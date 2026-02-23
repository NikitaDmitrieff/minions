import { Octokit } from '@octokit/rest'
import { getInstallationToken, isGitHubAppConfigured } from './github-app.js'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = SupabaseClient<any, any, any>

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL ?? ''

async function notifySlack(message: string): Promise<void> {
  if (!SLACK_WEBHOOK_URL) return
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })
  } catch { /* don't break pipeline for Slack */ }
}

/** Fetch a GitHub token for the project (installation token or PAT fallback). */
async function getProjectToken(supabase: Supabase, projectId: string): Promise<{ token: string; repo: string }> {
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo, github_installation_id')
    .eq('id', projectId)
    .single()

  if (!project?.github_repo) throw new Error(`Project ${projectId} has no github_repo`)

  if (project.github_installation_id && isGitHubAppConfigured()) {
    const token = await getInstallationToken(project.github_installation_id)
    return { token, repo: project.github_repo }
  }

  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('No GitHub token available')
  return { token, repo: project.github_repo }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

/**
 * Auto-approve draft proposals and queue build jobs.
 * Only runs if autonomy_mode is 'assist' or 'automate' and project is not paused.
 */
export async function autoApproveAndTriggerBuilds(
  supabase: Supabase,
  projectId: string,
  cycleId: string | null,
): Promise<void> {
  // Fetch project settings
  const { data: project } = await supabase
    .from('projects')
    .select('autonomy_mode, max_concurrent_branches, risk_paths, paused')
    .eq('id', projectId)
    .single()

  if (!project) return

  // No auto-approval in audit mode or when paused
  if (project.autonomy_mode === 'audit' || project.paused) {
    console.log(`[autonomy] Skipping auto-approve: mode=${project.autonomy_mode}, paused=${project.paused}`)
    return
  }

  // Fetch draft proposals for this cycle (or all if no cycle)
  let query = supabase
    .from('proposals')
    .select('id, title, spec, priority, scores, source_finding_ids, is_wild_card')
    .eq('project_id', projectId)
    .eq('status', 'draft')

  if (cycleId) {
    query = query.eq('cycle_id', cycleId)
  }

  const { data: drafts } = await query

  if (!drafts?.length) {
    console.log('[autonomy] No draft proposals to auto-approve')
    return
  }

  // Count active branches (approved/implementing proposals)
  const { count: activeBranches } = await supabase
    .from('proposals')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .in('status', ['approved', 'implementing'])

  const maxBranches = project.max_concurrent_branches ?? 3
  let slotsAvailable = maxBranches - (activeBranches ?? 0)

  if (slotsAvailable <= 0) {
    console.log(`[autonomy] No branch slots available (${activeBranches}/${maxBranches} in use)`)
    return
  }

  // Sort proposals by average score descending
  const sorted = drafts.sort((a, b) => {
    const avgA = avgScore(a.scores)
    const avgB = avgScore(b.scores)
    return avgB - avgA
  })

  const riskPaths: string[] = (project.risk_paths as string[]) ?? []

  // Pick the single best proposal
  let chosen: typeof sorted[0] | null = null
  for (const proposal of sorted) {
    // In assist mode, skip proposals that touch risk paths
    if (project.autonomy_mode === 'assist' && riskPaths.length > 0) {
      const specLower = (proposal.spec || '').toLowerCase()
      const touchesRisk = riskPaths.some(p => specLower.includes(p.toLowerCase()))
      if (touchesRisk) {
        console.log(`[autonomy] Skipping "${proposal.title}" — touches risk paths (assist mode)`)
        continue
      }
    }
    chosen = proposal
    break
  }

  if (!chosen) {
    console.log('[autonomy] No eligible proposal found after filtering')
    return
  }

  // Reject the rest
  const rejected = sorted.filter(p => p.id !== chosen!.id)
  for (const p of rejected) {
    await supabase.from('proposals')
      .update({ status: 'rejected', completed_at: new Date().toISOString(), reject_reason: `Not selected — "${chosen.title}" scored higher` })
      .eq('id', p.id)
    console.log(`[autonomy] Skipped "${p.title}" (score ${avgScore(p.scores).toFixed(2)}) in favor of top pick`)
  }

  const branchName = `proposals/${slugify(chosen.title)}`

  // Update proposal to approved
  await supabase.from('proposals')
    .update({
      status: 'approved',
      branch_name: branchName,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', chosen.id)

  // Emit auto_approved branch event
  await supabase.from('branch_events').insert({
    project_id: projectId,
    branch_name: branchName,
    event_type: 'auto_approved',
    event_data: {
      proposal_id: chosen.id,
      proposal_title: chosen.title,
      autonomy_mode: project.autonomy_mode,
      score: avgScore(chosen.scores),
    },
    actor: 'autonomy',
  })

  // Record in strategy_memory
  await supabase.from('strategy_memory').insert({
    project_id: projectId,
    proposal_id: chosen.id,
    event_type: 'approved',
    title: chosen.title,
    themes: [],
    outcome_notes: `Auto-approved in ${project.autonomy_mode} mode (top pick from ${drafts.length} proposals, score ${avgScore(chosen.scores).toFixed(2)})`,
  })

  // Create pipeline_run entry
  const { data: pipelineRun } = await supabase.from('pipeline_runs').insert({
    project_id: projectId,
    github_issue_number: 0,
    stage: 'queued',
    triggered_by: 'autonomy',
  }).select('id').single()

  // Create build job in job_queue
  await supabase.from('job_queue').insert({
    project_id: projectId,
    github_issue_number: 0,
    issue_title: chosen.title,
    issue_body: JSON.stringify({
      proposal_id: chosen.id,
      branch_name: branchName,
      spec: chosen.spec,
      title: chosen.title,
      pipeline_run_id: pipelineRun?.id,
    }),
    job_type: 'build',
    status: 'pending',
  })

  console.log(`[autonomy] Auto-approved and queued build: "${chosen.title}" (score ${avgScore(chosen.scores).toFixed(2)}) → ${branchName}`)
}

/** Check if auto-merge should proceed. */
export async function shouldAutoMerge(supabase: Supabase, projectId: string): Promise<boolean> {
  const { data: project } = await supabase
    .from('projects')
    .select('autonomy_mode, paused, merge_in_progress')
    .eq('id', projectId)
    .single()

  if (!project) return false
  return project.autonomy_mode === 'automate' && !project.paused && !project.merge_in_progress
}

/**
 * Auto-merge a PR after reviewer approval.
 * Acquires a merge lock, squash-merges, creates checkpoint, checks cycle completion.
 */
export async function autoMergePR(
  supabase: Supabase,
  projectId: string,
  payload: { proposal_id: string; pr_number: number; head_sha: string; branch_name: string },
): Promise<void> {
  // Acquire merge lock (optimistic concurrency)
  const { data: locked, error: lockError } = await supabase
    .from('projects')
    .update({ merge_in_progress: true })
    .eq('id', projectId)
    .eq('merge_in_progress', false)
    .select('id')
    .single()

  if (lockError || !locked) {
    console.log('[autonomy] Could not acquire merge lock — another merge in progress')
    return
  }

  try {
    const { token, repo } = await getProjectToken(supabase, projectId)
    const [owner, repoName] = repo.split('/')
    const octokit = new Octokit({ auth: token })

    // Verify HEAD SHA still matches (prevent merging stale code)
    const { data: pr } = await octokit.pulls.get({
      owner,
      repo: repoName,
      pull_number: payload.pr_number,
    })

    if (pr.head.sha !== payload.head_sha) {
      console.log(`[autonomy] HEAD SHA mismatch: expected ${payload.head_sha.slice(0, 7)}, got ${pr.head.sha.slice(0, 7)} — rejecting proposal`)
      await supabase.from('branch_events').insert({
        project_id: projectId,
        branch_name: payload.branch_name,
        event_type: 'merge_failed',
        event_data: { reason: 'SHA mismatch', expected: payload.head_sha, actual: pr.head.sha },
        actor: 'autonomy',
      })
      await supabase.from('proposals')
        .update({ status: 'rejected', completed_at: new Date().toISOString(), reject_reason: 'HEAD SHA changed after review' })
        .eq('id', payload.proposal_id)
      await notifySlack(`⚠️ *Merge aborted* <https://github.com/${repo}/pull/${payload.pr_number}|PR #${payload.pr_number}> — SHA changed after review`)
      await checkCycleCompletion(supabase, projectId, payload.proposal_id)
      return
    }

    // Squash merge — with conflict handling
    let mergeResult: { sha: string }
    try {
      const { data } = await octokit.pulls.merge({
        owner,
        repo: repoName,
        pull_number: payload.pr_number,
        merge_method: 'squash',
      })
      mergeResult = data
    } catch (mergeErr: unknown) {
      const msg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr)
      console.log(`[autonomy] Merge failed for PR #${payload.pr_number}: ${msg}`)
      await supabase.from('branch_events').insert({
        project_id: projectId,
        branch_name: payload.branch_name,
        event_type: 'merge_failed',
        event_data: { reason: msg, pr_number: payload.pr_number },
        actor: 'autonomy',
      })
      await supabase.from('proposals')
        .update({ status: 'rejected', completed_at: new Date().toISOString(), reject_reason: `Merge failed: ${msg.slice(0, 200)}` })
        .eq('id', payload.proposal_id)
      await notifySlack(`❌ *Merge failed* <https://github.com/${repo}/pull/${payload.pr_number}|PR #${payload.pr_number}>: ${msg.slice(0, 100)}`)
      await checkCycleCompletion(supabase, projectId, payload.proposal_id)
      return
    }

    const mergeSha = mergeResult.sha ?? 'unknown'

    // Mark proposal as done
    await supabase.from('proposals')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', payload.proposal_id)

    // Emit events
    await supabase.from('branch_events').insert([
      {
        project_id: projectId,
        branch_name: payload.branch_name,
        event_type: 'pr_merged',
        event_data: { pr_number: payload.pr_number, merge_sha: mergeSha },
        commit_sha: mergeSha,
        actor: 'autonomy',
      },
      {
        project_id: projectId,
        branch_name: payload.branch_name,
        event_type: 'auto_merged',
        event_data: { pr_number: payload.pr_number, merge_sha: mergeSha },
        commit_sha: mergeSha,
        actor: 'autonomy',
      },
    ])

    // Update pipeline_run to deployed
    const { data: run } = await supabase
      .from('pipeline_runs')
      .select('id')
      .eq('project_id', projectId)
      .or(`github_pr_number.eq.${payload.pr_number}`)
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    if (run) {
      await supabase.from('pipeline_runs')
        .update({ stage: 'deployed', completed_at: new Date().toISOString(), result: 'success' })
        .eq('id', run.id)
    }

    // Create merge checkpoint
    await createCheckpoint(supabase, projectId, {
      cycleId: null, // Will be filled by checkCycleCompletion if applicable
      proposalId: payload.proposal_id,
      checkpointType: 'merge',
      commitSha: mergeSha,
      prNumber: payload.pr_number,
      branchName: payload.branch_name,
    })

    // Delete remote branch
    try {
      await octokit.git.deleteRef({
        owner,
        repo: repoName,
        ref: `heads/${payload.branch_name}`,
      })
    } catch {
      // Branch may already be deleted — not critical
    }

    console.log(`[autonomy] Auto-merged PR #${payload.pr_number} (${mergeSha.slice(0, 7)})`)
    await notifySlack(`🎉 *Merged* <https://github.com/${repo}/pull/${payload.pr_number}|PR #${payload.pr_number}> into main\nCommit: \`${mergeSha.slice(0, 7)}\` · <https://github.com/${repo}/commit/${mergeSha}|View>`)

    // Check if the cycle is now complete
    await checkCycleCompletion(supabase, projectId, payload.proposal_id)
  } finally {
    // Release merge lock
    await supabase.from('projects')
      .update({ merge_in_progress: false })
      .eq('id', projectId)
  }
}

/**
 * Check if all proposals in a cycle are resolved. If so, emit cycle_completed
 * and optionally re-trigger a scout for the next cycle.
 */
export async function checkCycleCompletion(
  supabase: Supabase,
  projectId: string,
  proposalId: string,
): Promise<void> {
  // Get the cycle_id from the completed proposal
  const { data: proposal } = await supabase
    .from('proposals')
    .select('cycle_id')
    .eq('id', proposalId)
    .single()

  if (!proposal?.cycle_id) return // No cycle tracking — nothing to check

  const cycleId = proposal.cycle_id

  // Check if all proposals in this cycle are resolved
  const { count: unresolved } = await supabase
    .from('proposals')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('cycle_id', cycleId)
    .not('status', 'in', '("done","rejected")')

  if ((unresolved ?? 0) > 0) {
    console.log(`[autonomy] Cycle ${cycleId.slice(0, 8)} not complete — ${unresolved} proposals still active`)
    return
  }

  console.log(`[autonomy] Cycle ${cycleId.slice(0, 8)} complete — all proposals resolved`)

  // Emit cycle_completed event
  await supabase.from('branch_events').insert({
    project_id: projectId,
    branch_name: 'main',
    event_type: 'cycle_completed',
    event_data: { cycle_id: cycleId },
    actor: 'autonomy',
  })

  // Create cycle checkpoint (snapshot HEAD of default branch)
  const { token, repo } = await getProjectToken(supabase, projectId)
  const [owner, repoName] = repo.split('/')
  const octokit = new Octokit({ auth: token })

  // Get default branch HEAD
  const { data: project } = await supabase
    .from('projects')
    .select('default_branch, autonomy_mode, paused')
    .eq('id', projectId)
    .single()

  const defaultBranch = project?.default_branch ?? 'main'

  try {
    const { data: ref } = await octokit.git.getRef({
      owner,
      repo: repoName,
      ref: `heads/${defaultBranch}`,
    })

    await createCheckpoint(supabase, projectId, {
      cycleId,
      proposalId: null,
      checkpointType: 'cycle_complete',
      commitSha: ref.object.sha,
      prNumber: null,
      branchName: defaultBranch,
    })
  } catch {
    console.error('[autonomy] Failed to fetch default branch HEAD for cycle checkpoint')
  }

  // Re-trigger scout if automate mode and not paused
  if (project?.autonomy_mode === 'automate' && !project.paused) {
    // Dedup check: skip if scout already pending/processing
    const { count: existingScout } = await supabase
      .from('job_queue')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('job_type', 'scout')
      .in('status', ['pending', 'processing'])

    if ((existingScout ?? 0) === 0) {
      await supabase.from('job_queue').insert({
        project_id: projectId,
        github_issue_number: 0,
        issue_title: 'Auto-scout after cycle completion',
        issue_body: '{}',
        job_type: 'scout',
        status: 'pending',
      })

      await supabase.from('branch_events').insert({
        project_id: projectId,
        branch_name: 'main',
        event_type: 'cycle_started',
        event_data: { triggered_by: 'cycle_completion', previous_cycle_id: cycleId },
        actor: 'autonomy',
      })

      console.log(`[autonomy] Re-triggered scout for next cycle`)
      await notifySlack(`🔄 *Cycle complete* — all proposals resolved. Starting new scout cycle.`)
    } else {
      console.log(`[autonomy] Scout already pending/processing — skipping re-trigger`)
    }
  }
}

/** Insert a checkpoint record and emit a branch event. */
export async function createCheckpoint(
  supabase: Supabase,
  projectId: string,
  opts: {
    cycleId: string | null
    proposalId: string | null
    checkpointType: 'merge' | 'cycle_complete'
    commitSha: string
    prNumber: number | null
    branchName: string | null
    metadata?: Record<string, unknown>
  },
): Promise<void> {
  await supabase.from('checkpoints').insert({
    project_id: projectId,
    cycle_id: opts.cycleId,
    proposal_id: opts.proposalId,
    checkpoint_type: opts.checkpointType,
    commit_sha: opts.commitSha,
    pr_number: opts.prNumber,
    branch_name: opts.branchName,
    metadata: opts.metadata ?? {},
  })

  await supabase.from('branch_events').insert({
    project_id: projectId,
    branch_name: opts.branchName ?? 'main',
    event_type: 'checkpoint_created',
    event_data: {
      checkpoint_type: opts.checkpointType,
      commit_sha: opts.commitSha,
      pr_number: opts.prNumber,
    },
    commit_sha: opts.commitSha,
    actor: 'autonomy',
  })
}

function avgScore(scores: Record<string, number> | null): number {
  if (!scores) return 0
  const vals = [scores.impact, scores.feasibility, scores.novelty, scores.alignment].filter(
    (v): v is number => v != null
  )
  if (vals.length === 0) return 0
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

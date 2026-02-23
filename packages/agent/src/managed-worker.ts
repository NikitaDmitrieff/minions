import { createSupabaseClient } from './supabase.js'
import { runManagedJob } from './worker.js'
// setup-worker stripped for minions (no consumer setup flow)
import { classifyFailure } from './classify-failure.js'
import { runSelfImproveJob } from './self-improve-worker.js'
import { runStrategizeJob } from './strategize-worker.js'
import { runScoutJob } from './scout-worker.js'
import { runBuilderJob } from './builder-worker.js'
import { runReviewerJob } from './reviewer-worker.js'
import { getInstallationToken, getInstallationFirstRepo, isGitHubAppConfigured } from './github-app.js'
import { initCredentials, ensureValidToken } from './oauth.js'
import { autoApproveAndTriggerBuilds, shouldAutoMerge, autoMergePR, checkCycleCompletion } from './autonomy.js'
type Supabase = ReturnType<typeof createSupabaseClient>

const POLL_INTERVAL_MS = 5_000
const PAUSE_POLL_MS = 30_000
const STALE_THRESHOLD_MINUTES = 60
const MAX_ATTEMPTS = 3
const MAX_BACKOFF_MS = 60_000
const WORKER_ID = `worker-${process.pid}-${Date.now()}`
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL ?? ''

/** Fire-and-forget Slack notification for pipeline events. */
async function notifySlack(message: string): Promise<void> {
  if (!SLACK_WEBHOOK_URL) return
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })
  } catch {
    // Don't let Slack failures break the pipeline
  }
}

async function reapStaleJobs(supabase: Supabase) {
  const cutoff = new Date(Date.now() - STALE_THRESHOLD_MINUTES * 60_000).toISOString()

  const { data: staleJobs } = await supabase
    .from('job_queue')
    .select('id, attempt_count')
    .eq('status', 'processing')
    .lt('locked_at', cutoff)

  if (!staleJobs?.length) return

  for (const job of staleJobs) {
    if (job.attempt_count >= MAX_ATTEMPTS) {
      await supabase
        .from('job_queue')
        .update({
          status: 'failed',
          last_error: `Stale after ${MAX_ATTEMPTS} attempts (locked_at exceeded ${STALE_THRESHOLD_MINUTES}m)`,
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id)
        .eq('status', 'processing')
      console.log(`[${WORKER_ID}] Reaped stale job ${job.id} → failed (exhausted)`)
    } else {
      await supabase
        .from('job_queue')
        .update({
          status: 'pending',
          worker_id: null,
          locked_at: null,
          last_error: `Reset by reaper (attempt ${job.attempt_count}/${MAX_ATTEMPTS})`,
        })
        .eq('id', job.id)
        .eq('status', 'processing')
      console.log(`[${WORKER_ID}] Reaped stale job ${job.id} → pending (attempt ${job.attempt_count}/${MAX_ATTEMPTS})`)
    }
  }
}

async function pollForJobs(supabase: Supabase) {
  const { data: job, error } = await supabase.rpc('claim_next_job', {
    p_worker_id: WORKER_ID,
    p_skip_setup: false,
  })

  if (error || !job) return null
  return job
}

async function fetchCredentials(supabase: Supabase, projectId: string) {
  const { data } = await supabase
    .from('credentials')
    .select('type, encrypted_value')
    .eq('project_id', projectId)
    .single()

  if (data) {
    return {
      claudeCredentials: data.type === 'claude_oauth' ? data.encrypted_value : undefined,
      anthropicApiKey: data.type === 'anthropic_api_key' ? data.encrypted_value : undefined,
    }
  }

  // Fall back to system credentials (the dashboard owner's credential)
  const claudeCredentials = process.env.CLAUDE_CREDENTIALS_JSON
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY
  if (!claudeCredentials && !anthropicApiKey) {
    throw new Error(`No credentials for project ${projectId} and no system credential configured`)
  }
  console.log(`[${WORKER_ID}] No project credential found — using system credential`)
  return { claudeCredentials, anthropicApiKey }
}

async function fetchGithubConfig(supabase: Supabase, projectId: string) {
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo, github_installation_id')
    .eq('id', projectId)
    .single()

  if (!project) throw new Error(`Project ${projectId} not found`)

  // For GitHub App projects, use an installation token
  if (project.github_installation_id && isGitHubAppConfigured()) {
    const token = await getInstallationToken(project.github_installation_id)
    return { token, repo: project.github_repo }
  }

  // Fallback: use GITHUB_TOKEN env var (legacy PAT-based projects)
  const token = process.env.GITHUB_TOKEN
  if (!token) throw new Error('GITHUB_TOKEN must be set on the worker')

  return { token, repo: project.github_repo }
}

async function fetchProject(supabase: Supabase, projectId: string) {
  const { data } = await supabase
    .from('projects')
    .select('id, name, github_repo, github_installation_id, default_branch, paused')
    .eq('id', projectId)
    .single()
  if (!data) throw new Error(`Project ${projectId} not found`)
  return data
}

async function findRunId(supabase: Supabase, projectId: string, issueNumber: number, jobId?: string): Promise<string> {
  // For autonomous builds (issue_number=0), try to find by pipeline_run_id from job payload
  if (jobId && issueNumber === 0) {
    const { data: job } = await supabase
      .from('job_queue')
      .select('issue_body')
      .eq('id', jobId)
      .single()

    if (job?.issue_body) {
      try {
        const payload = JSON.parse(job.issue_body)
        if (payload.pipeline_run_id) {
          return payload.pipeline_run_id
        }
      } catch { /* fall through */ }
    }
  }

  const { data } = await supabase
    .from('pipeline_runs')
    .select('id')
    .eq('project_id', projectId)
    .eq('github_issue_number', issueNumber)
    .order('started_at', { ascending: false })
    .limit(1)
    .single()

  if (!data) throw new Error(`No pipeline run found for issue #${issueNumber}`)
  return data.id
}

async function handleFailedJob(
  supabase: Supabase,
  job: { id: string; project_id: string; job_type?: string; github_issue_number: number; issue_body: string },
) {
  // Recursion guard: only classify agent (implement) job failures
  if (['self_improve', 'setup', 'strategize', 'scout', 'build', 'review'].includes(job.job_type ?? '')) return

  try {
    // Find the run ID for this job
    const { data: run, error: runError } = await supabase
      .from('pipeline_runs')
      .select('id')
      .eq('project_id', job.project_id)
      .eq('github_issue_number', job.github_issue_number)
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    if (!run) {
      console.warn(`[${WORKER_ID}] handleFailedJob: no pipeline_run for project=${job.project_id} issue=#${job.github_issue_number}`, runError?.message)
      return
    }

    console.log(`[${WORKER_ID}] handleFailedJob: found run ${run.id}, fetching logs...`)

    // Fetch logs for classification
    const { data: logs } = await supabase
      .from('run_logs')
      .select('level, message')
      .eq('run_id', run.id)
      .order('timestamp', { ascending: false })
      .limit(100)

    const { data: jobData } = await supabase
      .from('job_queue')
      .select('last_error')
      .eq('id', job.id)
      .single()

    console.log(`[${WORKER_ID}] handleFailedJob: ${(logs || []).length} logs, lastError=${(jobData?.last_error || '').slice(0, 100)}`)

    // Classify
    const classification = await classifyFailure({
      logs: (logs || []).reverse(),
      lastError: jobData?.last_error || '',
      issueBody: job.issue_body,
      jobType: job.job_type || 'implement',
    })

    if (!classification) {
      console.warn(`[${WORKER_ID}] handleFailedJob: classification returned null`)
      return
    }

    // Store classification on the pipeline run
    await supabase
      .from('pipeline_runs')
      .update({
        failure_category: classification.category,
        failure_analysis: classification.analysis,
      })
      .eq('id', run.id)

    console.log(`[${WORKER_ID}] Classified failure for run ${run.id}: ${classification.category}`)

    // Only spawn improvement job for our-fault categories
    if (!['docs_gap', 'widget_bug', 'agent_bug'].includes(classification.category)) return

    // Create self-improvement job
    const payload = JSON.stringify({
      fix_summary: classification.fix_summary,
      original_issue_body: job.issue_body.slice(0, 2000),
      log_excerpts: (logs || [])
        .reverse()
        .map((l: { level: string; message: string }) => `[${l.level}] ${l.message}`)
        .join('\n')
        .slice(-3000),
    })

    const { data: newJob } = await supabase
      .from('job_queue')
      .insert({
        project_id: job.project_id,
        github_issue_number: 0, // not tied to a consumer issue
        issue_title: `Self-improve: ${classification.category}`,
        issue_body: payload,
        job_type: 'self_improve',
        source_run_id: run.id,
        status: 'pending',
      })
      .select('id')
      .single()

    if (newJob) {
      console.log(`[${WORKER_ID}] Spawned self-improvement job ${newJob.id} (category: ${classification.category})`)
    }
  } catch (err) {
    console.error(`[${WORKER_ID}] Failed to classify/spawn improvement:`, err instanceof Error ? err.message : err)
  }
}

async function processJob(supabase: Supabase, job: {
  id: string
  project_id: string
  job_type?: string
  attempt_count?: number
  github_issue_number: number
  issue_title: string
  issue_body: string
  source_run_id?: string
}) {
  console.log(`[${WORKER_ID}] Processing job ${job.id} (type=${job.job_type ?? 'implement'}, ${job.job_type === 'self_improve' ? `source_run=${job.source_run_id}` : `issue #${job.github_issue_number}`})`)

  // Per-project pause check
  try {
    const project = await fetchProject(supabase, job.project_id)
    if (project.paused) {
      console.log(`[${WORKER_ID}] Project ${job.project_id} is paused — releasing job back to pending`)
      await supabase.from('job_queue').update({
        status: 'pending',
        worker_id: null,
        locked_at: null,
      }).eq('id', job.id)
      return
    }
  } catch { /* project fetch failed — proceed anyway */ }

  try {
    // Dispatch based on job type
    if (job.job_type === 'self_improve') {
      // Self-improvement job: clone feedback-chat and fix it
      const { data: sourceRun } = await supabase
        .from('pipeline_runs')
        .select('failure_category, failure_analysis')
        .eq('id', job.source_run_id)
        .single()

      if (!sourceRun?.failure_category) {
        throw new Error(`Source run ${job.source_run_id} has no failure classification`)
      }

      // Parse the fix_summary from the job's issue_body (we store it as JSON)
      let payload: { fix_summary?: string; original_issue_body?: string; log_excerpts?: string } = {}
      try { payload = JSON.parse(job.issue_body) } catch {}

      const result = await runSelfImproveJob({
        jobId: job.id,
        sourceRunId: job.source_run_id!,
        failureCategory: sourceRun.failure_category,
        failureAnalysis: sourceRun.failure_analysis || '',
        fixSummary: payload.fix_summary || '',
        originalIssueBody: payload.original_issue_body || '',
        logExcerpts: payload.log_excerpts || '',
        supabase,
      })

      if (result.prUrl) {
        // Link the improvement job back to the source run
        await supabase
          .from('pipeline_runs')
          .update({ improvement_job_id: job.id })
          .eq('id', job.source_run_id)
      }
    } else if (job.job_type === 'strategize') {
      // Extract cycle_id from issue_body (passed from scout auto-trigger)
      let strategizePayload: { cycle_id?: string } = {}
      try { strategizePayload = JSON.parse(job.issue_body) } catch {}
      const strategizeCycleId = strategizePayload.cycle_id || null

      await runStrategizeJob({
        jobId: job.id,
        projectId: job.project_id,
        cycleId: strategizeCycleId,
        supabase,
      })
      // Auto-approve proposals after strategize completes
      await autoApproveAndTriggerBuilds(supabase, job.project_id, strategizeCycleId)
      await notifySlack(`Strategize complete — proposals auto-approved and queued for build`)
    } else if (job.job_type === 'scout') {
      await runScoutJob({
        jobId: job.id,
        projectId: job.project_id,
        supabase,
      })

      // Auto-trigger strategist after scout completes (thread scout job ID as cycle reference)
      // Note: source_run_id has FK to pipeline_runs, so we pass cycle_id through issue_body instead
      const cycleId = job.id
      console.log(`[${WORKER_ID}] Scout complete, auto-triggering strategize for project ${job.project_id} (cycle ${cycleId.slice(0, 8)})`)
      await notifySlack(`Scout complete — triggering strategize (cycle ${cycleId.slice(0, 8)})`)
      await supabase.from('job_queue').insert({
        project_id: job.project_id,
        github_issue_number: 0,
        issue_title: 'Auto-strategize after scout',
        issue_body: JSON.stringify({ cycle_id: cycleId }),
        job_type: 'strategize',
        status: 'pending',
      })
    } else if (job.job_type === 'build') {
      // Builder job: implement a proposal spec into a PR
      let payload: { proposal_id?: string; branch_name?: string; spec?: string; title?: string } = {}
      try { payload = JSON.parse(job.issue_body) } catch {}

      if (!payload.proposal_id || !payload.branch_name || !payload.spec) {
        throw new Error('Build job missing required payload fields: proposal_id, branch_name, spec')
      }

      // Update pipeline_run stage to running
      const buildRunId = await findRunId(supabase, job.project_id, job.github_issue_number, job.id)
      await supabase.from('pipeline_runs').update({ stage: 'running' }).eq('id', buildRunId)

      await supabase.from('branch_events').insert({
        project_id: job.project_id,
        branch_name: payload.branch_name,
        event_type: 'build_started',
        event_data: {
          proposal_id: payload.proposal_id,
          title: payload.title || job.issue_title,
        },
        actor: 'builder',
      })

      await notifySlack(`Build started: "${payload.title || job.issue_title}" → branch ${payload.branch_name}`)

      const result = await runBuilderJob({
        jobId: job.id,
        projectId: job.project_id,
        proposalId: payload.proposal_id,
        branchName: payload.branch_name,
        spec: payload.spec,
        title: payload.title || job.issue_title,
        supabase,
      })

      // Update pipeline_run with PR number and stage
      if (result.prNumber) {
        await supabase.from('pipeline_runs')
          .update({ stage: 'validating', github_pr_number: result.prNumber })
          .eq('id', buildRunId)
      }

      // Auto-trigger reviewer after builder completes with a PR
      if (result.prNumber && result.headSha) {
        console.log(`[${WORKER_ID}] Build complete, auto-triggering review for PR #${result.prNumber}`)
        await supabase.from('job_queue').insert({
          project_id: job.project_id,
          github_issue_number: job.github_issue_number,
          issue_title: `Review PR #${result.prNumber}`,
          issue_body: JSON.stringify({
            proposal_id: payload.proposal_id,
            pr_number: result.prNumber,
            head_sha: result.headSha,
            branch_name: payload.branch_name,
          }),
          job_type: 'review',
          status: 'pending',
        })
      } else {
        // Builder produced no changes — reject proposal and move on
        console.log(`[${WORKER_ID}] Build produced no changes — rejecting proposal ${payload.proposal_id}`)
        await notifySlack(`Build produced no changes for "${payload.title || job.issue_title}" — proposal rejected`)

        await supabase.from('proposals')
          .update({ status: 'rejected', completed_at: new Date().toISOString(), reject_reason: 'Builder produced no code changes' })
          .eq('id', payload.proposal_id)

        await supabase.from('pipeline_runs')
          .update({ stage: 'failed', completed_at: new Date().toISOString(), result: 'failure' })
          .eq('id', buildRunId)

        // Trigger cycle completion check so pipeline doesn't stall
        await checkCycleCompletion(supabase, job.project_id, payload.proposal_id!)
      }
    } else if (job.job_type === 'review') {
      // Reviewer job: AI code review of a PR
      let payload: { proposal_id?: string; pr_number?: number; head_sha?: string; branch_name?: string } = {}
      try { payload = JSON.parse(job.issue_body) } catch {}

      if (!payload.proposal_id || !payload.pr_number || !payload.head_sha || !payload.branch_name) {
        throw new Error('Review job missing required payload fields: proposal_id, pr_number, head_sha, branch_name')
      }

      await supabase.from('branch_events').insert({
        project_id: job.project_id,
        branch_name: payload.branch_name,
        event_type: 'review_started',
        event_data: {
          proposal_id: payload.proposal_id,
          pr_number: payload.pr_number,
          head_sha: payload.head_sha,
        },
        actor: 'reviewer',
      })

      const reviewResult = await runReviewerJob({
        jobId: job.id,
        projectId: job.project_id,
        proposalId: payload.proposal_id,
        prNumber: payload.pr_number,
        headSha: payload.head_sha,
        branchName: payload.branch_name,
        supabase,
      })

      // Complete proposal lifecycle based on review outcome
      if (reviewResult.approved) {
        // Try auto-merge if in automate mode
        if (await shouldAutoMerge(supabase, job.project_id)) {
          console.log(`[${WORKER_ID}] Review approved — attempting auto-merge for PR #${payload.pr_number}`)
          await notifySlack(`Review approved — auto-merging PR #${payload.pr_number}`)
          await autoMergePR(supabase, job.project_id, {
            proposal_id: payload.proposal_id!,
            pr_number: payload.pr_number!,
            head_sha: payload.head_sha!,
            branch_name: payload.branch_name!,
          })
        } else {
          // Manual mode: mark proposal done and pipeline deployed
          await supabase.from('proposals')
            .update({ status: 'done', completed_at: new Date().toISOString() })
            .eq('id', payload.proposal_id)
          console.log(`[${WORKER_ID}] Review approved — proposal ${payload.proposal_id} marked as done`)

          const { data: reviewRun } = await supabase
            .from('pipeline_runs')
            .select('id')
            .eq('project_id', job.project_id)
            .eq('github_issue_number', job.github_issue_number)
            .order('started_at', { ascending: false })
            .limit(1)
            .single()

          if (reviewRun) {
            await supabase.from('pipeline_runs')
              .update({ stage: 'deployed', completed_at: new Date().toISOString(), result: 'success' })
              .eq('id', reviewRun.id)
          }
        }
      } else {
        // Reviewer requested changes or rejected
        console.log(`[${WORKER_ID}] Review rejected — proposal ${payload.proposal_id}`)
        await notifySlack(`Review rejected PR #${payload.pr_number} — reviewer requested changes`)
        await supabase.from('proposals')
          .update({ status: 'rejected', completed_at: new Date().toISOString(), reject_reason: 'Reviewer requested changes' })
          .eq('id', payload.proposal_id)

        await supabase.from('branch_events').insert({
          project_id: job.project_id,
          branch_name: payload.branch_name,
          event_type: 'review_rejected',
          event_data: { proposal_id: payload.proposal_id, pr_number: payload.pr_number },
          actor: 'reviewer',
        })

        // Check if all proposals in cycle are resolved — triggers next scout
        await checkCycleCompletion(supabase, job.project_id, payload.proposal_id!)
      }
    } else {
      // Default: implement job (existing flow)
      const creds = await fetchCredentials(supabase, job.project_id)
      const github = await fetchGithubConfig(supabase, job.project_id)
      const runId = await findRunId(supabase, job.project_id, job.github_issue_number)

      await runManagedJob({
        issueNumber: job.github_issue_number,
        issueTitle: job.issue_title,
        issueBody: job.issue_body,
        projectId: job.project_id,
        github,
        ...creds,
        runId,
        supabase,
      })
    }

    await supabase
      .from('job_queue')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('id', job.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[${WORKER_ID}] Job ${job.id} failed:`, message)

    const isOAuthError = /authentication_error|invalid_grant|\b401\b|OAuth/i.test(message)
    const isPermanentFailure = isOAuthError || (job.attempt_count ?? 0) + 1 >= MAX_ATTEMPTS

    try {
      if (isOAuthError) {
        // OAuth errors are permanent — no retry
        await supabase
          .from('job_queue')
          .update({
            status: 'failed',
            last_error: `OAuth error (no retry): ${message}`,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id)
        await handleFailedJob(supabase, job)
      } else if ((job.attempt_count ?? 0) + 1 < MAX_ATTEMPTS) {
        // Retryable — reset to pending
        await supabase
          .from('job_queue')
          .update({
            status: 'pending',
            worker_id: null,
            locked_at: null,
            last_error: message,
          })
          .eq('id', job.id)
        console.log(`[${WORKER_ID}] Job ${job.id} reset to pending for retry`)
      } else {
        // Exhausted retries
        await supabase
          .from('job_queue')
          .update({
            status: 'failed',
            last_error: `Failed after ${MAX_ATTEMPTS} attempts: ${message}`,
            completed_at: new Date().toISOString(),
          })
          .eq('id', job.id)
        await handleFailedJob(supabase, job)
      }

      // Mark pipeline_run as failed for build/review jobs on permanent failure
      if (isPermanentFailure && ['build', 'review'].includes(job.job_type ?? '')) {
        const { data: failedRun } = await supabase
          .from('pipeline_runs')
          .select('id')
          .eq('project_id', job.project_id)
          .eq('github_issue_number', job.github_issue_number)
          .order('started_at', { ascending: false })
          .limit(1)
          .single()

        if (failedRun) {
          await supabase.from('pipeline_runs')
            .update({ result: 'failed', completed_at: new Date().toISOString() })
            .eq('id', failedRun.id)
          console.log(`[${WORKER_ID}] Marked pipeline_run ${failedRun.id} as failed`)
        }
      }
    } catch (updateErr) {
      console.error(`[${WORKER_ID}] Failed to update job ${job.id} status:`, updateErr)
    }
  }
}

async function main() {
  const supabase = createSupabaseClient()
  console.log(`[${WORKER_ID}] Starting managed worker, polling every ${POLL_INTERVAL_MS}ms`)

  // Initialize system Claude credential at startup (reads from Supabase first, then env var)
  if (await initCredentials()) {
    await ensureValidToken()
  }

  let consecutiveErrors = 0

  while (true) {
    if (process.env.WORKER_PAUSED === 'true') {
      await new Promise((r) => setTimeout(r, PAUSE_POLL_MS))
      continue
    }

    try {
      await reapStaleJobs(supabase)

      const job = await pollForJobs(supabase)

      // Successful DB round-trip — reset backoff
      consecutiveErrors = 0

      if (job) {
        // Refresh OAuth token before each job — access tokens expire after ~8h
        await ensureValidToken()
        await processJob(supabase, job)
      } else {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      }
    } catch (err) {
      consecutiveErrors++
      const backoff = Math.min(POLL_INTERVAL_MS * 2 ** (consecutiveErrors - 1), MAX_BACKOFF_MS)
      console.error(
        `[${WORKER_ID}] Poll loop error (${consecutiveErrors} consecutive, retrying in ${backoff}ms):`,
        err instanceof Error ? err.message : err,
      )
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
}

main().catch((err) => {
  console.error('Worker crashed:', err)
  process.exit(1)
})

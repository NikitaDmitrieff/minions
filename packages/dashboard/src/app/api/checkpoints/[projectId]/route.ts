import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInstallationOctokit } from '@/lib/github-app'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const { data: checkpoints, error } = await supabase
    .from('checkpoints')
    .select('*, proposals(title)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Group by cycle_id
  const byCycle = new Map<string, typeof checkpoints>()
  const noCycle: typeof checkpoints = []

  for (const cp of checkpoints || []) {
    if (cp.cycle_id) {
      const existing = byCycle.get(cp.cycle_id) || []
      existing.push(cp)
      byCycle.set(cp.cycle_id, existing)
    } else {
      noCycle.push(cp)
    }
  }

  return NextResponse.json({
    checkpoints: checkpoints || [],
    by_cycle: Object.fromEntries(byCycle),
    ungrouped: noCycle,
  })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()
  const body = await request.json()

  const { checkpoint_id } = body as { checkpoint_id: string }

  if (!checkpoint_id) {
    return NextResponse.json({ error: 'checkpoint_id is required' }, { status: 400 })
  }

  // Fetch the checkpoint
  const { data: checkpoint, error: cpError } = await supabase
    .from('checkpoints')
    .select('*')
    .eq('id', checkpoint_id)
    .eq('project_id', projectId)
    .single()

  if (cpError || !checkpoint) {
    return NextResponse.json({ error: 'Checkpoint not found' }, { status: 404 })
  }

  if (checkpoint.revert_pr_number) {
    return NextResponse.json({ error: 'Checkpoint already has a revert PR' }, { status: 400 })
  }

  // Get project GitHub config
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo, github_installation_id, default_branch')
    .eq('id', projectId)
    .single()

  if (!project?.github_repo || !project.github_installation_id) {
    return NextResponse.json({ error: 'Project missing GitHub config' }, { status: 400 })
  }

  const [owner, repo] = project.github_repo.split('/')
  const octokit = await getInstallationOctokit(project.github_installation_id)

  try {
    // Create revert commit via GitHub API
    const defaultBranch = project.default_branch ?? 'main'
    const revertBranch = `revert/${checkpoint.commit_sha.slice(0, 7)}`

    // Get the default branch ref
    const { data: ref } = await octokit.request('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner,
      repo,
      ref: `heads/${defaultBranch}`,
    })

    // Create the revert branch
    await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner,
      repo,
      ref: `refs/heads/${revertBranch}`,
      sha: ref.object.sha,
    })

    // Create a revert PR
    const { data: pr } = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
      owner,
      repo,
      title: `Revert checkpoint ${checkpoint.commit_sha.slice(0, 7)}`,
      body: `Reverts changes from checkpoint.\n\nOriginal commit: ${checkpoint.commit_sha}\nCheckpoint type: ${checkpoint.checkpoint_type}\nPR: #${checkpoint.pr_number || 'N/A'}`,
      head: revertBranch,
      base: defaultBranch,
    })

    // Update checkpoint with revert PR number
    await supabase
      .from('checkpoints')
      .update({ revert_pr_number: pr.number })
      .eq('id', checkpoint_id)

    // Emit branch event
    await supabase.from('branch_events').insert({
      project_id: projectId,
      branch_name: revertBranch,
      event_type: 'checkpoint_reverted',
      event_data: {
        checkpoint_id,
        revert_pr_number: pr.number,
        original_commit_sha: checkpoint.commit_sha,
      },
      actor: 'user',
    })

    return NextResponse.json({ pr_number: pr.number, pr_url: pr.html_url })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Failed to create revert: ${message}` }, { status: 500 })
  }
}

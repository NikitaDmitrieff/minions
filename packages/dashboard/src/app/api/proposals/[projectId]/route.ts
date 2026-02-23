import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getInstallationOctokit } from '@/lib/github-app'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const { searchParams } = request.nextUrl
  const status = searchParams.get('status')

  let query = supabase
    .from('proposals')
    .select('*')
    .eq('project_id', projectId)

  if (status) {
    query = query.eq('status', status)
  }

  const { data: proposals, error } = await query
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ proposals })
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const body = await request.json()
  const { title, spec, priority } = body as { title: string; spec: string; priority: string }

  if (!title?.trim() || !spec?.trim()) {
    return NextResponse.json({ error: 'Title and spec are required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('proposals')
    .insert({
      project_id: projectId,
      title: title.trim(),
      rationale: 'User-created proposal',
      spec: spec.trim(),
      priority: priority === 'high' ? 'high' : priority === 'low' ? 'low' : 'medium',
      scores: {},
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ proposal: data })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const body = await request.json()
  const { proposalId, action, userNotes, rejectReason, modifiedSpec, branchName } = body as {
    proposalId: string
    action: 'approve' | 'reject'
    userNotes?: string
    rejectReason?: string
    modifiedSpec?: string
    branchName?: string
  }

  if (!proposalId || !action) {
    return NextResponse.json({ error: 'proposalId and action are required' }, { status: 400 })
  }

  // Fetch proposal
  const { data: proposal, error: fetchError } = await supabase
    .from('proposals')
    .select('*')
    .eq('id', proposalId)
    .eq('project_id', projectId)
    .single()

  if (fetchError || !proposal) {
    return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  }

  if (action === 'reject') {
    const { error } = await supabase
      .from('proposals')
      .update({
        status: 'rejected',
        reject_reason: rejectReason || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', proposalId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Record in strategy memory
    await supabase.from('strategy_memory').insert({
      project_id: projectId,
      proposal_id: proposalId,
      event_type: 'rejected',
      title: proposal.title,
      themes: [],
      outcome_notes: rejectReason || null,
    })

    await supabase.from('branch_events').insert({
      project_id: projectId,
      branch_name: 'main',
      event_type: 'proposal_rejected',
      event_data: {
        proposal_id: proposalId,
        proposal_title: proposal.title,
        reject_reason: rejectReason || null,
      },
      actor: 'user',
    })

    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  if (action === 'approve') {
    // Use modified spec if user edited it, otherwise use original
    const finalSpec = modifiedSpec || proposal.spec

    // Update proposal
    const { error } = await supabase
      .from('proposals')
      .update({
        status: 'approved',
        spec: finalSpec,
        user_notes: userNotes || null,
        branch_name: branchName || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', proposalId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Create GitHub issue (for tracking — not for triggering the build)
    let issueNumber: number | null = null
    try {
      issueNumber = await createGitHubIssue(supabase, projectId, proposal.title, finalSpec, userNotes, branchName)
      if (issueNumber) {
        await supabase
          .from('proposals')
          .update({ github_issue_number: issueNumber })
          .eq('id', proposalId)
      }
    } catch (err) {
      console.error('[proposals] Failed to create GitHub issue:', err)
    }

    // Create build job directly — don't rely on webhook round-trip
    const finalBranch = branchName
      || `proposals/${proposal.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '').slice(0, 50)}`

    const { data: job } = await supabase.from('job_queue').insert({
      project_id: projectId,
      github_issue_number: issueNumber ?? 0,
      issue_title: proposal.title,
      issue_body: JSON.stringify({
        proposal_id: proposalId,
        branch_name: finalBranch,
        spec: finalSpec,
        title: proposal.title,
      }),
      job_type: 'build',
      status: 'pending',
    }).select('id').single()

    if (job) {
      await supabase.from('pipeline_runs').insert({
        job_id: job.id,
        project_id: projectId,
        github_issue_number: issueNumber ?? 0,
        stage: 'queued',
        triggered_by: 'user',
      })
    }

    // Record in strategy memory with edit distance
    const editDist = modifiedSpec ? calculateEditDistance(proposal.spec, modifiedSpec) : 0
    await supabase.from('strategy_memory').insert({
      project_id: projectId,
      proposal_id: proposalId,
      event_type: 'approved',
      title: proposal.title,
      themes: [],
      outcome_notes: userNotes || null,
      edit_distance: editDist,
    })

    await supabase.from('branch_events').insert({
      project_id: projectId,
      branch_name: branchName || 'main',
      event_type: 'proposal_approved',
      event_data: {
        proposal_id: proposalId,
        proposal_title: proposal.title,
        github_issue_number: issueNumber,
        branch_name: branchName || null,
        user_notes: userNotes || null,
      },
      actor: 'user',
    })

    return NextResponse.json({ ok: true, status: 'approved', github_issue_number: issueNumber })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

async function createGitHubIssue(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
  title: string,
  spec: string,
  userNotes?: string,
  branchName?: string,
): Promise<number | null> {
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo, github_installation_id')
    .eq('id', projectId)
    .single()

  if (!project?.github_repo || !project?.github_installation_id) return null

  const [owner, repo] = project.github_repo.split('/')
  if (!owner || !repo) return null

  const octokit = await getInstallationOctokit(project.github_installation_id)

  const metadata = branchName ? `\n## Metadata\nBranch: ${branchName}` : ''
  const prompt = userNotes
    ? `${spec}\n\nAdditional guidance from the user:\n${userNotes}`
    : spec
  const body = `## Generated Prompt
\`\`\`
${prompt}
\`\`\`

## Spec Content
${spec}
${metadata}

<!-- agent-meta: ${JSON.stringify({ prompt_type: 'simple', visitor_name: 'proposals-system' })} -->

---
*Auto-generated by the proposals system.*`

  const { data: issue } = await octokit.request('POST /repos/{owner}/{repo}/issues', {
    owner,
    repo,
    title,
    body,
    labels: ['feedback-bot', 'auto-implement'],
  })

  return issue.number
}

function calculateEditDistance(original: string, modified: string): number {
  if (original === modified) return 0
  const maxLen = Math.max(original.length, modified.length)
  if (maxLen === 0) return 0
  let changes = 0
  for (let i = 0; i < maxLen; i++) {
    if (original[i] !== modified[i]) changes++
  }
  return changes / maxLen
}

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { BranchState } from '@/lib/types'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  // Fetch branch events for the project, ordered by time
  const { data: events, error } = await supabase
    .from('branch_events')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Group events by branch
  const branches = new Map<string, typeof events>()
  const unbranched: typeof events = []

  for (const event of events || []) {
    if (event.branch_name) {
      const existing = branches.get(event.branch_name) || []
      existing.push(event)
      branches.set(event.branch_name, existing)
    } else {
      unbranched.push(event)
    }
  }

  // Determine branch states
  const branchStates = Array.from(branches.entries()).map(([name, branchEvents]) => {
    const lastEvent = branchEvents[branchEvents.length - 1]
    let state: BranchState

    if (lastEvent.event_type === 'pr_merged') state = 'merged'
    else if (lastEvent.event_type === 'proposal_rejected' || lastEvent.event_type === 'review_rejected') state = 'rejected'
    else if (lastEvent.event_type === 'build_failed') state = 'failed'
    else if (lastEvent.event_type === 'deploy_production') state = 'deployed'
    else if (lastEvent.event_type === 'build_started' || lastEvent.event_type === 'review_started') state = 'active'
    else if (lastEvent.event_type === 'review_approved' || lastEvent.event_type === 'build_completed') state = 'awaiting_approval'
    else state = 'pending'

    return { name, state, events: branchEvents, lastActivity: lastEvent.created_at }
  })

  // Fetch pending/queued jobs for "scheduled" view
  const { data: pendingJobs } = await supabase
    .from('job_queue')
    .select('id, job_type, status, issue_title, created_at')
    .eq('project_id', projectId)
    .in('status', ['pending', 'processing'])
    .order('created_at', { ascending: true })

  // Fetch project schedule info
  const { data: project } = await supabase
    .from('projects')
    .select('scout_schedule, paused')
    .eq('id', projectId)
    .single()

  return NextResponse.json({
    branches: branchStates.sort((a, b) =>
      new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
    ),
    unbranched,
    scheduled: {
      pending_jobs: pendingJobs || [],
      scout_schedule: project?.scout_schedule || '0 6 * * *',
      paused: project?.paused || false,
    },
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const body = await request.json()
  const { jobId, action } = body as { jobId: string; action: 'reset' | 'fail' }

  if (!jobId || !action) {
    return NextResponse.json({ error: 'jobId and action are required' }, { status: 400 })
  }

  // Verify the job belongs to this project and is currently processing
  const { data: job, error: fetchError } = await supabase
    .from('job_queue')
    .select('id, status, locked_at')
    .eq('id', jobId)
    .eq('project_id', projectId)
    .eq('status', 'processing')
    .single()

  if (fetchError || !job) {
    return NextResponse.json({ error: 'Job not found or not processing' }, { status: 404 })
  }

  if (action === 'reset') {
    // Reset to pending so the worker picks it up again
    const { error } = await supabase
      .from('job_queue')
      .update({
        status: 'pending',
        worker_id: null,
        locked_at: null,
        last_error: 'Manually reset from dashboard (suspected stale)',
      })
      .eq('id', jobId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, action: 'reset' })
  }

  if (action === 'fail') {
    // Mark as permanently failed
    const { error } = await supabase
      .from('job_queue')
      .update({
        status: 'failed',
        last_error: 'Manually failed from dashboard (suspected stale/zombie)',
        completed_at: new Date().toISOString(),
      })
      .eq('id', jobId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ ok: true, action: 'failed' })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}

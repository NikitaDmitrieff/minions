import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project, error } = await supabase
    .from('projects')
    .select('product_context, strategic_nudges')
    .eq('id', id)
    .single()

  if (error || !project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  return NextResponse.json(project)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createClient()
  const body = await request.json()

  const updates: Record<string, unknown> = {}

  if ('product_context' in body) {
    updates.product_context = body.product_context
  }
  if ('strategic_nudges' in body) {
    updates.strategic_nudges = body.strategic_nudges
  }
  if ('scout_schedule' in body) {
    updates.scout_schedule = body.scout_schedule
  }
  if ('autonomy_mode' in body) {
    updates.autonomy_mode = body.autonomy_mode
  }
  if ('max_concurrent_branches' in body) {
    updates.max_concurrent_branches = body.max_concurrent_branches
  }
  if ('paused' in body) {
    updates.paused = body.paused
  }
  if ('risk_paths' in body) {
    updates.risk_paths = body.risk_paths
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('projects')
    .update(updates)
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

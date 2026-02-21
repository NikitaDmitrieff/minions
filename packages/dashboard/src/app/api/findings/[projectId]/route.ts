import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  const { searchParams } = request.nextUrl
  const category = searchParams.get('category')
  const severity = searchParams.get('severity')
  const status = searchParams.get('status')
  const limit = Number(searchParams.get('limit')) || 100

  let query = supabase
    .from('findings')
    .select('*')
    .eq('project_id', projectId)

  if (category) query = query.eq('category', category)
  if (severity) query = query.eq('severity', severity)
  if (status) query = query.eq('status', status)

  const { data: findings, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ findings: findings || [] })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()
  const body = await request.json()

  const { findingIds, status } = body as { findingIds: string[]; status: string }

  if (!findingIds?.length || !status) {
    return NextResponse.json({ error: 'findingIds and status required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('findings')
    .update({ status })
    .eq('project_id', projectId)
    .in('id', findingIds)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

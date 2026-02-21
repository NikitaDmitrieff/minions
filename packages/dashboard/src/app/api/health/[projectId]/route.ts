import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const { projectId } = await params
  const supabase = await createClient()

  // Fetch health snapshots for the last 30 days
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { data: snapshots, error } = await supabase
    .from('health_snapshots')
    .select('*')
    .eq('project_id', projectId)
    .gte('snapshot_date', thirtyDaysAgo.toISOString().split('T')[0])
    .order('snapshot_date', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const latest = snapshots && snapshots.length > 0 ? snapshots[snapshots.length - 1] : null

  return NextResponse.json({
    snapshots: snapshots || [],
    latest,
  })
}

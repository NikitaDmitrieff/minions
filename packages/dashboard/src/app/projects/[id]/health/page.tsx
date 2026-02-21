import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { HealthPageClient } from './client'
import type { HealthSnapshot } from '@/lib/types'

export default async function HealthPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', id)
    .single()

  if (!project) notFound()

  // Fetch last 30 days of snapshots
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const { data: snapshots } = await supabase
    .from('health_snapshots')
    .select('*')
    .eq('project_id', id)
    .gte('snapshot_date', thirtyDaysAgo.toISOString().split('T')[0])
    .order('snapshot_date', { ascending: true })

  return (
    <div className="mx-auto max-w-5xl px-6 pt-10 pb-16">
      <HealthPageClient
        projectId={project.id}
        snapshots={(snapshots ?? []) as HealthSnapshot[]}
      />
    </div>
  )
}

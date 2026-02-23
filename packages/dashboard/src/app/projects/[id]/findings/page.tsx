import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FindingsPageClient } from './client'
import type { Finding, HealthSnapshot } from '@/lib/types'

export default async function FindingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo')
    .eq('id', id)
    .single()

  if (!project) notFound()

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [{ data: findings }, { data: snapshots }] = await Promise.all([
    supabase
      .from('findings')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('health_snapshots')
      .select('*')
      .eq('project_id', id)
      .gte('snapshot_date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('snapshot_date', { ascending: true }),
  ])

  return (
    <div className="mx-auto max-w-6xl px-6 pt-10 pb-16">
      <FindingsPageClient
        projectId={project.id}
        githubRepo={project.github_repo ?? ''}
        findings={(findings ?? []) as Finding[]}
        snapshots={(snapshots ?? []) as HealthSnapshot[]}
      />
    </div>
  )
}

import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProposalsPageClient } from './client'
import type { Proposal } from '@/lib/types'

export default async function ProposalsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo, github_installation_id')
    .eq('id', id)
    .single()

  if (!project) notFound()

  const [
    { data: proposals },
    { data: runs },
    { data: jobs },
    { data: allFindings },
  ] = await Promise.all([
    supabase
      .from('proposals')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('pipeline_runs')
      .select('id, github_issue_number, github_pr_number, stage, triggered_by, started_at, completed_at, result')
      .eq('project_id', id)
      .order('started_at', { ascending: false })
      .limit(50),
    supabase
      .from('job_queue')
      .select('id, project_id, job_type, status, github_issue_number')
      .eq('project_id', id)
      .in('status', ['pending', 'processing']),
    supabase
      .from('findings')
      .select('id, title, category')
      .eq('project_id', id),
  ])

  const findingsForSource = (allFindings ?? []).map((f: { id: string; title: string; category: string }) => ({
    id: f.id,
    title: f.title,
    category: f.category,
  }))

  return (
    <div className="mx-auto max-w-6xl px-6 pt-10 pb-16">
      <ProposalsPageClient
        projectId={project.id}
        githubRepo={project.github_repo}
        proposals={(proposals ?? []) as Proposal[]}
        runs={runs ?? []}
        activeJobs={jobs ?? []}
        sourceFindings={findingsForSource}
      />
    </div>
  )
}

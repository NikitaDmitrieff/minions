import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Github } from 'lucide-react'
import { DeleteProjectButton } from '@/components/delete-project-button'
import { GraphPageClient } from '@/components/graph-page-client'

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo, product_context, created_at, github_installation_id, setup_status')
    .eq('id', id)
    .single()

  if (!project) notFound()

  return (
    <div className="mx-auto max-w-6xl px-6 pt-10 pb-16">
      {/* Project header */}
      <div className="mb-8 flex items-start justify-between">
        <div>
          <h1 className="text-lg font-medium text-fg">{project.name}</h1>
          {project.github_repo && (
            <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
              <Github className="h-3 w-3" />
              {project.github_repo}
            </div>
          )}
        </div>
        <DeleteProjectButton projectId={project.id} />
      </div>

      <GraphPageClient projectId={project.id} />
    </div>
  )
}

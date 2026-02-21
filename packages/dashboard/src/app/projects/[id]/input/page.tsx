import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { InputPageClient } from './client'
import type { UserIdea } from '@/lib/types'

export default async function InputPage({
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

  const { data: ideas } = await supabase
    .from('user_ideas')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="mx-auto max-w-5xl px-6 pt-10 pb-16">
      <InputPageClient
        projectId={project.id}
        ideas={(ideas ?? []) as UserIdea[]}
      />
    </div>
  )
}

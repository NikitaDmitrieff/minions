import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FindingsPageClient } from './client'
import type { Finding } from '@/lib/types'

export default async function FindingsPage({
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

  const { data: findings } = await supabase
    .from('findings')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(200)

  return (
    <div className="mx-auto max-w-6xl px-6 pt-10 pb-16">
      <FindingsPageClient
        projectId={project.id}
        findings={(findings ?? []) as Finding[]}
      />
    </div>
  )
}

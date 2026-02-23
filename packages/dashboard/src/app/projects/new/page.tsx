import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { generateApiKey } from '@/lib/api-keys'
import crypto from 'node:crypto'
import { NewProjectForm } from './form'

export const dynamic = 'force-dynamic'

async function createProject(_prev: { error?: string } | null, formData: FormData): Promise<{ error?: string }> {
  'use server'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const name = formData.get('name') as string
  if (!name?.trim()) return { error: 'Project name is required' }

  const webhookSecret = crypto.randomBytes(32).toString('hex')

  const { data: project, error } = await supabase
    .from('projects')
    .insert({ name: name.trim(), webhook_secret: webhookSecret, user_id: user.id })
    .select('id')
    .single()

  if (error || !project) return { error: error?.message ?? 'Failed to create project' }

  const { raw, hash, prefix } = generateApiKey()
  const { error: keyError } = await supabase.from('api_keys').insert({
    project_id: project.id,
    key_hash: hash,
    prefix,
  })

  if (keyError) return { error: keyError.message }

  redirect(`/projects/${project.id}?apiKey=${encodeURIComponent(raw)}&webhookSecret=${encodeURIComponent(webhookSecret)}`)
}

export default function NewProjectPage() {
  return (
    <div className="mx-auto max-w-lg px-6 pt-10 pb-16">
      <div className="glass-card p-6">
        <h1 className="mb-6 text-base font-medium text-fg">New Project</h1>
        <NewProjectForm action={createProject} />
      </div>
    </div>
  )
}

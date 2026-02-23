'use client'

import { useActionState } from 'react'
import { SubmitButton } from './submit-button'

export function NewProjectForm({
  action,
}: {
  action: (prev: { error?: string } | null, formData: FormData) => Promise<{ error?: string }>
}) {
  const [state, formAction] = useActionState(action, null)

  return (
    <form action={formAction} className="space-y-5">
      {state?.error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {state.error}
        </div>
      )}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted">Project name</label>
        <input
          name="name"
          required
          placeholder="My App"
          className="input-field"
        />
      </div>
      <SubmitButton />
    </form>
  )
}

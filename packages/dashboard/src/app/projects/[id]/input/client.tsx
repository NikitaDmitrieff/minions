'use client'

import { useState, useEffect } from 'react'
import { Lightbulb, Loader2, Plus, X } from 'lucide-react'
import type { UserIdea } from '@/lib/types'

type Props = {
  projectId: string
  ideas: UserIdea[]
}

export function InputPageClient({ projectId, ideas: initialIdeas }: Props) {
  const [ideas, setIdeas] = useState(initialIdeas)
  const [ideaText, setIdeaText] = useState('')
  const [submittingIdea, setSubmittingIdea] = useState(false)

  // Create proposal state
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [proposalTitle, setProposalTitle] = useState('')
  const [proposalSpec, setProposalSpec] = useState('')
  const [proposalPriority, setProposalPriority] = useState('medium')
  const [submittingProposal, setSubmittingProposal] = useState(false)

  async function submitIdea() {
    if (!ideaText.trim()) return
    setSubmittingIdea(true)
    try {
      const res = await fetch(`/api/ideas/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: ideaText.trim() }),
      })
      if (res.ok) {
        const json = await res.json()
        setIdeas(prev => [json.idea, ...prev])
        setIdeaText('')
      }
    } finally {
      setSubmittingIdea(false)
    }
  }

  async function createProposal() {
    if (!proposalTitle.trim() || !proposalSpec.trim()) return
    setSubmittingProposal(true)
    try {
      const res = await fetch(`/api/proposals/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: proposalTitle.trim(),
          spec: proposalSpec.trim(),
          priority: proposalPriority,
        }),
      })
      if (res.ok) {
        setProposalTitle('')
        setProposalSpec('')
        setProposalPriority('medium')
        setShowCreateForm(false)
      }
    } finally {
      setSubmittingProposal(false)
    }
  }

  return (
    <>
      <div className="mb-8 flex items-center gap-3">
        <Lightbulb className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-medium text-fg">Your Input</h1>
      </div>

      <div className="space-y-6">
        {/* Quick Idea */}
        <div className="glass-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-fg">Quick Idea</h2>
          <p className="mb-3 text-xs text-muted">
            Drop a feature direction or improvement idea. The strategist will consider it in the next run.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={ideaText}
              onChange={e => setIdeaText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitIdea() }}
              placeholder="e.g., Add dark mode, Optimize page load, Add API rate limiting..."
              className="flex-1 rounded-lg bg-white/[0.04] px-3 py-2.5 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <button
              onClick={submitIdea}
              disabled={!ideaText.trim() || submittingIdea}
              className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-4 py-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
            >
              {submittingIdea ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Submit
            </button>
          </div>
        </div>

        {/* Manual Proposal */}
        <div className="glass-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Manual Proposal</h2>
            {!showCreateForm && (
              <button
                onClick={() => setShowCreateForm(true)}
                className="flex items-center gap-1 text-[11px] text-accent hover:text-fg"
              >
                <Plus className="h-3 w-3" />
                Create
              </button>
            )}
          </div>
          <p className="mb-3 text-xs text-muted">
            Create a proposal directly, bypassing the Scout and Strategist. Goes straight to the Kanban.
          </p>

          {showCreateForm && (
            <div className="space-y-4 rounded-lg border border-white/[0.06] p-4">
              {/* Title */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">Title</label>
                <input
                  type="text"
                  value={proposalTitle}
                  onChange={e => setProposalTitle(e.target.value)}
                  placeholder="What should be built?"
                  className="w-full rounded-lg bg-white/[0.04] px-3 py-2.5 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {/* Spec */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">Spec</label>
                <textarea
                  value={proposalSpec}
                  onChange={e => setProposalSpec(e.target.value)}
                  placeholder="Describe what you want in detail..."
                  rows={6}
                  className="w-full rounded-lg bg-white/[0.04] p-3 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {/* Priority */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted">Priority</label>
                <div className="flex gap-2">
                  {(['low', 'medium', 'high'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setProposalPriority(p)}
                      className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
                        proposalPriority === p
                          ? p === 'high' ? 'bg-red-400/20 text-red-400'
                            : p === 'low' ? 'bg-emerald-400/20 text-emerald-400'
                            : 'bg-amber-400/20 text-amber-400'
                          : 'bg-surface text-muted hover:text-fg'
                      }`}
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={createProposal}
                  disabled={!proposalTitle.trim() || !proposalSpec.trim() || submittingProposal}
                  className="flex items-center gap-2 rounded-lg bg-accent/20 px-4 py-2 text-xs font-medium text-accent transition-colors hover:bg-accent/30 disabled:opacity-50"
                >
                  {submittingProposal && <Loader2 className="h-3 w-3 animate-spin" />}
                  Create Proposal
                </button>
                <button
                  onClick={() => setShowCreateForm(false)}
                  className="rounded-lg bg-surface px-4 py-2 text-xs font-medium text-muted transition-colors hover:text-fg"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Recent Ideas */}
        <div className="glass-card p-5">
          <h2 className="mb-3 text-sm font-semibold text-fg">Your Ideas</h2>
          {ideas.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted">
              No ideas submitted yet. Drop one above.
            </p>
          ) : (
            <div className="space-y-1.5">
              {ideas.map(idea => (
                <div
                  key={idea.id}
                  className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <span className="text-sm text-fg">{idea.text}</span>
                    <span className="ml-2 text-[11px] text-dim">
                      {new Date(idea.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <span className={`ml-3 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    idea.status === 'incorporated' ? 'bg-green-400/10 text-green-400'
                      : idea.status === 'dismissed' ? 'bg-white/[0.06] text-muted'
                      : 'bg-amber-400/10 text-amber-400'
                  }`}>
                    {idea.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

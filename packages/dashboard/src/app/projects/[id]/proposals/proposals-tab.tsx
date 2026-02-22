'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Lightbulb, Loader2, X } from 'lucide-react'
import { ProposalSlideOver } from '@/components/proposal-slide-over'
import type { Proposal } from '@/lib/types'

type Props = {
  projectId: string
  githubRepo: string | null
  proposals: Proposal[]
  sourceFindings: { id: string; title: string; category: string }[]
}

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-red-400',
  medium: 'bg-amber-400',
  low: 'bg-emerald-400',
}

const STATUS_GROUPS = {
  pending: ['draft'],
  active: ['approved', 'implementing'],
  completed: ['done', 'rejected'],
} as const

function avgScore(scores: Proposal['scores']): number {
  const vals = [scores.impact, scores.feasibility, scores.novelty, scores.alignment].filter(
    (v): v is number => v != null
  )
  if (vals.length === 0) return 0
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

export function ProposalsTab({ projectId, githubRepo, proposals: initialProposals, sourceFindings }: Props) {
  const [proposals, setProposals] = useState(initialProposals)
  const [selected, setSelected] = useState<Proposal | null>(null)
  const findingsMap = useMemo(() => new Map(sourceFindings.map(f => [f.id, f])), [sourceFindings])

  // Create proposal state
  const [showCreateForm, setShowCreateForm] = useState(false)

  async function createUserProposal(title: string, spec: string, priority: string) {
    const res = await fetch(`/api/proposals/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, spec, priority }),
    })
    if (res.ok) {
      const json = await res.json()
      setProposals(prev => [json.proposal, ...prev])
      setShowCreateForm(false)
    }
  }

  const pending = proposals.filter(p => STATUS_GROUPS.pending.includes(p.status as 'draft'))
  const active = proposals.filter(p => STATUS_GROUPS.active.includes(p.status as 'approved' | 'implementing'))
  const completed = proposals.filter(p => STATUS_GROUPS.completed.includes(p.status as 'done' | 'rejected')).slice(0, 10)

  const handleUpdate = useCallback((updated: Proposal) => {
    setProposals(prev => prev.map(p => p.id === updated.id ? updated : p))
    setSelected(null)
  }, [])

  return (
    <>
      {/* Create proposal button */}
      <div className="mb-8">
        <button
          onClick={() => setShowCreateForm(true)}
          className="text-[11px] text-accent hover:text-fg"
        >
          + Create a proposal
        </button>
      </div>

      {/* Pending Review */}
      <Section title="Pending Review" count={pending.length} emptyText="No proposals awaiting review.">
        {pending
          .sort((a, b) => {
            const priorityOrder = { high: 0, medium: 1, low: 2 }
            return (priorityOrder[a.priority] ?? 1) - (priorityOrder[b.priority] ?? 1)
          })
          .map(p => (
            <ProposalCard key={p.id} proposal={p} onClick={() => setSelected(p)} sourceFindings={findingsMap} />
          ))}
      </Section>

      {/* In Progress */}
      {active.length > 0 && (
        <Section title="In Progress" count={active.length}>
          {active.map(p => (
            <ProposalCard key={p.id} proposal={p} onClick={() => setSelected(p)} sourceFindings={findingsMap} />
          ))}
        </Section>
      )}

      {/* Recently Completed */}
      {completed.length > 0 && (
        <Section title="Recently Completed" count={completed.length}>
          {completed.map(p => (
            <ProposalCard key={p.id} proposal={p} onClick={() => setSelected(p)} sourceFindings={findingsMap} />
          ))}
        </Section>
      )}

      {/* Empty state */}
      {proposals.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Lightbulb className="mb-4 h-8 w-8 text-muted" />
          <p className="text-sm text-muted">No proposals yet.</p>
          <p className="mt-1 text-xs text-dim">The strategist generates proposals from your feedback data.</p>
        </div>
      )}

      {selected && (
        <ProposalSlideOver
          proposal={selected}
          projectId={projectId}
          githubRepo={githubRepo}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
        />
      )}

      {showCreateForm && (
        <CreateProposalSlideOver
          onClose={() => setShowCreateForm(false)}
          onCreate={createUserProposal}
        />
      )}
    </>
  )
}

function Section({
  title,
  count,
  emptyText,
  children,
}: {
  title: string
  count: number
  emptyText?: string
  children: React.ReactNode
}) {
  return (
    <div className="mb-8">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-sm font-medium text-fg">{title}</h2>
        <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] tabular-nums text-muted">
          {count}
        </span>
      </div>
      {count === 0 && emptyText ? (
        <p className="py-6 text-center text-sm text-muted">{emptyText}</p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  )
}

function ProposalCard({ proposal, onClick, sourceFindings }: { proposal: Proposal; onClick: () => void; sourceFindings?: Map<string, { id: string; title: string; category: string }> }) {
  const score = avgScore(proposal.scores)
  const statusColors: Record<string, string> = {
    draft: 'text-muted',
    approved: 'text-accent',
    implementing: 'text-amber-400',
    done: 'text-success',
    rejected: 'text-red-400',
  }

  return (
    <button
      onClick={onClick}
      className="glass-card flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-white/[0.06]"
    >
      <div className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[proposal.priority] ?? 'bg-gray-400'}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-0">
          <p className="truncate text-sm font-medium text-fg">{proposal.title}</p>
          {proposal.is_wild_card && (
            <span className="ml-2 inline-flex shrink-0 rounded-full bg-purple-400/10 px-1.5 py-0.5 text-[9px] font-medium text-purple-400">
              Wild Card
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-dim">{proposal.rationale.slice(0, 80)}</p>
        {proposal.source_finding_ids && proposal.source_finding_ids.length > 0 && sourceFindings && (
          <div className="mt-1 flex items-center gap-1 flex-wrap">
            {proposal.source_finding_ids.slice(0, 3).map(fid => {
              const finding = sourceFindings.get(fid)
              if (!finding) return null
              return (
                <span key={fid} className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-muted">
                  {finding.category.replace('_', ' ')}
                </span>
              )
            })}
            {proposal.source_finding_ids.length > 3 && (
              <span className="text-[9px] text-dim">+{proposal.source_finding_ids.length - 3}</span>
            )}
          </div>
        )}
      </div>
      {Object.keys(proposal.scores).length > 0 ? (
        score > 0 && (
          <div className="flex shrink-0 items-center gap-2">
            <div className="h-1 w-12 overflow-hidden rounded-full bg-surface">
              <div
                className="h-full rounded-full bg-accent"
                style={{ width: `${score * 100}%` }}
              />
            </div>
            <span className="text-[11px] tabular-nums text-muted">{(score * 100).toFixed(0)}</span>
          </div>
        )
      ) : (
        <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">User</span>
      )}
      {proposal.status !== 'draft' && (
        <span className={`shrink-0 text-[11px] font-medium ${statusColors[proposal.status] ?? 'text-muted'}`}>
          {proposal.status}
        </span>
      )}
    </button>
  )
}

function CreateProposalSlideOver({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (title: string, spec: string, priority: string) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [spec, setSpec] = useState('')
  const [priority, setPriority] = useState('medium')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  async function handleSubmit() {
    if (!title.trim() || !spec.trim()) return
    setSubmitting(true)
    try {
      await onCreate(title.trim(), spec.trim(), priority)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div className="slide-over-backdrop" onClick={onClose} />

      <div className="fixed top-0 right-0 z-50 flex h-screen w-full max-w-[480px] flex-col border-l border-edge bg-bg/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-6 py-4">
          <h2 className="text-sm font-medium text-fg">Create Proposal</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Title */}
          <div className="mb-5">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Title</h3>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="What should be built?"
              className="w-full rounded-lg bg-surface px-3 py-2.5 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* Spec */}
          <div className="mb-5">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Spec</h3>
            <textarea
              value={spec}
              onChange={e => setSpec(e.target.value)}
              placeholder="Describe what you want in detail..."
              rows={8}
              className="w-full rounded-lg bg-surface p-3 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          {/* Priority */}
          <div className="mb-5">
            <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Priority</h3>
            <div className="flex gap-2">
              {(['low', 'medium', 'high'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    priority === p
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
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-edge px-6 py-4">
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !spec.trim() || submitting}
            className="flex h-9 items-center gap-2 rounded-xl bg-accent/20 px-4 text-sm font-medium text-accent transition-colors hover:bg-accent/30 disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            Create Proposal
          </button>
          <button
            onClick={onClose}
            className="flex h-9 items-center rounded-xl bg-surface px-4 text-sm font-medium text-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}

'use client'

import { Fragment } from 'react'
import {
  Search, Lightbulb, Hammer, Eye, GitPullRequest, Rocket,
  Check, X as XIcon,
} from 'lucide-react'
import type { BranchEvent, Branch, BranchState } from '@/lib/types'

/* ── Pipeline stage config ── */
const STAGES = [
  { id: 'scout',   label: 'Scout',   Icon: Search,         match: ['scout_finding'], done: ['scout_finding'], fail: [] as string[] },
  { id: 'propose', label: 'Propose', Icon: Lightbulb,      match: ['proposal_created', 'proposal_approved', 'proposal_rejected'], done: ['proposal_approved'], fail: ['proposal_rejected'] },
  { id: 'build',   label: 'Build',   Icon: Hammer,         match: ['build_started', 'build_completed', 'build_failed', 'build_remediation'], done: ['build_completed'], fail: ['build_failed'] },
  { id: 'review',  label: 'Review',  Icon: Eye,            match: ['review_started', 'review_approved', 'review_rejected'], done: ['review_approved'], fail: ['review_rejected'] },
  { id: 'pr',      label: 'PR',      Icon: GitPullRequest, match: ['pr_created', 'pr_merged'], done: ['pr_merged'], fail: [] as string[] },
  { id: 'deploy',  label: 'Deploy',  Icon: Rocket,         match: ['deploy_preview', 'deploy_production'], done: ['deploy_production', 'deploy_preview'], fail: [] as string[] },
]

type StageState = 'done' | 'active' | 'failed' | 'waiting'

const STATE_BADGES: Record<BranchState, { color: string; bg: string; label: string }> = {
  active:            { color: 'text-blue-400',    bg: 'bg-blue-400/10',    label: 'Building' },
  awaiting_approval: { color: 'text-amber-400',   bg: 'bg-amber-400/10',   label: 'Awaiting Review' },
  needs_action:      { color: 'text-amber-400',   bg: 'bg-amber-400/10',   label: 'Needs Action' },
  merged:            { color: 'text-emerald-400', bg: 'bg-emerald-400/10', label: 'Merged' },
  rejected:          { color: 'text-red-400',     bg: 'bg-red-400/10',     label: 'Rejected' },
  failed:            { color: 'text-red-400',     bg: 'bg-red-400/10',     label: 'Failed' },
  deployed:          { color: 'text-purple-400',  bg: 'bg-purple-400/10',  label: 'Deployed' },
  pending:           { color: 'text-muted',       bg: 'bg-surface',        label: 'Pending' },
}

/* ── Helpers ── */

function resolveStage(events: BranchEvent[], stage: typeof STAGES[number]): { state: StageState; event: BranchEvent | null } {
  const matched = events.filter(e => stage.match.includes(e.event_type))
  if (matched.length === 0) return { state: 'waiting', event: null }
  const last = matched[matched.length - 1]
  if (stage.fail.includes(last.event_type)) return { state: 'failed', event: last }
  if (stage.done.includes(last.event_type)) return { state: 'done', event: last }
  return { state: 'active', event: last }
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/* ── Stage node ── */

function StageNode({ state, Icon, label, onClick }: {
  state: StageState
  Icon: typeof Search
  label: string
  onClick: (() => void) | null
}) {
  const ring: Record<StageState, string> = {
    done:    'border-emerald-500/50 bg-emerald-500/15 text-emerald-400 shadow-[0_0_12px_rgba(34,197,94,0.15)]',
    active:  'border-blue-400/50 bg-blue-400/15 text-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.2)]',
    failed:  'border-red-400/50 bg-red-400/15 text-red-400 shadow-[0_0_12px_rgba(239,68,68,0.15)]',
    waiting: 'border-white/[0.08] bg-white/[0.02] text-white/20',
  }

  return (
    <button
      onClick={onClick ?? undefined}
      disabled={!onClick}
      className="group flex flex-col items-center gap-1.5"
    >
      <div className={`relative flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] transition-all duration-200 ${ring[state]} ${onClick ? 'cursor-pointer group-hover:scale-110' : 'cursor-default'}`}>
        {state === 'done' ? (
          <Check className="h-[18px] w-[18px]" />
        ) : state === 'failed' ? (
          <XIcon className="h-[18px] w-[18px]" />
        ) : (
          <Icon className="h-[18px] w-[18px]" />
        )}
        {state === 'active' && (
          <span className="absolute inset-0 animate-ping rounded-full border-[1.5px] border-current opacity-30" />
        )}
      </div>
      <span className={`text-[10px] font-medium tracking-wider uppercase ${state === 'waiting' ? 'text-white/15' : 'text-muted'}`}>
        {label}
      </span>
    </button>
  )
}

/* ── Connector between stages ── */

function StageConnector({ left }: { left: StageState }) {
  return (
    <div className="relative flex flex-1 items-center">
      <div className={`h-[1.5px] w-full transition-colors duration-300 ${
        left === 'done'
          ? 'bg-emerald-500/30'
          : left === 'failed'
            ? 'bg-red-400/20'
            : 'bg-white/[0.05]'
      }`} />
    </div>
  )
}

/* ── Branch row ── */

function BranchRow({ branch, onEventClick }: { branch: Branch; onEventClick: (e: BranchEvent) => void }) {
  const badge = STATE_BADGES[branch.state] || STATE_BADGES.pending
  const stages = STAGES.map(s => ({ ...s, ...resolveStage(branch.events, s) }))

  return (
    <div className="glass-card p-5 transition-all duration-200 hover:border-white/[0.12]">
      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <span className="text-[13px] font-medium text-fg font-[family-name:var(--font-mono)]">
          {branch.name.replace('minions/', '')}
        </span>
        <div className="flex items-center gap-3">
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${badge.color} ${badge.bg}`}>
            {badge.label}
          </span>
          <span className="text-[11px] tabular-nums text-muted">{timeAgo(branch.lastActivity)}</span>
        </div>
      </div>

      {/* Pipeline stages */}
      <div className="flex items-start px-2">
        {stages.map((s, i) => (
          <Fragment key={s.id}>
            {i > 0 && <StageConnector left={stages[i - 1].state} />}
            <StageNode
              state={s.state}
              Icon={s.Icon}
              label={s.label}
              onClick={s.event ? () => onEventClick(s.event!) : null}
            />
          </Fragment>
        ))}
      </div>
    </div>
  )
}

/* ── Pipeline graph ── */

export function PipelineGraph({ branches, onEventClick }: {
  branches: Branch[]
  onEventClick: (event: BranchEvent) => void
}) {
  if (branches.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-muted">
        No branch activity yet. Run a Scout scan to get started.
      </div>
    )
  }

  // Sort: active branches first, then by last activity
  const sorted = [...branches].sort((a, b) => {
    const activeOrder: Record<string, number> = { needs_action: 0, active: 1, awaiting_approval: 2, failed: 3 }
    const aOrder = activeOrder[a.state] ?? 3
    const bOrder = activeOrder[b.state] ?? 3
    if (aOrder !== bOrder) return aOrder - bOrder
    return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  })

  return (
    <div className="space-y-3">
      {sorted.map(branch => (
        <BranchRow key={branch.name} branch={branch} onEventClick={onEventClick} />
      ))}
    </div>
  )
}

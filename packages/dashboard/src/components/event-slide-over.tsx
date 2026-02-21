'use client'

import { useEffect, useCallback } from 'react'
import {
  X,
  ExternalLink,
  GitPullRequest,
  AlertTriangle,
  Search,
  Lightbulb,
  Hammer,
  Eye,
  Rocket,
  GitMerge,
  Trash2,
  RefreshCw,
  FileCode,
} from 'lucide-react'
import type { BranchEvent } from '@/lib/types'

type Props = {
  event: BranchEvent
  onClose: () => void
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400 bg-red-400/10',
  high: 'text-orange-400 bg-orange-400/10',
  medium: 'text-amber-400 bg-amber-400/10',
  low: 'text-emerald-400 bg-emerald-400/10',
}

const EVENT_TYPE_CONFIG: Record<string, { icon: typeof Search; label: string; color: string }> = {
  scout_finding:      { icon: Search,      label: 'Scout Finding',    color: 'text-blue-400' },
  proposal_created:   { icon: Lightbulb,   label: 'Proposal Created', color: 'text-accent' },
  proposal_approved:  { icon: Lightbulb,   label: 'Proposal Approved',color: 'text-success' },
  proposal_rejected:  { icon: Lightbulb,   label: 'Proposal Rejected',color: 'text-red-400' },
  build_started:      { icon: Hammer,      label: 'Build Started',    color: 'text-blue-400' },
  build_completed:    { icon: Hammer,      label: 'Build Completed',  color: 'text-success' },
  build_failed:       { icon: AlertTriangle,label: 'Build Failed',    color: 'text-red-400' },
  build_remediation:  { icon: RefreshCw,   label: 'Remediation',      color: 'text-amber-400' },
  review_started:     { icon: Eye,         label: 'Review Started',   color: 'text-blue-400' },
  review_approved:    { icon: Eye,         label: 'Review Approved',  color: 'text-success' },
  review_rejected:    { icon: Eye,         label: 'Review Rejected',  color: 'text-red-400' },
  pr_created:         { icon: GitPullRequest, label: 'PR Created',    color: 'text-accent' },
  pr_merged:          { icon: GitMerge,    label: 'PR Merged',        color: 'text-success' },
  deploy_preview:     { icon: Rocket,      label: 'Preview Deployed', color: 'text-purple-400' },
  deploy_production:  { icon: Rocket,      label: 'Production Deploy',color: 'text-success' },
  branch_deleted:     { icon: Trash2,      label: 'Branch Deleted',   color: 'text-muted' },
}

function ScoutFindingContent({ data }: { data: Record<string, unknown> }) {
  const severity = data.severity as string | undefined
  const category = data.category as string | undefined
  const filePath = data.file_path as string | undefined

  return (
    <div className="space-y-4">
      {(severity || category) && (
        <div className="flex items-center gap-2">
          {severity && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_COLORS[severity] || 'text-muted bg-surface'}`}>
              {severity}
            </span>
          )}
          {category && (
            <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted">
              {category.replace('_', ' ')}
            </span>
          )}
        </div>
      )}
      {typeof data.title === 'string' && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Finding</h3>
          <p className="text-sm text-fg">{data.title}</p>
        </div>
      )}
      {filePath && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">File</h3>
          <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5">
            <FileCode className="h-3.5 w-3.5 shrink-0 text-muted" />
            <span className="font-[family-name:var(--font-mono)] text-sm text-fg">{filePath}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function ProposalContent({ data }: { data: Record<string, unknown> }) {
  const scores = data.scores as Record<string, number> | undefined

  return (
    <div className="space-y-4">
      {typeof data.proposal_title === 'string' && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Proposal</h3>
          <p className="text-sm text-fg">{data.proposal_title}</p>
        </div>
      )}
      {scores && Object.keys(scores).length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Scores</h3>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(scores).map(([key, val]) => (
              <div key={key} className="rounded-lg bg-surface p-3">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
                  {key}
                </span>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${val * 100}%` }} />
                  </div>
                  <span className="text-xs tabular-nums text-fg">{(val * 100).toFixed(0)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function BuildContent({ data, eventType }: { data: Record<string, unknown>; eventType: string }) {
  const diffStats = data.diff_stats as string | undefined
  const error = data.error as string | undefined
  const stage = data.stage as string | undefined
  const attempt = data.attempt as number | undefined
  const remediationAttempts = data.remediation_attempts as number | undefined

  return (
    <div className="space-y-4">
      {eventType === 'build_failed' && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/5 p-3">
          <p className="text-xs font-medium text-red-400">
            {stage ? `Failed at: ${stage}` : 'Build failed'}
            {remediationAttempts != null && ` (after ${remediationAttempts} remediation attempts)`}
          </p>
        </div>
      )}
      {eventType === 'build_remediation' && attempt != null && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
          <p className="text-xs font-medium text-amber-400">
            Remediation attempt #{attempt}{stage ? ` — fixing ${stage}` : ''}
          </p>
        </div>
      )}
      {error && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Error Output</h3>
          <pre className="overflow-x-auto rounded-lg bg-surface p-3 font-[family-name:var(--font-mono)] text-xs leading-relaxed text-fg">
            {error}
          </pre>
        </div>
      )}
      {diffStats && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Diff Stats</h3>
          <pre className="overflow-x-auto rounded-lg bg-surface p-3 font-[family-name:var(--font-mono)] text-xs leading-relaxed text-fg">
            {diffStats}
          </pre>
        </div>
      )}
    </div>
  )
}

function ReviewContent({ data, eventType }: { data: Record<string, unknown>; eventType: string }) {
  const comments = data.comments as string[] | undefined
  const riskLevel = data.risk_level as string | undefined
  const riskFiles = data.risk_files as string[] | undefined

  return (
    <div className="space-y-4">
      {eventType === 'review_rejected' && riskLevel === 'high' && riskFiles && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/5 p-3">
          <p className="mb-1 text-xs font-medium text-red-400">High-Risk Files Modified</p>
          <ul className="space-y-0.5 text-xs text-red-300">
            {riskFiles.map((f, i) => (
              <li key={i} className="font-[family-name:var(--font-mono)]">{f}</li>
            ))}
          </ul>
        </div>
      )}
      {comments && comments.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Review Comments</h3>
          <div className="space-y-2">
            {comments.map((comment, i) => (
              <div key={i} className="rounded-lg bg-surface p-3">
                <p className="text-sm text-fg">{comment}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {(!comments || comments.length === 0) && eventType === 'review_approved' && (
        <div className="rounded-lg border border-success/20 bg-success/5 p-3">
          <p className="text-xs font-medium text-success">No issues found. Approved.</p>
        </div>
      )}
    </div>
  )
}

function PRContent({ data }: { data: Record<string, unknown> }) {
  const prNumber = data.pr_number as number | undefined
  const prUrl = data.pr_url as string | undefined

  return (
    <div className="space-y-4">
      {prUrl && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Pull Request</h3>
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm text-accent transition-colors hover:bg-surface-hover"
          >
            <GitPullRequest className="h-4 w-4 shrink-0" />
            <span>{prNumber ? `PR #${prNumber}` : 'View Pull Request'}</span>
            <ExternalLink className="ml-auto h-3 w-3 text-muted" />
          </a>
        </div>
      )}
    </div>
  )
}

function DeployContent({ data, eventType }: { data: Record<string, unknown>; eventType: string }) {
  const url = (data.preview_url || data.production_url || data.url) as string | undefined

  return (
    <div className="space-y-4">
      {url && (
        <div>
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">
            {eventType === 'deploy_production' ? 'Production URL' : 'Preview URL'}
          </h3>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm text-accent transition-colors hover:bg-surface-hover"
          >
            <Rocket className="h-4 w-4 shrink-0" />
            <span className="truncate">{url.replace('https://', '')}</span>
            <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-muted" />
          </a>
        </div>
      )}
    </div>
  )
}

function renderEventContent(event: BranchEvent) {
  const data = event.event_data

  switch (event.event_type) {
    case 'scout_finding':
      return <ScoutFindingContent data={data} />
    case 'proposal_created':
    case 'proposal_approved':
    case 'proposal_rejected':
      return <ProposalContent data={data} />
    case 'build_started':
    case 'build_completed':
    case 'build_failed':
    case 'build_remediation':
      return <BuildContent data={data} eventType={event.event_type} />
    case 'review_started':
    case 'review_approved':
    case 'review_rejected':
      return <ReviewContent data={data} eventType={event.event_type} />
    case 'pr_created':
    case 'pr_merged':
      return <PRContent data={data} />
    case 'deploy_preview':
    case 'deploy_production':
      return <DeployContent data={data} eventType={event.event_type} />
    default:
      return (
        <div className="rounded-lg bg-surface p-3">
          <pre className="text-xs text-muted">{JSON.stringify(data, null, 2)}</pre>
        </div>
      )
  }
}

export function EventSlideOver({ event, onClose }: Props) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const config = EVENT_TYPE_CONFIG[event.event_type] || {
    icon: Search,
    label: event.event_type.replace(/_/g, ' '),
    color: 'text-muted',
  }
  const Icon = config.icon

  return (
    <>
      {/* Backdrop */}
      <div className="slide-over-backdrop" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 z-50 flex h-screen w-full max-w-[480px] flex-col border-l border-edge bg-bg/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-6 py-4">
          <div className="flex items-center gap-3">
            <Icon className={`h-4 w-4 ${config.color}`} />
            <span className="text-sm font-medium text-fg">{config.label}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Branch name */}
          {event.branch_name && (
            <div className="mb-4 flex items-center gap-2 text-xs text-muted">
              <GitPullRequest className="h-3 w-3" />
              <span className="font-[family-name:var(--font-mono)]">{event.branch_name}</span>
            </div>
          )}

          {/* Commit SHA */}
          {event.commit_sha && (
            <div className="mb-4 flex items-center gap-2 text-xs text-muted">
              <span>SHA:</span>
              <span className="font-[family-name:var(--font-mono)] text-fg">{event.commit_sha.slice(0, 8)}</span>
            </div>
          )}

          {/* Actor */}
          <div className="mb-5 flex items-center gap-2 text-xs text-muted">
            <span>Actor:</span>
            <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-fg">{event.actor}</span>
          </div>

          {/* Event-specific content */}
          {renderEventContent(event)}

          {/* Timestamp */}
          <div className="mt-6 text-xs text-muted">
            <span className="tabular-nums text-fg">
              {new Date(event.created_at).toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

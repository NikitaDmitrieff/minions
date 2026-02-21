'use client'

import { useState, useMemo } from 'react'
import { Search, AlertTriangle, CheckCircle2, XCircle, FileCode, ChevronDown, ChevronUp } from 'lucide-react'
import type { Finding, FindingCategory, FindingSeverity, FindingStatus } from '@/lib/types'

type Props = {
  projectId: string
  findings: Finding[]
}

const CATEGORIES: { key: FindingCategory; label: string }[] = [
  { key: 'bug_risk', label: 'Bug Risk' },
  { key: 'tech_debt', label: 'Tech Debt' },
  { key: 'security', label: 'Security' },
  { key: 'performance', label: 'Performance' },
  { key: 'accessibility', label: 'Accessibility' },
  { key: 'testing_gap', label: 'Testing Gap' },
  { key: 'dx', label: 'DX' },
]

const SEVERITIES: FindingSeverity[] = ['critical', 'high', 'medium', 'low']
const STATUSES: FindingStatus[] = ['open', 'addressed', 'dismissed', 'wont_fix']

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400 bg-red-400/10 border-red-400/20',
  high: 'text-orange-400 bg-orange-400/10 border-orange-400/20',
  medium: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
  low: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20',
}

const STATUS_ICONS: Record<string, typeof Search> = {
  open: AlertTriangle,
  addressed: CheckCircle2,
  dismissed: XCircle,
}

export function FindingsPageClient({ projectId, findings: initialFindings }: Props) {
  const [findings, setFindings] = useState(initialFindings)
  const [categoryFilter, setCategoryFilter] = useState<FindingCategory | null>(null)
  const [severityFilter, setSeverityFilter] = useState<FindingSeverity | null>(null)
  const [statusFilter, setStatusFilter] = useState<FindingStatus | null>('open')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [updating, setUpdating] = useState(false)

  const filtered = useMemo(() => {
    return findings.filter(f => {
      if (categoryFilter && f.category !== categoryFilter) return false
      if (severityFilter && f.severity !== severityFilter) return false
      if (statusFilter && f.status !== statusFilter) return false
      return true
    })
  }, [findings, categoryFilter, severityFilter, statusFilter])

  // Counts per category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const f of findings) {
      if (statusFilter && f.status !== statusFilter) continue
      counts[f.category] = (counts[f.category] || 0) + 1
    }
    return counts
  }, [findings, statusFilter])

  async function bulkUpdate(status: string) {
    if (selectedIds.size === 0) return
    setUpdating(true)
    try {
      const res = await fetch(`/api/findings/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingIds: Array.from(selectedIds), status }),
      })
      if (res.ok) {
        setFindings(prev =>
          prev.map(f => selectedIds.has(f.id) ? { ...f, status: status as FindingStatus } : f)
        )
        setSelectedIds(new Set())
      }
    } finally {
      setUpdating(false)
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <>
      <div className="mb-8 flex items-center gap-3">
        <Search className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-medium text-fg">Findings</h1>
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs tabular-nums text-muted">
          {filtered.length}
        </span>
      </div>

      {/* Filters */}
      <div className="mb-6 space-y-3">
        {/* Category chips */}
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setCategoryFilter(null)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
              !categoryFilter ? 'bg-accent/20 text-accent' : 'bg-surface text-muted hover:text-fg'
            }`}
          >
            All
          </button>
          {CATEGORIES.map(cat => (
            <button
              key={cat.key}
              onClick={() => setCategoryFilter(categoryFilter === cat.key ? null : cat.key)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                categoryFilter === cat.key ? 'bg-accent/20 text-accent' : 'bg-surface text-muted hover:text-fg'
              }`}
            >
              {cat.label}
              {categoryCounts[cat.key] ? ` (${categoryCounts[cat.key]})` : ''}
            </button>
          ))}
        </div>

        {/* Severity + status row */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-dim">Severity:</span>
            {SEVERITIES.map(sev => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(severityFilter === sev ? null : sev)}
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  severityFilter === sev
                    ? SEVERITY_COLORS[sev]
                    : 'bg-surface text-muted hover:text-fg'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-dim">Status:</span>
            {STATUSES.map(st => (
              <button
                key={st}
                onClick={() => setStatusFilter(statusFilter === st ? null : st)}
                className={`rounded-lg px-2 py-0.5 text-[11px] font-medium transition-colors ${
                  statusFilter === st ? 'bg-accent/20 text-accent' : 'bg-surface text-muted hover:text-fg'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bulk actions */}
      {selectedIds.size > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
          <span className="text-xs text-muted">{selectedIds.size} selected</span>
          <button
            onClick={() => bulkUpdate('dismissed')}
            disabled={updating}
            className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-fg disabled:opacity-50"
          >
            Dismiss
          </button>
          <button
            onClick={() => bulkUpdate('open')}
            disabled={updating}
            className="rounded-lg bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:text-fg disabled:opacity-50"
          >
            Reopen
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto text-[11px] text-muted hover:text-fg"
          >
            Clear
          </button>
        </div>
      )}

      {/* Findings list */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="glass-card py-12 text-center text-sm text-muted">
            No findings match your filters.
          </div>
        )}

        {filtered.map(finding => {
          const isExpanded = expandedId === finding.id
          const isSelected = selectedIds.has(finding.id)
          const StatusIcon = STATUS_ICONS[finding.status] || AlertTriangle
          const sevColor = SEVERITY_COLORS[finding.severity] || ''

          return (
            <div key={finding.id} className="glass-card overflow-hidden">
              <div className="flex items-start gap-3 p-3">
                {/* Checkbox */}
                <button
                  onClick={() => toggleSelect(finding.id)}
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    isSelected
                      ? 'border-accent bg-accent/20 text-accent'
                      : 'border-white/[0.1] hover:border-white/[0.2]'
                  }`}
                >
                  {isSelected && <CheckCircle2 className="h-3 w-3" />}
                </button>

                {/* Content */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : finding.id)}
                  className="flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <StatusIcon className={`h-3.5 w-3.5 ${
                      finding.status === 'open' ? 'text-amber-400' :
                      finding.status === 'addressed' ? 'text-success' : 'text-muted'
                    }`} />
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${sevColor}`}>
                      {finding.severity}
                    </span>
                    <span className="rounded-full bg-surface px-1.5 py-0.5 text-[10px] text-muted">
                      {finding.category.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm font-medium text-fg">{finding.title}</p>
                  {finding.file_path && (
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-dim">
                      <FileCode className="h-3 w-3" />
                      <span className="font-[family-name:var(--font-mono)]">
                        {finding.file_path}
                        {finding.line_range && `:${finding.line_range}`}
                      </span>
                    </div>
                  )}
                </button>

                {/* Expand arrow */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : finding.id)}
                  className="mt-0.5 text-muted hover:text-fg"
                >
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </div>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-edge px-3 py-3 pl-10">
                  <p className="text-sm leading-relaxed text-fg">{finding.description}</p>
                  <p className="mt-2 text-[11px] text-dim">
                    Found {new Date(finding.created_at).toLocaleDateString()}
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

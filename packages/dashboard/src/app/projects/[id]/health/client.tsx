'use client'

import { useMemo } from 'react'
import { BarChart3, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { HealthSnapshot } from '@/lib/types'

type Props = {
  projectId: string
  snapshots: HealthSnapshot[]
}

const BREAKDOWN_LABELS: Record<string, string> = {
  bug_risk: 'Bug Risk',
  tech_debt: 'Tech Debt',
  security: 'Security',
  performance: 'Performance',
  accessibility: 'Accessibility',
  testing_gap: 'Testing Gap',
  dx: 'Developer Experience',
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-success'
  if (score >= 40) return 'text-amber-400'
  return 'text-red-400'
}

function barColor(score: number): string {
  if (score >= 70) return 'bg-success'
  if (score >= 40) return 'bg-amber-400'
  return 'bg-red-400'
}

function Sparkline({ snapshots }: { snapshots: HealthSnapshot[] }) {
  if (snapshots.length < 2) return null

  const width = 300
  const height = 60
  const padding = 4
  const scores = snapshots.map(s => s.score)
  const min = Math.min(...scores) - 5
  const max = Math.max(...scores) + 5
  const range = max - min || 1

  const points = scores.map((score, i) => {
    const x = padding + (i / (scores.length - 1)) * (width - padding * 2)
    const y = height - padding - ((score - min) / range) * (height - padding * 2)
    return `${x},${y}`
  })

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`).join(' ')

  // Gradient fill
  const firstPoint = points[0]
  const lastPoint = points[points.length - 1]
  const fillD = `${pathD} L${lastPoint.split(',')[0]},${height - padding} L${firstPoint.split(',')[0]},${height - padding} Z`

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillD} fill="url(#sparkFill)" className={scoreColor(scores[scores.length - 1])} />
      <path d={pathD} fill="none" stroke="currentColor" strokeWidth={2}
        className={scoreColor(scores[scores.length - 1])} />
      {/* Latest point dot */}
      <circle
        cx={Number(lastPoint.split(',')[0])}
        cy={Number(lastPoint.split(',')[1])}
        r={3}
        fill="currentColor"
        className={scoreColor(scores[scores.length - 1])}
      />
    </svg>
  )
}

export function HealthPageClient({ projectId, snapshots }: Props) {
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
  const previous = snapshots.length > 1 ? snapshots[snapshots.length - 2] : null

  const trend = useMemo(() => {
    if (!latest || !previous) return null
    const diff = latest.score - previous.score
    return diff
  }, [latest, previous])

  if (!latest) {
    return (
      <>
        <div className="mb-8 flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-accent" />
          <h1 className="text-lg font-medium text-fg">Health Score</h1>
        </div>
        <div className="glass-card p-8 text-center text-muted">
          No health data yet. Run a Scout scan to generate your first health snapshot.
        </div>
      </>
    )
  }

  const breakdown = latest.breakdown || {}

  return (
    <>
      <div className="mb-8 flex items-center gap-3">
        <BarChart3 className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-medium text-fg">Health Score</h1>
      </div>

      {/* Score + sparkline */}
      <div className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Big score */}
        <div className="glass-card flex flex-col items-center justify-center p-8">
          <span className={`text-6xl font-bold tabular-nums ${scoreColor(latest.score)}`}>
            {latest.score}
          </span>
          <span className="mt-2 text-xs text-muted">out of 100</span>
          {trend !== null && (
            <div className={`mt-3 flex items-center gap-1 text-sm ${
              trend > 0 ? 'text-success' : trend < 0 ? 'text-red-400' : 'text-muted'
            }`}>
              {trend > 0 ? <TrendingUp className="h-4 w-4" /> :
               trend < 0 ? <TrendingDown className="h-4 w-4" /> :
               <Minus className="h-4 w-4" />}
              <span className="tabular-nums">{trend > 0 ? '+' : ''}{trend} from previous</span>
            </div>
          )}
          <p className="mt-2 text-xs text-dim">
            {latest.findings_open} open findings as of {new Date(latest.snapshot_date).toLocaleDateString()}
          </p>
        </div>

        {/* Sparkline trend */}
        <div className="glass-card flex flex-col items-center justify-center p-8">
          <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted">
            30-Day Trend
          </h3>
          {snapshots.length >= 2 ? (
            <Sparkline snapshots={snapshots} />
          ) : (
            <p className="text-xs text-dim">Need more data points for trend</p>
          )}
          {snapshots.length >= 2 && (
            <p className="mt-2 text-[11px] text-dim">
              {snapshots.length} snapshots over {Math.ceil(
                (new Date(snapshots[snapshots.length - 1].snapshot_date).getTime() -
                 new Date(snapshots[0].snapshot_date).getTime()) / 86400000
              )} days
            </p>
          )}
        </div>
      </div>

      {/* Breakdown bars */}
      <div className="glass-card p-5">
        <h3 className="mb-4 text-xs font-medium uppercase tracking-wider text-muted">
          Category Breakdown
        </h3>
        <div className="space-y-4">
          {Object.entries(BREAKDOWN_LABELS).map(([key, label]) => {
            const entry = breakdown[key]
            const count = entry?.count ?? null
            const severity = entry?.worst_severity ?? null
            const prevEntry = previous?.breakdown?.[key]
            const prevCount = prevEntry?.count ?? null
            const diff = prevCount != null && count != null ? count - prevCount : null

            const severityColor = (s: string | null) => {
              if (!s) return 'text-dim'
              if (s === 'critical') return 'text-red-400'
              if (s === 'high') return 'text-amber-400'
              return 'text-success'
            }

            return (
              <div key={key}>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-sm text-fg">{label}</span>
                  <div className="flex items-center gap-2">
                    {severity && (
                      <span className={`text-[11px] ${severityColor(severity)}`}>
                        {severity}
                      </span>
                    )}
                    {diff !== null && diff !== 0 && (
                      <span className={`text-[11px] tabular-nums ${diff > 0 ? 'text-red-400' : 'text-success'}`}>
                        {diff > 0 ? '+' : ''}{diff}
                      </span>
                    )}
                    <span className={`text-sm font-medium tabular-nums ${count != null ? 'text-fg' : 'text-dim'}`}>
                      {count != null ? count : '—'}
                    </span>
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${count != null && count > 0 ? severityColor(severity).replace('text-', 'bg-') : 'bg-white/[0.06]'}`}
                    style={{ width: `${Math.min((count ?? 0) * 10, 100)}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

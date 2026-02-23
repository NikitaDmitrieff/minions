'use client'

import { useState, useMemo } from 'react'
import type { BranchEvent, Branch, BranchState } from '@/lib/types'

/* ── Color maps ── */

const EVENT_COLORS: Record<string, string> = {
  scout_finding:      '#3b82f6',
  proposal_created:   '#f59e0b',
  proposal_approved:  '#22c55e',
  proposal_rejected:  '#ef4444',
  build_started:      '#3b82f6',
  build_completed:    '#22c55e',
  build_failed:       '#ef4444',
  build_remediation:  '#f59e0b',
  review_started:     '#8b5cf6',
  review_approved:    '#22c55e',
  review_rejected:    '#ef4444',
  pr_created:         '#5e9eff',
  pr_merged:          '#22c55e',
  deploy_preview:     '#8b5cf6',
  deploy_production:  '#22c55e',
  branch_deleted:     '#6b7280',
}

const EVENT_LABELS: Record<string, string> = {
  scout_finding:      'Scout',
  proposal_created:   'Proposed',
  proposal_approved:  'Approved',
  proposal_rejected:  'Rejected',
  build_started:      'Building',
  build_completed:    'Built',
  build_failed:       'Failed',
  build_remediation:  'Retry',
  review_started:     'Reviewing',
  review_approved:    'Approved',
  review_rejected:    'Rejected',
  pr_created:         'PR',
  pr_merged:          'Merged',
  deploy_preview:     'Preview',
  deploy_production:  'Shipped',
  branch_deleted:     'Deleted',
}

const STATE_COLORS: Record<BranchState, string> = {
  active:            '#3b82f6',
  awaiting_approval: '#f59e0b',
  needs_action:      '#f59e0b',
  merged:            '#22c55e',
  rejected:          '#ef4444',
  failed:            '#ef4444',
  deployed:          '#8b5cf6',
  pending:           '#6b7280',
}

/* ── Layout ── */
const TIME_AXIS_Y = 40
const LANE_START_Y = 75
const LANE_HEIGHT = 70
const LEFT_MARGIN = 160
const RIGHT_MARGIN = 60
const NODE_R = 10
const CHART_WIDTH = 700 // usable width for time positioning

/* ── Duration pairs: start→end events that should show a duration bar ── */
const DURATION_PAIRS: [string, string][] = [
  ['build_started', 'build_completed'],
  ['build_started', 'build_failed'],
  ['review_started', 'review_approved'],
  ['review_started', 'review_rejected'],
]

/* ── Helpers ── */

function formatTimeLabel(date: Date, rangeMs: number): string {
  if (rangeMs < 86400000) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
  if (rangeMs < 604800000) {
    return date.toLocaleDateString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function useTimeScale(branches: Branch[]) {
  return useMemo(() => {
    const allEvents = branches.flatMap(b => b.events)
    if (allEvents.length === 0) return null

    const times = allEvents.map(e => new Date(e.created_at).getTime())
    let min = Math.min(...times)
    let max = Math.max(...times)

    // Ensure minimum range of 5 minutes
    if (max - min < 300000) {
      min -= 150000
      max += 150000
    }

    // Add padding
    const range = max - min
    min -= range * 0.05
    max += range * 0.1

    const totalRange = max - min
    const scale = (t: number) => LEFT_MARGIN + ((t - min) / totalRange) * CHART_WIDTH

    // Generate tick marks (~8 ticks)
    const tickCount = 8
    const tickInterval = totalRange / tickCount
    const ticks: { time: number; x: number; label: string }[] = []
    for (let i = 0; i <= tickCount; i++) {
      const t = min + i * tickInterval
      ticks.push({
        time: t,
        x: scale(t),
        label: formatTimeLabel(new Date(t), totalRange),
      })
    }

    const now = Date.now()
    const nowX = now >= min && now <= max ? scale(now) : null

    return { min, max, range: totalRange, scale, ticks, nowX }
  }, [branches])
}

/* ── Timeline graph ── */

export function TimelineGraph({ branches, githubRepo, onEventClick }: {
  branches: Branch[]
  githubRepo?: string
  onEventClick: (event: BranchEvent) => void
}) {
  const [hoveredEvent, setHoveredEvent] = useState<string | null>(null)
  const timeScale = useTimeScale(branches)

  if (branches.length === 0 || !timeScale) {
    return (
      <div className="glass-card p-8 text-center text-muted">
        No branch activity yet. Run a Scout scan to get started.
      </div>
    )
  }

  const totalWidth = LEFT_MARGIN + CHART_WIDTH + RIGHT_MARGIN
  const totalHeight = LANE_START_Y + branches.length * LANE_HEIGHT + 30

  return (
    <div className="glass-card overflow-x-auto">
      <svg width={totalWidth} height={totalHeight} className="min-w-full">
        <defs>
          <filter id="tl-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Time axis ── */}
        <line
          x1={LEFT_MARGIN} y1={TIME_AXIS_Y}
          x2={LEFT_MARGIN + CHART_WIDTH} y2={TIME_AXIS_Y}
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={1}
        />

        {/* Tick marks and labels */}
        {timeScale.ticks.map((tick, i) => (
          <g key={i}>
            <line
              x1={tick.x} y1={TIME_AXIS_Y - 4}
              x2={tick.x} y2={TIME_AXIS_Y + 4}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={1}
            />
            <text
              x={tick.x} y={TIME_AXIS_Y - 12}
              fill="#6b7280"
              fontSize={9}
              fontFamily="'JetBrains Mono', monospace"
              textAnchor="middle"
            >
              {tick.label}
            </text>
            {/* Vertical grid line */}
            <line
              x1={tick.x} y1={TIME_AXIS_Y + 10}
              x2={tick.x} y2={totalHeight - 10}
              stroke="rgba(255,255,255,0.03)"
              strokeWidth={1}
            />
          </g>
        ))}

        {/* "Now" marker */}
        {timeScale.nowX && (
          <g>
            <line
              x1={timeScale.nowX} y1={TIME_AXIS_Y - 4}
              x2={timeScale.nowX} y2={totalHeight - 10}
              stroke="#5e9eff"
              strokeWidth={1}
              strokeDasharray="4 3"
              opacity={0.5}
            />
            <text
              x={timeScale.nowX} y={TIME_AXIS_Y - 14}
              fill="#5e9eff"
              fontSize={9}
              fontWeight={600}
              fontFamily="'Inter', system-ui, sans-serif"
              textAnchor="middle"
            >
              now
            </text>
          </g>
        )}

        {/* ── Swim lanes ── */}
        {branches.map((branch, bi) => {
          const laneY = LANE_START_Y + bi * LANE_HEIGHT + LANE_HEIGHT / 2
          const color = STATE_COLORS[branch.state] || STATE_COLORS.pending

          // Find duration bars
          const durationBars: { x1: number; x2: number; color: string }[] = []
          for (const [startType, endType] of DURATION_PAIRS) {
            const startEvent = branch.events.find(e => e.event_type === startType)
            const endEvent = branch.events.find(e => e.event_type === endType)
            if (startEvent && endEvent) {
              const x1 = timeScale.scale(new Date(startEvent.created_at).getTime())
              const x2 = timeScale.scale(new Date(endEvent.created_at).getTime())
              const barColor = endType.includes('failed') || endType.includes('rejected')
                ? '#ef4444' : EVENT_COLORS[endType] || color
              durationBars.push({ x1, x2, color: barColor })
            }
          }

          return (
            <g key={branch.name}>
              {/* Lane separator */}
              {bi > 0 && (
                <line
                  x1={0} y1={LANE_START_Y + bi * LANE_HEIGHT}
                  x2={totalWidth} y2={LANE_START_Y + bi * LANE_HEIGHT}
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth={1}
                />
              )}

              {/* Branch label */}
              {githubRepo ? (
                <a
                  href={`https://github.com/${githubRepo}/tree/${branch.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <text
                    x={LEFT_MARGIN - 16}
                    y={laneY + 4}
                    fill={color}
                    fontSize={11}
                    fontWeight={500}
                    fontFamily="'JetBrains Mono', monospace"
                    textAnchor="end"
                    opacity={0.9}
                    style={{ cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {branch.name.replace('minions/', '')}
                  </text>
                </a>
              ) : (
                <text
                  x={LEFT_MARGIN - 16}
                  y={laneY + 4}
                  fill={color}
                  fontSize={11}
                  fontWeight={500}
                  fontFamily="'JetBrains Mono', monospace"
                  textAnchor="end"
                  opacity={0.9}
                >
                  {branch.name.replace('minions/', '')}
                </text>
              )}

              {/* Lane baseline (subtle) */}
              <line
                x1={LEFT_MARGIN} y1={laneY}
                x2={LEFT_MARGIN + CHART_WIDTH} y2={laneY}
                stroke={color}
                strokeWidth={1}
                opacity={0.08}
              />

              {/* Duration bars */}
              {durationBars.map((bar, i) => (
                <rect
                  key={i}
                  x={bar.x1}
                  y={laneY - 4}
                  width={Math.max(bar.x2 - bar.x1, 2)}
                  height={8}
                  rx={4}
                  fill={bar.color}
                  opacity={0.15}
                />
              ))}

              {/* Event nodes */}
              {branch.events.map(event => {
                const x = timeScale.scale(new Date(event.created_at).getTime())
                const eventColor = EVENT_COLORS[event.event_type] || color
                const label = EVENT_LABELS[event.event_type] || event.event_type
                const isHovered = hoveredEvent === event.id

                return (
                  <g
                    key={event.id}
                    className="cursor-pointer"
                    onClick={() => onEventClick(event)}
                    onMouseEnter={() => setHoveredEvent(event.id)}
                    onMouseLeave={() => setHoveredEvent(null)}
                  >
                    {/* Glow ring */}
                    <circle
                      cx={x} cy={laneY} r={NODE_R + 4}
                      fill="none"
                      stroke={eventColor}
                      strokeWidth={isHovered ? 1.5 : 0}
                      opacity={isHovered ? 0.5 : 0}
                      style={{ transition: 'all 0.15s ease' }}
                    />

                    {/* Main dot */}
                    <circle
                      cx={x} cy={laneY} r={NODE_R}
                      fill={eventColor}
                      opacity={isHovered ? 1 : 0.8}
                      filter={isHovered ? 'url(#tl-glow)' : undefined}
                      style={{ transition: 'opacity 0.15s' }}
                    />

                    {/* Inner dot (white center) */}
                    <circle
                      cx={x} cy={laneY} r={3}
                      fill="white"
                      opacity={isHovered ? 0.9 : 0.5}
                      style={{ pointerEvents: 'none', transition: 'opacity 0.15s' }}
                    />

                    {/* Label above */}
                    <text
                      x={x} y={laneY - NODE_R - 8}
                      fill={isHovered ? '#e8eaed' : '#6b7280'}
                      fontSize={9}
                      fontFamily="'Inter', system-ui, sans-serif"
                      textAnchor="middle"
                      opacity={isHovered ? 1 : 0.7}
                      style={{ transition: 'all 0.15s' }}
                    >
                      {label}
                    </text>
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

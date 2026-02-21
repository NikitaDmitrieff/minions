'use client'

import { useState, useEffect } from 'react'
import type { BranchEvent, Branch, BranchState } from '@/lib/types'

// State colors
const STATE_COLORS: Record<BranchState | string, { line: string; glow: string; label: string }> = {
  active:            { line: '#3b82f6', glow: '#3b82f680', label: 'Building' },
  awaiting_approval: { line: '#f59e0b', glow: '#f59e0b40', label: 'Awaiting Review' },
  merged:            { line: '#22c55e', glow: '#22c55e40', label: 'Merged' },
  rejected:          { line: '#ef4444', glow: '#ef444440', label: 'Rejected' },
  failed:            { line: '#ef4444', glow: '#ef444440', label: 'Failed' },
  deployed:          { line: '#8b5cf6', glow: '#8b5cf640', label: 'Deployed' },
  pending:           { line: '#6b7280', glow: '#6b728040', label: 'Pending' },
}

const EVENT_LABELS: Record<string, string> = {
  scout_finding: 'Scout found',
  proposal_created: 'Proposed',
  proposal_approved: 'Approved',
  proposal_rejected: 'Rejected',
  build_started: 'Builder started',
  build_completed: 'Build complete',
  build_failed: 'Build failed',
  build_remediation: 'Remediation',
  review_started: 'Reviewer started',
  review_approved: 'Review approved',
  review_rejected: 'Review rejected',
  pr_created: 'PR created',
  pr_merged: 'Merged',
  deploy_preview: 'Preview deployed',
  deploy_production: 'Shipped',
  branch_deleted: 'Branch deleted',
}

interface GraphData {
  branches: Branch[]
  unbranched: BranchEvent[]
  scheduled: {
    pending_jobs: Array<{ id: string; job_type: string; status: string; issue_title: string; created_at: string }>
    scout_schedule: string
    paused: boolean
  }
}

// Node component
function EventNode({
  event, x, y, color, onClick,
}: {
  event: BranchEvent
  x: number
  y: number
  color: string
  onClick: (event: BranchEvent) => void
}) {
  const label = EVENT_LABELS[event.event_type] || event.event_type
  const title = (event.event_data as { title?: string })?.title || label

  return (
    <g
      className="cursor-pointer transition-opacity hover:opacity-80"
      onClick={() => onClick(event)}
    >
      <circle cx={x} cy={y} r={6} fill={color} stroke="white" strokeWidth={1.5} />
      <text x={x + 12} y={y + 4} fill="#d1d5db" fontSize={11} fontFamily="monospace">
        {title.length > 35 ? title.slice(0, 35) + '...' : title}
      </text>
    </g>
  )
}

// Main graph
export function BranchGraph({
  projectId,
  onEventClick,
}: {
  projectId: string
  onEventClick?: (event: BranchEvent) => void
}) {
  const [data, setData] = useState<GraphData | null>(null)

  // Poll for updates
  useEffect(() => {
    let cancelled = false

    const fetchData = async () => {
      const res = await fetch(`/api/graph/${projectId}`)
      if (res.ok && !cancelled) setData(await res.json())
    }

    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [projectId])

  const handleClick = (event: BranchEvent) => {
    onEventClick?.(event)
  }

  if (!data) {
    return (
      <div className="glass-card p-8 text-center text-muted">
        Loading branch graph...
      </div>
    )
  }

  if (data.branches.length === 0 && data.unbranched.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-muted">
        No activity yet. Run a Scout scan to get started.
      </div>
    )
  }

  // Layout calculations
  const MAIN_Y = 40
  const BRANCH_START_X = 80
  const BRANCH_SPACING_Y = 120
  const NODE_SPACING_X = 50

  const width = Math.max(800, data.branches.reduce((max, b) =>
    Math.max(max, BRANCH_START_X + b.events.length * NODE_SPACING_X + 200), 0
  ))
  const height = MAIN_Y + (data.branches.length + 1) * BRANCH_SPACING_Y

  return (
    <div className="glass-card overflow-x-auto p-4">
      <svg width={width} height={height} className="min-w-full">
        {/* Main branch line */}
        <line x1={0} y1={MAIN_Y} x2={width} y2={MAIN_Y}
          stroke="#6b7280" strokeWidth={2} />
        <text x={10} y={MAIN_Y - 10} fill="#9ca3af" fontSize={12} fontFamily="monospace">
          main
        </text>

        {/* Branch lines and nodes */}
        {data.branches.map((branch, bi) => {
          const branchY = MAIN_Y + (bi + 1) * BRANCH_SPACING_Y
          const forkX = BRANCH_START_X + bi * 60
          const colors = STATE_COLORS[branch.state] || STATE_COLORS.pending
          const isActive = branch.state === 'active'

          return (
            <g key={branch.name}>
              {/* Fork line from main */}
              <line x1={forkX} y1={MAIN_Y} x2={forkX} y2={branchY}
                stroke={colors.line} strokeWidth={1.5}
                strokeDasharray={branch.state === 'awaiting_approval' ? '6 3' : undefined}
              />

              {/* Branch merge line back to main (if merged) */}
              {branch.state === 'merged' && (
                <line
                  x1={forkX + branch.events.length * NODE_SPACING_X}
                  y1={branchY}
                  x2={forkX + branch.events.length * NODE_SPACING_X + 30}
                  y2={MAIN_Y}
                  stroke={colors.line} strokeWidth={1.5}
                />
              )}

              {/* Main dot on main line */}
              <circle cx={forkX} cy={MAIN_Y} r={4} fill={colors.line} />

              {/* Branch label */}
              <text x={forkX + 10} y={branchY - 8} fill={colors.line} fontSize={11} fontFamily="monospace">
                {branch.name.replace('minions/', '')}
              </text>

              {/* State badge */}
              <text x={forkX + 10} y={branchY + 16} fill={colors.line} fontSize={9} fontFamily="monospace" opacity={0.7}>
                {colors.label}
              </text>

              {/* Active pulse animation */}
              {isActive && (
                <circle cx={forkX} cy={branchY} r={10} fill="none"
                  stroke={colors.glow} strokeWidth={2}>
                  <animate attributeName="r" values="6;14;6" dur="2s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
                </circle>
              )}

              {/* Event nodes along the branch */}
              {branch.events.map((event, ei) => (
                <EventNode
                  key={event.id}
                  event={event}
                  x={forkX + (ei + 1) * NODE_SPACING_X}
                  y={branchY}
                  color={colors.line}
                  onClick={handleClick}
                />
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

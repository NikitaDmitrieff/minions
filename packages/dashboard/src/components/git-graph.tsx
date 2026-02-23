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
  auto_approved:      '#22c55e',
  auto_merged:        '#22c55e',
  merge_failed:       '#ef4444',
  cycle_started:      '#3b82f6',
  cycle_completed:    '#22c55e',
  checkpoint_created: '#8b5cf6',
  checkpoint_reverted:'#f59e0b',
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
  auto_approved:      'Auto-approved',
  auto_merged:        'Merged',
  merge_failed:       'Merge Failed',
  cycle_started:      'Cycle Start',
  cycle_completed:    'Cycle Done',
  checkpoint_created: 'Checkpoint',
  checkpoint_reverted:'Reverted',
}

const EVENT_ABBREVS: Record<string, string> = {
  scout_finding: 'S', proposal_created: 'P', proposal_approved: 'A', proposal_rejected: 'R',
  build_started: 'B', build_completed: 'B', build_failed: 'F', build_remediation: 'R',
  review_started: 'R', review_approved: 'A', review_rejected: 'R',
  pr_created: 'PR', pr_merged: 'M',
  deploy_preview: 'D', deploy_production: 'D', branch_deleted: 'X',
  auto_approved: '?', auto_merged: 'M', merge_failed: 'X',
  cycle_started: '?', cycle_completed: '?',
  checkpoint_created: '?', checkpoint_reverted: '?',
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

const STATE_LABELS: Record<BranchState, string> = {
  active: 'Building', awaiting_approval: 'Awaiting Review', needs_action: 'Needs Action',
  merged: 'Merged', rejected: 'Rejected', failed: 'Failed', deployed: 'Deployed', pending: 'Pending',
}

const TERMINAL_STATES = new Set<BranchState>(['merged', 'rejected', 'failed', 'deployed'])

/* ── Layout constants ── */
const MAIN_Y = 50
const LANE_SPACING_Y = 120
const COL_SPACING_X = 80
const LEFT_PAD = 60
const NODE_R = 14
const FORK_DOT_R = 5

/* ── Layout computation ── */

type PositionedEvent = {
  event: BranchEvent
  col: number
  branchName: string
}

type LaneAssignment = {
  branch: Branch
  lane: number
  forkCol: number      // column on main line where fork originates
  mergeCol: number     // column on main line where merge lands (-1 if not merged)
  firstCol: number     // column of branch's first event
  lastCol: number      // column of branch's last event
}

function computeLayout(branches: Branch[]) {
  const mainBranch = branches.find(b => b.name === 'main')
  const featureBranches = branches.filter(b => b.name !== 'main')

  // 1. Build global timeline: all events sorted by created_at
  const allEvents: PositionedEvent[] = []

  if (mainBranch) {
    for (const event of mainBranch.events) {
      allEvents.push({ event, col: 0, branchName: 'main' })
    }
  }
  for (const branch of featureBranches) {
    for (const event of branch.events) {
      allEvents.push({ event, col: 0, branchName: branch.name })
    }
  }

  // Sort by timestamp, then by branch (main first for tie-breaking)
  allEvents.sort((a, b) => {
    const timeDiff = new Date(a.event.created_at).getTime() - new Date(b.event.created_at).getTime()
    if (timeDiff !== 0) return timeDiff
    // Main events first when same timestamp
    if (a.branchName === 'main' && b.branchName !== 'main') return -1
    if (a.branchName !== 'main' && b.branchName === 'main') return 1
    return 0
  })

  // Assign column indices
  const eventColMap = new Map<string, number>()
  allEvents.forEach((item, i) => {
    item.col = i
    eventColMap.set(item.event.id, i)
  })

  // 2. Compute main event positions
  const mainEvents: PositionedEvent[] = allEvents.filter(e => e.branchName === 'main')

  // 3. Assign lanes to feature branches (greedy reuse)
  // Sort by first event timestamp
  const sortedFeatures = [...featureBranches].sort((a, b) => {
    const aFirst = a.events[0]?.created_at || ''
    const bFirst = b.events[0]?.created_at || ''
    return aFirst.localeCompare(bFirst)
  })

  // Track when each lane becomes free (by column index)
  const laneFreeAt: number[] = [] // laneFreeAt[lane] = column after which lane is free

  const laneAssignments: LaneAssignment[] = []

  for (const branch of sortedFeatures) {
    if (branch.events.length === 0) continue

    const firstEventCol = eventColMap.get(branch.events[0].id) ?? 0
    const lastEventCol = eventColMap.get(branch.events[branch.events.length - 1].id) ?? 0

    // Find lowest available lane
    let assignedLane = -1
    for (let l = 0; l < laneFreeAt.length; l++) {
      if (laneFreeAt[l] < firstEventCol) {
        assignedLane = l
        break
      }
    }
    if (assignedLane === -1) {
      assignedLane = laneFreeAt.length
      laneFreeAt.push(-1)
    }

    // Mark lane as occupied until branch ends
    laneFreeAt[assignedLane] = lastEventCol

    // Find fork origin: closest preceding main event
    let forkCol = firstEventCol
    for (let i = mainEvents.length - 1; i >= 0; i--) {
      if (mainEvents[i].col <= firstEventCol) {
        forkCol = mainEvents[i].col
        break
      }
    }

    // Merge column: for merged branches, last event col
    const isMerged = TERMINAL_STATES.has(branch.state) && branch.state === 'merged'
    const mergeCol = isMerged ? lastEventCol : -1

    laneAssignments.push({
      branch,
      lane: assignedLane,
      forkCol,
      mergeCol,
      firstCol: firstEventCol,
      lastCol: lastEventCol,
    })
  }

  const totalCols = allEvents.length
  const totalLanes = laneFreeAt.length

  return { mainEvents, laneAssignments, eventColMap, totalCols, totalLanes }
}

function colToX(col: number): number {
  return LEFT_PAD + col * COL_SPACING_X
}

function laneToY(lane: number): number {
  return MAIN_Y + (lane + 1) * LANE_SPACING_Y
}

/* ── Git graph ── */

export function GitGraph({ branches, onEventClick }: {
  branches: Branch[]
  onEventClick: (event: BranchEvent) => void
}) {
  const [hoveredEvent, setHoveredEvent] = useState<string | null>(null)
  const [hoveredBranch, setHoveredBranch] = useState<string | null>(null)

  const layout = useMemo(() => computeLayout(branches), [branches])

  if (branches.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-muted">
        No branch activity yet. Run a Scout scan to get started.
      </div>
    )
  }

  const { mainEvents, laneAssignments, eventColMap, totalCols, totalLanes } = layout
  const width = Math.max(900, colToX(totalCols) + 100)
  const height = MAIN_Y + (totalLanes + 1) * LANE_SPACING_Y + 40

  return (
    <div className="glass-card overflow-x-auto">
      <svg width={width} height={height} className="min-w-full">
        <defs>
          <filter id="node-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="line-glow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Main branch line ── */}
        <line
          x1={0} y1={MAIN_Y} x2={width} y2={MAIN_Y}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={3}
        />
        <line
          x1={0} y1={MAIN_Y} x2={width} y2={MAIN_Y}
          stroke="rgba(255,255,255,0.04)"
          strokeWidth={8}
        />
        <text
          x={20} y={MAIN_Y - 18}
          fill="#e8eaed"
          fontSize={13}
          fontWeight={600}
          fontFamily="'Inter', system-ui, sans-serif"
          letterSpacing="-0.01em"
        >
          main
        </text>

        {/* ── Main branch event nodes ── */}
        {mainEvents.map(({ event, col }) => {
          const x = colToX(col)
          const eventColor = EVENT_COLORS[event.event_type] || '#6b7280'
          const label = EVENT_LABELS[event.event_type] || event.event_type
          const abbrev = EVENT_ABBREVS[event.event_type] || '?'
          const isHovered = hoveredEvent === event.id

          return (
            <g
              key={event.id}
              className="cursor-pointer"
              onClick={() => onEventClick(event)}
              onMouseEnter={() => setHoveredEvent(event.id)}
              onMouseLeave={() => setHoveredEvent(null)}
            >
              <circle
                cx={x} cy={MAIN_Y} r={NODE_R + 4}
                fill="none"
                stroke={eventColor}
                strokeWidth={isHovered ? 1.5 : 0.5}
                opacity={isHovered ? 0.5 : 0.1}
                style={{ transition: 'all 0.15s ease' }}
              />
              <circle
                cx={x} cy={MAIN_Y} r={NODE_R}
                fill={eventColor}
                opacity={isHovered ? 1 : 0.8}
                filter={isHovered ? 'url(#node-glow)' : undefined}
                style={{ transition: 'opacity 0.15s' }}
              />
              <text
                x={x} y={MAIN_Y + 4}
                fill="white"
                fontSize={abbrev.length > 1 ? 8 : 9}
                fontWeight={600}
                fontFamily="'Inter', system-ui, sans-serif"
                textAnchor="middle"
                style={{ pointerEvents: 'none' }}
              >
                {abbrev}
              </text>
              <text
                x={x} y={MAIN_Y + NODE_R + 18}
                fill={isHovered ? '#e8eaed' : '#6b7280'}
                fontSize={10}
                fontFamily="'Inter', system-ui, sans-serif"
                textAnchor="middle"
                style={{ transition: 'fill 0.15s' }}
              >
                {label}
              </text>
            </g>
          )
        })}

        {/* ── Feature branches ── */}
        {laneAssignments.map(({ branch, lane, forkCol, mergeCol, firstCol, lastCol }) => {
          const branchY = laneToY(lane)
          const color = STATE_COLORS[branch.state] || STATE_COLORS.pending
          const isActive = branch.state === 'active'
          const isMerged = branch.state === 'merged'
          const branchHovered = hoveredBranch === branch.name
          const lineOpacity = branchHovered ? 0.7 : 0.35
          const isDashed = branch.state === 'awaiting_approval' || branch.state === 'needs_action'

          const forkX = colToX(forkCol)
          const firstX = colToX(firstCol)
          const lastX = colToX(lastCol)
          const mergeX = mergeCol >= 0 ? colToX(mergeCol) + 45 : 0

          return (
            <g
              key={branch.name}
              onMouseEnter={() => setHoveredBranch(branch.name)}
              onMouseLeave={() => setHoveredBranch(null)}
            >
              {/* Fork curve: main → branch */}
              <path
                d={`M ${forkX} ${MAIN_Y} C ${forkX} ${MAIN_Y + (branchY - MAIN_Y) * 0.5}, ${firstX} ${branchY - (branchY - MAIN_Y) * 0.3}, ${firstX} ${branchY}`}
                fill="none"
                stroke={color}
                strokeWidth={2}
                opacity={lineOpacity}
                strokeDasharray={isDashed ? '6 4' : undefined}
                filter={branchHovered ? 'url(#line-glow)' : undefined}
                style={{ transition: 'opacity 0.2s' }}
              />

              {/* Branch horizontal line */}
              <line
                x1={firstX} y1={branchY}
                x2={lastX + 20} y2={branchY}
                stroke={color}
                strokeWidth={2}
                opacity={lineOpacity}
                strokeDasharray={isDashed ? '6 4' : undefined}
                style={{ transition: 'opacity 0.2s' }}
              />

              {/* Merge curve: branch → main */}
              {isMerged && (
                <path
                  d={`M ${lastX} ${branchY} C ${lastX + 25} ${branchY - (branchY - MAIN_Y) * 0.3}, ${mergeX - 10} ${MAIN_Y + (branchY - MAIN_Y) * 0.3}, ${mergeX} ${MAIN_Y}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  opacity={lineOpacity}
                  filter={branchHovered ? 'url(#line-glow)' : undefined}
                  style={{ transition: 'opacity 0.2s' }}
                />
              )}

              {/* Fork dot on main line */}
              <circle cx={forkX} cy={MAIN_Y} r={FORK_DOT_R} fill={color} opacity={0.7} />

              {/* Merge dot on main line */}
              {isMerged && (
                <circle cx={mergeX} cy={MAIN_Y} r={FORK_DOT_R} fill={color} opacity={0.7} />
              )}

              {/* Branch label */}
              <text
                x={firstX + 8}
                y={branchY - 24}
                fill={color}
                fontSize={11}
                fontWeight={500}
                fontFamily="'JetBrains Mono', monospace"
                opacity={branchHovered ? 1 : 0.8}
                style={{ transition: 'opacity 0.2s' }}
              >
                {branch.name.replace('minions/', '')}
              </text>

              {/* State label */}
              <text
                x={firstX + 8}
                y={branchY + 30}
                fill={color}
                fontSize={9}
                fontWeight={500}
                fontFamily="'Inter', system-ui, sans-serif"
                opacity={0.5}
                letterSpacing="0.05em"
              >
                {STATE_LABELS[branch.state] || 'Pending'}
              </text>

              {/* Active pulse ring */}
              {isActive && (
                <>
                  <circle cx={firstX} cy={branchY} r={20} fill="none" stroke={color} strokeWidth={1} opacity={0.2}>
                    <animate attributeName="r" values="14;28;14" dur="2.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.3;0.05;0.3" dur="2.5s" repeatCount="indefinite" />
                  </circle>
                  <circle cx={firstX} cy={branchY} r={14} fill="none" stroke={color} strokeWidth={1} opacity={0.15}>
                    <animate attributeName="r" values="14;22;14" dur="2.5s" begin="0.4s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.25;0.05;0.25" dur="2.5s" begin="0.4s" repeatCount="indefinite" />
                  </circle>
                </>
              )}

              {/* Event nodes */}
              {branch.events.map((event) => {
                const col = eventColMap.get(event.id) ?? 0
                const x = colToX(col)
                const y = branchY
                const eventColor = EVENT_COLORS[event.event_type] || color
                const label = EVENT_LABELS[event.event_type] || event.event_type
                const abbrev = EVENT_ABBREVS[event.event_type] || '?'
                const isHovered = hoveredEvent === event.id

                return (
                  <g
                    key={event.id}
                    className="cursor-pointer"
                    onClick={() => onEventClick(event)}
                    onMouseEnter={() => setHoveredEvent(event.id)}
                    onMouseLeave={() => setHoveredEvent(null)}
                  >
                    <circle
                      cx={x} cy={y} r={NODE_R + 4}
                      fill="none"
                      stroke={eventColor}
                      strokeWidth={isHovered ? 1.5 : 0.5}
                      opacity={isHovered ? 0.5 : 0.1}
                      style={{ transition: 'all 0.15s ease' }}
                    />
                    <circle
                      cx={x} cy={y} r={NODE_R}
                      fill={eventColor}
                      opacity={isHovered ? 1 : 0.8}
                      filter={isHovered ? 'url(#node-glow)' : undefined}
                      style={{ transition: 'opacity 0.15s' }}
                    />
                    <text
                      x={x} y={y + 4}
                      fill="white"
                      fontSize={abbrev.length > 1 ? 8 : 9}
                      fontWeight={600}
                      fontFamily="'Inter', system-ui, sans-serif"
                      textAnchor="middle"
                      style={{ pointerEvents: 'none' }}
                    >
                      {abbrev}
                    </text>
                    <text
                      x={x} y={y + NODE_R + 18}
                      fill={isHovered ? '#e8eaed' : '#6b7280'}
                      fontSize={10}
                      fontFamily="'Inter', system-ui, sans-serif"
                      textAnchor="middle"
                      style={{ transition: 'fill 0.15s' }}
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

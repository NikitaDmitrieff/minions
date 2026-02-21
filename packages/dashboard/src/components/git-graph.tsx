'use client'

import { useState } from 'react'
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

const EVENT_ABBREVS: Record<string, string> = {
  scout_finding: 'S', proposal_created: 'P', proposal_approved: 'A', proposal_rejected: 'R',
  build_started: 'B', build_completed: 'B', build_failed: 'F', build_remediation: 'R',
  review_started: 'R', review_approved: 'A', review_rejected: 'R',
  pr_created: 'PR', pr_merged: 'M',
  deploy_preview: 'D', deploy_production: 'D', branch_deleted: 'X',
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

/* ── Layout constants ── */
const MAIN_Y = 50
const BRANCH_START_X = 140
const BRANCH_SPACING_Y = 110
const NODE_SPACING_X = 90
const NODE_R = 14
const MAIN_NODE_R = 5

/* ── Git graph ── */

export function GitGraph({ branches, onEventClick }: {
  branches: Branch[]
  onEventClick: (event: BranchEvent) => void
}) {
  const [hoveredEvent, setHoveredEvent] = useState<string | null>(null)
  const [hoveredBranch, setHoveredBranch] = useState<string | null>(null)

  if (branches.length === 0) {
    return (
      <div className="glass-card p-8 text-center text-muted">
        No branch activity yet. Run a Scout scan to get started.
      </div>
    )
  }

  const width = Math.max(900, branches.reduce((max, b) =>
    Math.max(max, BRANCH_START_X + (b.events.length + 1) * NODE_SPACING_X + 140), 0
  ))
  const height = MAIN_Y + (branches.length + 1) * BRANCH_SPACING_Y

  return (
    <div className="glass-card overflow-x-auto">
      <svg width={width} height={height} className="min-w-full">
        <defs>
          {/* Glow filter for hovered nodes */}
          <filter id="node-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Softer glow for branch lines */}
          <filter id="line-glow" x="-20%" y="-50%" width="140%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Main branch line */}
        <line
          x1={0} y1={MAIN_Y} x2={width} y2={MAIN_Y}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth={3}
        />
        {/* Main branch glow line (subtle) */}
        <line
          x1={0} y1={MAIN_Y} x2={width} y2={MAIN_Y}
          stroke="rgba(255,255,255,0.04)"
          strokeWidth={8}
        />
        {/* Main label */}
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

        {/* Branches */}
        {branches.map((branch, bi) => {
          const branchY = MAIN_Y + (bi + 1) * BRANCH_SPACING_Y
          const forkX = BRANCH_START_X + bi * 50
          const color = STATE_COLORS[branch.state] || STATE_COLORS.pending
          const isActive = branch.state === 'active'
          const isMerged = branch.state === 'merged'
          const lastEventX = forkX + Math.max(branch.events.length, 1) * NODE_SPACING_X
          const branchHovered = hoveredBranch === branch.name
          const lineOpacity = branchHovered ? 0.7 : 0.35

          return (
            <g
              key={branch.name}
              onMouseEnter={() => setHoveredBranch(branch.name)}
              onMouseLeave={() => setHoveredBranch(null)}
            >
              {/* Fork curve: main → branch */}
              <path
                d={`M ${forkX} ${MAIN_Y} C ${forkX} ${MAIN_Y + (branchY - MAIN_Y) * 0.5}, ${forkX} ${branchY - (branchY - MAIN_Y) * 0.3}, ${forkX} ${branchY}`}
                fill="none"
                stroke={color}
                strokeWidth={2}
                opacity={lineOpacity}
                strokeDasharray={branch.state === 'awaiting_approval' || branch.state === 'needs_action' ? '6 4' : undefined}
                filter={branchHovered ? 'url(#line-glow)' : undefined}
                style={{ transition: 'opacity 0.2s' }}
              />

              {/* Branch horizontal line */}
              <line
                x1={forkX} y1={branchY}
                x2={lastEventX + 20} y2={branchY}
                stroke={color}
                strokeWidth={2}
                opacity={lineOpacity}
                strokeDasharray={branch.state === 'awaiting_approval' || branch.state === 'needs_action' ? '6 4' : undefined}
                style={{ transition: 'opacity 0.2s' }}
              />

              {/* Merge curve: branch → main */}
              {isMerged && (
                <path
                  d={`M ${lastEventX} ${branchY} C ${lastEventX + 25} ${branchY - (branchY - MAIN_Y) * 0.3}, ${lastEventX + 35} ${MAIN_Y + (branchY - MAIN_Y) * 0.3}, ${lastEventX + 45} ${MAIN_Y}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  opacity={lineOpacity}
                  filter={branchHovered ? 'url(#line-glow)' : undefined}
                  style={{ transition: 'opacity 0.2s' }}
                />
              )}

              {/* Fork dot on main line */}
              <circle cx={forkX} cy={MAIN_Y} r={MAIN_NODE_R} fill={color} opacity={0.7} />

              {/* Merge dot on main line */}
              {isMerged && (
                <circle cx={lastEventX + 45} cy={MAIN_Y} r={MAIN_NODE_R} fill={color} opacity={0.7} />
              )}

              {/* Branch label */}
              <text
                x={forkX + 8}
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
                x={forkX + 8}
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
                  <circle cx={forkX} cy={branchY} r={20} fill="none" stroke={color} strokeWidth={1} opacity={0.2}>
                    <animate attributeName="r" values="14;28;14" dur="2.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.3;0.05;0.3" dur="2.5s" repeatCount="indefinite" />
                  </circle>
                  <circle cx={forkX} cy={branchY} r={14} fill="none" stroke={color} strokeWidth={1} opacity={0.15}>
                    <animate attributeName="r" values="14;22;14" dur="2.5s" begin="0.4s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.25;0.05;0.25" dur="2.5s" begin="0.4s" repeatCount="indefinite" />
                  </circle>
                </>
              )}

              {/* Event nodes */}
              {branch.events.map((event, ei) => {
                const x = forkX + (ei + 1) * NODE_SPACING_X
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
                    {/* Outer glow ring */}
                    <circle
                      cx={x} cy={y} r={NODE_R + 4}
                      fill="none"
                      stroke={eventColor}
                      strokeWidth={isHovered ? 1.5 : 0.5}
                      opacity={isHovered ? 0.5 : 0.1}
                      style={{ transition: 'all 0.15s ease' }}
                    />

                    {/* Main node */}
                    <circle
                      cx={x} cy={y} r={NODE_R}
                      fill={eventColor}
                      opacity={isHovered ? 1 : 0.8}
                      filter={isHovered ? 'url(#node-glow)' : undefined}
                      style={{ transition: 'opacity 0.15s' }}
                    />

                    {/* Inner abbreviation */}
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

                    {/* Label below */}
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

'use client'

import { useState, useEffect } from 'react'
import { PipelineGraph } from './pipeline-graph'
import { GitGraph } from './git-graph'
import { TimelineGraph } from './timeline-graph'
import { ScheduledPanel } from './scheduled-panel'
import { EventSlideOver } from './event-slide-over'
import type { BranchEvent, Branch } from '@/lib/types'
import { Rows3, GitBranch, Clock } from 'lucide-react'

type GraphView = 'pipeline' | 'git' | 'timeline'

interface GraphData {
  branches: Branch[]
  unbranched: BranchEvent[]
  scheduled: {
    pending_jobs: Array<{ id: string; job_type: string; status: string; issue_title: string; created_at: string; locked_at: string | null; worker_id: string | null }>
    scout_schedule: string
    paused: boolean
  }
}

const VIEW_TABS: { id: GraphView; label: string; Icon: typeof GitBranch }[] = [
  { id: 'pipeline', label: 'Pipeline', Icon: Rows3 },
  { id: 'git',      label: 'Git Graph', Icon: GitBranch },
  { id: 'timeline', label: 'Timeline', Icon: Clock },
]

export function GraphPageClient({ projectId, githubRepo }: { projectId: string; githubRepo: string }) {
  const [selectedEvent, setSelectedEvent] = useState<BranchEvent | null>(null)
  const [view, setView] = useState<GraphView>('pipeline')
  const [data, setData] = useState<GraphData | null>(null)

  // Poll for data (lifted from BranchGraph so all views share one fetch)
  useEffect(() => {
    let cancelled = false
    const fetchData = async () => {
      const res = await fetch(`/api/graph/${projectId}`)
      if (res.ok && !cancelled) setData(await res.json())
    }
    fetchData()
    const interval = setInterval(fetchData, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [projectId])

  const renderView = () => {
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

    switch (view) {
      case 'pipeline':
        return <PipelineGraph branches={data.branches} githubRepo={githubRepo} onEventClick={setSelectedEvent} />
      case 'git':
        return <GitGraph branches={data.branches} githubRepo={githubRepo} onEventClick={setSelectedEvent} />
      case 'timeline':
        return <TimelineGraph branches={data.branches} githubRepo={githubRepo} onEventClick={setSelectedEvent} />
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
        <div>
          {/* View switcher */}
          <div className="mb-4 inline-flex items-center gap-1 rounded-xl border border-edge bg-surface/30 p-1">
            {VIEW_TABS.map(({ id, label, Icon }) => (
              <button
                key={id}
                onClick={() => setView(id)}
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-all duration-150 ${
                  view === id
                    ? 'bg-white/[0.08] text-fg shadow-sm'
                    : 'text-muted hover:text-fg hover:bg-white/[0.03]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Graph view */}
          {renderView()}
        </div>

        {/* Scheduled panel */}
        <ScheduledPanel projectId={projectId} initialData={data?.scheduled} />
      </div>

      {/* Event slide-over */}
      {selectedEvent && (
        <EventSlideOver
          event={selectedEvent}
          githubRepo={githubRepo}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </>
  )
}

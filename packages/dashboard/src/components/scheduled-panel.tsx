'use client'

import { useState, useEffect, useCallback } from 'react'
import { Clock, Pause, Play, Loader2, Hammer, Search, Lightbulb, Eye } from 'lucide-react'

interface PendingJob {
  id: string
  job_type: string
  status: string
  issue_title: string
  created_at: string
}

interface ScheduledData {
  pending_jobs: PendingJob[]
  scout_schedule: string
  paused: boolean
}

const JOB_TYPE_CONFIG: Record<string, { icon: typeof Search; label: string; color: string }> = {
  scout:      { icon: Search,    label: 'Scout',      color: 'text-blue-400' },
  strategize: { icon: Lightbulb, label: 'Strategist',  color: 'text-accent' },
  build:      { icon: Hammer,    label: 'Builder',     color: 'text-amber-400' },
  review:     { icon: Eye,       label: 'Reviewer',    color: 'text-purple-400' },
}

function parseCronHuman(cron: string): string {
  const parts = cron.split(' ')
  if (parts.length !== 5) return cron

  const [minute, hour, dayOfMonth, , dayOfWeek] = parts

  if (dayOfMonth !== '*' && dayOfWeek === '*') {
    return `Monthly on day ${dayOfMonth} at ${hour}:${minute.padStart(2, '0')} UTC`
  }
  if (dayOfWeek !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    return `Weekly on ${days[Number(dayOfWeek)] || dayOfWeek} at ${hour}:${minute.padStart(2, '0')} UTC`
  }

  // Check if it runs twice daily (two hours)
  if (hour.includes(',')) {
    const hours = hour.split(',')
    return `Twice daily at ${hours.map(h => `${h}:${minute.padStart(2, '0')}`).join(' & ')} UTC`
  }

  return `Daily at ${hour}:${minute.padStart(2, '0')} UTC`
}

function timeUntilNext(cron: string): string {
  const parts = cron.split(' ')
  if (parts.length !== 5) return 'unknown'

  const [minute, hour] = parts
  const now = new Date()
  const targetHours = hour.includes(',') ? hour.split(',').map(Number) : [Number(hour)]
  const targetMinute = Number(minute)

  // Find next occurrence
  let next: Date | null = null
  for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
    for (const h of targetHours) {
      const candidate = new Date(now)
      candidate.setUTCDate(candidate.getUTCDate() + dayOffset)
      candidate.setUTCHours(h, targetMinute, 0, 0)
      if (candidate > now && (!next || candidate < next)) {
        next = candidate
      }
    }
  }

  if (!next) return 'soon'

  const diffMs = next.getTime() - now.getTime()
  const diffH = Math.floor(diffMs / 3600000)
  const diffM = Math.floor((diffMs % 3600000) / 60000)

  if (diffH === 0) return `in ${diffM}m`
  return `in ${diffH}h ${diffM}m`
}

export function ScheduledPanel({
  projectId,
  initialData,
}: {
  projectId: string
  initialData?: ScheduledData
}) {
  const [data, setData] = useState<ScheduledData | null>(initialData || null)
  const [toggling, setToggling] = useState(false)

  // Sync from parent when initialData updates
  useEffect(() => {
    if (initialData) setData(initialData)
  }, [initialData])

  useEffect(() => {
    if (initialData) return

    let cancelled = false
    const fetchData = async () => {
      const res = await fetch(`/api/graph/${projectId}`)
      if (res.ok && !cancelled) {
        const json = await res.json()
        setData(json.scheduled)
      }
    }
    fetchData()
    const interval = setInterval(fetchData, 10000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [projectId, initialData])

  const togglePause = useCallback(async () => {
    if (!data) return
    setToggling(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: !data.paused }),
      })
      if (res.ok) {
        setData(prev => prev ? { ...prev, paused: !prev.paused } : prev)
      }
    } finally {
      setToggling(false)
    }
  }, [projectId, data])

  if (!data) {
    return (
      <div className="glass-card p-4 text-center text-xs text-muted">
        Loading schedule...
      </div>
    )
  }

  const processingJobs = data.pending_jobs.filter(j => j.status === 'processing')
  const queuedJobs = data.pending_jobs.filter(j => j.status === 'pending')

  return (
    <div className="glass-card p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-fg">Scheduled</h2>
        </div>
        <button
          onClick={togglePause}
          disabled={toggling}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
            data.paused
              ? 'bg-success/10 text-success hover:bg-success/20'
              : 'bg-amber-400/10 text-amber-400 hover:bg-amber-400/20'
          } disabled:opacity-50`}
        >
          {toggling ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : data.paused ? (
            <Play className="h-3 w-3" />
          ) : (
            <Pause className="h-3 w-3" />
          )}
          {data.paused ? 'Resume' : 'Pause'}
        </button>
      </div>

      {/* Paused banner */}
      {data.paused && (
        <div className="mb-4 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-xs text-amber-400">
          All minion activity is paused
        </div>
      )}

      {/* Next scout */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Search className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-xs text-fg">Next Scout scan</span>
          </div>
          <span className="text-xs tabular-nums text-muted">
            {data.paused ? 'paused' : timeUntilNext(data.scout_schedule)}
          </span>
        </div>
        <p className="mt-1 pl-[22px] text-[11px] text-dim">
          {parseCronHuman(data.scout_schedule)}
        </p>
      </div>

      {/* Active workers */}
      {processingJobs.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">Active</h3>
          <div className="space-y-1.5">
            {processingJobs.map(job => {
              const config = JOB_TYPE_CONFIG[job.job_type] || { icon: Loader2, label: job.job_type, color: 'text-muted' }
              const Icon = config.icon
              return (
                <div key={job.id} className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
                  <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                  <span className="flex-1 truncate text-xs text-fg">
                    {job.issue_title || config.label}
                  </span>
                  <Loader2 className="h-3 w-3 animate-spin text-accent" />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Queued jobs */}
      {queuedJobs.length > 0 && (
        <div>
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted">Queued</h3>
          <div className="space-y-1.5">
            {queuedJobs.map((job, i) => {
              const config = JOB_TYPE_CONFIG[job.job_type] || { icon: Clock, label: job.job_type, color: 'text-muted' }
              const Icon = config.icon
              return (
                <div key={job.id} className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
                  <Icon className={`h-3.5 w-3.5 ${config.color}`} />
                  <span className="flex-1 truncate text-xs text-fg">
                    {job.issue_title || config.label}
                  </span>
                  <span className="text-[10px] tabular-nums text-dim">#{i + 1}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Empty state */}
      {processingJobs.length === 0 && queuedJobs.length === 0 && !data.paused && (
        <p className="text-center text-xs text-dim">No active or queued jobs</p>
      )}
    </div>
  )
}

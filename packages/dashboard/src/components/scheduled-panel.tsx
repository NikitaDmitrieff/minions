'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Clock, Pause, Play, Loader2, Hammer, Search, Lightbulb, Eye,
  AlertTriangle, RotateCcw, XCircle,
} from 'lucide-react'

interface PendingJob {
  id: string
  job_type: string
  status: string
  issue_title: string
  created_at: string
  locked_at: string | null
  worker_id: string | null
}

interface ScheduledData {
  pending_jobs: PendingJob[]
  scout_schedule: string
  paused: boolean
}

const JOB_TYPE_CONFIG: Record<string, { icon: typeof Search; label: string; color: string; expectedMinutes: number }> = {
  scout:      { icon: Search,    label: 'Scout',      color: 'text-blue-400',   expectedMinutes: 5 },
  strategize: { icon: Lightbulb, label: 'Strategist', color: 'text-accent',     expectedMinutes: 3 },
  build:      { icon: Hammer,    label: 'Builder',    color: 'text-amber-400',  expectedMinutes: 20 },
  review:     { icon: Eye,       label: 'Reviewer',   color: 'text-purple-400', expectedMinutes: 5 },
}

// A job is "suspect" after 1.5x expected time, "stale" after 2.5x
const SUSPECT_MULTIPLIER = 1.5
const STALE_MULTIPLIER = 2.5

function getJobHealth(job: PendingJob): 'healthy' | 'suspect' | 'stale' {
  if (job.status !== 'processing' || !job.locked_at) return 'healthy'
  const config = JOB_TYPE_CONFIG[job.job_type]
  if (!config) return 'healthy'
  const elapsedMs = Date.now() - new Date(job.locked_at).getTime()
  const expectedMs = config.expectedMinutes * 60_000
  if (elapsedMs > expectedMs * STALE_MULTIPLIER) return 'stale'
  if (elapsedMs > expectedMs * SUSPECT_MULTIPLIER) return 'suspect'
  return 'healthy'
}

function formatDuration(lockedAt: string): string {
  const elapsedMs = Date.now() - new Date(lockedAt).getTime()
  const totalSeconds = Math.floor(elapsedMs / 1000)
  if (totalSeconds < 60) return `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return `${hours}h ${remainMinutes}m`
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
  const [resettingJob, setResettingJob] = useState<string | null>(null)
  const [, setTick] = useState(0)

  // Sync from parent when initialData updates
  useEffect(() => {
    if (initialData) setData(initialData)
  }, [initialData])

  // Force re-render every 10s to update durations
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 10_000)
    return () => clearInterval(interval)
  }, [])

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

  const resetJob = useCallback(async (jobId: string, action: 'reset' | 'fail') => {
    setResettingJob(jobId)
    try {
      const res = await fetch(`/api/jobs/${projectId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, action }),
      })
      if (res.ok) {
        // Remove the job from local state immediately
        setData(prev => prev ? {
          ...prev,
          pending_jobs: prev.pending_jobs.filter(j => j.id !== jobId),
        } : prev)
      }
    } finally {
      setResettingJob(null)
    }
  }, [projectId])

  if (!data) {
    return (
      <div className="glass-card p-4 text-center text-xs text-muted">
        Loading schedule...
      </div>
    )
  }

  const processingJobs = data.pending_jobs.filter(j => j.status === 'processing')
  const queuedJobs = data.pending_jobs.filter(j => j.status === 'pending')
  const hasStaleJobs = processingJobs.some(j => getJobHealth(j) === 'stale')

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

      {/* Stale warning banner */}
      {hasStaleJobs && (
        <div className="mb-4 rounded-lg border border-red-400/20 bg-red-400/5 px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-medium text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Stale job detected — worker may be stuck
          </div>
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
              const config = JOB_TYPE_CONFIG[job.job_type] || { icon: Loader2, label: job.job_type, color: 'text-muted', expectedMinutes: 10 }
              const Icon = config.icon
              const health = getJobHealth(job)
              const isResetting = resettingJob === job.id

              return (
                <div key={job.id}>
                  <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
                    health === 'stale' ? 'bg-red-400/5 border border-red-400/20' :
                    health === 'suspect' ? 'bg-amber-400/5 border border-amber-400/10' :
                    'bg-surface'
                  }`}>
                    <Icon className={`h-3.5 w-3.5 shrink-0 ${config.color}`} />
                    <span className="flex-1 truncate text-xs text-fg">
                      {job.issue_title || config.label}
                    </span>
                    <div className="flex items-center gap-2">
                      {/* Duration */}
                      {job.locked_at && (
                        <span className={`text-[10px] tabular-nums ${
                          health === 'stale' ? 'text-red-400 font-medium' :
                          health === 'suspect' ? 'text-amber-400' :
                          'text-muted'
                        }`}>
                          {formatDuration(job.locked_at)}
                        </span>
                      )}
                      {/* Spinner or warning */}
                      {health === 'stale' ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                      ) : health === 'suspect' ? (
                        <AlertTriangle className="h-3 w-3 text-amber-400" />
                      ) : (
                        <Loader2 className="h-3 w-3 animate-spin text-accent" />
                      )}
                    </div>
                  </div>
                  {/* Reset/Fail actions for stale jobs */}
                  {health === 'stale' && (
                    <div className="mt-1 flex items-center gap-2 pl-2">
                      <button
                        onClick={() => resetJob(job.id, 'reset')}
                        disabled={isResetting}
                        className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-amber-400 hover:bg-amber-400/10 transition-colors disabled:opacity-50"
                      >
                        {isResetting ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                        Retry
                      </button>
                      <button
                        onClick={() => resetJob(job.id, 'fail')}
                        disabled={isResetting}
                        className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                      >
                        <XCircle className="h-3 w-3" />
                        Kill
                      </button>
                    </div>
                  )}
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
              const config = JOB_TYPE_CONFIG[job.job_type] || { icon: Clock, label: job.job_type, color: 'text-muted', expectedMinutes: 10 }
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

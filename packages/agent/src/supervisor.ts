#!/usr/bin/env node
/**
 * Minions Supervisor — launch once, forget.
 *
 * 1. Spawns the managed worker as a child process, restarts on crash
 * 2. Health loop (every 2 min): detects stuck/failed jobs, auto-recovers
 * 3. Slack notifier: immediate alerts on errors, periodic digest every 30 min
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { createSupabaseClient } from './supabase.js'
import { ensureValidToken, initCredentials } from './oauth.js'

type Supabase = ReturnType<typeof createSupabaseClient>

// ── Config ──────────────────────────────────────────────────────────────────
const HEALTH_INTERVAL_MS = parseInt(process.env.SUPERVISOR_HEALTH_INTERVAL_MS ?? '120000')   // 2 min
const DIGEST_INTERVAL_MS = parseInt(process.env.SUPERVISOR_DIGEST_INTERVAL_MS ?? '1800000')  // 30 min
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL ?? ''
const STUCK_JOB_THRESHOLD_MS = 15 * 60 * 1000    // 15 min
const MERGE_LOCK_THRESHOLD_MS = 5 * 60 * 1000    // 5 min
const TOKEN_REFRESH_BUFFER_MS = 30 * 60 * 1000   // 30 min before expiry
const MAX_RESTART_BACKOFF_MS = 60_000
const WORKER_SCRIPT = join(import.meta.dirname, 'managed-worker.js')

// ── State ───────────────────────────────────────────────────────────────────
let worker: ChildProcess | null = null
let workerStartedAt = 0
let restartCount = 0
let lastDigestAt = Date.now()
const digestEvents: string[] = []
const supabase = createSupabaseClient()

// ── Slack ───────────────────────────────────────────────────────────────────
async function sendSlack(text: string): Promise<void> {
  if (!SLACK_WEBHOOK_URL) {
    console.log(`[supervisor] [slack-skip] ${text}`)
    return
  }
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (err) {
    console.error(`[supervisor] Slack send failed:`, err)
  }
}

async function sendSlackAlert(message: string): Promise<void> {
  const text = `🚨 *Minions Alert*\n${message}`
  console.log(`[supervisor] ALERT: ${message}`)
  await sendSlack(text)
}

function queueDigestEvent(event: string): void {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  digestEvents.push(`${timestamp} — ${event}`)
}

async function sendDigest(): Promise<void> {
  const now = Date.now()
  if (now - lastDigestAt < DIGEST_INTERVAL_MS && digestEvents.length === 0) return

  // Query current state
  const [{ data: jobs }, { data: proposals }] = await Promise.all([
    supabase.from('job_queue')
      .select('id, job_type, status')
      .in('status', ['pending', 'processing', 'done', 'failed'])
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('proposals')
      .select('id, title, status')
      .in('status', ['approved', 'implementing', 'done', 'rejected'])
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const processing = jobs?.filter(j => j.status === 'processing') ?? []
  const pending = jobs?.filter(j => j.status === 'pending') ?? []
  const failed = jobs?.filter(j => j.status === 'failed') ?? []
  const merged = proposals?.filter(p => p.status === 'done') ?? []
  const building = proposals?.filter(p => p.status === 'approved' || p.status === 'implementing') ?? []

  const uptimeMin = Math.round((now - workerStartedAt) / 60000)
  const lines: string[] = [
    `🔄 *Minions Digest*`,
    `━━━━━━━━━━━━━━━━━━━━━`,
  ]

  if (merged.length > 0) lines.push(`✅ Merged: ${merged.map(p => `"${p.title}"`).join(', ')}`)
  if (building.length > 0) lines.push(`🔨 Building: ${building.map(p => `"${p.title}"`).join(', ')}`)
  if (pending.length > 0) lines.push(`⏳ Queued: ${pending.length} job${pending.length > 1 ? 's' : ''}`)
  if (failed.length > 0) lines.push(`❌ Failed: ${failed.length} job${failed.length > 1 ? 's' : ''}`)
  if (processing.length > 0) lines.push(`⚙️ Processing: ${processing.map(j => j.job_type).join(', ')}`)
  lines.push(`🏥 Worker uptime: ${uptimeMin}min, restarts: ${restartCount}`)

  if (digestEvents.length > 0) {
    lines.push(``, `📋 *Events since last digest:*`)
    for (const evt of digestEvents.slice(-10)) lines.push(`  • ${evt}`)
    digestEvents.length = 0
  }

  if (lines.length <= 3 && digestEvents.length === 0) {
    // Nothing interesting to report
    lastDigestAt = now
    return
  }

  await sendSlack(lines.join('\n'))
  lastDigestAt = now
}

// ── Worker Management ───────────────────────────────────────────────────────
function startWorker(): void {
  if (worker) return

  console.log(`[supervisor] Starting managed worker...`)
  workerStartedAt = Date.now()

  worker = spawn('node', ['--env-file=.env', WORKER_SCRIPT], {
    cwd: join(import.meta.dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })

  worker.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(l => l.trim())
    for (const line of lines) {
      console.log(`[worker] ${line}`)
    }
  })

  worker.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(l => l.trim())
    for (const line of lines) {
      console.error(`[worker:err] ${line}`)
    }
  })

  worker.on('exit', (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`
    console.log(`[supervisor] Worker exited (${reason})`)
    worker = null

    queueDigestEvent(`Worker exited (${reason})`)

    if (signal === 'SIGTERM' || signal === 'SIGINT') {
      // Intentional shutdown — don't restart
      return
    }

    // Restart with backoff
    restartCount++
    const backoff = Math.min(5000 * Math.pow(2, restartCount - 1), MAX_RESTART_BACKOFF_MS)
    console.log(`[supervisor] Restarting in ${backoff / 1000}s (restart #${restartCount})`)
    sendSlackAlert(`Worker crashed (${reason}). Restarting in ${backoff / 1000}s (restart #${restartCount})`)

    setTimeout(() => startWorker(), backoff)
  })

  console.log(`[supervisor] Worker started (pid ${worker.pid})`)
}

// ── Health Checks ───────────────────────────────────────────────────────────
async function healthCheck(): Promise<void> {
  const now = new Date()
  const cutoff = new Date(Date.now() - STUCK_JOB_THRESHOLD_MS).toISOString()

  // 1. Stuck jobs (processing for too long)
  const { data: stuckJobs } = await supabase
    .from('job_queue')
    .select('id, job_type, locked_at')
    .eq('status', 'processing')
    .lt('locked_at', cutoff)

  if (stuckJobs && stuckJobs.length > 0) {
    for (const job of stuckJobs) {
      console.log(`[supervisor] Resetting stuck job ${job.id} (${job.job_type})`)
      await supabase.from('job_queue')
        .update({ status: 'pending', worker_id: null, locked_at: null })
        .eq('id', job.id)
      queueDigestEvent(`Reset stuck ${job.job_type} job`)
    }
  }

  // 2. Failed builds with recoverable errors — reset for retry
  const { data: failedBuilds } = await supabase
    .from('job_queue')
    .select('id, job_type, last_error, attempt_count')
    .eq('status', 'failed')
    .in('job_type', ['build', 'review'])
    .lt('attempt_count', 3)

  if (failedBuilds && failedBuilds.length > 0) {
    const recoverable = failedBuilds.filter(j => {
      const err = j.last_error ?? ''
      return err.includes('npm ci') || err.includes('ECONNRESET') || err.includes('timeout')
        || err.includes('No credentials file') || err.includes('OAuth token not available')
    })
    for (const job of recoverable) {
      console.log(`[supervisor] Auto-recovering failed ${job.job_type} job ${job.id}`)
      await supabase.from('job_queue')
        .update({ status: 'pending', attempt_count: 0, last_error: null, worker_id: null, locked_at: null })
        .eq('id', job.id)
      queueDigestEvent(`Auto-recovered failed ${job.job_type} job`)
    }
  }

  // 3. Permanently failed jobs — alert once
  const { data: permFailed } = await supabase
    .from('job_queue')
    .select('id, job_type, last_error')
    .eq('status', 'failed')
    .gte('attempt_count', 3)

  if (permFailed && permFailed.length > 0) {
    for (const job of permFailed) {
      const snippet = (job.last_error ?? '').slice(0, 100)
      queueDigestEvent(`❌ ${job.job_type} permanently failed: ${snippet}`)
    }
  }

  // 4. Merge lock stuck
  const mergeLockCutoff = new Date(Date.now() - MERGE_LOCK_THRESHOLD_MS).toISOString()
  const { data: lockedProjects } = await supabase
    .from('projects')
    .select('id, github_repo')
    .eq('merge_in_progress', true)

  if (lockedProjects && lockedProjects.length > 0) {
    for (const project of lockedProjects) {
      console.log(`[supervisor] Releasing stuck merge lock for ${project.github_repo ?? project.id}`)
      await supabase.from('projects')
        .update({ merge_in_progress: false })
        .eq('id', project.id)
      queueDigestEvent(`Released stuck merge lock (${project.github_repo ?? 'unknown'})`)
    }
  }

  // 5. Credential refresh
  try {
    const valid = await ensureValidToken()
    if (!valid) {
      await sendSlackAlert('OAuth credentials expired and could not refresh. Worker will fail on build jobs.')
    }
  } catch {
    // Credentials not configured — not an error if only using API key
  }

  // 6. Worker alive check
  if (!worker || worker.exitCode !== null) {
    console.log(`[supervisor] Worker not running — restarting`)
    queueDigestEvent('Worker found dead — restarting')
    startWorker()
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(`[supervisor] Minions Supervisor starting`)
  console.log(`[supervisor] Health interval: ${HEALTH_INTERVAL_MS / 1000}s`)
  console.log(`[supervisor] Digest interval: ${DIGEST_INTERVAL_MS / 1000}s`)
  console.log(`[supervisor] Slack: ${SLACK_WEBHOOK_URL ? 'configured' : 'not configured (logs only)'}`)

  // Initialize credentials
  if (await initCredentials()) {
    await ensureValidToken()
    console.log(`[supervisor] OAuth credentials loaded`)
  }

  // Start worker
  startWorker()

  // Send startup message
  await sendSlack(`🟢 *Minions Supervisor started*\nHealth check: every ${HEALTH_INTERVAL_MS / 60000}min | Digest: every ${DIGEST_INTERVAL_MS / 60000}min`)

  // Health check loop
  setInterval(async () => {
    try {
      await healthCheck()
    } catch (err) {
      console.error(`[supervisor] Health check error:`, err)
    }
  }, HEALTH_INTERVAL_MS)

  // Digest loop
  setInterval(async () => {
    try {
      await sendDigest()
    } catch (err) {
      console.error(`[supervisor] Digest error:`, err)
    }
  }, DIGEST_INTERVAL_MS)

  // Graceful shutdown
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      console.log(`[supervisor] ${sig} received — shutting down`)
      if (worker) {
        worker.kill('SIGTERM')
        // Give worker 5s to clean up
        setTimeout(() => {
          if (worker) worker.kill('SIGKILL')
          process.exit(0)
        }, 5000)
      }
      await sendSlack(`🔴 *Minions Supervisor stopped* (${sig})`)
      if (!worker) process.exit(0)
    })
  }
}

main().catch((err) => {
  console.error(`[supervisor] Fatal error:`, err)
  process.exit(1)
})

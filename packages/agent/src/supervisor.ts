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
const DIGEST_INTERVAL_MS = parseInt(process.env.SUPERVISOR_DIGEST_INTERVAL_MS ?? '300000')   // 5 min
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL ?? ''
const STUCK_JOB_THRESHOLD_MS = 60 * 60 * 1000    // 60 min
const MERGE_LOCK_THRESHOLD_MS = 5 * 60 * 1000    // 5 min
const TOKEN_REFRESH_BUFFER_MS = 30 * 60 * 1000   // 30 min before expiry
const MAX_RESTART_BACKOFF_MS = 60_000
const WORKER_SCRIPT = join(import.meta.dirname, 'managed-worker.js')

// ── ANSI Colors ─────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  // Foreground
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
}

function colorize(line: string): string {
  // Tool use — cyan
  if (line.includes('[tool_use]')) return `${c.cyan}${line}${c.reset}`
  // Errors — red bold
  if (line.includes('[error]') || line.includes('failed') || line.includes('Error')) return `${c.red}${c.bold}${line}${c.reset}`
  // Events — dim gray
  if (line.includes('[event]') || line.includes('[monitor]')) return `${c.gray}${line}${c.reset}`
  // OAuth — dim
  if (line.includes('[oauth]')) return `${c.dim}${line}${c.reset}`
  // Review/verdict — yellow
  if (line.includes('verdict') || line.includes('Review')) return `${c.yellow}${line}${c.reset}`
  // Build/PR — green
  if (line.includes('PR #') || line.includes('Build complete') || line.includes('merged') || line.includes('approved')) return `${c.green}${c.bold}${line}${c.reset}`
  // Scout/strategize — magenta
  if (line.includes('Scout') || line.includes('scout') || line.includes('strategize') || line.includes('Strategize')) return `${c.magenta}${line}${c.reset}`
  // Job processing — blue
  if (line.includes('Processing job')) return `${c.blue}${c.bold}${line}${c.reset}`
  // Default
  return line
}

// ── State ───────────────────────────────────────────────────────────────────
let worker: ChildProcess | null = null
let workerStartedAt = 0
let restartCount = 0
let lastDigestAt = Date.now()
const digestEvents: string[] = []
let pipelineStage = 'idle'      // Current activity: idle, scout, strategize, build, review, fix_build
let pipelineDetail = ''          // Extra context (proposal title, PR number, etc.)
let stageStartedAt = 0           // Timestamp for elapsed time tracking
const supabase = createSupabaseClient()

function elapsed(): string {
  if (!stageStartedAt) return ''
  const ms = Date.now() - stageStartedAt
  const s = Math.floor(ms / 1000) % 60
  const m = Math.floor(ms / 60000)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

// ── Log Intelligence ────────────────────────────────────────────────────────
/** Patterns to detect in worker stdout — triggers alerts and stage tracking. */
function analyzeWorkerLine(line: string): void {
  const lower = line.toLowerCase()

  // ── Stage tracking ──
  if (lower.includes('processing job') && lower.includes('type=scout')) {
    pipelineStage = 'scout'
    pipelineDetail = ''
    stageStartedAt = Date.now()
    console.log(`\n${c.magenta}${c.bold}  ┌──────────────────────────────────────────────${c.reset}`)
    console.log(`${c.magenta}${c.bold}  │  SCOUT — analyzing codebase${c.reset}`)
    console.log(`${c.magenta}${c.bold}  ├──────────────────────────────────────────────${c.reset}`)
  } else if (lower.includes('processing job') && lower.includes('type=strategize')) {
    pipelineStage = 'strategize'
    pipelineDetail = ''
    stageStartedAt = Date.now()
    console.log(`\n${c.magenta}${c.bold}  ┌──────────────────────────────────────────────${c.reset}`)
    console.log(`${c.magenta}${c.bold}  │  STRATEGIZE — generating proposals${c.reset}`)
    console.log(`${c.magenta}${c.bold}  ├──────────────────────────────────────────────${c.reset}`)
  } else if (lower.includes('processing job') && lower.includes('type=build')) {
    pipelineStage = 'build'
    const titleMatch = line.match(/issue_title.*?"([^"]+)"/) || line.match(/"title":"([^"]+)"/)
    pipelineDetail = titleMatch?.[1] ?? ''
    stageStartedAt = Date.now()
    console.log(`\n${c.green}${c.bold}  ┌──────────────────────────────────────────────${c.reset}`)
    console.log(`${c.green}${c.bold}  │  BUILD${pipelineDetail ? ` — "${pipelineDetail}"` : ''}${c.reset}`)
    console.log(`${c.green}${c.bold}  ├──────────────────────────────────────────────${c.reset}`)
  } else if (lower.includes('processing job') && lower.includes('type=fix_build')) {
    pipelineStage = 'fix_build'
    stageStartedAt = Date.now()
    const prMatch = line.match(/PR #(\d+)/) || line.match(/#(\d+)/)
    pipelineDetail = prMatch ? `PR #${prMatch[1]}` : ''
    console.log(`\n${c.yellow}${c.bold}  ┌──────────────────────────────────────────────${c.reset}`)
    console.log(`${c.yellow}${c.bold}  │  FIX-BUILD — addressing review feedback${pipelineDetail ? ` (${pipelineDetail})` : ''}${c.reset}`)
    console.log(`${c.yellow}${c.bold}  ├──────────────────────────────────────────────${c.reset}`)
  } else if (lower.includes('processing job') && lower.includes('type=review')) {
    pipelineStage = 'review'
    stageStartedAt = Date.now()
    const prMatch = line.match(/PR #(\d+)/) || line.match(/#(\d+)/)
    pipelineDetail = prMatch ? `PR #${prMatch[1]}` : ''
    console.log(`\n${c.yellow}${c.bold}  ┌──────────────────────────────────────────────${c.reset}`)
    console.log(`${c.yellow}${c.bold}  │  REVIEW${pipelineDetail ? ` — ${pipelineDetail}` : ''}${c.reset}`)
    console.log(`${c.yellow}${c.bold}  ├──────────────────────────────────────────────${c.reset}`)
  }

  // ── Stage completion ──
  if (lower.includes('scout complete')) {
    pipelineStage = 'strategize-pending'
    const findingsMatch = line.match(/(\d+) new findings/)
    const count = findingsMatch?.[1] ?? '?'
    const dur = elapsed()
    console.log(`${c.magenta}  │  ${count} new findings${c.reset}`)
    console.log(`${c.magenta}  └── Scout done${dur ? ` (${dur})` : ''}${c.reset}\n`)
    queueDigestEvent(`Scout complete — ${count} new findings`)
  } else if (lower.includes('auto-approved and queued')) {
    const dur = elapsed()
    console.log(`${c.green}${c.bold}  └── Strategize done — proposal approved, build queued${dur ? ` (${dur})` : ''}${c.reset}\n`)
    queueDigestEvent('Strategize complete — proposal auto-approved')
  } else if (lower.includes('no draft proposals to auto-approve')) {
    pipelineStage = 'idle'
    const dur = elapsed()
    console.log(`${c.yellow}  └── Strategize done — no viable proposals${dur ? ` (${dur})` : ''}${c.reset}\n`)
    queueDigestEvent('Strategize complete — no viable proposals')
    sendSlack(`⚠️ Strategize produced no viable proposals (all scored below 0.6 threshold). Pipeline will idle until next scout.`)
  }

  // ── Immediate alerts ──
  if (lower.includes('no changes to commit')) {
    const dur = elapsed()
    pipelineStage = 'idle'
    console.log(`${c.red}${c.bold}  │  NO CHANGES — Claude ran but didn't write any code${c.reset}`)
    console.log(`${c.red}${c.bold}  └── Build failed${dur ? ` (${dur})` : ''}${c.reset}\n`)
    queueDigestEvent('Build produced no code changes')
    sendSlack(`⚠️ *Build produced no changes* — Claude CLI ran through the spec but didn't write any code. Proposal rejected, pipeline cycling.`)
  }

  if (lower.includes('validation failed') || lower.includes('remediation attempts')) {
    const stageMatch = line.match(/failed at (\w+)/)
    const stage = stageMatch?.[1] ?? 'unknown'
    const dur = elapsed()
    console.log(`${c.red}${c.bold}  │  VALIDATION FAILED at ${stage}${c.reset}`)
    console.log(`${c.red}${c.bold}  └── Build failed${dur ? ` (${dur})` : ''}${c.reset}\n`)
    queueDigestEvent(`Build validation failed at ${stage}`)
    sendSlack(`❌ *Build failed validation* at \`${stage}\` after remediation attempts. Proposal rejected.`)
  }

  if (lower.includes('review rejected') || lower.includes('reviewer requested changes')) {
    const prMatch = line.match(/PR #(\d+)/)
    const pr = prMatch?.[1] ?? '?'
    const dur = elapsed()
    if (lower.includes('permanently rejecting') || lower.includes('fix attempt failed')) {
      pipelineStage = 'idle'
      console.log(`${c.red}${c.bold}  │  REJECTED (final) — fix attempt failed${c.reset}`)
      console.log(`${c.red}${c.bold}  └── PR #${pr} rejected${dur ? ` (${dur})` : ''}${c.reset}\n`)
      queueDigestEvent(`PR #${pr} permanently rejected after fix attempt`)
    } else {
      console.log(`${c.yellow}${c.bold}  │  Review rejected PR #${pr} — will retry with fix-build${c.reset}`)
      queueDigestEvent(`Review rejected PR #${pr} — fix-build queued`)
    }
  }

  if (lower.includes('fix-build complete')) {
    const dur = elapsed()
    const prMatch = line.match(/PR #(\d+)/)
    const pr = prMatch?.[1] ?? '?'
    console.log(`${c.green}  │  Fix pushed to PR #${pr}${c.reset}`)
    console.log(`${c.green}  └── Fix-build done${dur ? ` (${dur})` : ''} — re-review queued${c.reset}\n`)
    queueDigestEvent(`Fix-build complete for PR #${pr}`)
  }

  if (lower.includes('fix-build produced no changes')) {
    const dur = elapsed()
    pipelineStage = 'idle'
    console.log(`${c.red}${c.bold}  │  Fix-build produced no changes${c.reset}`)
    console.log(`${c.red}${c.bold}  └── Fix-build failed${dur ? ` (${dur})` : ''}${c.reset}\n`)
    queueDigestEvent('Fix-build produced no changes — proposal rejected')
  }

  if (lower.includes('auto-merged') || lower.includes('merge complete')) {
    pipelineStage = 'idle'
    const prMatch = line.match(/PR #(\d+)/)
    const pr = prMatch?.[1] ?? '?'
    console.log(`${c.green}${c.bold}  ┌──────────────────────────────────────────────${c.reset}`)
    console.log(`${c.green}${c.bold}  │  MERGED — PR #${pr}${c.reset}`)
    console.log(`${c.green}${c.bold}  └──────────────────────────────────────────────${c.reset}\n`)
    queueDigestEvent(`Merged PR #${pr}`)
  }

  if (lower.includes('merge failed')) {
    pipelineStage = 'idle'
    console.log(`${c.red}${c.bold}  └── Merge failed${c.reset}\n`)
    queueDigestEvent('Merge failed')
  }

  // ── Review approved ──
  if (lower.includes('review approved')) {
    const dur = elapsed()
    const prMatch = line.match(/PR #(\d+)/)
    const pr = prMatch?.[1] ?? '?'
    console.log(`${c.green}${c.bold}  │  APPROVED — PR #${pr}${c.reset}`)
    console.log(`${c.green}  └── Review done${dur ? ` (${dur})` : ''} — merging...${c.reset}\n`)
    queueDigestEvent(`Review approved PR #${pr}`)
  }

  // ── Progress indicators ──
  if (lower.includes('running claude code cli') || lower.includes('running claude cli')) {
    console.log(`${c.cyan}  │  Claude CLI spawned...${c.reset}`)
  }
  if (lower.includes('installing dependencies')) {
    console.log(`${c.gray}  │  Installing dependencies...${c.reset}`)
  }
  if (lower.includes('validating:') || lower.includes('validation:')) {
    const stageMatch = line.match(/[Vv]alidat(?:ing|ion)[: ]+(\w+)/)
    if (stageMatch) {
      console.log(`${c.gray}  │  Validating: ${stageMatch[1]}...${c.reset}`)
    }
  }
  if (lower.includes('passed')) {
    const stageMatch = line.match(/(\w+) passed/)
    if (stageMatch) {
      console.log(`${c.green}  │  ✓ ${stageMatch[1]}${c.reset}`)
    }
  }
  if (lower.includes('creating pr') || lower.includes('created pull request')) {
    const prMatch = line.match(/PR #(\d+)/) || line.match(/#(\d+)/)
    const pr = prMatch?.[1]
    const dur = elapsed()
    if (pr) {
      console.log(`${c.green}${c.bold}  │  PR #${pr} created${c.reset}`)
      console.log(`${c.green}  └── Build done${dur ? ` (${dur})` : ''} — review queued${c.reset}\n`)
    }
  }

  // ── CLI tool use tracking ──
  if (line.includes('[tool_use]') || line.match(/[📖✏️📝💻🔍🔎🤖✅🔧]/)) {
    // Already colorized, just track activity
  }

  // ── Wild card tracking ──
  if (lower.includes('wild card cycle')) {
    console.log(`${c.magenta}${c.bold}  │  🎲 Wild card mode — requesting ambitious proposal${c.reset}`)
    queueDigestEvent('Wild card cycle triggered')
  }

  // ── Score tracking ──
  const scoreMatch = line.match(/scored ([\d.]+) — below threshold/)
  if (scoreMatch) {
    console.log(`${c.yellow}  │  Proposal scored ${scoreMatch[1]} (below 0.6) — discarded${c.reset}`)
  }
  const passedScoreMatch = line.match(/Created proposal: "([^"]+)" \(score: ([\d.]+)/)
  if (passedScoreMatch) {
    console.log(`${c.green}${c.bold}  │  ✓ Proposal "${passedScoreMatch[1]}" scored ${passedScoreMatch[2]} — created${c.reset}`)
    queueDigestEvent(`Proposal created: "${passedScoreMatch[1]}" (score: ${passedScoreMatch[2]})`)
  }

  // ── Rate limiting (terminal only, not worth a digest event) ──
  if (lower.includes('rate limit')) {
    console.log(`${c.yellow}  │  ⏳ Rate limited — waiting for capacity${c.reset}`)
  }

  // ── Error detection ──
  if (lower.includes('cli timed out')) {
    pipelineStage = 'idle'
    console.log(`${c.red}${c.bold}  ⚠ CLI TIMED OUT${c.reset}`)
    queueDigestEvent('CLI timed out')
    sendSlack(`⏰ *Claude CLI timed out* during build. Job will be retried.`)
  }

  if (lower.includes('exited with code') && !lower.includes('code 0')) {
    const codeMatch = line.match(/code (\d+)/)
    console.log(`${c.red}${c.bold}  ⚠ CLI exited with code ${codeMatch?.[1] ?? '?'}${c.reset}`)
    queueDigestEvent(`CLI exited with error code ${codeMatch?.[1] ?? '?'}`)
  }
}

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

const DASHBOARD_BASE = 'https://minions-dashboard.vercel.app'

async function sendDigest(): Promise<void> {
  const now = Date.now()

  // Query current state + project info for links
  const [{ data: jobs }, { data: proposals }, { data: projects }] = await Promise.all([
    supabase.from('job_queue')
      .select('id, job_type, status, project_id')
      .in('status', ['pending', 'processing', 'done', 'failed'])
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('proposals')
      .select('id, title, status, project_id')
      .in('status', ['approved', 'implementing', 'done', 'rejected'])
      .order('created_at', { ascending: false })
      .limit(10),
    supabase.from('projects')
      .select('id, name, github_repo')
      .eq('paused', false)
      .limit(5),
  ])

  const project = projects?.[0]
  const ghRepo = project?.github_repo ?? ''
  const projectId = project?.id ?? ''

  const processing = jobs?.filter(j => j.status === 'processing') ?? []
  const pending = jobs?.filter(j => j.status === 'pending') ?? []
  const failed = jobs?.filter(j => j.status === 'failed') ?? []
  const merged = proposals?.filter(p => p.status === 'done') ?? []
  const building = proposals?.filter(p => p.status === 'approved' || p.status === 'implementing') ?? []

  const uptimeMin = Math.round((now - workerStartedAt) / 60000)
  const stageEmoji: Record<string, string> = {
    idle: '💤', scout: '🔭', strategize: '🧠', 'strategize-pending': '🧠',
    build: '🔨', review: '🔍', fix_build: '🔧',
  }

  const lines: string[] = [
    `🔄 *Minions Digest*${project ? ` — ${project.name}` : ''}`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `${stageEmoji[pipelineStage] ?? '❓'} *${pipelineStage}*${pipelineDetail ? ` — ${pipelineDetail}` : ''}`,
  ]

  if (merged.length > 0) {
    lines.push(``)
    lines.push(`✅ *Recently merged:*`)
    for (const p of merged.slice(0, 3)) lines.push(`  • _${p.title}_`)
  }
  if (building.length > 0) {
    lines.push(``)
    lines.push(`🔨 *In progress:*`)
    for (const p of building) lines.push(`  • _${p.title}_`)
  }
  if (pending.length > 0 || failed.length > 0 || processing.length > 0) {
    lines.push(``)
    if (processing.length > 0) lines.push(`⚙️ Processing: ${processing.map(j => j.job_type).join(', ')}`)
    if (pending.length > 0) lines.push(`⏳ Queued: ${pending.length} job${pending.length > 1 ? 's' : ''}`)
    if (failed.length > 0) lines.push(`❌ Failed: ${failed.length} job${failed.length > 1 ? 's' : ''}`)
  }

  lines.push(``)
  lines.push(`🏥 Uptime: ${uptimeMin}min · Restarts: ${restartCount}`)

  if (digestEvents.length > 0) {
    lines.push(``, `📋 *Events since last digest:*`)
    for (const evt of digestEvents.slice(-10)) lines.push(`  • ${evt}`)
    digestEvents.length = 0
  }

  if (merged.length === 0 && building.length === 0 && processing.length === 0 && pending.length === 0) {
    lines.push(`💤 Pipeline idle — nothing in progress`)
  }

  // Add quick links
  const links: string[] = []
  if (projectId) links.push(`<${DASHBOARD_BASE}/projects/${projectId}/kanban|Kanban>`)
  if (projectId) links.push(`<${DASHBOARD_BASE}/projects/${projectId}|Graph>`)
  if (ghRepo) links.push(`<https://github.com/${ghRepo}/pulls|PRs>`)
  if (links.length > 0) lines.push(``, links.join(' · '))

  await sendSlack(lines.join('\n'))
  lastDigestAt = now
}

// ── Worker Management ───────────────────────────────────────────────────────
async function releaseOrphanedJobs(): Promise<void> {
  // Release stuck processing jobs
  const { data: orphans } = await supabase
    .from('job_queue')
    .select('id, job_type')
    .eq('status', 'processing')

  if (orphans && orphans.length > 0) {
    for (const job of orphans) {
      await supabase.from('job_queue')
        .update({ status: 'pending', worker_id: null, locked_at: null })
        .eq('id', job.id)
      console.log(`${c.yellow}[supervisor] Released orphaned ${job.job_type} job ${(job.id ?? '').slice(0, 8)}${c.reset}`)
    }
  }

  // Reject proposals stuck in 'approved' with no corresponding build job
  const { data: stuckProposals } = await supabase
    .from('proposals')
    .select('id, title')
    .in('status', ['approved', 'implementing'])

  if (stuckProposals && stuckProposals.length > 0) {
    for (const p of stuckProposals) {
      // Check if there's an active build job for this proposal
      const { count } = await supabase
        .from('job_queue')
        .select('id', { count: 'exact', head: true })
        .eq('job_type', 'build')
        .in('status', ['pending', 'processing'])

      if ((count ?? 0) === 0) {
        await supabase.from('proposals')
          .update({ status: 'rejected', completed_at: new Date().toISOString(), reject_reason: 'Orphaned after supervisor restart' })
          .eq('id', p.id)
        console.log(`${c.yellow}[supervisor] Rejected orphaned proposal "${p.title ?? 'untitled'}" ${(p.id ?? '').slice(0, 8)}${c.reset}`)
      }
    }
  }

  // Release stuck merge locks
  await supabase.from('projects').update({ merge_in_progress: false }).eq('merge_in_progress', true)
}

function startWorker(): void {
  if (worker) return

  console.log(`${c.green}${c.bold}[supervisor] Starting managed worker...${c.reset}`)
  workerStartedAt = Date.now()

  worker = spawn('node', ['--env-file=.env', WORKER_SCRIPT], {
    cwd: join(import.meta.dirname, '..'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  })

  worker.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(l => l.trim())
    for (const line of lines) {
      console.log(colorize(line))
      analyzeWorkerLine(line)
    }
  })

  worker.stderr?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(l => l.trim())
    for (const line of lines) {
      console.error(`${c.red}${line}${c.reset}`)
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

  console.log(`${c.green}${c.bold}[supervisor] Worker started (pid ${worker.pid})${c.reset}`)
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

  // 7. Idle pipeline check — auto-trigger scout if nothing is happening
  const { data: activeJobs, count: activeJobCount } = await supabase
    .from('job_queue')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'processing'])

  if ((activeJobCount ?? 0) === 0) {
    // No active jobs — check if any project in automate mode has no in-flight proposals
    const { data: automateProjects } = await supabase
      .from('projects')
      .select('id, github_repo')
      .eq('autonomy_mode', 'automate')
      .eq('paused', false)

    for (const project of automateProjects ?? []) {
      const { count: inFlightCount } = await supabase
        .from('proposals')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', project.id)
        .in('status', ['approved', 'implementing'])

      if ((inFlightCount ?? 0) === 0) {
        // Double-check no scout already queued
        const { count: scoutCount } = await supabase
          .from('job_queue')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', project.id)
          .eq('job_type', 'scout')
          .in('status', ['pending', 'processing'])

        if ((scoutCount ?? 0) === 0) {
          console.log(`[supervisor] Pipeline idle for ${project.github_repo ?? project.id} — auto-triggering scout`)
          await supabase.from('job_queue').insert({
            project_id: project.id,
            github_issue_number: 0,
            issue_title: 'Auto-scout (idle pipeline)',
            issue_body: '{}',
            job_type: 'scout',
            status: 'pending',
          })
          await sendSlackAlert(`Pipeline idle for ${project.github_repo ?? 'unknown'} — auto-triggered scout`)
          queueDigestEvent(`Auto-triggered scout for idle pipeline (${project.github_repo ?? 'unknown'})`)
        }
      }
    }
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

  // Release any jobs orphaned by a previous crash
  await releaseOrphanedJobs()

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

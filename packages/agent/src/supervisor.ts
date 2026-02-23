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
import { claudeEnv } from './claude-cli.js'

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
const WATCHDOG_TIMEOUT_MS = 60_000     // 60s max for watchdog CLI

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
let pipelineStage = 'idle'      // Current activity: idle, scout, strategize, build, review
let pipelineDetail = ''          // Extra context (proposal title, PR number, etc.)
const supabase = createSupabaseClient()
const LOG_BUFFER_MAX = 100
const logBuffer: string[] = []

// ── Log Intelligence ────────────────────────────────────────────────────────
/** Patterns to detect in worker stdout — triggers alerts and stage tracking. */
function analyzeWorkerLine(line: string): void {
  const lower = line.toLowerCase()

  // ── Stage tracking ──
  if (lower.includes('processing job') && lower.includes('type=scout')) {
    pipelineStage = 'scout'
    pipelineDetail = ''
    console.log(`${c.magenta}${c.bold}  ┌─ STAGE: Scout analysis started${c.reset}`)
  } else if (lower.includes('processing job') && lower.includes('type=strategize')) {
    pipelineStage = 'strategize'
    pipelineDetail = ''
    console.log(`${c.magenta}${c.bold}  ┌─ STAGE: Strategize started${c.reset}`)
  } else if (lower.includes('processing job') && lower.includes('type=build')) {
    pipelineStage = 'build'
    const titleMatch = line.match(/issue_title.*?"([^"]+)"/) || line.match(/"title":"([^"]+)"/)
    pipelineDetail = titleMatch?.[1] ?? ''
    console.log(`${c.green}${c.bold}  ┌─ STAGE: Build started${pipelineDetail ? ` — "${pipelineDetail}"` : ''}${c.reset}`)
  } else if (lower.includes('processing job') && lower.includes('type=review')) {
    pipelineStage = 'review'
    console.log(`${c.yellow}${c.bold}  ┌─ STAGE: Review started${c.reset}`)
  }

  // ── Stage completion ──
  if (lower.includes('scout complete')) {
    pipelineStage = 'strategize-pending'
    const findingsMatch = line.match(/(\d+) new findings/)
    const count = findingsMatch?.[1] ?? '?'
    console.log(`${c.magenta}  └─ Scout done: ${count} new findings${c.reset}`)
    queueDigestEvent(`Scout complete — ${count} new findings`)
  } else if (lower.includes('auto-approved and queued')) {
    console.log(`${c.green}${c.bold}  └─ Strategize done — proposal approved, build queued${c.reset}`)
    queueDigestEvent('Strategize complete — proposal auto-approved')
  } else if (lower.includes('no draft proposals to auto-approve')) {
    pipelineStage = 'idle'
    console.log(`${c.yellow}  └─ Strategize done — no viable proposals (all scored below threshold)${c.reset}`)
    queueDigestEvent('Strategize complete — no viable proposals')
    sendSlack(`⚠️ Strategize produced no viable proposals (all scored below 0.6 threshold). Pipeline will idle until next scout.`)
  }

  // ── Immediate alerts ──
  if (lower.includes('no changes to commit')) {
    pipelineStage = 'idle'
    console.log(`${c.red}${c.bold}  ⚠ BUILD PRODUCED NO CHANGES — Claude ran but didn't write any code${c.reset}`)
    queueDigestEvent('Build produced no code changes')
    sendSlack(`⚠️ *Build produced no changes* — Claude CLI ran through the spec but didn't write any code. Proposal rejected, pipeline cycling.`)
  }

  if (lower.includes('validation failed') || lower.includes('remediation attempts')) {
    const stageMatch = line.match(/failed at (\w+)/)
    const stage = stageMatch?.[1] ?? 'unknown'
    console.log(`${c.red}${c.bold}  ⚠ BUILD VALIDATION FAILED at ${stage}${c.reset}`)
    queueDigestEvent(`Build validation failed at ${stage}`)
    sendSlack(`❌ *Build failed validation* at \`${stage}\` after remediation attempts. Proposal rejected.`)
  }

  if (lower.includes('review rejected') || lower.includes('reviewer requested changes')) {
    pipelineStage = 'idle'
    const prMatch = line.match(/PR #(\d+)/)
    const pr = prMatch?.[1] ?? '?'
    console.log(`${c.yellow}${c.bold}  ⚠ REVIEW REJECTED PR #${pr}${c.reset}`)
    queueDigestEvent(`Review rejected PR #${pr}`)
  }

  if (lower.includes('auto-merged') || lower.includes('merge complete')) {
    pipelineStage = 'idle'
    const prMatch = line.match(/PR #(\d+)/)
    const pr = prMatch?.[1] ?? '?'
    console.log(`${c.green}${c.bold}  ✓ PR #${pr} MERGED SUCCESSFULLY${c.reset}`)
    queueDigestEvent(`PR #${pr} auto-merged`)
  }

  if (lower.includes('merge failed')) {
    pipelineStage = 'idle'
    console.log(`${c.red}${c.bold}  ⚠ MERGE FAILED${c.reset}`)
    queueDigestEvent('Merge failed')
  }

  // ── Progress indicators ──
  if (lower.includes('running claude code cli')) {
    console.log(`${c.cyan}  │  Claude CLI spawned — working on implementation...${c.reset}`)
  }
  if (lower.includes('claude cli finished')) {
    console.log(`${c.cyan}  │  Claude CLI finished — validating changes...${c.reset}`)
  }
  if (lower.includes('validating:')) {
    const stageMatch = line.match(/Validating: (\w+)/)
    if (stageMatch) {
      console.log(`${c.gray}  │  Validating: ${stageMatch[1]}...${c.reset}`)
    }
  }
  if (lower.includes('passed')) {
    const stageMatch = line.match(/(\w+) passed/)
    if (stageMatch) {
      console.log(`${c.green}  │  ✓ ${stageMatch[1]} passed${c.reset}`)
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

  // ── Rate limiting ──
  if (lower.includes('rate limit')) {
    console.log(`${c.yellow}  │  ⏳ Rate limited — waiting for capacity${c.reset}`)
    queueDigestEvent('Rate limited during build')
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

async function sendDigest(): Promise<void> {
  const now = Date.now()

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
  const stageEmoji: Record<string, string> = {
    idle: '💤', scout: '🔭', strategize: '🧠', 'strategize-pending': '🧠',
    build: '🔨', review: '🔍',
  }
  const lines: string[] = [
    `🔄 *Minions Digest*`,
    `━━━━━━━━━━━━━━━━━━━━━`,
    `${stageEmoji[pipelineStage] ?? '❓'} Current stage: *${pipelineStage}*${pipelineDetail ? ` — ${pipelineDetail}` : ''}`,
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

  if (lines.length <= 3) {
    lines.push(`💤 Pipeline idle — nothing in progress`)
  }

  await sendSlack(lines.join('\n'))
  lastDigestAt = now
}

// ── Worker Management ───────────────────────────────────────────────────────
async function releaseOrphanedJobs(): Promise<void> {
  const { data: orphans } = await supabase
    .from('job_queue')
    .select('id, job_type')
    .eq('status', 'processing')

  if (orphans && orphans.length > 0) {
    for (const job of orphans) {
      await supabase.from('job_queue')
        .update({ status: 'pending', worker_id: null, locked_at: null })
        .eq('id', job.id)
      console.log(`${c.yellow}[supervisor] Released orphaned ${job.job_type} job ${job.id.slice(0, 8)}${c.reset}`)
    }
  }
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
      logBuffer.push(line)
      if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift()
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

// ── Watchdog ─────────────────────────────────────────────────────────────────

interface WatchdogAction {
  type: 'send_slack' | 'retrigger_job' | 'reject_proposal' | 'release_merge_lock' | 'trigger_scout' | 'reset_job_attempts'
  job_id?: string
  proposal_id?: string
  project_id?: string
  message?: string
  reason?: string
}

interface WatchdogResponse {
  diagnosis: string
  slack_message?: string
  actions: WatchdogAction[]
}

async function gatherWatchdogContext(): Promise<string> {
  const [
    { data: jobs },
    { data: proposals },
    { data: recentEvents },
    { data: projects },
  ] = await Promise.all([
    supabase.from('job_queue')
      .select('id, job_type, status, last_error, attempt_count, locked_at, worker_id')
      .in('status', ['pending', 'processing', 'failed'])
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('proposals')
      .select('id, title, status, priority, created_at, completed_at, reject_reason')
      .in('status', ['draft', 'approved', 'implementing', 'done', 'rejected'])
      .order('created_at', { ascending: false })
      .limit(15),
    supabase.from('branch_events')
      .select('event_type, event_data, branch_name, created_at, actor')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase.from('projects')
      .select('id, github_repo, autonomy_mode, paused, merge_in_progress, product_context, strategic_nudges')
      .eq('paused', false),
  ])

  const sections: string[] = []

  sections.push(`## Pipeline Stage\nCurrent: ${pipelineStage}${pipelineDetail ? ` (${pipelineDetail})` : ''}`)
  sections.push(`Worker uptime: ${Math.round((Date.now() - workerStartedAt) / 60000)} min, restarts: ${restartCount}`)

  if (jobs && jobs.length > 0) {
    sections.push(`\n## Jobs (${jobs.length})\n${jobs.map(j =>
      `- [${j.status}] ${j.job_type} (id: ${j.id.slice(0, 8)})${j.last_error ? ` ERROR: ${j.last_error.slice(0, 200)}` : ''}${j.locked_at ? ` locked: ${j.locked_at}` : ''}`
    ).join('\n')}`)
  } else {
    sections.push(`\n## Jobs\nNo active jobs.`)
  }

  if (proposals && proposals.length > 0) {
    sections.push(`\n## Proposals (${proposals.length})\n${proposals.map(p =>
      `- [${p.status}] "${p.title}" (id: ${p.id.slice(0, 8)}, priority: ${p.priority})${p.reject_reason ? ` rejected: ${p.reject_reason}` : ''}`
    ).join('\n')}`)
  } else {
    sections.push(`\n## Proposals\nNo recent proposals.`)
  }

  if (recentEvents && recentEvents.length > 0) {
    sections.push(`\n## Recent Events (last 20)\n${recentEvents.map(e =>
      `- ${e.created_at} [${e.event_type}] branch:${e.branch_name} actor:${e.actor}${e.event_data ? ` data:${JSON.stringify(e.event_data).slice(0, 150)}` : ''}`
    ).join('\n')}`)
  }

  if (projects && projects.length > 0) {
    sections.push(`\n## Projects\n${projects.map(p =>
      `- ${p.github_repo} (mode: ${p.autonomy_mode}, paused: ${p.paused}, merge_lock: ${p.merge_in_progress})`
    ).join('\n')}`)
  }

  if (digestEvents.length > 0) {
    sections.push(`\n## Recent Digest Events\n${digestEvents.map(e => `- ${e}`).join('\n')}`)
  }

  return sections.join('\n')
}

function buildWatchdogPrompt(context: string, recentLogs: string): string {
  return `You are the AI watchdog for the Minions autonomous pipeline.

Your PRIMARY job is to OBSERVE and REPORT. You are NOT an operator.
You are CAUTIOUS. You PREFER sending a Slack message over taking action.

RULES:
- NEVER write, edit, delete, or create files
- NEVER run bash commands
- You may read source files to understand how the system works
- Your default action is send_slack — explain what's happening to the owner
- ONLY take corrective actions when the fix is TRIVIALLY OBVIOUS and SAFE
- When in doubt, just report to the owner via send_slack — don't act
- Return ONLY a JSON object, no markdown fences, no explanation

CURRENT PIPELINE STATE:
${context}

RECENT WORKER LOGS (last ${LOG_BUFFER_MAX} lines):
${recentLogs}

AVAILABLE ACTIONS (use sparingly — prefer send_slack):
- send_slack(message) — ALWAYS allowed. Your primary tool. Explain what's happening.
- retrigger_job(job_id, reason) — ONLY for jobs stuck in "processing" for >30min with no worker activity
- reject_proposal(proposal_id, reason) — ONLY for proposals stuck in "approved" with no corresponding build job
- release_merge_lock(project_id) — ONLY for merge locks held >10min with no active merge
- trigger_scout(project_id) — ONLY when pipeline is clearly idle with no jobs and no in-flight proposals
- reset_job_attempts(job_id) — ONLY for jobs failed due to clearly transient errors (network, timeout)

IMPORTANT: If everything looks healthy and normal, return { "diagnosis": "Pipeline is healthy", "actions": [] } with NO slack_message. Do not report routine operations.

Respond with JSON only (no markdown, no code fences):
{
  "diagnosis": "Plain English explanation of what's happening and why",
  "slack_message": "Message for the owner (ONLY if something noteworthy — omit if routine)",
  "actions": [
    { "type": "send_slack", "message": "..." }
  ]
}`
}

async function executeWatchdogAction(action: WatchdogAction): Promise<void> {
  switch (action.type) {
    case 'send_slack':
      if (action.message) {
        await sendSlack(`🐕 *Watchdog*\n${action.message}`)
        console.log(`${c.cyan}[watchdog] Action: send_slack${c.reset}`)
      }
      break

    case 'retrigger_job':
      if (action.job_id) {
        await supabase.from('job_queue')
          .update({ status: 'pending', worker_id: null, locked_at: null })
          .eq('id', action.job_id)
        console.log(`${c.green}[watchdog] Action: retrigger_job ${action.job_id.slice(0, 8)} — ${action.reason ?? 'no reason'}${c.reset}`)
        queueDigestEvent(`Watchdog retriggered job ${action.job_id.slice(0, 8)}`)
      }
      break

    case 'reject_proposal':
      if (action.proposal_id) {
        await supabase.from('proposals')
          .update({ status: 'rejected', completed_at: new Date().toISOString(), reject_reason: `Watchdog: ${action.reason ?? 'stuck proposal'}` })
          .eq('id', action.proposal_id)
        console.log(`${c.green}[watchdog] Action: reject_proposal ${action.proposal_id.slice(0, 8)} — ${action.reason ?? 'no reason'}${c.reset}`)
        queueDigestEvent(`Watchdog rejected proposal ${action.proposal_id.slice(0, 8)}`)
      }
      break

    case 'release_merge_lock':
      if (action.project_id) {
        await supabase.from('projects')
          .update({ merge_in_progress: false })
          .eq('id', action.project_id)
        console.log(`${c.green}[watchdog] Action: release_merge_lock${c.reset}`)
        queueDigestEvent('Watchdog released merge lock')
      }
      break

    case 'trigger_scout':
      if (action.project_id) {
        await supabase.from('job_queue').insert({
          project_id: action.project_id,
          github_issue_number: 0,
          issue_title: 'Watchdog-triggered scout',
          issue_body: '{}',
          job_type: 'scout',
          status: 'pending',
        })
        console.log(`${c.green}[watchdog] Action: trigger_scout${c.reset}`)
        queueDigestEvent('Watchdog triggered scout')
      }
      break

    case 'reset_job_attempts':
      if (action.job_id) {
        await supabase.from('job_queue')
          .update({ attempt_count: 0, last_error: null })
          .eq('id', action.job_id)
        console.log(`${c.green}[watchdog] Action: reset_job_attempts ${action.job_id.slice(0, 8)}${c.reset}`)
        queueDigestEvent(`Watchdog reset attempts for job ${action.job_id.slice(0, 8)}`)
      }
      break

    default:
      console.log(`${c.yellow}[watchdog] Ignored unknown action: ${(action as WatchdogAction).type}${c.reset}`)
  }
}

async function runWatchdog(): Promise<void> {
  // Skip during builds to avoid CLI concurrency issues
  if (pipelineStage === 'build') {
    console.log(`${c.gray}[watchdog] Skipped — build in progress${c.reset}`)
    return
  }

  let env: NodeJS.ProcessEnv
  try {
    env = await claudeEnv(true)
  } catch {
    console.log(`${c.yellow}[watchdog] Skipped — OAuth not available${c.reset}`)
    return
  }

  const context = await gatherWatchdogContext()
  const recentLogs = logBuffer.join('\n')
  const prompt = buildWatchdogPrompt(context, recentLogs)

  console.log(`${c.cyan}${c.bold}[watchdog] Running AI diagnosis...${c.reset}`)

  try {
    const result = await new Promise<string>((resolve, reject) => {
      const args = [
        '--dangerously-skip-permissions',
        '--permission-mode', 'dontAsk',
        '--output-format', 'json',
        '--model', 'claude-sonnet-4-6',
        '--verbose',
        '-p', prompt,
      ]

      const proc = spawn('claude', args, {
        cwd: join(import.meta.dirname, '..'),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      proc.stdin.end()

      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM')
        reject(new Error('Watchdog CLI timed out after 60s'))
      }, WATCHDOG_TIMEOUT_MS)

      proc.on('close', (code) => {
        clearTimeout(timeout)
        if (code === 0 || code === null) resolve(stdout)
        else reject(new Error(`Watchdog CLI exited with code ${code}: ${stderr.slice(-500)}`))
      })

      proc.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
    })

    // Parse the JSON response — CLI --output-format json wraps in { result: "..." }
    let response: WatchdogResponse
    try {
      const parsed = JSON.parse(result)
      const text = parsed.result ?? parsed.text ?? result
      const inner = typeof text === 'string' ? JSON.parse(text) : text
      response = inner as WatchdogResponse
    } catch {
      try {
        response = JSON.parse(result) as WatchdogResponse
      } catch {
        console.log(`${c.yellow}[watchdog] Could not parse response — raw: ${result.slice(0, 300)}${c.reset}`)
        return
      }
    }

    console.log(`${c.cyan}[watchdog] Diagnosis: ${response.diagnosis.slice(0, 200)}${c.reset}`)

    if (response.slack_message) {
      await sendSlack(`🐕 *Watchdog*\n${response.slack_message}`)
      console.log(`${c.cyan}[watchdog] Sent Slack message${c.reset}`)
    }

    for (const action of response.actions ?? []) {
      await executeWatchdogAction(action)
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`${c.yellow}[watchdog] Error: ${msg.slice(0, 200)}${c.reset}`)
  }
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

  // 8. AI Watchdog — diagnose pipeline health with Claude
  try {
    await runWatchdog()
  } catch (err) {
    console.log(`${c.yellow}[watchdog] Watchdog error: ${err instanceof Error ? err.message : String(err)}${c.reset}`)
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

# AI Watchdog Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an AI watchdog to the supervisor that spawns a Claude Code CLI instance every 2 minutes, diagnoses pipeline health, reports via Slack, and takes trivially obvious safe corrective actions.

**Architecture:** The existing `supervisor.ts` health check calls a new `runWatchdog()` function. It gathers DB state + recent worker logs, spawns `claude` CLI (OAuth, Sonnet 4.6, one-shot JSON mode), parses the structured response, sends Slack messages, and executes whitelisted safe actions. The watchdog is biased toward observation — it prefers reporting over acting.

**Tech Stack:** Node.js `child_process.spawn`, Claude Code CLI (`claude` binary), OAuth via `claudeEnv()` from `claude-cli.ts`, Supabase client already in supervisor.

---

### Task 1: Add log buffer to supervisor

**Files:**
- Modify: `packages/agent/src/supervisor.ts:64-72` (State section)
- Modify: `packages/agent/src/supervisor.ts:328-334` (stdout handler)

**Step 1: Add logBuffer array and MAX constant to the State section**

After line 72 (`const supabase = createSupabaseClient()`), add the log buffer:

```typescript
const LOG_BUFFER_MAX = 100
const logBuffer: string[] = []
```

**Step 2: Push lines into logBuffer in the stdout handler**

In the `worker.stdout?.on('data')` handler (currently lines 328-334), add a buffer push right after `console.log(colorize(line))` and before `analyzeWorkerLine(line)`:

```typescript
worker.stdout?.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n').filter(l => l.trim())
    for (const line of lines) {
      console.log(colorize(line))
      // Buffer for watchdog context
      logBuffer.push(line)
      if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift()
      analyzeWorkerLine(line)
    }
  })
```

**Step 3: Verify typecheck**

Run: `cd /Users/nikitadmitrieff/Projects/minions/packages/agent && npx tsc --noEmit`
Expected: Clean (no errors)

**Step 4: Commit**

```bash
git add packages/agent/src/supervisor.ts
git commit -m "feat(supervisor): add log ring buffer for watchdog context"
```

---

### Task 2: Add claudeEnv import and watchdog config

**Files:**
- Modify: `packages/agent/src/supervisor.ts:10-13` (imports)
- Modify: `packages/agent/src/supervisor.ts:17-25` (Config section)

**Step 1: Add claudeEnv import**

Add to the imports section (after line 13):

```typescript
import { claudeEnv } from './claude-cli.js'
```

**Step 2: Add watchdog config constant**

Add to the Config section (after `WORKER_SCRIPT`):

```typescript
const WATCHDOG_TIMEOUT_MS = 60_000     // 60s max for watchdog CLI
```

**Step 3: Verify typecheck**

Run: `cd /Users/nikitadmitrieff/Projects/minions/packages/agent && npx tsc --noEmit`
Expected: Clean

**Step 4: Commit**

```bash
git add packages/agent/src/supervisor.ts
git commit -m "feat(supervisor): add watchdog config and claudeEnv import"
```

---

### Task 3: Implement gatherWatchdogContext function

This function queries Supabase for the current pipeline state and returns a formatted string for the watchdog prompt.

**Files:**
- Modify: `packages/agent/src/supervisor.ts` — add new function before `healthCheck()`

**Step 1: Add gatherWatchdogContext function**

Insert before the `// ── Health Checks ──` section:

```typescript
// ── Watchdog ─────────────────────────────────────────────────────────────────
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
```

**Step 2: Verify typecheck**

Run: `cd /Users/nikitadmitrieff/Projects/minions/packages/agent && npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add packages/agent/src/supervisor.ts
git commit -m "feat(supervisor): add gatherWatchdogContext for DB state snapshot"
```

---

### Task 4: Implement runWatchdog function

This is the core: spawns Claude CLI, sends the prompt, parses JSON, executes actions.

**Files:**
- Modify: `packages/agent/src/supervisor.ts` — add after `gatherWatchdogContext()`

**Step 1: Define the WatchdogAction type and the WATCHDOG_PROMPT template**

```typescript
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
```

**Step 2: Implement runWatchdog**

```typescript
async function runWatchdog(): Promise<void> {
  // Skip during builds to avoid CLI concurrency issues
  if (pipelineStage === 'build') {
    console.log(`${c.gray}[watchdog] Skipped — build in progress${c.reset}`)
    return
  }

  let env: NodeJS.ProcessEnv
  try {
    env = await claudeEnv(true)  // restricted env, OAuth only
  } catch (err) {
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

    // Parse the JSON response — CLI with --output-format json wraps in { result: "..." }
    let response: WatchdogResponse
    try {
      const parsed = JSON.parse(result)
      // CLI JSON mode wraps the text in a result field
      const text = parsed.result ?? parsed.text ?? result
      // The text itself should be JSON — parse it
      const inner = typeof text === 'string' ? JSON.parse(text) : text
      response = inner as WatchdogResponse
    } catch {
      // Try parsing the raw stdout directly (might be plain JSON)
      try {
        response = JSON.parse(result) as WatchdogResponse
      } catch {
        console.log(`${c.yellow}[watchdog] Could not parse response — raw output: ${result.slice(0, 300)}${c.reset}`)
        return
      }
    }

    // Log diagnosis
    console.log(`${c.cyan}[watchdog] Diagnosis: ${response.diagnosis.slice(0, 200)}${c.reset}`)

    // Send slack message if present
    if (response.slack_message) {
      await sendSlack(`🐕 *Watchdog*\n${response.slack_message}`)
      console.log(`${c.cyan}[watchdog] Sent Slack message${c.reset}`)
    }

    // Execute whitelisted actions
    for (const action of response.actions ?? []) {
      await executeWatchdogAction(action)
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`${c.yellow}[watchdog] Error: ${msg.slice(0, 200)}${c.reset}`)
    // Don't alert on watchdog errors — it's a nice-to-have, not critical
  }
}
```

**Step 3: Implement executeWatchdogAction**

```typescript
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
```

**Step 4: Verify typecheck**

Run: `cd /Users/nikitadmitrieff/Projects/minions/packages/agent && npx tsc --noEmit`
Expected: Clean

**Step 5: Commit**

```bash
git add packages/agent/src/supervisor.ts
git commit -m "feat(supervisor): implement AI watchdog with CLI diagnosis and safe actions"
```

---

### Task 5: Wire watchdog into healthCheck

**Files:**
- Modify: `packages/agent/src/supervisor.ts` — end of `healthCheck()` function

**Step 1: Add watchdog call at the end of healthCheck**

After the idle pipeline check (after the closing `}` of the `if ((activeJobCount ?? 0) === 0)` block, at the very end of `healthCheck()`), add:

```typescript
  // 8. AI Watchdog — diagnose pipeline health with Claude
  try {
    await runWatchdog()
  } catch (err) {
    console.log(`${c.yellow}[watchdog] Watchdog error: ${err instanceof Error ? err.message : String(err)}${c.reset}`)
  }
```

**Step 2: Verify typecheck**

Run: `cd /Users/nikitadmitrieff/Projects/minions/packages/agent && npx tsc --noEmit`
Expected: Clean

**Step 3: Commit**

```bash
git add packages/agent/src/supervisor.ts
git commit -m "feat(supervisor): wire watchdog into health check loop"
```

---

### Task 6: Build and verify

**Step 1: Full build**

Run: `cd /Users/nikitadmitrieff/Projects/minions && npm run build`
Expected: Clean build with no errors

**Step 2: Verify the managed-worker "no changes" fix is also compiled**

The fix at `managed-worker.ts:431-445` (reject proposal when builder produces no changes) is already written from the earlier session. The build step compiles it.

**Step 3: Verify the log intelligence in supervisor.ts is compiled**

The `analyzeWorkerLine()` function (lines 76-214) was added earlier. The build compiles it.

**Step 4: Commit any remaining changes**

```bash
git add -A
git commit -m "build: compile watchdog, log intelligence, and no-changes fix"
```

---

## Summary of all changes

| File | What changed |
|------|-------------|
| `packages/agent/src/supervisor.ts` | Log buffer, `claudeEnv` import, `gatherWatchdogContext()`, `runWatchdog()`, `executeWatchdogAction()`, watchdog prompt, wired into `healthCheck()` |
| `packages/agent/src/managed-worker.ts` | "No changes" case now rejects proposal + triggers cycle completion (pre-existing fix from earlier) |

**No new files. No new dependencies.**

# AI Watchdog — Design

## Problem

The Minions pipeline stalls in ways the deterministic supervisor can't diagnose. Stuck proposals, builders that produce no changes, strategists that generate nothing viable — these require a human to read logs, understand root causes, and take corrective action. The supervisor detects _that_ something is wrong but not _why_.

## Solution

Add an AI watchdog that runs alongside the existing health check every 2 minutes. It receives the current pipeline state and recent worker logs, reasons about what's happening, and primarily reports its diagnosis to the owner via Slack. It takes corrective actions only when the fix is trivially obvious and safe.

## Architecture

```
supervisor.ts (existing)
  └─ healthCheck() (every 2 min)
       ├─ existing deterministic checks (stuck jobs, dead workers, etc.)
       └─ runWatchdog() (new)
            ├─ gather context from Supabase
            ├─ read logBuffer (ring buffer of recent worker stdout)
            ├─ spawn `claude` CLI (OAuth, Sonnet 4.6, one-shot)
            │   ├─ cwd = agent package dir (read-only access to source)
            │   ├─ prompt contains all context + action whitelist
            │   └─ returns JSON: { diagnosis, slack_message?, actions[] }
            ├─ parse response
            ├─ send slack_message if present
            └─ execute actions (only from whitelist, with logging)
```

## Behavior Hierarchy

The watchdog follows this strict priority order:

1. **Always:** Diagnose what's happening and why
2. **Prefer:** Send a Slack message with the diagnosis and what the owner could do
3. **Only if trivially obvious:** Take a safe corrective action (and still report it)

The watchdog should never feel compelled to act. Observation and reporting is its primary job. Actions are the exception, not the rule.

## Safe Action Whitelist

These are the only actions the supervisor will execute from the watchdog's recommendations:

| Action | What it does | When it's "obvious" |
|--------|-------------|---------------------|
| `retrigger_job` | Reset a failed/stuck job to `pending` | Job stuck in `processing` with dead worker_id for >30 min |
| `reject_proposal` | Mark a stuck proposal as `rejected` | Proposal in `approved` status with no corresponding build job |
| `release_merge_lock` | Set `merge_in_progress = false` | Lock held for >10 min with no active merge job |
| `trigger_scout` | Insert a new `scout` job | Pipeline idle with no jobs and no in-flight proposals |
| `send_slack` | Send diagnostic message to Slack | Always allowed |
| `reset_job_attempts` | Clear attempt count and error | Job failed due to transient error (network, timeout) |

Any action not in this list is logged and ignored.

## CLI Configuration

- **Binary:** `claude`
- **Auth:** OAuth token via `CLAUDE_CODE_OAUTH_TOKEN` env var (from `claudeEnv()`)
- **Model:** `claude-sonnet-4-6`
- **Flags:** `--dangerously-skip-permissions --permission-mode dontAsk --output-format json -p <prompt>`
- **Working directory:** Agent package dir (can read source files)
- **Output format:** `json` (not `stream-json` — one-shot response, not streaming)
- **Timeout:** 60 seconds (if it takes longer, something is wrong — kill it)
- **Never uses ANTHROPIC_API_KEY** — OAuth only

## Concurrency Safety

Skip the watchdog run if `pipelineStage === 'build'` (builder holds a CLI session for up to 45 min and we don't want to compete for the ~14 session limit).

## Prompt

```
You are the AI watchdog for the Minions autonomous pipeline.

Your PRIMARY job is to OBSERVE and REPORT. You are NOT an operator.

RULES:
- NEVER write, edit, delete, or create files
- NEVER run bash commands
- You may read source files to understand how the system works
- Your default action is to send a Slack message explaining what's happening
- ONLY take corrective actions when the fix is TRIVIALLY OBVIOUS and SAFE
- When in doubt, report to the owner — don't act
- Return ONLY a JSON object

CURRENT PIPELINE STATE:
<jobs, proposals, events, stage info>

RECENT WORKER LOGS (last 100 lines):
<buffered stdout>

AVAILABLE ACTIONS (use sparingly — prefer send_slack):
- send_slack(message) — always allowed, your primary tool
- retrigger_job(job_id, reason) — only for clearly stuck/orphaned jobs
- reject_proposal(proposal_id, reason) — only for clearly abandoned proposals
- release_merge_lock(project_id) — only for obviously stuck locks
- trigger_scout(project_id) — only when pipeline is clearly idle
- reset_job_attempts(job_id) — only for transient failures

Respond with JSON only:
{
  "diagnosis": "Plain English explanation of what's happening and why",
  "slack_message": "Message to send to the owner (optional — only if something noteworthy)",
  "actions": [
    { "type": "send_slack", "message": "..." },
    { "type": "retrigger_job", "job_id": "...", "reason": "..." }
  ]
}

If everything looks healthy, return:
{ "diagnosis": "Pipeline is healthy", "actions": [] }
```

## Changes

Only **`packages/agent/src/supervisor.ts`** is modified:

1. Add `logBuffer: string[]` ring buffer (max 100 lines)
2. Push to buffer in existing `worker.stdout` handler
3. Add `runWatchdog()` async function
4. Call from `healthCheck()` after existing checks
5. Add action executor with whitelist validation

No new files. No new dependencies. Reuses `claudeEnv()` from `claude-cli.ts` for OAuth token.

## Slack Output

Watchdog messages are tagged differently from digests:

> **Watchdog:** The strategist produced 1 proposal but it scored 0.53 (below the 0.6 threshold), so it was discarded. This is the 3rd consecutive cycle with no viable proposals. The product context asks for "interactive features" but the scout is finding mostly code quality issues. Consider updating the strategic nudges to be more specific about what features you want.

vs. digest:

> **Digest:** Pipeline idle. 0 pending, 0 processing.

## Non-Goals

- The watchdog does NOT modify code or push to GitHub
- The watchdog does NOT change project settings or thresholds
- The watchdog does NOT interact with the GitHub API
- The watchdog is NOT a replacement for the deterministic health checks — it runs alongside them

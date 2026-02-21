# Claude CLI: OAuth Streaming Setup Guide

How to spawn Claude Code CLI as a subprocess with OAuth authentication and real-time stream-json output. Portable to any Node.js backend.

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  Your Backend (Node.js)                         │
│                                                 │
│  1. initCredentials() at startup                │
│     └─ Supabase → env var → ~/.claude/creds     │
│                                                 │
│  2. ensureValidToken() before each CLI run      │
│     └─ Reads creds file, refreshes if < 5 min   │
│                                                 │
│  3. spawn('claude', args, { env })              │
│     └─ OAuth token via CLAUDE_CODE_OAUTH_TOKEN  │
│     └─ ANTHROPIC_API_KEY stripped from env       │
│                                                 │
│  4. Parse stream-json lines from stdout         │
│     └─ readline interface, JSON.parse per line  │
└─────────────────────────────────────────────────┘
```

## Critical Flags

The Claude CLI has specific flag requirements that are easy to get wrong:

```bash
claude \
  --dangerously-skip-permissions \
  --verbose \
  --output-format stream-json \
  --include-partial-messages \
  -p "your prompt here"
```

| Flag | Required? | Why |
|------|-----------|-----|
| `--dangerously-skip-permissions` | Yes | Skips interactive permission prompts (headless mode) |
| `--verbose` | **Yes** | **Mandatory** when using `--output-format stream-json` with `-p`. CLI exits with code 1 without it. |
| `--output-format stream-json` | Yes | Emits newline-delimited JSON events on stdout |
| `--include-partial-messages` | Optional | Includes partial/streaming content blocks for real-time updates |
| `-p <prompt>` | Yes | Print mode — runs prompt non-interactively |

### The `--verbose` Trap

If you use `--output-format stream-json` with `-p` (print mode) but omit `--verbose`, the CLI immediately exits with:

```
Error: When using --print, --output-format=stream-json requires --verbose
```

This is the single most common failure mode when setting up programmatic CLI usage.

## OAuth Credentials

### Credential File Format

Claude CLI reads credentials from `~/.claude/.credentials.json`:

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat-...",
    "refreshToken": "sk-ant-ort-...",
    "expiresAt": 1740000000000,
    "scopes": ["user:inference", "user:profile"],
    "subscriptionType": "max",
    "rateLimitTier": "claude_pro"
  }
}
```

### Initial Seed

Get the initial credentials by authenticating with `claude` CLI interactively once. Then extract the JSON from `~/.claude/.credentials.json` and store it as:

- **Supabase** `system_credentials` table (key: `system_claude_oauth`) — survives container restarts
- **Env var** `CLAUDE_CREDENTIALS_JSON` — fallback for first boot

### Token Lifecycle

```
Startup:  initCredentials()
            │
            ├─ Supabase has token? → write to ~/.claude/.credentials.json
            │
            └─ Env var fallback? → write to file + persist to Supabase

Before each CLI run:  ensureValidToken()
            │
            ├─ Token valid (>5 min remaining)? → proceed
            │
            └─ Expired/expiring? → refresh via Anthropic OAuth endpoint
               └─ Write new token to file + Supabase
```

### Refresh Endpoint

```
POST https://console.anthropic.com/v1/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e
refresh_token=sk-ant-ort-...
```

Response:
```json
{
  "access_token": "sk-ant-oat-...",
  "refresh_token": "sk-ant-ort-...",
  "expires_in": 3600
}
```

## Environment Setup

**Rule: ANTHROPIC_API_KEY must NEVER be passed to the CLI.** It is only for direct Anthropic SDK calls (Haiku, etc). The CLI must always authenticate via OAuth.

```typescript
async function claudeEnv(restricted = false): Promise<NodeJS.ProcessEnv> {
  await ensureValidToken()  // refresh if needed

  const creds = JSON.parse(readFileSync('~/.claude/.credentials.json', 'utf-8'))
  const accessToken = creds.claudeAiOauth.accessToken

  if (restricted) {
    // Sandbox mode: minimal env, no inherited secrets
    return {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      CI: 'true',
      CLAUDE_CODE_OAUTH_TOKEN: accessToken,
    }
  }

  // Full mode: inherit env EXCEPT sensitive keys
  const { ANTHROPIC_API_KEY: _, ...rest } = process.env
  return {
    ...rest,
    CI: 'true',
    CLAUDE_CODE_OAUTH_TOKEN: accessToken,
  }
}
```

Key points:
- `CLAUDE_CODE_OAUTH_TOKEN` — the env var Claude CLI reads for OAuth auth
- `ANTHROPIC_API_KEY` — **always stripped**, never passed to CLI
- `CI: 'true'` — suppresses interactive prompts
- `restricted` mode — for running in consumer repos (sandbox), only HOME/PATH exposed

## Spawning the CLI

Use `spawn` (not `execSync` or `execFileSync`) for streaming:

```typescript
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'

const args = [
  '--dangerously-skip-permissions',
  '--verbose',                        // REQUIRED for stream-json
  '--output-format', 'stream-json',
  '--include-partial-messages',
  '-p', prompt,
]

const proc = spawn('claude', args, {
  cwd: workDir,
  env: await claudeEnv(),
  stdio: ['pipe', 'pipe', 'pipe'],
})

// Close stdin immediately — CLI doesn't need input in print mode
proc.stdin.end()
```

### Why `spawn` over `execFileSync`

- `execFileSync` blocks the event loop and buffers all output until exit
- `spawn` gives you real-time stdout/stderr streaming
- With `execFileSync` you get zero visibility during long runs (10+ min)

## Parsing Stream-JSON Output

Each line on stdout is a JSON event. Key event types:

```typescript
const rl = createInterface({ input: proc.stdout })

rl.on('line', (line) => {
  try {
    const evt = JSON.parse(line)

    if (evt.type === 'assistant' && evt.message?.content) {
      for (const block of evt.message.content) {
        if (block.type === 'tool_use') {
          // Claude is using a tool (Read, Edit, Bash, etc.)
          console.log(`Tool: ${block.name}`, block.input)
        } else if (block.type === 'text' && block.text?.trim()) {
          // Claude's text output
          console.log(`Claude: ${block.text.trim().slice(0, 200)}`)
        }
      }
    }
  } catch {
    // Non-JSON line (startup messages, etc.)
    if (line.trim()) console.log(`[raw] ${line.trim()}`)
  }
})
```

### Event Types

| `evt.type` | Contains | Description |
|-----------|----------|-------------|
| `assistant` | `evt.message.content[]` | Claude's response blocks (text, tool_use) |
| `system` | System info | Session initialization |
| `result` | Final result | Completion event |

Content block types inside `evt.message.content`:

| `block.type` | Fields | Description |
|-------------|--------|-------------|
| `text` | `block.text` | Claude's text output |
| `tool_use` | `block.name`, `block.input` | Tool call (Read, Edit, Bash, Glob, Grep, Write) |
| `tool_result` | `block.content` | Result from a tool call |

## Timeout and Process Management

```typescript
// Timeout guard
const timer = setTimeout(() => {
  proc.kill('SIGTERM')
  reject(new Error(`Claude CLI timed out after ${timeoutMs / 60000} min`))
}, timeoutMs)

// Stdout byte monitor — detect silent buffering
let stdoutBytes = 0
proc.stdout.on('data', (chunk: Buffer) => {
  stdoutBytes += chunk.length
})
const monitor = setInterval(() => {
  console.log(`[monitor] stdout=${stdoutBytes} bytes, pid=${proc.pid}`)
}, 5000)

// Clean up on exit
proc.on('close', (code) => {
  clearTimeout(timer)
  clearInterval(monitor)
  if (code === 0) resolve()
  else reject(new Error(`CLI exited with code ${code}\nSTDERR: ${stderr}`))
})

proc.on('error', (err) => {
  clearTimeout(timer)
  clearInterval(monitor)
  reject(err)
})
```

### Concurrency Limit

Claude CLI has a **~14 concurrent session limit** per OAuth account. Excess sessions hang with null exit code and never produce output. Track active processes and queue beyond this limit.

## Stderr Handling

Stderr contains diagnostics. Stream it in real-time:

```typescript
let stderr = ''
proc.stderr.on('data', (chunk: Buffer) => {
  const text = chunk.toString().trim()
  stderr += text + '\n'
  if (text) console.log(`[stderr] ${text.slice(0, 300)}`)
})
```

Common stderr patterns:
- `auth=oauth` — correct, using OAuth
- `auth=api-key` — **wrong**, ANTHROPIC_API_KEY is leaking into the env
- `Error: When using --print, --output-format=stream-json requires --verbose` — missing `--verbose` flag

## Supabase Persistence (Optional)

For containerized deployments (Railway, Fly, etc.), tokens must survive restarts:

```sql
CREATE TABLE system_credentials (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

On each token refresh, upsert the full credentials JSON:

```typescript
await supabase
  .from('system_credentials')
  .upsert(
    { key: 'system_claude_oauth', value: JSON.stringify(creds) },
    { onConflict: 'key' }
  )
```

## Checklist

Before deploying:

- [ ] `--verbose` is included in args (required for stream-json)
- [ ] `ANTHROPIC_API_KEY` is stripped from CLI env
- [ ] `CLAUDE_CODE_OAUTH_TOKEN` is set in CLI env
- [ ] `proc.stdin.end()` is called after spawn
- [ ] Timeout kills the process with `SIGTERM`
- [ ] Monitor interval is cleared on close/error
- [ ] Credentials are seeded at startup (`initCredentials`)
- [ ] Token refresh runs before each CLI invocation (`ensureValidToken`)
- [ ] Refreshed tokens persist to Supabase (or equivalent)
- [ ] Concurrency stays under ~14 sessions

## Gotchas Log

| Issue | Symptom | Fix |
|-------|---------|-----|
| Missing `--verbose` | CLI exits code 1: "stream-json requires --verbose" | Always include `--verbose` with `stream-json` |
| `ANTHROPIC_API_KEY` in env | Logs show `auth=api-key` instead of `auth=oauth` | Strip from env before spawn |
| `execFileSync` instead of `spawn` | Zero output for 10+ min, then everything at once | Use `spawn` for streaming |
| Stdin not closed | CLI hangs waiting for input | Call `proc.stdin.end()` immediately |
| No credential refresh | Token expires mid-run, CLI auth fails | Call `ensureValidToken()` before each run |
| Container restart loses tokens | Fresh container has no `~/.claude/.credentials.json` | Persist to Supabase, load at startup |
| Concurrency exceeded | Sessions hang with null exit code, no output | Cap at ~14 concurrent CLI processes |
| Monitor interval leak | Node process doesn't exit cleanly | `clearInterval(monitor)` on close and error |
| Hardcoded branch in PR creation | GitHub 422 "head invalid" when using custom branch names | Pass the actual branch name to `createPR()`, don't hardcode |
| Job retries on PR failure | Worker re-clones and re-runs Claude CLI after a PR 422 error | Separate transient (network) from permanent (bad branch) errors |

## Reference Implementation

See `packages/agent/src/claude-cli.ts` for the production implementation used in this repo.

/**
 * Shared Claude CLI runner — single source of truth for spawning Claude Code.
 * Used by both worker.ts (agent jobs) and builder-worker.ts (build jobs).
 *
 * IMPORTANT: Claude CLI MUST use OAuth (Max subscription) only.
 * ANTHROPIC_API_KEY is NEVER passed to the CLI.
 * If OAuth is not configured or fails, the CLI job must fail loudly.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { ensureValidToken } from './oauth.js'
import type { DbLogger } from './logger.js'

/**
 * Build env for Claude CLI. OAuth-only — never passes ANTHROPIC_API_KEY.
 * Throws if OAuth credentials are missing or refresh fails.
 *
 * @param restricted - If true, only pass HOME/PATH/CI (builder sandbox mode).
 *                     If false, pass full process.env minus sensitive keys.
 */
export async function claudeEnv(restricted = false): Promise<NodeJS.ProcessEnv> {
  // OAuth is mandatory for CLI. Credentials are loaded at startup by
  // initCredentials() (from Supabase or CLAUDE_CREDENTIALS_JSON env var)
  // and written to ~/.claude/.credentials.json. We read from that file.
  const ok = await ensureValidToken()
  if (!ok) {
    throw new Error(
      'OAuth token not available. Claude CLI requires OAuth (Max subscription). ' +
      'Ensure initCredentials() ran at startup and credentials exist in Supabase ' +
      'or CLAUDE_CREDENTIALS_JSON env var. ANTHROPIC_API_KEY must never be used for CLI.',
    )
  }

  const credsPath = join(homedir(), '.claude', '.credentials.json')
  let accessToken: string | undefined
  try {
    const creds = JSON.parse(readFileSync(credsPath, 'utf-8'))
    accessToken = creds?.claudeAiOauth?.accessToken
  } catch (err) {
    throw new Error(`Failed to read OAuth credentials from ${credsPath}: ${err}`)
  }

  if (!accessToken) {
    throw new Error(
      `OAuth credentials file exists but contains no accessToken. ` +
      'Re-authenticate with Claude CLI to refresh credentials.',
    )
  }

  if (restricted) {
    // Builder sandbox: minimal env, keep HOME so user skills/plugins load
    return {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      CI: 'true',
      NODE_ENV: 'production',
      CLAUDE_CODE_OAUTH_TOKEN: accessToken,
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: '128000',
    }
  }

  // Full env mode: pass everything EXCEPT ANTHROPIC_API_KEY and CLAUDECODE
  const { ANTHROPIC_API_KEY: _, CLAUDECODE: _cc, ...rest } = process.env
  return {
    ...rest,
    CI: 'true',
    CLAUDE_CODE_OAUTH_TOKEN: accessToken,
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: '128000',
  }
}

export function summarizeToolInput(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Read':
      return `\u{1F4D6} Read ${input.file_path ?? 'file'}`
    case 'Edit':
      return `\u270F\uFE0F  Edit ${input.file_path ?? 'file'}`
    case 'Write':
      return `\u{1F4DD} Write ${input.file_path ?? 'file'}`
    case 'Bash':
      return `\u{1F4BB} ${String(input.command ?? '').slice(0, 120)}`
    case 'Glob':
      return `\u{1F50D} Glob ${input.pattern ?? ''}`
    case 'Grep':
      return `\u{1F50E} Grep ${input.pattern ?? ''}`
    case 'Task':
      return `\u{1F916} Subagent`
    case 'TodoWrite':
      return `\u2705 Todo update`
    default:
      return `\u{1F527} ${tool}`
  }
}

export interface RunClaudeOptions {
  prompt: string
  workDir: string
  timeoutMs: number
  /** DbLogger for structured logging to Supabase. */
  logger?: DbLogger
  /** Label for console logs (e.g. job-1, builder-abc). */
  logPrefix?: string
  /** If true, use restricted env (HOME/PATH only). Default: false. */
  restrictedEnv?: boolean
  /** Extra env vars to pass to the CLI (e.g. database credentials). */
  extraEnv?: Record<string, string>
}

export async function runClaude(opts: RunClaudeOptions): Promise<void> {
  const { prompt, workDir, timeoutMs, logger, logPrefix = 'claude', restrictedEnv = false, extraEnv } = opts
  const env = { ...await claudeEnv(restrictedEnv), ...extraEnv }
  const args = ['--dangerously-skip-permissions', '--permission-mode', 'dontAsk', '--verbose', '--model', 'claude-sonnet-4-6', '--output-format', 'stream-json', '--include-partial-messages', '-p', prompt]

  console.log(`[${logPrefix}] Running Claude Code CLI (stream-json, auth=oauth)...`)
  await logger?.event('text', `Starting Claude CLI (auth=oauth, cwd=${workDir}, prompt=${prompt.length} chars)`)

  return new Promise<void>((resolve, reject) => {
    const proc = spawn('claude', args, { cwd: workDir, env, stdio: ['pipe', 'pipe', 'pipe'] })

    // Close stdin immediately so the CLI doesn't wait for input
    proc.stdin.end()

    let settled = false
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearTimeout(resultGraceTimer)
      clearInterval(monitor)
      fn()
    }

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      settle(() => reject(new Error(`Claude CLI timed out after ${Math.round(timeoutMs / 60000)} minutes`)))
    }, timeoutMs)

    // Grace period: if CLI emits 'result' but doesn't exit within 15s, kill it
    let resultGraceTimer: ReturnType<typeof setTimeout>
    const RESULT_GRACE_MS = 15_000

    let stderr = ''
    let stdoutBytes = 0
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      stderr += text + '\n'
      if (text) {
        console.log(`[${logPrefix}] [stderr] ${text.slice(0, 300)}`)
        logger?.event('text', `[claude:stderr] ${text.slice(0, 300)}`)
      }
    })

    // Raw stdout monitoring — log byte count every 5s to detect silent buffering
    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
    })
    let lastMonitorBytes = 0
    const monitor = setInterval(() => {
      // Only log if new output was produced (skip silent polls)
      if (stdoutBytes !== lastMonitorBytes) {
        lastMonitorBytes = stdoutBytes
      }
    }, 60000)

    const rl = createInterface({ input: proc.stdout })
    rl.on('line', (line) => {
      try {
        const evt = JSON.parse(line)
        if (evt.type === 'result') {
          // CLI is done — start grace period in case it doesn't exit on its own
          console.log(`[${logPrefix}] [event] result (starting ${RESULT_GRACE_MS / 1000}s exit grace period)`)
          resultGraceTimer = setTimeout(() => {
            console.log(`[${logPrefix}] CLI did not exit after result — killing process`)
            logger?.event('text', 'CLI hung after result event — force killed')
            proc.kill('SIGTERM')
            settle(() => resolve())
          }, RESULT_GRACE_MS)
        } else if (evt.type === 'assistant' && evt.message?.content) {
          for (const block of evt.message.content) {
            if (block.type === 'tool_use') {
              const summary = summarizeToolInput(block.name, block.input ?? {})
              logger?.event('tool_use', summary, { tool: block.name, input: block.input })
            } else if (block.type === 'text' && block.text?.trim()) {
              const preview = block.text.trim().slice(0, 200)
              console.log(`[${logPrefix}] \u{1F4AC} ${preview}`)
              logger?.event('text', `[claude] ${preview}`)
            }
          }
        } else if (evt.type === 'rate_limit_event') {
          console.log(`[${logPrefix}] \u23F3 Rate limited — waiting`)
        } else if (evt.type && !['stream_event', 'user', 'system'].includes(evt.type)) {
          console.log(`[${logPrefix}] [event] ${evt.type}`)
        }
      } catch {
        if (line.trim()) {
          console.log(`[${logPrefix}] [raw] ${line.trim().slice(0, 200)}`)
          logger?.event('text', `[claude:raw] ${line.trim().slice(0, 200)}`)
        }
      }
    })

    proc.on('close', (code) => {
      settle(() => {
        if (code === 0 || code === null) resolve()
        else reject(new Error(`Claude CLI exited with code ${code}\nSTDERR: ${stderr.slice(-2000)}`))
      })
    })

    proc.on('error', (err) => {
      settle(() => reject(err))
    })
  })
}

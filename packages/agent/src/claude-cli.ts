/**
 * Shared Claude CLI runner — single source of truth for spawning Claude Code.
 * Used by both worker.ts (agent jobs) and builder-worker.ts (build jobs).
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { ensureValidToken } from './oauth.js'
import type { DbLogger } from './logger.js'

/**
 * Build env for Claude CLI: refresh OAuth token and pass it via
 * CLAUDE_CODE_OAUTH_TOKEN so the CLI uses the Max subscription.
 * Also strip ANTHROPIC_API_KEY to ensure it doesn't fall back to API billing.
 *
 * @param restricted - If true, only pass HOME/PATH/CI (builder sandbox mode).
 *                     If false, pass full process.env minus sensitive keys.
 */
export async function claudeEnv(restricted = false): Promise<NodeJS.ProcessEnv> {
  if (restricted) {
    const limited: NodeJS.ProcessEnv = {
      HOME: process.env.HOME,
      PATH: process.env.PATH,
      CI: 'true',
      NODE_ENV: 'production',
    }

    if (process.env.CLAUDE_CREDENTIALS_JSON) {
      const ok = await ensureValidToken()
      if (ok) {
        try {
          const credsPath = join(homedir(), '.claude', '.credentials.json')
          const creds = JSON.parse(readFileSync(credsPath, 'utf-8'))
          const accessToken = creds?.claudeAiOauth?.accessToken
          if (accessToken) {
            limited.CLAUDE_CODE_OAUTH_TOKEN = accessToken
            return limited
          }
        } catch { /* fall through */ }
      }
    }

    if (process.env.ANTHROPIC_API_KEY) {
      limited.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY
    }

    return limited
  }

  // Full env mode (agent jobs)
  if (process.env.CLAUDE_CREDENTIALS_JSON) {
    const ok = await ensureValidToken()
    if (!ok) {
      console.warn('[claude] OAuth refresh failed, falling back to process.env')
      const { CLAUDECODE: _cc, ...envWithoutClaude } = process.env
      return { ...envWithoutClaude, CI: 'true' }
    }
    try {
      const credsPath = join(homedir(), '.claude', '.credentials.json')
      const creds = JSON.parse(readFileSync(credsPath, 'utf-8'))
      const accessToken = creds?.claudeAiOauth?.accessToken
      if (accessToken) {
        const { ANTHROPIC_API_KEY: _, ...rest } = process.env
        const { CLAUDECODE: _cc, ...rest2 } = rest
        return { ...rest2, CLAUDE_CODE_OAUTH_TOKEN: accessToken, CI: 'true' }
      }
    } catch {}
  }
  const { CLAUDECODE: _cc, ...envWithoutClaude } = process.env
  return { ...envWithoutClaude, CI: 'true' }
}

export function summarizeToolInput(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case 'Read':
      return `Reading ${input.file_path ?? 'file'}`
    case 'Edit':
      return `Editing ${input.file_path ?? 'file'}`
    case 'Write':
      return `Creating ${input.file_path ?? 'file'}`
    case 'Bash':
      return `Running: ${String(input.command ?? '').slice(0, 120)}`
    case 'Glob':
      return `Searching files: ${input.pattern ?? ''}`
    case 'Grep':
      return `Searching for: ${input.pattern ?? ''}`
    default:
      return `Using tool: ${tool}`
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
}

export async function runClaude(opts: RunClaudeOptions): Promise<void> {
  const { prompt, workDir, timeoutMs, logger, logPrefix = 'claude', restrictedEnv = false } = opts
  const env = await claudeEnv(restrictedEnv)
  const authMethod = env.CLAUDE_CODE_OAUTH_TOKEN ? 'oauth' : env.ANTHROPIC_API_KEY ? 'api-key' : 'none'
  const args = ['--dangerously-skip-permissions', '--verbose', '--output-format', 'stream-json', '--include-partial-messages', '-p', prompt]

  console.log(`[${logPrefix}] Running Claude Code CLI (stream-json, auth=${authMethod})...`)
  await logger?.event('text', `Starting Claude CLI (auth=${authMethod}, cwd=${workDir}, prompt=${prompt.length} chars)`)

  return new Promise<void>((resolve, reject) => {
    const proc = spawn('claude', args, { cwd: workDir, env, stdio: ['pipe', 'pipe', 'pipe'] })

    const timer = setTimeout(() => {
      proc.kill('SIGTERM')
      reject(new Error(`Claude CLI timed out after ${Math.round(timeoutMs / 60000)} minutes`))
    }, timeoutMs)

    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim()
      stderr += text + '\n'
      if (text) {
        console.log(`[${logPrefix}] [stderr] ${text.slice(0, 300)}`)
        logger?.event('text', `[claude:stderr] ${text.slice(0, 300)}`)
      }
    })

    const rl = createInterface({ input: proc.stdout })
    rl.on('line', (line) => {
      try {
        const evt = JSON.parse(line)
        if (evt.type === 'assistant' && evt.message?.content) {
          for (const block of evt.message.content) {
            if (block.type === 'tool_use') {
              const summary = summarizeToolInput(block.name, block.input ?? {})
              logger?.event('tool_use', summary, { tool: block.name, input: block.input })
            } else if (block.type === 'text' && block.text?.trim()) {
              const preview = block.text.trim().slice(0, 200)
              console.log(`[${logPrefix}] [claude] ${preview}`)
              logger?.event('text', `[claude] ${preview}`)
            }
          }
        } else if (evt.type) {
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
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`Claude CLI exited with code ${code}\nSTDERR: ${stderr.slice(-2000)}`))
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

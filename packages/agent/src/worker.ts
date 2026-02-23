import { execSync, execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseIssueBody } from './parse-issue.js'
import { runClaude } from './claude-cli.js'
import { validateRef, redactToken } from './sanitize.js'
import {
  commentOnIssue,
  labelIssue,
  createPR,
  findOpenPR,
  removeLabelFromIssue,
  getIssueComments,
} from './github.js'
import { initCredentials } from './oauth.js'
import { loadConfig, matchesEnvPattern } from './config.js'
import type { GitHubConfig } from './github.js'
import type { SupabaseClient } from '@supabase/supabase-js'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>
import { DbLogger } from './logger.js'

const STEP_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes per build/test step
const MAX_FIX_ATTEMPTS = 2
const MIN_RETRY_BUDGET_MS = 3 * 60 * 1000 // need at least 3 min for a retry

export interface JobInput {
  issueNumber: number
  issueTitle: string
  issueBody: string
}

interface ValidationResult {
  success: boolean
  stage: 'build' | 'lint'
  errorOutput: string
  changedFiles: string[]
}

function run(cmd: string, cwd: string, timeoutMs = STEP_TIMEOUT_MS): string {
  try {
    return execSync(cmd, {
      cwd,
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true' },
    })
  } catch (err: unknown) {
    const e = err as { stderr?: string; stdout?: string; status?: number }
    const details = `Exit code: ${e.status}\nSTDERR: ${(e.stderr || '').slice(-2000)}\nSTDOUT: ${(e.stdout || '').slice(-2000)}`
    throw new Error(`Command failed: ${redactToken(cmd)}\n${redactToken(details)}`)
  }
}

// claudeEnv, summarizeToolInput, runClaude → shared in claude-cli.ts

function getChangedFiles(workDir: string): string[] {
  const modified = run('git diff --name-only HEAD', workDir).trim()
  const untracked = run('git ls-files --others --exclude-standard', workDir).trim()
  return [modified, untracked]
    .filter(Boolean)
    .join('\n')
    .split('\n')
    .filter((f) => /\.(ts|tsx|js|jsx)$/.test(f))
}

function validate(workDir: string, issueNumber: number, buildCommand: string): ValidationResult {
  // Build
  try {
    console.log(`[job-${issueNumber}] Running build validation...`)
    run(buildCommand, workDir)
    console.log(`[job-${issueNumber}] Build passed`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, stage: 'build', errorOutput: msg, changedFiles: [] }
  }

  // Lint changed files only
  const changedFiles = getChangedFiles(workDir)
  if (changedFiles.length === 0) {
    return { success: true, stage: 'lint', errorOutput: '', changedFiles: [] }
  }

  try {
    console.log(`[job-${issueNumber}] Running lint on ${changedFiles.length} changed files...`)
    run(`npx eslint ${changedFiles.join(' ')}`, workDir)
    console.log(`[job-${issueNumber}] Lint passed`)
    return { success: true, stage: 'lint', errorOutput: '', changedFiles }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, stage: 'lint', errorOutput: msg, changedFiles }
  }
}

async function fail(issueNumber: number, reason: string, logs: string, workDir: string) {
  try {
    const truncated = logs.length > 3000 ? logs.slice(-3000) : logs
    await commentOnIssue(
      issueNumber,
      `Agent failed: ${reason}\n\n<details><summary>Logs (last 3000 chars)</summary>\n\n\`\`\`\n${truncated}\n\`\`\`\n\n</details>`
    )
    await removeLabelFromIssue(issueNumber, 'in-progress')
    await labelIssue(issueNumber, ['agent-failed'])
  } catch (err) {
    console.error(`[job-${issueNumber}] Failed to report error to GitHub:`, err)
  }
  cleanup(workDir)
}

function cleanup(workDir: string) {
  if (existsSync(workDir)) {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function extractBranchName(issueBody: string): string | null {
  const match = issueBody.match(/^Branch:\s*(.+)$/m)
  return match ? match[1].trim() : null
}

export async function runJob(input: JobInput, logger?: DbLogger): Promise<{ success: boolean; prNumber?: number }> {
  const config = loadConfig()
  const { issueNumber, issueTitle, issueBody } = input
  const workDir = `/tmp/job-${issueNumber}`
  const jobStart = Date.now()

  console.log(`[job-${issueNumber}] Starting`)
  await logger?.event('text', `Job claimed — starting implementation for issue #${issueNumber}`)

  // 1. Parse issue
  let parsed
  try {
    parsed = parseIssueBody(issueBody)
  } catch (err) {
    await logger?.event('error', `Could not parse issue body: ${err}`)
    await commentOnIssue(issueNumber, `Agent could not parse issue body: ${err}`)
    await labelIssue(issueNumber, ['agent-failed'])
    return { success: false }
  }

  // Extract custom branch name from issue body metadata
  const customBranch = extractBranchName(issueBody)
  if (customBranch) {
    await logger?.event('text', `Custom branch requested: ${customBranch}`)
  }

  // Mark as in-progress
  await labelIssue(issueNumber, ['in-progress'])
  await commentOnIssue(issueNumber, 'Picked up')

  // 2. Clone & setup
  const repo = process.env.GITHUB_REPO
  const token = process.env.GITHUB_TOKEN
  try {
    cleanup(workDir)
    await logger?.event('text', `Cloning repo ${repo}...`)
    execFileSync(
      'git',
      ['clone', '--depth=1', `https://x-access-token:${token}@github.com/${repo}.git`, workDir],
      { cwd: '/tmp', timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )
    await logger?.event('text', 'Clone complete')

    // Replace CLAUDE.md with headless builder instructions (prevents brainstorming skill blocking)
    const claudeMdPath = join(workDir, 'CLAUDE.md')
    writeFileSync(claudeMdPath, `# Builder Agent Instructions

## CRITICAL: You are running in HEADLESS mode. There is NO human to interact with.

- NEVER use the brainstorming skill — skip it entirely
- NEVER call AskUserQuestion — there is no one to answer
- NEVER present designs or options for approval — just implement
- NEVER use EnterPlanMode — go straight to writing code
- DO use implementation skills (frontend-design, TDD, writing-plans) if they help
- DO be creative and bold with the implementation — the spec is your guide
- Start writing code IMMEDIATELY after reading the codebase
- Your output is judged by what you SHIP, not what you plan
`)
    await logger?.event('text', 'Wrote builder CLAUDE.md (headless mode)')

    await logger?.event('text', `Installing dependencies (${config.installCommand})...`)
    run(config.installCommand, workDir)
    await logger?.event('text', 'Dependencies installed')

    // Write .env.local for build (forward env vars matching configured patterns)
    const envKeys = Object.keys(process.env).filter(
      (k) => matchesEnvPattern(k, config.envForwardPatterns)
    )
    if (envKeys.length > 0) {
      const envContent = envKeys.map((k) => `${k}=${process.env[k]}`).join('\n')
      writeFileSync(`${workDir}/.env.local`, envContent + '\n')
      await logger?.event('text', `Wrote .env.local (${envKeys.length} vars)`)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await logger?.event('error', `Clone/install failed: ${msg.slice(0, 300)}`)
    await fail(issueNumber, `Clone or ${config.installCommand} failed`, msg, workDir)
    return { success: false }
  }

  // 2b. Pre-lint: catch pre-existing errors before Claude touches anything
  let preLintErrors = ''
  try {
    await logger?.event('text', 'Running pre-lint check...')
    run(config.lintCommand, workDir)
    await logger?.event('text', 'Pre-lint: clean')
    console.log(`[job-${issueNumber}] Pre-lint clean`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    preLintErrors = msg
    await logger?.event('text', 'Pre-lint: existing errors found, will include in prompt')
    console.log(`[job-${issueNumber}] Pre-existing lint errors found, will include in prompt`)
  }

  // 3. Retry detection — check for modification requests in recent comments
  let retryFeedback = ''
  try {
    const comments = await getIssueComments(issueNumber, 5)
    const modComment = comments.find((c) =>
      c.body.startsWith('**Modifications demandées :**')
    )
    if (modComment) {
      retryFeedback = modComment.body
      await logger?.event('text', 'Retry detected — appending modification feedback')
      console.log(`[job-${issueNumber}] Retry detected — appending modification feedback`)
    }
  } catch (err) {
    console.log(`[job-${issueNumber}] Could not fetch comments for retry detection:`, err)
  }

  // 4. Run Claude Code CLI
  let prompt =
    parsed.promptType === 'ralph_loop' && parsed.specContent
      ? `${parsed.generatedPrompt}\n\nSpec:\n${parsed.specContent}`
      : parsed.generatedPrompt

  if (retryFeedback) {
    prompt += `\n\nIMPORTANT — This is a RETRY. The user reviewed the previous implementation and requested changes:\n\n${retryFeedback}\n\nAddress this feedback in your implementation.`
  }

  if (preLintErrors) {
    prompt += `\n\nIMPORTANT: Before implementing the above request, fix these pre-existing lint errors in the codebase:\n\n${preLintErrors}`
  }

  try {
    const initialTimeout = Math.min(config.claudeTimeoutMs, config.jobBudgetMs - (Date.now() - jobStart))
    await logger?.event('text', `Preparing Claude CLI prompt (${prompt.length} chars)`)
    console.log(`[job-${issueNumber}] Running Claude Code CLI with prompt: ${prompt.slice(0, 200)}...`)
    await runClaude({ prompt, workDir, timeoutMs: initialTimeout, logger, logPrefix: `job-${issueNumber}` })
    await logger?.event('text', 'Claude CLI finished')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const isTimeout = msg.includes('TIMEOUT') || msg.includes('timed out')
    await logger?.event('error', isTimeout ? 'Claude CLI timed out' : `Claude CLI failed: ${msg.slice(0, 300)}`)
    await fail(
      issueNumber,
      isTimeout ? `Claude Code CLI timed out (${Math.round(config.claudeTimeoutMs / 60_000)} min limit)` : 'Claude Code CLI failed',
      msg,
      workDir
    )
    return { success: false }
  }

  // Log changed files
  const changedFiles = getChangedFiles(workDir)
  await logger?.event('text', `Changed files: ${changedFiles.length} (${changedFiles.slice(0, 5).join(', ')}${changedFiles.length > 5 ? '...' : ''})`)

  // 5. Validate with escalating fix retry loop
  await logger?.event('text', `Running build validation (${config.buildCommand})...`)
  let result = validate(workDir, issueNumber, config.buildCommand)

  if (result.success) {
    await logger?.event('text', 'Build passed')
    await logger?.event('text', 'Lint passed')
  }

  for (let attempt = 1; attempt <= MAX_FIX_ATTEMPTS && !result.success; attempt++) {
    const elapsed = Date.now() - jobStart
    const remaining = config.jobBudgetMs - elapsed

    if (remaining < MIN_RETRY_BUDGET_MS) {
      await logger?.event('text', `Budget exhausted (${Math.round(elapsed / 1000)}s), cannot retry`)
      console.log(`[job-${issueNumber}] Budget exhausted (${Math.round(elapsed / 1000)}s elapsed), cannot retry`)
      break
    }

    await logger?.event('text', `${result.stage} failed — fix attempt ${attempt}/${MAX_FIX_ATTEMPTS}`)

    // Level 1: Try eslint --fix for lint errors (free, instant)
    if (result.stage === 'lint' && result.changedFiles.length > 0) {
      await commentOnIssue(issueNumber, `Auto-fix ${attempt}/${MAX_FIX_ATTEMPTS}`)
      await logger?.event('text', 'Attempting eslint --fix...')
      console.log(`[job-${issueNumber}] Attempting eslint --fix (attempt ${attempt})...`)
      try {
        run(`npx eslint --fix ${result.changedFiles.join(' ')}`, workDir)
      } catch {
        // eslint --fix may exit non-zero even when it fixes some issues
      }
      result = validate(workDir, issueNumber, config.buildCommand)
      if (result.success) {
        await logger?.event('text', 'Auto-fix resolved the issue')
        break
      }
    }

    // Level 2: Ask Claude to fix the errors
    const fixPrompt = `The ${result.stage} step failed with the following errors. Fix them without changing any unrelated code:\n\n${result.errorOutput}`
    await commentOnIssue(issueNumber, `Retry ${attempt}/${MAX_FIX_ATTEMPTS} (${result.stage})`)
    await logger?.event('text', `Asking Claude to fix ${result.stage} errors...`)

    try {
      const claudeTimeout = Math.min(remaining - 60_000, config.claudeTimeoutMs)
      await runClaude({ prompt: fixPrompt, workDir, timeoutMs: claudeTimeout, logger, logPrefix: `job-${issueNumber}` })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.log(`[job-${issueNumber}] Claude fix attempt ${attempt} failed: ${msg.slice(0, 200)}`)
    }

    result = validate(workDir, issueNumber, config.buildCommand)
    if (result.success) {
      await logger?.event('text', `Fix attempt ${attempt} succeeded`)
    }
  }

  if (!result.success) {
    await logger?.event('error', `${result.stage} still failing after ${MAX_FIX_ATTEMPTS} fix attempts`)
    await fail(
      issueNumber,
      `${result.stage === 'build' ? 'Build' : 'Lint'} still failing after ${MAX_FIX_ATTEMPTS} fix attempts`,
      result.errorOutput,
      workDir
    )
    return { success: false }
  }

  // 5. Branch + PR
  const branch = customBranch || `feedback/issue-${issueNumber}`
  validateRef(branch)
  try {
    await logger?.event('text', `Creating branch: ${branch}`)
    execFileSync('git', ['checkout', '-b', branch], {
      cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    })
    run('git add -A', workDir)
    execFileSync(
      'git',
      ['commit', '-m', `feat: ${issueTitle} (auto-implemented from #${issueNumber})`],
      { cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    )
    await logger?.event('text', `Pushing to origin/${branch}...`)
    execFileSync('git', ['push', '-f', 'origin', branch], {
      cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    })
    await logger?.event('text', 'Push complete')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await logger?.event('error', `Git branch/push failed: ${msg.slice(0, 300)}`)
    await fail(issueNumber, 'Git branch/push failed', msg, workDir)
    return { success: false }
  }

  // 6. Create PR if none exists
  let prNumber: number | undefined
  try {
    const existing = await findOpenPR(issueNumber, undefined, branch)
    if (!existing) {
      await logger?.event('text', 'Creating pull request...')
      const pr = await createPR(
        issueNumber,
        `feat: ${issueTitle} (auto-implemented from #${issueNumber})`,
        `Closes #${issueNumber}\n\nAuto-implemented by the feedback agent.`,
        undefined,
        branch,
      )
      prNumber = pr.number
      await logger?.event('text', `PR created: #${pr.number}`)
      console.log(`[job-${issueNumber}] Created PR #${pr.number}: ${pr.html_url}`)
    } else {
      prNumber = existing.number
      await logger?.event('text', `PR already exists: #${existing.number}`)
      console.log(`[job-${issueNumber}] PR already exists: #${existing.number}`)
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    await logger?.event('error', `PR creation failed: ${msg.slice(0, 300)}`)
    await fail(issueNumber, 'PR creation failed', msg, workDir)
    return { success: false }
  }

  // 7. Update labels and comment
  await removeLabelFromIssue(issueNumber, 'in-progress')
  await removeLabelFromIssue(issueNumber, 'auto-implement')
  await labelIssue(issueNumber, ['preview-pending'])
  await commentOnIssue(
    issueNumber,
    'Preview deploying — Vercel will build the PR branch. Check the tracker for status.'
  )
  cleanup(workDir)
  await logger?.event('text', 'Done — PR created, awaiting Vercel preview')
  console.log(`[job-${issueNumber}] Done — PR created, awaiting preview`)
  return { success: true, prNumber }
}

// --- Managed worker mode ---

export interface ManagedJobInput extends JobInput {
  projectId: string
  github: GitHubConfig
  claudeCredentials?: string
  anthropicApiKey?: string
  runId: string
  supabase: AnySupabaseClient
}

export async function runManagedJob(input: ManagedJobInput): Promise<void> {
  const logger = new DbLogger(input.supabase, input.runId)

  // Set per-job env vars so existing code paths work
  process.env.GITHUB_TOKEN = input.github.token
  process.env.GITHUB_REPO = input.github.repo

  if (input.claudeCredentials) {
    process.env.CLAUDE_CREDENTIALS_JSON = input.claudeCredentials
    await initCredentials()
  } else if (input.anthropicApiKey) {
    process.env.ANTHROPIC_API_KEY = input.anthropicApiKey
    delete process.env.CLAUDE_CREDENTIALS_JSON
  }

  // Update pipeline run stage
  await input.supabase
    .from('pipeline_runs')
    .update({ stage: 'running' })
    .eq('id', input.runId)

  await logger.log(`Starting job for issue #${input.issueNumber}`)

  try {
    const result = await runJob(input, logger)

    if (!result.success) {
      await input.supabase
        .from('pipeline_runs')
        .update({ stage: 'running', completed_at: new Date().toISOString(), result: 'failed' })
        .eq('id', input.runId)

      await logger.error('Job failed (agent reported failure on GitHub)')
      throw new Error('runJob returned failure')
    }

    await input.supabase
      .from('pipeline_runs')
      .update({
        stage: 'deployed',
        completed_at: new Date().toISOString(),
        result: 'success',
        ...(result.prNumber ? { github_pr_number: result.prNumber } : {}),
      })
      .eq('id', input.runId)

    await logger.log('Job completed successfully')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    await input.supabase
      .from('pipeline_runs')
      .update({ completed_at: new Date().toISOString(), result: 'failed' })
      .eq('id', input.runId)

    await logger.error(`Job failed: ${msg}`)
    throw err
  }
}

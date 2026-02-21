import { execSync, execFileSync, spawn } from 'node:child_process'
import { existsSync, rmSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { Octokit } from '@octokit/rest'
import { ensureValidToken } from './oauth.js'
import { DbLogger } from './logger.js'
import { validateRef, redactToken } from './sanitize.js'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = SupabaseClient<any, any, any>

const STEP_TIMEOUT_MS = 5 * 60 * 1000
const CLAUDE_TIMEOUT_MS = 15 * 60 * 1000
const MAX_REMEDIATION_ATTEMPTS = 2

export interface BuilderInput {
  jobId: string
  projectId: string
  proposalId: string
  branchName: string
  spec: string
  title: string
  supabase: Supabase
}

interface ValidationResult {
  success: boolean
  stage: 'lint' | 'typecheck' | 'build' | 'test'
  errorOutput: string
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
    const details = `Exit ${e.status}\nSTDERR: ${(e.stderr || '').slice(-2000)}\nSTDOUT: ${(e.stdout || '').slice(-2000)}`
    throw new Error(`Command failed: ${redactToken(cmd)}\n${redactToken(details)}`)
  }
}

/** Build a restricted env for Claude CLI: only HOME, PATH, and auth token. */
async function claudeEnv(): Promise<NodeJS.ProcessEnv> {
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

function summarizeToolInput(tool: string, input: Record<string, unknown>): string {
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

async function runClaude(
  prompt: string,
  workDir: string,
  timeoutMs: number,
  logger: DbLogger,
): Promise<void> {
  const env = await claudeEnv()
  const authMethod = env.CLAUDE_CODE_OAUTH_TOKEN ? 'oauth' : env.ANTHROPIC_API_KEY ? 'api-key' : 'none'
  const args = ['--dangerously-skip-permissions', '--verbose', '--output-format', 'stream-json', '--include-partial-messages', '-p', prompt]
  await logger.event('text', `Starting Claude CLI (auth=${authMethod}, cwd=${workDir}, prompt=${prompt.length} chars)`)
  await logger.event('text', `[cmd] claude ${args.slice(0, -2).join(' ')} -p <prompt>`)

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
      if (text) logger.event('text', `[claude:stderr] ${text.slice(0, 300)}`)
    })

    const rl = createInterface({ input: proc.stdout })
    rl.on('line', (line) => {
      try {
        const evt = JSON.parse(line)
        if (evt.type === 'assistant' && evt.message?.content) {
          for (const block of evt.message.content) {
            if (block.type === 'tool_use') {
              const summary = summarizeToolInput(block.name, block.input ?? {})
              logger.event('tool_use', summary, { tool: block.name, input: block.input })
            } else if (block.type === 'text' && block.text?.trim()) {
              const preview = block.text.trim().slice(0, 200)
              logger.event('text', `[claude] ${preview}`)
            }
          }
        } else if (evt.type) {
          logger.event('text', `[claude:event] ${evt.type}`)
        }
      } catch {
        if (line.trim()) logger.event('text', `[claude:raw] ${line.trim().slice(0, 200)}`)
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

/** Tiered validation: lint -> typecheck -> build -> test (fail fast). */
function validate(workDir: string, logger: DbLogger): ValidationResult {
  const steps: Array<{ stage: ValidationResult['stage']; cmd: string }> = [
    { stage: 'lint', cmd: 'npm run lint --if-present' },
    { stage: 'typecheck', cmd: 'npx tsc --noEmit --pretty' },
    { stage: 'build', cmd: 'npm run build' },
    { stage: 'test', cmd: 'npm test --if-present' },
  ]

  for (const step of steps) {
    try {
      logger.event('text', `Validating: ${step.stage}...`)
      run(step.cmd, workDir)
      logger.event('text', `${step.stage} passed`)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { success: false, stage: step.stage, errorOutput: msg }
    }
  }

  return { success: true, stage: 'test', errorOutput: '' }
}

function getHeadSha(workDir: string): string {
  return run('git rev-parse HEAD', workDir).trim()
}

export async function runBuilderJob(input: BuilderInput): Promise<{
  prNumber: number | null
  prUrl: string | null
  headSha: string | null
}> {
  const { jobId, projectId, proposalId, branchName, spec, title, supabase } = input
  const workDir = `/tmp/builder-${jobId.slice(0, 8)}`
  const logger = new DbLogger(supabase, jobId)

  // Fetch GitHub config for this project
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo, github_installation_id')
    .eq('id', projectId)
    .single()

  if (!project?.github_repo) {
    throw new Error(`Project ${projectId} has no github_repo`)
  }

  // Get a token — prefer GitHub App installation token, fallback to PAT
  let token: string
  if (project.github_installation_id) {
    const { getInstallationToken, isGitHubAppConfigured } = await import('./github-app.js')
    if (isGitHubAppConfigured()) {
      token = await getInstallationToken(project.github_installation_id)
    } else {
      token = process.env.GITHUB_TOKEN ?? ''
    }
  } else {
    token = process.env.GITHUB_TOKEN ?? ''
  }

  if (!token) throw new Error('No GitHub token available for builder job')

  validateRef(branchName)

  const [owner, repo] = project.github_repo.split('/')
  const octokit = new Octokit({ auth: token })

  try {
    // 1. Clone with sandbox safety
    await logger.event('text', `Cloning ${project.github_repo}...`)
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })

    execFileSync(
      'git',
      ['clone', '--depth=1', '-c', 'core.hooksPath=/dev/null',
       `https://x-access-token:${token}@github.com/${project.github_repo}.git`, workDir],
      { cwd: '/tmp', timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )

    // Strip CLAUDE.md to prevent prompt injection from consumer repos
    const claudeMdPath = join(workDir, 'CLAUDE.md')
    if (existsSync(claudeMdPath)) {
      unlinkSync(claudeMdPath)
      await logger.event('text', 'Stripped CLAUDE.md for sandbox safety')
    }

    await logger.event('text', 'Installing dependencies...')
    run('npm ci', workDir)
    await logger.event('text', 'Dependencies installed')

    // 2. Create branch
    execFileSync('git', ['checkout', '-b', branchName], {
      cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    })
    await logger.event('text', `Created branch: ${branchName}`)

    // 3. Run Claude CLI with the spec
    const prompt = `You are implementing a product improvement for a software project.

## Task
${title}

## Specification
${spec}

## Rules
- Implement EXACTLY what the spec says — no more, no less
- Do NOT refactor unrelated code
- Do NOT add features beyond the spec
- Make the minimal changes needed
- Ensure all new code has proper types
- Run the build to verify your changes compile before finishing`

    await logger.event('text', `Running Claude CLI (spec: ${spec.length} chars)...`)
    await runClaude(prompt, workDir, CLAUDE_TIMEOUT_MS, logger)
    await logger.event('text', 'Claude CLI finished')

    // 4. Validate with remediation loop
    let validationResult = validate(workDir, logger)

    for (let attempt = 1; attempt <= MAX_REMEDIATION_ATTEMPTS && !validationResult.success; attempt++) {
      await logger.event('text', `${validationResult.stage} failed — remediation attempt ${attempt}/${MAX_REMEDIATION_ATTEMPTS}`)

      const fixPrompt = `The ${validationResult.stage} step failed. Fix the errors without changing unrelated code.

## Errors
${validationResult.errorOutput.slice(-4000)}`

      await runClaude(fixPrompt, workDir, CLAUDE_TIMEOUT_MS / 2, logger)
      validationResult = validate(workDir, logger)

      if (validationResult.success) {
        await logger.event('text', `Remediation attempt ${attempt} succeeded`)
      }
    }

    if (!validationResult.success) {
      await logger.event('error', `Validation still failing after ${MAX_REMEDIATION_ATTEMPTS} remediation attempts: ${validationResult.stage}`)

      // Emit build_failed event
      await supabase.from('branch_events').insert({
        project_id: projectId,
        branch_name: branchName,
        event_type: 'build_failed',
        event_data: {
          proposal_id: proposalId,
          stage: validationResult.stage,
          error: validationResult.errorOutput.slice(-2000),
        },
      })

      throw new Error(`Validation failed at ${validationResult.stage} after ${MAX_REMEDIATION_ATTEMPTS} remediation attempts`)
    }

    // 5. Commit and push
    await logger.event('text', 'Committing changes...')
    run('git add -A', workDir)

    // Check if there are actual changes
    const diff = run('git diff --cached --stat', workDir).trim()
    if (!diff) {
      await logger.event('text', 'No changes to commit — Claude made no modifications')

      await supabase.from('branch_events').insert({
        project_id: projectId,
        branch_name: branchName,
        event_type: 'build_failed',
        event_data: { proposal_id: proposalId, error: 'No changes generated' },
      })

      return { prNumber: null, prUrl: null, headSha: null }
    }

    execFileSync(
      'git',
      ['commit', '-m', `feat: ${title}\n\nImplemented from proposal ${proposalId.slice(0, 8)}.`],
      { cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )

    const headSha = getHeadSha(workDir)
    await logger.event('text', `Pushing to origin/${branchName} (SHA: ${headSha.slice(0, 7)})...`)
    execFileSync('git', ['push', '-u', 'origin', branchName], {
      cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    })
    await logger.event('text', 'Push complete')

    // 6. Create PR via Octokit
    await logger.event('text', 'Creating pull request...')

    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: `feat: ${title}`,
      body: `## Summary\n\nImplemented from proposal \`${proposalId.slice(0, 8)}\`.\n\n### Specification\n${spec.slice(0, 2000)}\n\n---\n*Auto-implemented by the builder agent.*`,
      head: branchName,
      base: 'main',
    })

    await logger.event('text', `PR created: #${pr.number} — ${pr.html_url}`)

    // 7. Emit build_completed event with SHA
    await supabase.from('branch_events').insert({
      project_id: projectId,
      branch_name: branchName,
      event_type: 'build_completed',
      event_data: {
        proposal_id: proposalId,
        pr_number: pr.number,
        pr_url: pr.html_url,
        head_sha: headSha,
      },
    })

    // Update proposal status
    await supabase
      .from('proposals')
      .update({ status: 'implementing', branch_name: branchName })
      .eq('id', proposalId)

    return { prNumber: pr.number, prUrl: pr.html_url, headSha }
  } finally {
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })
  }
}

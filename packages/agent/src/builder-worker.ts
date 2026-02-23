import { execSync, execFileSync } from 'node:child_process'
import { existsSync, rmSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { Octokit } from '@octokit/rest'
import { runClaude } from './claude-cli.js'
import { DbLogger } from './logger.js'
import { validateRef, redactToken } from './sanitize.js'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = SupabaseClient<any, any, any>

const STEP_TIMEOUT_MS = 10 * 60 * 1000
const CLAUDE_TIMEOUT_MS = 45 * 60 * 1000
const MAX_REMEDIATION_ATTEMPTS = 2

export interface BuilderInput {
  jobId: string
  projectId: string
  proposalId: string
  branchName: string
  spec: string
  title: string
  pipelineRunId?: string
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

// claudeEnv, summarizeToolInput, runClaude → shared in claude-cli.ts

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
  const { jobId, projectId, proposalId, branchName, spec, title, pipelineRunId, supabase } = input
  const workDir = `/tmp/builder-${jobId.slice(0, 8)}`
  const logger = new DbLogger(supabase, pipelineRunId ?? jobId)

  // Fetch GitHub config for this project
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo, github_installation_id, default_branch')
    .eq('id', projectId)
    .single()

  if (!project?.github_repo) {
    throw new Error(`Project ${projectId} has no github_repo`)
  }

  const defaultBranch: string = (project as Record<string, unknown>).default_branch as string || 'main'

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

    // Replace CLAUDE.md with builder instructions (prevents prompt injection + guides skills)
    const claudeMdPath = join(workDir, 'CLAUDE.md')
    const hasSandboxDb = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
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
${hasSandboxDb ? `
## Database Access

You have access to a Supabase Postgres database via environment variables:
- \`SUPABASE_SANDBOX_URL\` — the Supabase project URL
- \`SUPABASE_SANDBOX_SERVICE_ROLE_KEY\` — service role key (full DDL access to the sandbox schema)
- \`SUPABASE_SANDBOX_ANON_KEY\` — anon key (for client-side use in the app)

**Schema: \`minions_sandbox\`** — you MUST use this schema for ALL database operations.

### Rules
- Create ALL tables in the \`minions_sandbox\` schema: \`CREATE TABLE minions_sandbox.my_table (...)\`
- Enable RLS on every table: \`ALTER TABLE minions_sandbox.my_table ENABLE ROW LEVEL SECURITY\`
- Create permissive RLS policies so the app can read/write data
- Use \`@supabase/supabase-js\` in the app code with \`{ db: { schema: 'minions_sandbox' } }\`
- For server-side (API routes): use the service role key
- For client-side: use the anon key via \`NEXT_PUBLIC_SUPABASE_URL\` and \`NEXT_PUBLIC_SUPABASE_ANON_KEY\`
- NEVER touch any schema other than \`minions_sandbox\`
- To run migrations, use the Bash tool: \`npx supabase db push\` or raw SQL via the Supabase REST API
` : ''}
`)
    await logger.event('text', 'Wrote builder CLAUDE.md (headless mode instructions)')

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
- NEVER create or modify files in .github/workflows/ — you don't have permission to push those
- NEVER modify .env files or add secrets
- Run the build to verify your changes compile before finishing`

    // Build sandbox database env vars for the CLI
    const sandboxEnv: Record<string, string> = {}
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      sandboxEnv.SUPABASE_SANDBOX_URL = process.env.SUPABASE_URL
      sandboxEnv.SUPABASE_SANDBOX_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
      sandboxEnv.SUPABASE_SANDBOX_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? ''
    }

    await logger.event('text', `Running Claude CLI (spec: ${spec.length} chars)...`)
    await runClaude({ prompt, workDir, timeoutMs: CLAUDE_TIMEOUT_MS, logger, logPrefix: `builder-${proposalId.slice(0, 8)}`, restrictedEnv: true, extraEnv: sandboxEnv })
    await logger.event('text', 'Claude CLI finished')

    // 4. Validate with remediation loop
    let validationResult = validate(workDir, logger)

    for (let attempt = 1; attempt <= MAX_REMEDIATION_ATTEMPTS && !validationResult.success; attempt++) {
      await logger.event('text', `${validationResult.stage} failed — remediation attempt ${attempt}/${MAX_REMEDIATION_ATTEMPTS}`)

      await supabase.from('branch_events').insert({
        project_id: projectId,
        branch_name: branchName,
        event_type: 'build_remediation',
        event_data: {
          proposal_id: proposalId,
          attempt,
          stage: validationResult.stage,
          error: validationResult.errorOutput.slice(-1000),
        },
        actor: 'builder',
      })

      const fixPrompt = `The ${validationResult.stage} step failed. Fix the errors without changing unrelated code.

## Errors
${validationResult.errorOutput.slice(-4000)}`

      await runClaude({ prompt: fixPrompt, workDir, timeoutMs: CLAUDE_TIMEOUT_MS / 2, logger, logPrefix: `builder-${proposalId.slice(0, 8)}`, restrictedEnv: true, extraEnv: sandboxEnv })
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

    // Refresh token before push — installation tokens expire after 1 hour
    let pushToken = token
    if (project.github_installation_id) {
      const { getInstallationToken, isGitHubAppConfigured } = await import('./github-app.js')
      if (isGitHubAppConfigured()) {
        pushToken = await getInstallationToken(project.github_installation_id)
      }
    }
    execFileSync('git', ['remote', 'set-url', 'origin',
      `https://x-access-token:${pushToken}@github.com/${project.github_repo}.git`],
      { cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })

    await logger.event('text', `Pushing to origin/${branchName} (SHA: ${headSha.slice(0, 7)})...`)
    execFileSync('git', ['push', '-u', 'origin', branchName], {
      cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    })
    await logger.event('text', 'Push complete')

    // 6. Create PR via Octokit (use fresh token)
    const pushOctokit = new Octokit({ auth: pushToken })
    await logger.event('text', 'Creating pull request...')

    const { data: pr } = await pushOctokit.pulls.create({
      owner,
      repo,
      title: `feat: ${title}`,
      body: `## Summary\n\nImplemented from proposal \`${proposalId.slice(0, 8)}\`.\n\n### Specification\n${spec.slice(0, 2000)}\n\n---\n*Auto-implemented by the builder agent.*`,
      head: branchName,
      base: defaultBranch,
    })

    await logger.event('text', `PR created: #${pr.number} — ${pr.html_url}`)

    await supabase.from('branch_events').insert({
      project_id: projectId,
      branch_name: branchName,
      event_type: 'pr_created',
      event_data: {
        proposal_id: proposalId,
        pr_number: pr.number,
        pr_url: pr.html_url,
        head_sha: headSha,
      },
      actor: 'builder',
    })

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

export interface FixBuildInput {
  jobId: string
  projectId: string
  proposalId: string
  prNumber: number
  branchName: string
  reviewSummary: string
  reviewConcerns: Array<{ file: string; line?: number; severity: string; comment: string }>
  pipelineRunId?: string
  supabase: Supabase
}

export async function runFixBuildJob(input: FixBuildInput): Promise<{
  headSha: string | null
}> {
  const { jobId, projectId, proposalId, prNumber, branchName, reviewSummary, reviewConcerns, pipelineRunId, supabase } = input
  const workDir = `/tmp/fixbuild-${jobId.slice(0, 8)}`
  const logger = new DbLogger(supabase, pipelineRunId ?? jobId)

  // Fetch GitHub config (reuse same pattern as runBuilderJob)
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo, github_installation_id, default_branch')
    .eq('id', projectId)
    .single()

  if (!project?.github_repo) throw new Error(`Project ${projectId} has no github_repo`)

  const defaultBranch: string = (project as Record<string, unknown>).default_branch as string || 'main'

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
  if (!token) throw new Error('No GitHub token available for fix-build job')

  validateRef(branchName)

  try {
    // 1. Clone the PR branch directly
    await logger.event('text', `Cloning ${project.github_repo} (branch: ${branchName}) for fix-build...`)
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })

    execFileSync('git', [
      'clone', '--depth=50', '-b', branchName,
      '-c', 'core.hooksPath=/dev/null',
      `https://x-access-token:${token}@github.com/${project.github_repo}.git`, workDir,
    ], { cwd: '/tmp', timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })

    // Fetch default branch and attempt merge — so fixes are applied on top of latest
    const isConflictFix = reviewSummary.toLowerCase().includes('merge conflict')
    try {
      execFileSync('git', ['fetch', 'origin', defaultBranch, '--depth=50'], {
        cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      })
      // Set git identity for merge commit
      execFileSync('git', ['config', 'user.email', 'minions@bot.dev'], {
        cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      })
      execFileSync('git', ['config', 'user.name', 'Minions Bot'], {
        cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
      })
      try {
        execFileSync('git', ['merge', `origin/${defaultBranch}`, '--no-edit'], {
          cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
        })
        await logger.event('text', `Merged ${defaultBranch} into PR branch successfully`)
      } catch {
        // Merge conflicts — abort and let CLI resolve them
        execFileSync('git', ['merge', '--abort'], {
          cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
        })
        await logger.event('text', 'Merge conflicts detected — CLI will resolve them')
      }
    } catch {
      await logger.event('text', `Could not fetch ${defaultBranch} — proceeding without merge`)
    }

    // Write headless CLAUDE.md
    const claudeMdPath = join(workDir, 'CLAUDE.md')
    writeFileSync(claudeMdPath, `# Fix-Build Agent Instructions

## CRITICAL: HEADLESS mode. NO human interaction.

- NEVER use brainstorming skill
- NEVER call AskUserQuestion
- NEVER use EnterPlanMode
- Fix ONLY the issues identified in the review feedback
- Do NOT refactor unrelated code
- Do NOT add new features
- Make minimal, targeted fixes
`)

    await logger.event('text', 'Installing dependencies...')
    run('npm ci', workDir)

    // 2. Run Claude CLI with fix prompt
    const concernsList = reviewConcerns
      .map(c => `- [${c.severity}] ${c.file}${c.line ? `:${c.line}` : ''}: ${c.comment}`)
      .join('\n')

    const prompt = isConflictFix
      ? `You are resolving merge conflicts on PR #${prNumber}.

The PR branch has diverged from ${defaultBranch}. You need to:
1. Run \`git fetch origin ${defaultBranch}\` and \`git merge origin/${defaultBranch}\` to bring in the latest changes
2. If there are merge conflicts, resolve them — keep BOTH the PR's new features AND ${defaultBranch}'s changes
3. Make sure the merged code compiles, builds, and tests pass
4. Commit the merge resolution

## Rules
- Preserve ALL functionality from both branches
- Do NOT delete features from either branch
- Ensure imports, routes, and component references are correct after merge
- Run the build to verify everything works`
      : `You are fixing code review issues on PR #${prNumber}.

## Review Summary
${reviewSummary}

## Specific Concerns to Fix
${concernsList || 'No specific concerns listed — address the summary above.'}

## Rules
- Fix ONLY the issues mentioned above
- Do NOT refactor unrelated code
- Do NOT add features beyond what's needed to fix the concerns
- Make minimal, targeted changes
- Ensure the code compiles and tests pass after your changes`

    await logger.event('text', `Running Claude CLI for fix-build (${reviewConcerns.length} concerns)...`)
    await runClaude({
      prompt,
      workDir,
      timeoutMs: CLAUDE_TIMEOUT_MS / 2,
      logger,
      logPrefix: `fixbuild-${proposalId.slice(0, 8)}`,
      restrictedEnv: true,
    })

    // 3. Validate
    const validationResult = validate(workDir, logger)
    if (!validationResult.success) {
      await logger.event('error', `Fix-build validation failed at ${validationResult.stage}`)
      return { headSha: null }
    }

    // 4. Commit and push
    run('git add -A', workDir)
    const diff = run('git diff --cached --stat', workDir).trim()
    if (!diff) {
      await logger.event('text', 'Fix-build: no changes made')
      return { headSha: null }
    }

    execFileSync('git', ['commit', '-m', `fix: address review feedback on PR #${prNumber}`], {
      cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    })

    const headSha = getHeadSha(workDir)

    // Refresh token before push — installation tokens expire after 1 hour
    if (project.github_installation_id) {
      const { getInstallationToken: refreshToken, isGitHubAppConfigured: isAppConfigured } = await import('./github-app.js')
      if (isAppConfigured()) {
        const freshToken = await refreshToken(project.github_installation_id)
        execFileSync('git', ['remote', 'set-url', 'origin',
          `https://x-access-token:${freshToken}@github.com/${project.github_repo}.git`],
          { cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })
      }
    }

    await logger.event('text', `Pushing fix to ${branchName} (SHA: ${headSha.slice(0, 7)})...`)
    execFileSync('git', ['push', 'origin', branchName], {
      cwd: workDir, timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    })

    await logger.event('text', `Fix-build complete — pushed to PR #${prNumber}`)
    await supabase.from('branch_events').insert({
      project_id: projectId,
      branch_name: branchName,
      event_type: 'build_completed',
      event_data: { proposal_id: proposalId, pr_number: prNumber, head_sha: headSha, is_fix: true },
      actor: 'builder',
    })

    return { headSha }
  } finally {
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })
  }
}

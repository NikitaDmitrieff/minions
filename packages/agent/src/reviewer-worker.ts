import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Octokit } from '@octokit/rest'
import { minimatch } from 'minimatch'
import { runClaude } from './claude-cli.js'
import { DbLogger } from './logger.js'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = SupabaseClient<any, any, any>

const STEP_TIMEOUT_MS = 10 * 60 * 1000
const CLAUDE_TIMEOUT_MS = 15 * 60 * 1000

export interface ReviewerInput {
  jobId: string
  projectId: string
  proposalId: string
  prNumber: number
  headSha: string
  branchName: string
  pipelineRunId?: string
  supabase: Supabase
}

/** Risk tiers for file paths — higher tier = more scrutiny. */
const RISK_TIERS: Array<{ tier: 'critical' | 'high' | 'medium' | 'low'; patterns: string[] }> = [
  {
    tier: 'critical',
    patterns: [
      '**/.env*', '**/secrets*', '**/*credentials*', '**/*secret*',
      '**/Dockerfile*', '**/docker-compose*',
      '**/.github/workflows/**',
    ],
  },
  {
    tier: 'high',
    patterns: [
      '**/migrations/**', '**/schema*', '**/middleware*',
      '**/auth/**', '**/api/**', '**/server/**',
      '**/package.json', '**/package-lock.json',
    ],
  },
  {
    tier: 'medium',
    patterns: [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
    ],
  },
  {
    tier: 'low',
    patterns: [
      '**/*.md', '**/*.css', '**/*.json', '**/*.yaml', '**/*.yml',
    ],
  },
]

function getFileRiskTier(filePath: string): 'critical' | 'high' | 'medium' | 'low' {
  for (const { tier, patterns } of RISK_TIERS) {
    for (const pattern of patterns) {
      if (minimatch(filePath, pattern)) return tier
    }
  }
  return 'low'
}

export async function runReviewerJob(input: ReviewerInput): Promise<{
  approved: boolean
  reviewId: number | null
  summary: string
  concerns: Array<{ file: string; line?: number; severity: string; comment: string }>
}> {
  const { jobId, projectId, proposalId, prNumber, headSha, branchName, pipelineRunId, supabase } = input
  const logger = new DbLogger(supabase, pipelineRunId ?? jobId)
  const workDir = `/tmp/reviewer-${jobId.slice(0, 8)}`

  // Fetch project GitHub config
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo, github_installation_id')
    .eq('id', projectId)
    .single()

  if (!project?.github_repo) {
    throw new Error(`Project ${projectId} has no github_repo`)
  }

  // Get token
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

  if (!token) throw new Error('No GitHub token available for reviewer job')

  const [owner, repo] = project.github_repo.split('/')
  const octokit = new Octokit({ auth: token })

  await logger.event('text', `Reviewing PR #${prNumber} (SHA: ${headSha.slice(0, 7)})`)

  // 1. Fetch the diff via GitHub API
  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  })

  if (!files.length) {
    await logger.event('text', 'No files changed in PR — skipping review')
    return { approved: true, reviewId: null, summary: '', concerns: [] }
  }

  await logger.event('text', `PR has ${files.length} changed files`)

  // 2. File-path risk tier analysis
  const fileRisks = files.map((f) => ({
    filename: f.filename,
    status: f.status,
    additions: f.additions,
    deletions: f.deletions,
    patch: f.patch ?? '',
    tier: getFileRiskTier(f.filename),
  }))

  const riskSummary = {
    critical: fileRisks.filter((f) => f.tier === 'critical'),
    high: fileRisks.filter((f) => f.tier === 'high'),
    medium: fileRisks.filter((f) => f.tier === 'medium'),
    low: fileRisks.filter((f) => f.tier === 'low'),
  }

  await logger.event('text', `Risk tiers — critical: ${riskSummary.critical.length}, high: ${riskSummary.high.length}, medium: ${riskSummary.medium.length}, low: ${riskSummary.low.length}`)

  // 3. Fetch proposal spec for context
  const { data: proposal } = await supabase
    .from('proposals')
    .select('title, spec, rationale')
    .eq('id', proposalId)
    .single()

  // 4. Fetch revert lessons from strategy_memory
  const { data: revertLessons } = await supabase
    .from('strategy_memory')
    .select('title, outcome_notes, themes')
    .eq('project_id', projectId)
    .eq('event_type', 'rejected')
    .order('created_at', { ascending: false })
    .limit(10)

  const revertContext = (revertLessons ?? [])
    .map((l) => `- "${l.title}": ${l.outcome_notes ?? 'no notes'}`)
    .join('\n')

  // 5. Build the diff summary
  const diffSections = fileRisks
    .filter((f) => f.patch)
    .map((f) => `### ${f.filename} [${f.tier}] (+${f.additions}/-${f.deletions})\n\`\`\`diff\n${f.patch.slice(0, 3000)}\n\`\`\``)
    .join('\n\n')

  // 6. Clone the PR branch so CLI has full code context
  try {
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })

    await logger.event('text', `Cloning ${project.github_repo} (branch: ${branchName}) for review...`)
    execFileSync('git', [
      'clone', '--depth=5', '-b', branchName,
      '-c', 'core.hooksPath=/dev/null',
      `https://x-access-token:${token}@github.com/${project.github_repo}.git`, workDir,
    ], { cwd: '/tmp', timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })

    // Write headless CLAUDE.md
    writeFileSync(join(workDir, 'CLAUDE.md'), `# Reviewer Agent Instructions

## CRITICAL: HEADLESS mode. NO human interaction.

- NEVER use brainstorming skill
- NEVER call AskUserQuestion
- NEVER use EnterPlanMode
- You are reviewing a pull request
- Read the diff and the actual source files for context
- Write your review to review.json in the project root
`)

    // Write the diff to a file so the CLI can reference it
    writeFileSync(join(workDir, 'pr-diff.md'), `# PR #${prNumber} Diff\n\n${diffSections}`)

    // 7. Run Claude CLI for review
    const prompt = `You are a pragmatic code reviewer. Review PR #${prNumber} and write your verdict to review.json.

## Proposal Context
Title: ${proposal?.title ?? 'Unknown'}
Spec: ${(proposal?.spec ?? 'No spec').slice(0, 2000)}

## Risk Tier Summary
- Critical files (env, secrets, CI): ${riskSummary.critical.map((f) => f.filename).join(', ') || 'none'}
- High-risk files (migrations, auth, API, package.json): ${riskSummary.high.map((f) => f.filename).join(', ') || 'none'}
- Medium-risk files (source code): ${riskSummary.medium.length} files
- Low-risk files (docs, styles): ${riskSummary.low.length} files

## Your Process
1. Read pr-diff.md for the complete diff
2. Read any source files you need for fuller context (the full codebase is available)
3. Assess whether the changes match the spec and are safe
4. Write review.json

## Review Rules

ONLY request_changes for these reasons:
- Security vulnerabilities: secrets exposed, SQL injection, XSS, etc.
- Code that will crash at runtime: undefined references, missing imports that are used, broken logic
- Fundamentally wrong approach: e.g. testing Server Components with jsdom (won't work)

APPROVE with comments for everything else, including:
- Minor scope additions (ESLint config, version pinning, extra tooling) — these are fine
- Style preferences, naming conventions, unused imports
- Missing tests or docs
- Package.json dependency changes — these are normal and expected

Be generous. The builder is an AI agent doing its best. Approve if the code works and roughly matches the spec. Don't reject for polish issues.
${revertContext ? `\n## Past Rejected Changes (avoid similar patterns)\n${revertContext}\n` : ''}
## Output
Write a file called review.json in the project root containing:
{
  "verdict": "approve" or "request_changes",
  "summary": "2-3 sentence summary of the changes",
  "concerns": [
    {"file": "path/to/file", "line": 42, "severity": "critical|warning|info", "comment": "description"}
  ],
  "scope_creep": false,
  "security_issues": false
}

IMPORTANT: You MUST create review.json before finishing.`

    await logger.event('text', 'Running Claude CLI reviewer...')
    await runClaude({
      prompt,
      workDir,
      timeoutMs: CLAUDE_TIMEOUT_MS,
      logger,
      logPrefix: `reviewer-${proposalId.slice(0, 8)}`,
      restrictedEnv: true,
    })

    // 8. Parse review.json
    const reviewPath = join(workDir, 'review.json')
    let review: {
      verdict: 'approve' | 'request_changes'
      summary: string
      concerns: Array<{ file: string; line?: number; severity: string; comment: string }>
      scope_creep: boolean
      security_issues: boolean
    }

    if (!existsSync(reviewPath)) {
      await logger.event('text', 'CLI did not create review.json — defaulting to approve')
      review = {
        verdict: 'approve',
        summary: 'Automated review could not produce structured output — defaulting to approve.',
        concerns: [],
        scope_creep: false,
        security_issues: false,
      }
    } else {
      const reviewText = readFileSync(reviewPath, 'utf-8')
      const jsonMatch = reviewText.match(/\{[\s\S]*\}/)
      try {
        review = JSON.parse(jsonMatch?.[0] ?? '{}')
        if (!review.verdict) throw new Error('Missing verdict')
      } catch {
        await logger.event('text', 'Could not parse review.json — defaulting to approve')
        review = {
          verdict: 'approve',
          summary: 'Automated review could not parse output — defaulting to approve.',
          concerns: [],
          scope_creep: false,
          security_issues: false,
        }
      }
    }

    await logger.event('text', `Review verdict: ${review.verdict} — ${review.summary}`)

    // 9. Post review to GitHub PR via Octokit
    const reviewBody = `## Automated Review

**Verdict:** ${review.verdict === 'approve' ? 'Approved' : 'Changes Requested'}

${review.summary}

${review.concerns.length > 0 ? `### Concerns\n${review.concerns.map((c) => `- **[${c.severity}]** \`${c.file}\`${c.line ? ` L${c.line}` : ''}: ${c.comment}`).join('\n')}` : ''}
${review.scope_creep ? '\n**Scope creep detected** — changes go beyond the proposal spec.' : ''}
${review.security_issues ? '\n**Security issues detected** — review flagged potential security concerns.' : ''}

---
*SHA: ${headSha} | Auto-reviewed by the reviewer agent.*`

    // GitHub doesn't allow REQUEST_CHANGES on your own PR. Since builder and reviewer
    // use the same GitHub App token, use COMMENT for rejections and APPROVE for approvals.
    const ghEvent = review.verdict === 'approve' ? 'APPROVE' as const : 'COMMENT' as const

    let ghReview: { id: number }
    try {
      const { data } = await octokit.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        commit_id: headSha,
        body: reviewBody,
        event: ghEvent,
      })
      ghReview = data
    } catch (err: unknown) {
      if (ghEvent === 'APPROVE' && err instanceof Error && err.message.includes('own pull request')) {
        const { data } = await octokit.pulls.createReview({
          owner, repo, pull_number: prNumber, commit_id: headSha, body: reviewBody, event: 'COMMENT',
        })
        ghReview = data
      } else {
        throw err
      }
    }

    await logger.event('text', `GitHub review posted (ID: ${ghReview.id})`)

    // 10. Emit review event
    await supabase.from('branch_events').insert({
      project_id: projectId,
      branch_name: branchName,
      event_type: review.verdict === 'approve' ? 'review_approved' : 'review_rejected',
      event_data: {
        proposal_id: proposalId,
        pr_number: prNumber,
        head_sha: headSha,
        review_id: ghReview.id,
        verdict: review.verdict,
        summary: review.summary,
        concerns: review.concerns,
        scope_creep: review.scope_creep,
        security_issues: review.security_issues,
      },
    })

    return {
      approved: review.verdict === 'approve',
      reviewId: ghReview.id,
      summary: review.summary,
      concerns: review.concerns,
    }
  } finally {
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })
  }
}

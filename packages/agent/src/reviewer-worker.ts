import Anthropic from '@anthropic-ai/sdk'
import { Octokit } from '@octokit/rest'
import { minimatch } from 'minimatch'
import { DbLogger } from './logger.js'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = SupabaseClient<any, any, any>

export interface ReviewerInput {
  jobId: string
  projectId: string
  proposalId: string
  prNumber: number
  headSha: string
  branchName: string
  supabase: Supabase
}

/** Risk tiers for file paths — higher tier = more scrutiny. */
const RISK_TIERS: Array<{ tier: 'critical' | 'high' | 'medium' | 'low'; patterns: string[] }> = [
  {
    tier: 'critical',
    patterns: [
      '**/.env*', '**/secrets*', '**/*credentials*', '**/*secret*',
      '**/Dockerfile*', '**/docker-compose*',
      '**/.github/workflows/**', '**/package.json', '**/package-lock.json',
    ],
  },
  {
    tier: 'high',
    patterns: [
      '**/migrations/**', '**/schema*', '**/middleware*',
      '**/auth/**', '**/api/**', '**/server/**',
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

function getAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required for reviewer jobs')
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

export async function runReviewerJob(input: ReviewerInput): Promise<{
  approved: boolean
  reviewId: number | null
}> {
  const { jobId, projectId, proposalId, prNumber, headSha, branchName, supabase } = input
  const logger = new DbLogger(supabase, jobId)

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

  // 1. Fetch the diff via GitHub API (no clone needed)
  const { data: files } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  })

  if (!files.length) {
    await logger.event('text', 'No files changed in PR — skipping review')
    return { approved: true, reviewId: null }
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

  // Auto-reject if critical files are modified without explicit allowance
  if (riskSummary.critical.length > 0) {
    const criticalFiles = riskSummary.critical.map((f) => f.filename).join(', ')
    await logger.event('text', `Critical files modified: ${criticalFiles}`)
  }

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

  // 5. Build the diff summary for the LLM
  const diffSections = fileRisks
    .filter((f) => f.patch)
    .map((f) => `### ${f.filename} [${f.tier}] (+${f.additions}/-${f.deletions})\n\`\`\`diff\n${f.patch.slice(0, 3000)}\n\`\`\``)
    .join('\n\n')

  // 6. Call Anthropic for review
  const anthropic = getAnthropicClient()

  const reviewPrompt = `You are a code reviewer for a software project. Review this pull request diff.

## Proposal Context
Title: ${proposal?.title ?? 'Unknown'}
Spec: ${proposal?.spec?.slice(0, 2000) ?? 'No spec'}

## Risk Tier Summary
- Critical files (env, secrets, CI, package.json): ${riskSummary.critical.map((f) => f.filename).join(', ') || 'none'}
- High-risk files (migrations, auth, API): ${riskSummary.high.map((f) => f.filename).join(', ') || 'none'}
- Medium-risk files (source code): ${riskSummary.medium.length} files
- Low-risk files (docs, styles): ${riskSummary.low.length} files

## Diff
${diffSections.slice(0, 30000)}
${revertContext ? `\n## Past Rejected Changes (avoid similar patterns)\n${revertContext}\n` : ''}
## Review Instructions
1. Check that changes match the proposal spec — flag scope creep
2. Flag any security concerns (especially in critical/high-risk files)
3. Check for obvious bugs, missing error handling, or broken types
4. Verify no secrets, credentials, or API keys are exposed in the diff
5. If critical files (env, Dockerfile, CI workflows, package.json) are modified, explain WHY and whether it's justified

Respond in JSON:
\`\`\`json
{
  "verdict": "approve" | "request_changes",
  "summary": "2-3 sentence summary of the changes",
  "concerns": [
    {"file": "path/to/file", "line": 42, "severity": "critical|warning|info", "comment": "description"}
  ],
  "scope_creep": false,
  "security_issues": false
}
\`\`\`

Only output the JSON block. No other text.`

  await logger.event('text', 'Calling Anthropic for review...')

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{ role: 'user', content: reviewPrompt }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  const jsonMatch = text.match(/\{[\s\S]*\}/)

  let review: {
    verdict: 'approve' | 'request_changes'
    summary: string
    concerns: Array<{ file: string; line?: number; severity: string; comment: string }>
    scope_creep: boolean
    security_issues: boolean
  }

  try {
    review = JSON.parse(jsonMatch?.[0] ?? '{}')
    if (!review.verdict) throw new Error('Missing verdict')
  } catch {
    await logger.event('text', 'Could not parse review response — defaulting to request_changes')
    review = {
      verdict: 'request_changes',
      summary: 'Automated review could not parse LLM response — manual review needed.',
      concerns: [],
      scope_creep: false,
      security_issues: false,
    }
  }

  await logger.event('text', `Review verdict: ${review.verdict} — ${review.summary}`)

  // 7. Post review to GitHub PR via Octokit
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
    // Fallback: if APPROVE also fails (same author edge case), use COMMENT
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

  // 8. Emit review event
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

  return { approved: review.verdict === 'approve', reviewId: ghReview.id }
}

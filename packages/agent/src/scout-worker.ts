import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getInstallationToken, isGitHubAppConfigured } from './github-app.js'
import { runClaude } from './claude-cli.js'
import { DbLogger } from './logger.js'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = SupabaseClient<any, any, any>

export interface ScoutInput {
  jobId: string
  projectId: string
  supabase: Supabase
}

interface Finding {
  category: string
  severity: string
  title: string
  description: string
  file_path: string | null
  evidence: string | null
}

const CATEGORIES = [
  'bug_risk',
  'tech_debt',
  'security',
  'performance',
  'accessibility',
  'testing_gap',
  'dx',
] as const

const STEP_TIMEOUT_MS = 10 * 60 * 1000
const CLAUDE_TIMEOUT_MS = 20 * 60 * 1000

/** Generate a stable fingerprint for deduplication. */
function fingerprint(category: string, title: string, filePath: string | null): string {
  const normalized = `${category}:${title.toLowerCase().replace(/\s+/g, ' ').trim()}:${filePath || ''}`
  // Simple hash — sufficient for dedup, not cryptographic
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit int
  }
  return `scout-${Math.abs(hash).toString(36)}`
}

/** Compute health score from findings breakdown. */
function computeHealthScore(findings: { category: string; severity: string }[]): {
  score: number
  breakdown: Record<string, { count: number; worst_severity: string }>
} {
  const severityWeight: Record<string, number> = {
    critical: 20,
    high: 10,
    medium: 4,
    low: 1,
  }

  const breakdown: Record<string, { count: number; worst_severity: string }> = {}
  let totalPenalty = 0

  for (const f of findings) {
    if (!breakdown[f.category]) {
      breakdown[f.category] = { count: 0, worst_severity: 'low' }
    }
    breakdown[f.category].count++
    totalPenalty += severityWeight[f.severity] || 1

    // Track worst severity
    const severityOrder = ['critical', 'high', 'medium', 'low']
    if (severityOrder.indexOf(f.severity) < severityOrder.indexOf(breakdown[f.category].worst_severity)) {
      breakdown[f.category].worst_severity = f.severity
    }
  }

  // Score: start at 100, subtract penalties, floor at 0
  const score = Math.max(0, Math.min(100, 100 - totalPenalty))

  return { score, breakdown }
}

export async function runScoutJob(input: ScoutInput): Promise<void> {
  const { jobId, projectId, supabase } = input
  const logger = new DbLogger(supabase, jobId)

  // 1. Fetch project details
  const { data: project } = await supabase
    .from('projects')
    .select('name, github_repo, github_installation_id, default_branch, risk_paths')
    .eq('id', projectId)
    .single()

  if (!project?.github_repo) {
    console.log(`[scout] Project ${projectId} has no GitHub repo, skipping`)
    return
  }

  const workDir = `/tmp/scout-${jobId.slice(0, 8)}`
  const [owner, repo] = project.github_repo.split('/')

  console.log(`[scout] Starting CLI analysis of ${project.github_repo}`)

  try {
    // 2. Clone repo (sandboxed — disable hooks)
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })

    let token: string
    if (project.github_installation_id && isGitHubAppConfigured()) {
      token = await getInstallationToken(project.github_installation_id)
    } else if (process.env.GITHUB_TOKEN) {
      token = process.env.GITHUB_TOKEN
    } else {
      throw new Error('No GitHub credentials available for cloning')
    }

    const branch = project.default_branch || 'main'
    await logger.event('text', `Cloning ${project.github_repo} (branch: ${branch}) for scout...`)
    execFileSync(
      'git',
      ['clone', '--depth=1', '--branch', branch,
       '-c', 'core.hooksPath=/dev/null',
       `https://x-access-token:${token}@github.com/${owner}/${repo}.git`, workDir],
      { cwd: '/tmp', timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    )

    console.log(`[scout] Cloned ${project.github_repo} (branch: ${branch})`)

    // 3. Write headless CLAUDE.md
    const riskPaths = Array.isArray(project.risk_paths) ? project.risk_paths as string[] : []
    writeFileSync(join(workDir, 'CLAUDE.md'), `# Scout Agent Instructions

## CRITICAL: HEADLESS mode. NO human interaction.

- NEVER use brainstorming skill
- NEVER call AskUserQuestion
- NEVER use EnterPlanMode
- You are a code quality scout analyzing this codebase
- Read the source files, understand the architecture
- Write your findings to findings.json in the project root
`)

    const riskPathsHint = riskPaths.length > 0
      ? `\nPay special attention to these risk paths flagged by the project owner: ${riskPaths.join(', ')}`
      : ''

    const prompt = `You are a code quality scout analyzing "${project.name}" (${owner}/${repo}).

Explore this codebase and analyze it for issues across these 7 categories:
1. **bug_risk**: potential bugs, race conditions, null pointer issues, incorrect logic, missing error handling in critical paths
2. **tech_debt**: code duplication, overly complex functions, deprecated patterns, poor abstractions, dead code
3. **security**: hardcoded secrets, SQL injection, XSS, insecure dependencies, missing auth checks, unsafe data handling
4. **performance**: N+1 queries, unnecessary re-renders, missing memoization, synchronous I/O in hot paths, memory leaks
5. **accessibility**: missing ARIA labels, poor keyboard navigation, insufficient color contrast, missing alt text
6. **testing_gap**: untested critical paths, missing edge case coverage, no integration tests for key flows
7. **dx**: missing types, poor naming, unclear error messages, missing documentation for public APIs
${riskPathsHint}

## Your Process
1. Read the project structure (package.json, config files, directory layout)
2. Read key source files across the codebase
3. Identify REAL, CONCRETE issues with evidence from the code
4. Write your findings to findings.json

## Rules
- Only report issues you can see evidence for — do NOT fabricate or speculate
- 0-3 findings per category (max ~15 total)
- Each finding must reference a specific file and describe a specific issue
- Severity: critical (breaks things), high (significant risk), medium (should fix), low (nice to have)

## Output
Write a file called findings.json in the project root containing a JSON array:
[
  {
    "category": "bug_risk|tech_debt|security|performance|accessibility|testing_gap|dx",
    "title": "Short descriptive title",
    "description": "What the issue is and why it matters",
    "file_path": "path/to/file.ts or null if general",
    "severity": "critical|high|medium|low",
    "evidence": "The specific code pattern or line that demonstrates the issue"
  }
]

If no issues found, return an empty array: []

IMPORTANT: You MUST create findings.json before finishing.`

    await logger.event('text', 'Running Claude CLI scout...')
    await runClaude({
      prompt,
      workDir,
      timeoutMs: CLAUDE_TIMEOUT_MS,
      logger,
      logPrefix: `scout-${jobId.slice(0, 8)}`,
      restrictedEnv: true,
    })

    // 4. Read findings from file
    const findingsPath = join(workDir, 'findings.json')
    let allFindings: Finding[] = []

    if (!existsSync(findingsPath)) {
      console.log('[scout] CLI did not create findings.json')
      await logger.event('text', 'CLI did not create findings.json — no findings')
    } else {
      const findingsText = readFileSync(findingsPath, 'utf-8')
      const jsonMatch = findingsText.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]) as Array<{
            category: string; title: string; description: string;
            file_path: string | null; severity: string; evidence: string | null
          }>
          allFindings = parsed.map(f => ({
            category: CATEGORIES.includes(f.category as typeof CATEGORIES[number]) ? f.category : 'dx',
            severity: ['critical', 'high', 'medium', 'low'].includes(f.severity) ? f.severity : 'medium',
            title: f.title,
            description: f.description,
            file_path: f.file_path || null,
            evidence: f.evidence || null,
          }))
        } catch {
          console.log('[scout] Failed to parse findings.json')
        }
      }
    }

    console.log(`[scout] Found ${allFindings.length} findings across ${CATEGORIES.length} categories`)
    await logger.event('text', `Scout found ${allFindings.length} findings`)

    // 5. Deduplicate against existing open findings
    const { data: existingFindings } = await supabase
      .from('findings')
      .select('fingerprint')
      .eq('project_id', projectId)
      .eq('status', 'open')

    const existingFingerprints = new Set(
      (existingFindings ?? []).map((f: { fingerprint: string }) => f.fingerprint)
    )

    const newFindings = allFindings.filter(f => {
      const fp = fingerprint(f.category, f.title, f.file_path)
      return !existingFingerprints.has(fp)
    })

    console.log(`[scout] ${newFindings.length} new findings (${allFindings.length - newFindings.length} duplicates skipped)`)

    // 6. Insert new findings
    if (newFindings.length > 0) {
      const rows = newFindings.map(f => ({
        project_id: projectId,
        category: f.category,
        severity: f.severity,
        title: f.title,
        description: f.description,
        file_path: f.file_path,
        evidence: f.evidence,
        fingerprint: fingerprint(f.category, f.title, f.file_path),
      }))

      const { error } = await supabase.from('findings').upsert(rows, {
        onConflict: 'project_id,fingerprint',
        ignoreDuplicates: true,
      })

      if (error) {
        console.error(`[scout] Failed to insert findings: ${error.message}`)
      }
    }

    // 7. Emit branch event
    await supabase.from('branch_events').insert({
      project_id: projectId,
      branch_name: project.default_branch || 'main',
      event_type: 'scout_finding',
      event_data: {
        total_findings: allFindings.length,
        new_findings: newFindings.length,
        categories: Object.fromEntries(
          CATEGORIES.map(cat => [cat, allFindings.filter(f => f.category === cat).length])
        ),
      },
      actor: 'scout',
    })

    // 8. Compute and store health snapshot
    const { count: openCount } = await supabase
      .from('findings')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('status', 'open')

    const { count: addressedCount } = await supabase
      .from('findings')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('status', 'addressed')

    const { data: openFindings } = await supabase
      .from('findings')
      .select('category, severity')
      .eq('project_id', projectId)
      .eq('status', 'open')

    const { score, breakdown } = computeHealthScore(openFindings ?? [])

    const today = new Date().toISOString().split('T')[0]
    const { error: snapError } = await supabase.from('health_snapshots').upsert({
      project_id: projectId,
      score,
      breakdown,
      findings_open: openCount ?? 0,
      findings_addressed: addressedCount ?? 0,
      snapshot_date: today,
    }, {
      onConflict: 'project_id,snapshot_date',
    })

    if (snapError) {
      console.log(`[scout] Health snapshot: ${snapError.message}`)
    }

    console.log(`[scout] Health score: ${score}/100 (${openCount} open, ${addressedCount} addressed)`)

  } finally {
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })
  }
}

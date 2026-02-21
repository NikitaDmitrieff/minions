import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { getInstallationToken, isGitHubAppConfigured } from './github-app.js'
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

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.vercel',
  '.turbo', 'coverage', '__pycache__', '.cache', 'vendor',
])

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java',
  '.rb', '.php', '.vue', '.svelte', '.css', '.scss', '.html',
  '.json', '.yaml', '.yml', '.toml', '.md',
])

const MAX_SAMPLE_FILES = 30
const MAX_FILE_SIZE = 50_000 // 50KB per file
const STEP_TIMEOUT_MS = 2 * 60 * 1000

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
    throw new Error(`Command failed: ${cmd}\nExit ${e.status}\n${(e.stderr || '').slice(-1000)}`)
  }
}

function getAnthropicClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required for scout jobs')
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

/** Recursively collect code files, respecting skip dirs and extension filters. */
function collectFiles(dir: string, rootDir: string, files: string[] = []): string[] {
  if (files.length >= MAX_SAMPLE_FILES * 3) return files // collect more than needed, trim later

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return files
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue
    const fullPath = join(dir, entry)
    let stat
    try {
      stat = statSync(fullPath)
    } catch {
      continue
    }

    if (stat.isDirectory()) {
      collectFiles(fullPath, rootDir, files)
    } else if (stat.isFile() && CODE_EXTENSIONS.has(extname(entry).toLowerCase())) {
      if (stat.size > 0 && stat.size <= MAX_FILE_SIZE) {
        files.push(relative(rootDir, fullPath))
      }
    }
  }

  return files
}

/** Sample up to MAX_SAMPLE_FILES from the collected list, prioritizing diverse directories. */
function sampleFiles(allFiles: string[]): string[] {
  if (allFiles.length <= MAX_SAMPLE_FILES) return allFiles

  // Group by top-level directory
  const groups = new Map<string, string[]>()
  for (const f of allFiles) {
    const topDir = f.split('/')[0] || '_root'
    if (!groups.has(topDir)) groups.set(topDir, [])
    groups.get(topDir)!.push(f)
  }

  // Round-robin from each group
  const result: string[] = []
  const iterators = [...groups.values()].map(g => ({ items: g, idx: 0 }))

  while (result.length < MAX_SAMPLE_FILES) {
    let added = false
    for (const iter of iterators) {
      if (iter.idx < iter.items.length && result.length < MAX_SAMPLE_FILES) {
        result.push(iter.items[iter.idx++])
        added = true
      }
    }
    if (!added) break
  }

  return result
}

/** Read file contents for analysis, truncating large files. */
function readSampleContents(workDir: string, files: string[]): string {
  const parts: string[] = []
  let totalChars = 0
  const MAX_TOTAL = 100_000

  for (const f of files) {
    if (totalChars >= MAX_TOTAL) break
    try {
      let content = readFileSync(join(workDir, f), 'utf-8')
      if (content.length > 3000) {
        content = content.slice(0, 3000) + '\n... (truncated)'
      }
      parts.push(`### ${f}\n\`\`\`\n${content}\n\`\`\``)
      totalChars += content.length
    } catch {
      // Skip unreadable files
    }
  }

  return parts.join('\n\n')
}

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

/** Analyze files for a single category using Haiku. */
async function analyzeCategory(
  anthropic: Anthropic,
  category: string,
  fileContents: string,
  projectName: string,
  riskPaths: string[],
): Promise<Finding[]> {
  const categoryDescriptions: Record<string, string> = {
    bug_risk: 'potential bugs, race conditions, null pointer issues, incorrect logic, missing error handling in critical paths',
    tech_debt: 'code duplication, overly complex functions, deprecated patterns, poor abstractions, dead code',
    security: 'hardcoded secrets, SQL injection, XSS, insecure dependencies, missing auth checks, unsafe data handling',
    performance: 'N+1 queries, unnecessary re-renders, missing memoization, synchronous I/O in hot paths, memory leaks',
    accessibility: 'missing ARIA labels, poor keyboard navigation, insufficient color contrast, missing alt text',
    testing_gap: 'untested critical paths, missing edge case coverage, no integration tests for key flows',
    dx: 'missing types, poor naming, unclear error messages, missing documentation for public APIs',
  }

  const riskPathsHint = riskPaths.length > 0
    ? `\nPay special attention to these risk paths flagged by the project owner: ${riskPaths.join(', ')}`
    : ''

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You are a code quality scout analyzing "${projectName}" for: ${categoryDescriptions[category] || category}.
${riskPathsHint}

Review these source files and identify 0-3 concrete findings. Only report real issues you can see evidence for — do NOT fabricate or speculate.

${fileContents}

Respond in JSON only. No markdown fences, no explanation:
[
  {
    "title": "Short descriptive title",
    "description": "What the issue is and why it matters",
    "file_path": "path/to/file.ts or null if general",
    "severity": "critical|high|medium|low",
    "evidence": "The specific code pattern or line that demonstrates the issue"
  }
]

If no issues found, return an empty array: []`,
    }],
  })

  const text = response.content[0].type === 'text' ? response.content[0].text : ''
  // Strip markdown fences if Haiku wraps them
  const cleaned = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '')
  const jsonMatch = cleaned.match(/\[[\s\S]*\]/)
  if (!jsonMatch) return []

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      title: string
      description: string
      file_path: string | null
      severity: string
      evidence: string | null
    }>
    return parsed.map(f => ({
      category,
      severity: ['critical', 'high', 'medium', 'low'].includes(f.severity) ? f.severity : 'medium',
      title: f.title,
      description: f.description,
      file_path: f.file_path || null,
      evidence: f.evidence || null,
    }))
  } catch {
    console.log(`[scout] Failed to parse ${category} response`)
    return []
  }
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
  const { projectId, supabase } = input

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

  const workDir = `/tmp/scout-${projectId.slice(0, 8)}`
  const [owner, repo] = project.github_repo.split('/')

  console.log(`[scout] Starting analysis of ${project.github_repo}`)

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
    run(
      `git clone --depth=1 --branch ${branch} https://x-access-token:${token}@github.com/${owner}/${repo}.git ${workDir}`,
      '/tmp',
    )
    // Safety: disable hooks in cloned repo
    run('git config core.hooksPath /dev/null', workDir)

    console.log(`[scout] Cloned ${project.github_repo} (branch: ${branch})`)

    // 3. Sample files
    const allFiles = collectFiles(workDir, workDir)
    const sampledFiles = sampleFiles(allFiles)
    console.log(`[scout] Sampled ${sampledFiles.length} files from ${allFiles.length} total`)

    if (sampledFiles.length === 0) {
      console.log('[scout] No code files found, skipping analysis')
      return
    }

    const fileContents = readSampleContents(workDir, sampledFiles)

    // 4. Analyze all 7 categories in parallel via Haiku
    const anthropic = getAnthropicClient()
    const riskPaths = Array.isArray(project.risk_paths) ? project.risk_paths as string[] : []

    const categoryResults = await Promise.all(
      CATEGORIES.map(cat =>
        analyzeCategory(anthropic, cat, fileContents, project.name, riskPaths)
          .catch(err => {
            console.error(`[scout] Category ${cat} failed:`, err instanceof Error ? err.message : err)
            return [] as Finding[]
          })
      )
    )

    const allFindings = categoryResults.flat()
    console.log(`[scout] Found ${allFindings.length} findings across ${CATEGORIES.length} categories`)

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
        files_scanned: sampledFiles.length,
        categories: Object.fromEntries(
          CATEGORIES.map(cat => [cat, allFindings.filter(f => f.category === cat).length])
        ),
      },
      actor: 'scout',
    })

    // 8. Compute and store health snapshot
    // Count all open findings (existing + new)
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

    // For health score, use all currently open findings
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
      // Unique constraint violation is expected if we already ran today — just log
      console.log(`[scout] Health snapshot: ${snapError.message}`)
    }

    console.log(`[scout] Health score: ${score}/100 (${openCount} open, ${addressedCount} addressed)`)

  } finally {
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })
  }
}

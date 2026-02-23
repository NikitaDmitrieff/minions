import { execFileSync } from 'node:child_process'
import { existsSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runClaude } from './claude-cli.js'
import { DbLogger } from './logger.js'
import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = SupabaseClient<any, any, any>

export interface StrategizeInput {
  jobId: string
  projectId: string
  cycleId?: string | null
  supabase: Supabase
}

const MAX_PROPOSALS_PER_RUN = 3
const MIN_SCORE_THRESHOLD = 0.6
const STEP_TIMEOUT_MS = 10 * 60 * 1000
const CLAUDE_TIMEOUT_MS = 45 * 60 * 1000

export async function runStrategizeJob(input: StrategizeInput): Promise<void> {
  const { jobId, projectId, supabase } = input
  const workDir = `/tmp/strategist-${jobId.slice(0, 8)}`
  const logger = new DbLogger(supabase, jobId)

  // 1. Gather context — findings, proposals, memory, ideas
  const [
    { data: project },
    { data: findings },
    { data: recentProposals },
    { data: memory },
    { data: pendingIdeas },
  ] = await Promise.all([
    supabase.from('projects').select('name, github_repo, github_installation_id, product_context, strategic_nudges, wild_card_frequency').eq('id', projectId).single(),
    supabase.from('findings').select('id, category, severity, title, description, file_path').eq('project_id', projectId).eq('status', 'open').order('severity', { ascending: true }).limit(30),
    supabase.from('proposals').select('title, status, reject_reason').eq('project_id', projectId).order('created_at', { ascending: false }).limit(20),
    supabase.from('strategy_memory').select('title, event_type, themes, outcome_notes').eq('project_id', projectId).order('created_at', { ascending: false }).limit(30),
    supabase.from('user_ideas').select('id, text, status').eq('project_id', projectId).eq('status', 'pending').order('created_at', { ascending: false }).limit(20),
  ])

  if (!project) {
    console.log(`[strategize] Project ${projectId} not found, skipping`)
    return
  }

  const hasFindings = !!(findings?.length)
  const hasContext = !!(project.product_context || (project.strategic_nudges as string[] ?? []).length || pendingIdeas?.length)

  if (!hasFindings && !hasContext) {
    console.log(`[strategize] Skipping project ${projectId}: no findings and no product context`)
    return
  }

  // 2. Build context for prompt
  const severityOrder = ['critical', 'high', 'medium', 'low']

  const findingCounts = (findings ?? []).reduce((acc, f) => {
    const key = `${f.severity}/${f.category}`
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  const findingsSummary = Object.keys(findingCounts).length > 0
    ? Object.entries(findingCounts)
      .sort(([a], [b]) => severityOrder.indexOf(a.split('/')[0]) - severityOrder.indexOf(b.split('/')[0]))
      .map(([key, count]) => `- ${count}x ${key}`)
      .join('\n')
    : 'No findings yet'

  const existingProposals = (recentProposals ?? [])
    .map(p => `- [${p.status}] ${p.title}${p.reject_reason ? ` (rejected: ${p.reject_reason})` : ''}`)
    .join('\n') || 'None yet'

  const memoryContext = (memory ?? [])
    .map(m => `- [${m.event_type}] ${m.title}${m.outcome_notes ? `: ${m.outcome_notes}` : ''}`)
    .join('\n') || 'No history yet'

  const nudgesContext = (project.strategic_nudges ?? []).length > 0
    ? (project.strategic_nudges as string[]).map((n: string) => `- ${n}`).join('\n')
    : ''

  const ideasContext = (pendingIdeas ?? [])
    .map(i => `- ${i.text}`)
    .join('\n') || ''

  // 2.5. Wild card mode check
  const wildCardFrequency = (project as Record<string, unknown>).wild_card_frequency as number ?? 0.2
  const isWildCard = Math.random() < wildCardFrequency
  if (isWildCard) {
    console.log('[strategize] Wild card cycle — requesting ambitious proposal')
  }

  const wildCardInstructions = isWildCard
    ? `\n\nIMPORTANT: This is a WILD CARD cycle. Instead of incremental fixes, propose ONE ambitious architectural change or innovative feature. Think big — something that would meaningfully improve the codebase or product even if it's more complex to implement. Be bold.`
    : ''

  // 3. Clone repo and run CLI strategist
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

  if (!token || !project.github_repo) {
    throw new Error(`No GitHub token or repo for project ${projectId}`)
  }

  let rawProposals: Array<{
    title: string; rationale: string; spec: string; priority: string
    scores?: { impact: number; feasibility: number; novelty: number; alignment: number }
  }> = []

  try {
    await logger.event('text', `Cloning ${project.github_repo} for strategist...`)
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })

    execFileSync('git', [
      'clone', '--depth=1', '-c', 'core.hooksPath=/dev/null',
      `https://x-access-token:${token}@github.com/${project.github_repo}.git`, workDir,
    ], { cwd: '/tmp', timeout: STEP_TIMEOUT_MS, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] })

    // Write headless CLAUDE.md
    writeFileSync(join(workDir, 'CLAUDE.md'), `# Strategist Agent Instructions

## CRITICAL: HEADLESS mode. NO human interaction.

- NEVER use brainstorming skill
- NEVER call AskUserQuestion
- NEVER use EnterPlanMode
- You are a product strategist exploring this codebase to propose innovative features
- Explore the codebase to understand the architecture, patterns, and what exists
- Search the web for current trends, popular libraries, and innovative patterns
- Write your proposals to proposals.json in the project root
- Focus on FEATURES, not audits/refactors/tests
`)

    const prompt = `You are an INNOVATIVE product visionary for "${project.name}" (${project.github_repo}).

Your job is to explore this codebase, understand what it does, search the web for cutting-edge trends and patterns in this product's domain, and then propose features that make people go "wow, an AI built THIS?"

You are NOT a code auditor. You are a creative builder who ships surprising, delightful, FUNCTIONAL features.

## Your Process
1. Explore the codebase — read key files, understand the architecture, see what's already built
2. Search the web for innovative trends, popular libraries, and creative patterns relevant to this product
3. Synthesize what you've learned to propose bold, creative features
4. Write your proposals to proposals.json in the project root

${project.product_context ? `## Product Vision (YOUR PRIMARY GUIDE — follow this closely)\n${project.product_context}\n` : ''}
${nudgesContext ? `## Owner Directives (MUST FOLLOW)\n${nudgesContext}\n` : ''}
${ideasContext ? `## User-submitted ideas (incorporate these!)\n${ideasContext}\n` : ''}
## Codebase health summary (for awareness, NOT for driving proposals)
${findingsSummary}

## Already proposed or built (DO NOT duplicate)
${existingProposals}

## Past decisions (learn from what was rejected or approved)
${memoryContext}

Propose ${isWildCard ? '1 AMBITIOUS' : `1-${MAX_PROPOSALS_PER_RUN}`} NEW feature${isWildCard ? '' : 's'} to build. Think like a creative developer who wants to ship something impressive:

GOOD proposals — innovative, functional, surprising:
- "Build a real-time collaborative mood board with drag-and-drop"
- "Add an AI-powered color palette generator that creates themes from uploaded images"
- "Create an interactive 3D component playground with physics-based animations"
- "Build a generative art landing page that creates unique visuals per visitor"

BAD proposals — boring, safe, audit-focused:
- "Add accessibility audit dashboard" (auditing, not building)
- "Improve design token documentation" (docs, not features)
- "Create test suite for components" (testing, not creating)
- "Refactor CSS to use design tokens" (refactoring, not innovating)

Rules:
- Propose FEATURES that users can interact with, not audits/tests/refactors
- Each proposal must result in something VISIBLE and IMPRESSIVE
- The feature should build on what exists but take the product in a bold new direction
- Be specific: what exactly gets built, what does it look like, how does it work
- Do NOT re-propose anything from the "already proposed" list
- Spec must be detailed enough for a coding agent to implement in one PR${wildCardInstructions}

## Self-Assessment
After formulating each proposal, score it honestly on 4 dimensions (0.0 to 1.0):
- impact: How impressive and useful? "Wow" factor (innovative/delightful = high, boring/incremental = low)
- feasibility: Can a coding agent implement this in one PR? (clear spec + reasonable scope = high, vague/massive = low)
- novelty: Genuinely new and creative? (never seen before = high, common pattern = medium, already exists = low)
- alignment: Matches the product vision?
Be critical — not every proposal deserves high scores. Proposals below 0.6 average will be filtered out.

## Output
Write a file called proposals.json in the project root containing a JSON array:
[
  {
    "title": "Short imperative title (e.g., Build a generative art landing page)",
    "rationale": "Why this is exciting and what it adds to the product",
    "spec": "Detailed implementation spec: exact components to create, layout, interactions, animations, data flow. Be specific and creative.",
    "priority": "high|medium|low",
    "scores": {"impact": 0.8, "feasibility": 0.7, "novelty": 0.9, "alignment": 0.85}
  }
]

IMPORTANT: You MUST create the proposals.json file before finishing. This is your primary deliverable.`

    await logger.event('text', 'Running Claude CLI strategist...')
    await runClaude({
      prompt,
      workDir,
      timeoutMs: CLAUDE_TIMEOUT_MS,
      logger,
      logPrefix: `strategist-${jobId.slice(0, 8)}`,
      restrictedEnv: true,
    })

    // Read proposals from file
    const proposalsPath = join(workDir, 'proposals.json')
    if (!existsSync(proposalsPath)) {
      console.log('[strategize] CLI did not create proposals.json')
      await logger.event('text', 'CLI did not create proposals.json — no proposals generated')
      return
    }

    const proposalsText = readFileSync(proposalsPath, 'utf-8')
    const jsonMatch = proposalsText.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      console.log('[strategize] No valid JSON array in proposals.json')
      return
    }

    try {
      rawProposals = JSON.parse(jsonMatch[0])
    } catch {
      console.log('[strategize] Failed to parse proposals.json')
      return
    }

    await logger.event('text', `CLI generated ${rawProposals.length} proposals`)
  } finally {
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })
  }

  if (rawProposals.length === 0) return

  // 4. Filter and insert proposals (scored by CLI)
  for (const raw of rawProposals.slice(0, MAX_PROPOSALS_PER_RUN)) {
    const scores = raw.scores ?? { impact: 0.5, feasibility: 0.5, novelty: 0.5, alignment: 0.5 }
    const avgScore = (scores.impact + scores.feasibility + scores.novelty + scores.alignment) / 4
    if (avgScore < MIN_SCORE_THRESHOLD) {
      console.log(`[strategize] Proposal "${raw.title}" scored ${avgScore.toFixed(2)} — below threshold, skipping`)
      continue
    }

    // 5. Insert proposal with cycle_id and wild card flag
    const { data: inserted, error } = await supabase.from('proposals').insert({
      project_id: projectId,
      title: raw.title,
      rationale: raw.rationale,
      spec: raw.spec,
      priority: raw.priority === 'high' ? 'high' : raw.priority === 'low' ? 'low' : 'medium',
      source_finding_ids: [],
      scores,
      cycle_id: input.cycleId || null,
      is_wild_card: isWildCard,
    }).select('id').single()

    if (error) {
      console.error(`[strategize] Failed to insert proposal: ${error.message}`)
    } else {
      console.log(`[strategize] Created proposal: "${raw.title}" (score: ${avgScore.toFixed(2)})`)

      await supabase.from('branch_events').insert({
        project_id: projectId,
        branch_name: 'main',
        event_type: 'proposal_created',
        event_data: {
          proposal_id: inserted.id,
          proposal_title: raw.title,
          scores,
          priority: raw.priority === 'high' ? 'high' : raw.priority === 'low' ? 'low' : 'medium',
        },
        actor: 'strategist',
      })
    }
  }

  // Mark user ideas as incorporated or dismissed
  if (pendingIdeas?.length) {
    const proposalTexts = rawProposals.map(p => p.title.toLowerCase() + ' ' + p.rationale.toLowerCase())
    for (const idea of pendingIdeas) {
      const ideaWords = idea.text.toLowerCase().split(/\s+/)
      const incorporated = proposalTexts.some(text =>
        ideaWords.filter((w: string) => w.length > 3).some((word: string) => text.includes(word))
      )
      await supabase
        .from('user_ideas')
        .update({ status: incorporated ? 'incorporated' : 'dismissed' })
        .eq('id', idea.id)
    }
  }
}

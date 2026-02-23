import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { claudeEnv } from './claude-cli.js'

export type FailureCategory = 'docs_gap' | 'widget_bug' | 'agent_bug' | 'consumer_error' | 'transient'

export type FailureClassification = {
  category: FailureCategory
  analysis: string
  fix_summary: string
}

type LogEntry = { level: string; message: string }

interface ClassifyInput {
  logs: LogEntry[]
  lastError: string
  issueBody: string
  jobType: string
}

const VALID_CATEGORIES: FailureCategory[] = ['docs_gap', 'widget_bug', 'agent_bug', 'consumer_error', 'transient']

export async function classifyFailure(input: ClassifyInput): Promise<FailureClassification | null> {
  const { logs, lastError, issueBody, jobType } = input

  if (logs.length === 0 && !lastError) return null

  const workDir = `/tmp/classify-${Date.now()}`

  try {
    mkdirSync(workDir, { recursive: true })

    // Write context for the CLI to read
    const logText = logs
      .map((l) => `[${l.level}] ${l.message}`)
      .join('\n')

    writeFileSync(join(workDir, 'context.md'), `# Failure Context

## Job Type
${jobType}

## Original Issue Body
${issueBody.slice(0, 1000)}

## Last Error
${lastError.slice(0, 1000)}

## Run Logs (last entries)
${logText.slice(-3000)}
`)

    writeFileSync(join(workDir, 'CLAUDE.md'), `# Classification Agent Instructions

## CRITICAL: HEADLESS mode. NO human interaction.

- NEVER call AskUserQuestion
- NEVER use EnterPlanMode
- Read context.md and classify the failure
- Write classification.json in this directory
`)

    const prompt = `Read context.md and classify this agent failure into exactly ONE category:

- **docs_gap**: CLAUDE.md, installation instructions, or gotchas are incomplete/wrong. The agent didn't know how to handle a documented situation.
- **widget_bug**: The widget's source code has a bug — wrong exports, broken CSS, incompatible patterns.
- **agent_bug**: The agent's own workflow logic is broken — cloning issues, validation logic, prompt construction.
- **consumer_error**: Consumer's fault — bad config, missing env vars, incompatible dependencies, unusual project structure.
- **transient**: Network timeout, rate limit, flaky CI, GitHub API outage, or other temporary issue.

Write a file called classification.json containing:
{"category": "one_of_the_five", "analysis": "What went wrong and why this category", "fix_summary": "What to change to prevent this (N/A for consumer_error and transient)"}

IMPORTANT: You MUST create classification.json before finishing.`

    const env = await claudeEnv(true)
    execFileSync('claude', [
      '--dangerously-skip-permissions', '--permission-mode', 'dontAsk',
      '--model', 'claude-sonnet-4-6', '--output-format', 'text',
      '--max-turns', '3', '-p', prompt,
    ], {
      cwd: workDir,
      timeout: 120_000,
      encoding: 'utf-8',
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const resultPath = join(workDir, 'classification.json')
    if (!existsSync(resultPath)) {
      console.error('[classify] CLI did not create classification.json')
      return null
    }

    const text = readFileSync(resultPath, 'utf-8')
    // Strip markdown fences if present
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      console.error('[classify] No valid JSON in classification.json')
      return null
    }

    const parsed = JSON.parse(jsonMatch[0])

    if (!VALID_CATEGORIES.includes(parsed.category)) {
      console.error('[classify] Invalid category:', parsed.category)
      return null
    }

    return {
      category: parsed.category,
      analysis: String(parsed.analysis || ''),
      fix_summary: String(parsed.fix_summary || ''),
    }
  } catch (err) {
    console.error('[classify] CLI classification failed:', err instanceof Error ? err.message : err)
    return null
  } finally {
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true })
  }
}

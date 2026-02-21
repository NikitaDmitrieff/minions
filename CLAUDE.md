# Minions

AI worker swarm that continuously analyzes and improves codebases. Monorepo with two packages.

## Commands

```bash
npm install          # Install all workspace deps
npm run build        # Build all packages (turbo)
npm run dev          # Watch mode
npm run test         # Run tests
```

## Architecture

```
packages/
├── agent/     # Managed worker — polls Supabase job_queue, dispatches workers
│   └── src/
│       ├── managed-worker.ts     # Job queue poller + dispatcher
│       ├── scout-worker.ts       # Haiku-based repo analysis (7 categories)
│       ├── strategize-worker.ts  # Proposal generation with multi-grader scoring
│       ├── builder-worker.ts     # Claude CLI implementation with sandbox safety
│       ├── reviewer-worker.ts    # Anthropic SDK review with risk tiers
│       ├── self-improve-worker.ts # Self-improvement on internal failures
│       └── classify-failure.ts   # Haiku failure classifier
└── dashboard/ # Next.js dashboard
    └── src/
        ├── app/projects/[id]/    # Graph, Kanban, Findings, Health, Input, Settings
        ├── components/           # Branch graph, event slide-over, scheduled panel
        └── lib/                  # Supabase client, types, GitHub App
```

## Key Patterns

- Agent uses OAuth (`CLAUDE_CREDENTIALS_JSON`) for Claude CLI jobs, `ANTHROPIC_API_KEY` for Haiku classification + strategize
- OAuth tokens do NOT work for direct Anthropic API calls (only for Claude Code CLI)
- Dashboard async params: Next.js 15+ route handlers use `const { projectId } = await params` pattern
- Glass-card styling: components use `glass-card`, `stat-card` CSS classes with Tailwind theme colors
- Supabase schema: `feedback_chat` (agent queries with `{ db: { schema: 'feedback_chat' } }`)

## Worker Types

### Scout (`scout-worker.ts`)
- Clones repo with sandbox safety (`--config core.hooksPath=/dev/null`)
- Analyzes 7 categories in parallel via Haiku: security, performance, DX, testing, accessibility, architecture, docs
- Deduplicates findings via title+file_path fingerprint
- Computes health snapshots (0-100 per category)

### Strategist (`strategize-worker.ts`)
- Reads findings + user ideas + strategy memory
- Proposes improvements scored on 4 dimensions (impact, feasibility, novelty, alignment)
- Below 0.6 avg filtered out
- Uses `ANTHROPIC_API_KEY` (not OAuth)

### Builder (`builder-worker.ts`)
- Sandbox safety: strips repo CLAUDE.md, disables git hooks
- Creates PR via Octokit (not `gh` CLI — not in Docker)
- Remediation loops: retries with error context (max 2 attempts)
- Tiered validation: lint → typecheck → build → test (fail fast)
- SHA tracking on branch_events

### Reviewer (`reviewer-worker.ts`)
- Uses Anthropic SDK (not CLI) to free CLI concurrency slots (~14 session limit)
- GitHub API for diffs, risk tier checking with minimatch
- SHA-pinned events: verifies HEAD matches before merge
- Posts structured PR reviews

## Dashboard

- Next.js app at `packages/dashboard/`
- Pages: Graph (branch visualization), Kanban (proposal pipeline), Findings (scout results), Health (trend charts), Input (ideas/proposals), Settings (config)
- Sidebar: Graph, Kanban, Findings, Health, Settings, Your Input
- API routes:
  - `/api/graph/[projectId]` — branch events grouped by branch
  - `/api/findings/[projectId]` — GET with filters, PATCH for bulk updates
  - `/api/health/[projectId]` — 30-day snapshots
  - `/api/proposals/[projectId]` — GET/POST/PATCH proposals
  - `/api/ideas/[projectId]` — GET/POST user ideas
  - `/api/projects/[id]/settings` — GET/PATCH project config
  - `/api/runs/[projectId]` — pipeline runs

## Database

Supabase tables (feedback_chat schema):
- `projects` — GitHub repo, installation ID, product_context, strategic_nudges, autonomy_mode, scout_schedule, risk_paths, paused, max_concurrent_branches
- `job_queue` — Job dispatch with claim_next_job RPC (FOR UPDATE SKIP LOCKED)
- `findings` — Scout analysis results (category, severity, file_path, status)
- `health_snapshots` — Periodic codebase health scores by category
- `branch_events` — Timeline events with commit_sha (scout_finding, proposal_created, build_*, review_*, pr_*, deploy)
- `proposals` — AI/user proposals with scores, spec, status lifecycle
- `strategy_memory` — Tracks proposal outcomes for learning
- `user_ideas` — User-submitted ideas
- `pipeline_runs` — Build pipeline state tracking
- `run_logs` — Build output logs

## Gotchas

- Claude CLI has a concurrency limit (~14 sessions) — excess sessions hang with null exit code
- Railway deployment: old containers can briefly coexist with new ones during rollover
- Haiku sometimes wraps JSON in markdown code fences despite instructions — always strip them
- `self_improve`, `setup`, `strategize`, `scout` jobs never trigger failure classification (recursion guard)
- Self-improve jobs need `GITHUB_TOKEN` PAT (not installation token) to push

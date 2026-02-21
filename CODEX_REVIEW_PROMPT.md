# Codex Review Prompt

Copy everything below the line and paste it into Codex (or ChatGPT with code review context).

---

## Context

You are reviewing **Minions** — a new SaaS product that connects to a user's GitHub repo and deploys an autonomous AI worker swarm to continuously analyze and improve their codebase. The repo was forked from an existing feedback-chat monorepo and stripped down to focus on the autonomous improvement pipeline.

**Repo:** https://github.com/NikitaDmitrieff/minions
**Stack:** TypeScript monorepo (Turborepo), Next.js 15 dashboard, Node.js agent workers, Supabase (PostgreSQL + RLS), Railway for agent deployment
**Database schema:** `minions` on Supabase (16 tables with RLS)

## Architecture

Four autonomous workers poll a Supabase `job_queue` and process jobs:

1. **Scout** (`packages/agent/src/scout-worker.ts`) — Clones repo, samples 30 files, analyzes 7 categories in parallel via Claude Haiku. Deduplicates findings by fingerprint. Computes daily health snapshots (0-100 score).

2. **Strategist** (`packages/agent/src/strategize-worker.ts`) — Reads findings + user ideas + strategy memory. Proposes improvements scored on 4 dimensions (impact, feasibility, novelty, alignment). Filters below 0.6 average.

3. **Builder** (`packages/agent/src/builder-worker.ts`) — Runs Claude CLI with `--dangerously-skip-permissions` in sandbox. Strips consumer CLAUDE.md. Tiered validation (lint → typecheck → build → test). Up to 2 remediation attempts. Creates PR via Octokit.

4. **Reviewer** (`packages/agent/src/reviewer-worker.ts`) — Uses Anthropic SDK (not CLI) for PR review. Risk-tier system (high/medium/low based on file paths). SHA-pinned events. Auto-merge for low-risk in "automate" mode.

**Dashboard** (`packages/dashboard/`) — Next.js app with pages for:
- Branch graph visualization (SVG-based, interactive)
- Kanban board for proposal pipeline
- Findings browser with category/severity/status filters
- Health score trends with sparkline charts
- User input (ideas + manual proposals)
- Settings (scout schedule, autonomy mode, risk paths, kill switch)

## What to Review

Please review the entire codebase for:

### 1. Architecture & Design
- Is the worker polling architecture sound for this use case? Should we consider event-driven (webhooks/pub-sub) instead?
- Is the 4-worker separation (Scout → Strategist → Builder → Reviewer) the right decomposition?
- Is the autonomy mode system (audit/assist/automate) well-designed for progressive trust?
- Are there architectural anti-patterns or coupling issues?

### 2. Security
- The Builder runs `claude --dangerously-skip-permissions` on cloned consumer repos. What attack vectors exist?
- The Builder strips CLAUDE.md from consumer repos — is this sufficient protection against prompt injection?
- Are there risks in the way tokens (OAuth, GitHub PAT, installation tokens) are handled?
- RLS policies on all 16 tables — are they correctly scoped?
- Are there any SQL injection, XSS, or CSRF risks in the dashboard API routes?

### 3. Data Layer Integrity
- Do the SQL migrations (`packages/dashboard/supabase/migrations/00001-00016`) correctly define constraints, indexes, and relationships?
- Do the TypeScript types (`packages/dashboard/src/lib/types.ts`) match the database schema?
- Do the worker files use the correct column names and enum values when querying Supabase?
- Is the fingerprint deduplication in Scout robust enough?

### 4. Reliability & Error Handling
- Job retry logic: stale jobs reaped after 30min, max 3 attempts with exponential backoff. Is this sufficient?
- Builder remediation: 2 attempts to fix validation failures. Should there be more/fewer?
- What happens if the Claude CLI hangs or returns null exit code (known concurrency limit ~14 sessions)?
- Are there race conditions in the job queue (`claim_next_job` uses `FOR UPDATE SKIP LOCKED`)?
- What happens during Railway container rollover (old + new worker briefly coexist)?

### 5. Scaling & Performance
- Scout samples only 30 files from the repo. Is this representative enough for large codebases?
- All 7 Haiku calls run in parallel — what's the cost/latency profile?
- Health snapshots are daily — is the upsert on `(project_id, snapshot_date)` correct?
- Dashboard API routes — are there N+1 query patterns or missing pagination?

### 6. Code Quality
- Dead code from the feedback-chat fork that should be removed?
- Inconsistencies between worker implementations?
- Missing error handling at system boundaries?
- Test coverage gaps (5 unit test suites exist, 2 E2E specs)?

### 7. Missing Features / Gaps
- What's needed before this is production-ready for external users?
- Are there important observability gaps (logging, metrics, alerting)?
- Should there be rate limiting on the dashboard API?
- Is there a story for multi-tenancy / user isolation beyond RLS?

## Key Files to Focus On

**Workers (core logic):**
- `packages/agent/src/scout-worker.ts` (459 lines)
- `packages/agent/src/builder-worker.ts` (370 lines)
- `packages/agent/src/reviewer-worker.ts`
- `packages/agent/src/strategize-worker.ts`
- `packages/agent/src/managed-worker.ts` (job dispatcher)

**Data layer:**
- `packages/dashboard/src/lib/types.ts` (168 lines)
- `packages/dashboard/supabase/migrations/*.sql` (16 migrations)

**Dashboard components:**
- `packages/dashboard/src/components/branch-graph.tsx`
- `packages/dashboard/src/app/projects/[id]/findings/client.tsx`
- `packages/dashboard/src/app/projects/[id]/health/client.tsx`
- `packages/dashboard/src/app/projects/[id]/settings/client.tsx`

**API routes:**
- `packages/dashboard/src/app/api/graph/[projectId]/route.ts`
- `packages/dashboard/src/app/api/findings/[projectId]/route.ts`
- `packages/dashboard/src/app/api/health/[projectId]/route.ts`

## Output Format

Please structure your review as:

1. **Critical Issues** — Things that would break in production or pose security risks
2. **Important Improvements** — Design issues, missing error handling, data integrity gaps
3. **Nice-to-Haves** — Code quality, DX improvements, minor optimizations
4. **Architecture Assessment** — Overall verdict on the design choices, with specific alternatives where warranted
5. **Production Readiness Checklist** — What's needed before shipping to real users

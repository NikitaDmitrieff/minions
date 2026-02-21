# Minions

AI worker swarm that continuously analyzes and improves your codebase.

```
Connect GitHub repo → Scout finds issues → Strategist proposes fixes
    → You approve → Builder implements → Reviewer validates → Auto-merge
```

## Architecture

Four autonomous workers powered by Claude:

- **Scout** — Haiku-based analysis across 7 categories (security, performance, DX, testing, accessibility, architecture, documentation)
- **Strategist** — Converts findings into actionable proposals with multi-grader scoring
- **Builder** — Claude CLI implementation with sandbox safety, remediation loops, and tiered validation
- **Reviewer** — Anthropic SDK code review with risk tiers, SHA-pinned events, and auto-merge for low-risk changes

## Quick Start

```bash
npm install          # Install all workspace deps
npm run build        # Build all packages
npm run dev          # Dashboard dev server
npm run test         # Run tests
```

## Structure

```
packages/
├── agent/     # Managed worker — polls Supabase job_queue, dispatches workers
│   └── src/
│       ├── scout-worker.ts       # Repo analysis
│       ├── strategize-worker.ts  # Proposal generation
│       ├── builder-worker.ts     # Code implementation
│       ├── reviewer-worker.ts    # PR review
│       └── managed-worker.ts     # Job queue poller + dispatcher
└── dashboard/ # Next.js dashboard
    └── src/
        ├── app/projects/[id]/    # Graph, Kanban, Findings, Health, Input, Settings pages
        ├── components/           # Branch graph, event slide-over, scheduled panel
        └── lib/                  # Supabase client, types, GitHub App
```

## Dashboard Pages

| Page | Path | Description |
|------|------|-------------|
| Graph | `/projects/[id]` | Branch graph visualization — the main view |
| Kanban | `/projects/[id]/kanban` | Proposal pipeline: Proposed → In Progress → Completed |
| Findings | `/projects/[id]/findings` | Scout findings with category/severity filters |
| Health | `/projects/[id]/health` | Codebase health score trends |
| Your Input | `/projects/[id]/input` | Submit ideas and manual proposals |
| Settings | `/projects/[id]/settings` | Scout schedule, autonomy mode, risk paths, kill switch |

## Autonomy Modes

| Mode | Behavior |
|------|----------|
| **Audit** (default) | Scout and Strategist auto-run. Builder and merge need approval. |
| **Assist** | Low-risk changes auto-build. High-risk and merge need approval. |
| **Automate** | Full automation. Auto-merge if tests pass and Reviewer approves. |

## Infrastructure

- **Dashboard**: Next.js on Vercel
- **Agent**: Node.js worker on Railway (polls Supabase job queue)
- **Database**: Supabase (PostgreSQL with RLS)
- **GitHub**: GitHub App for repo access and webhooks

## License

MIT

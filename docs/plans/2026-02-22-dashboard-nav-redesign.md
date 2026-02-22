# Dashboard Navigation Redesign: Observe / Act

## Problem

The dashboard has 6 sidebar tabs (Graph, Kanban, Findings, Health, Settings, Your Input) that feel disconnected. Health is confusing as a standalone page. Your Input has no obvious home. The relationship between findings and proposals is unclear.

## Solution

Replace the flat 6-tab sidebar with a **top-level segmented control** toggling between **Observe** and **Act** modes, each with 2 sidebar items. Total: 4 pages instead of 6.

## Navigation Structure

```
Top bar: [Observe | Act] segmented control
```

### Observe Mode
| Page | Route | Content |
|------|-------|---------|
| Activity | `/projects/[id]` | Branch graph (hero view), event timeline, scheduled jobs |
| Findings | `/projects/[id]/findings` | Health summary bar (category scores + sparklines) at top, finding cards with filters below |

### Act Mode
| Page | Route | Content |
|------|-------|---------|
| Proposals | `/projects/[id]/proposals` | Proposal cards with source links to findings/ideas, active jobs, pipeline runs |
| Settings | `/projects/[id]/settings` | Internal tabs: [Configuration \| Your Input]. Config = GitHub/schedule/autonomy/risk. Input = ideas + strategic nudges |

## Key Design Decisions

### Health merged into Findings
Health scores are derived from findings. The Findings page gets a summary bar at the top with per-category score cards showing:
- Current score (0-100)
- Tiny sparkline (30-day trend)
- Clicking a category card filters the findings list to that category

### Your Input merged into Settings
Settings gains an internal tab bar: [Configuration | Your Input]. Strategic nudges move from config to the "Your Input" tab since they're user direction, not system config. Ideas (textarea + list) live alongside nudges.

### Proposal source links
Each proposal card shows which findings or user ideas generated it, linking the lifecycle: finding → proposal → build → merge.

### Mode detection from route
The Observe/Act toggle state is inferred from the current URL:
- `/projects/[id]` and `/projects/[id]/findings` → Observe
- `/projects/[id]/proposals` and `/projects/[id]/settings` → Act

No separate state management needed.

## Pages Removed
- **Health** (standalone) → merged into Findings header
- **Kanban** (was a redirect to Minions) → replaced by Proposals
- **Your Input** (standalone) → merged into Settings as internal tab

## URL Changes
| Old Route | New Route | Notes |
|-----------|-----------|-------|
| `/projects/[id]` | `/projects/[id]` | Unchanged (Activity/Graph) |
| `/projects/[id]/kanban` | Removed | Redirect to `/proposals` |
| `/projects/[id]/minions` | `/projects/[id]/proposals` | Renamed |
| `/projects/[id]/findings` | `/projects/[id]/findings` | Unchanged, gains health bar |
| `/projects/[id]/health` | Removed | Redirect to `/findings` |
| `/projects/[id]/settings` | `/projects/[id]/settings` | Unchanged, gains Your Input tab |
| `/projects/[id]/input` | Removed | Redirect to `/settings` |

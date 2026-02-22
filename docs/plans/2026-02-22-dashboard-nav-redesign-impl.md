# Dashboard Navigation Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restructure the dashboard from 6 flat sidebar tabs to an Observe/Act mode toggle with 4 pages total.

**Architecture:** Top-level segmented control in the sidebar switches between Observe (Activity, Findings) and Act (Proposals, Settings) modes. Health merges into Findings as a summary bar. Your Input merges into Settings as an internal tab. Minions page becomes Proposals at a new route. Mode is inferred from the current URL path.

**Tech Stack:** Next.js 15+ (App Router), React, Tailwind CSS, lucide-react icons, Supabase

---

### Task 1: Rewrite the Sidebar Component

**Files:**
- Modify: `packages/dashboard/src/components/sidebar.tsx`

**Step 1: Rewrite the sidebar**

Replace the flat list of 6 project nav items with a mode-aware sidebar. The mode (observe/act) is derived from the current pathname. The sidebar shows a segmented control at the top and 2 nav items below based on the active mode.

```tsx
'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FolderKanban, GitBranch, Search, Lightbulb, Settings, Eye, Zap, LogOut } from 'lucide-react'

type Mode = 'observe' | 'act'

function getMode(pathname: string, projectId: string | null): Mode {
  if (!projectId) return 'observe'
  if (pathname.includes('/proposals') || pathname.includes('/settings')) return 'act'
  return 'observe'
}

export function Sidebar() {
  const pathname = usePathname()
  const [expanded, setExpanded] = useState(false)
  const collapseTimer = useRef<ReturnType<typeof setTimeout>>(null)

  const projectMatch = pathname.match(/\/projects\/([^/]+)/)
  const projectId = projectMatch && projectMatch[1] !== 'new' ? projectMatch[1] : null

  const mode = getMode(pathname, projectId)

  const expand = useCallback(() => {
    if (collapseTimer.current) clearTimeout(collapseTimer.current)
    setExpanded(true)
  }, [])

  const scheduleCollapse = useCallback(() => {
    collapseTimer.current = setTimeout(() => setExpanded(false), 300)
  }, [])

  useEffect(() => {
    return () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current)
    }
  }, [])

  const observeItems = projectId ? [
    { href: `/projects/${projectId}`, label: 'Activity', icon: GitBranch, active: pathname === `/projects/${projectId}` },
    { href: `/projects/${projectId}/findings`, label: 'Findings', icon: Search, active: pathname.includes('/findings') },
  ] : []

  const actItems = projectId ? [
    { href: `/projects/${projectId}/proposals`, label: 'Proposals', icon: Lightbulb, active: pathname.includes('/proposals') },
    { href: `/projects/${projectId}/settings`, label: 'Settings', icon: Settings, active: pathname.includes('/settings') },
  ] : []

  const items = mode === 'observe' ? observeItems : actItems

  return (
    <aside
      onMouseEnter={expand}
      onMouseLeave={scheduleCollapse}
      className={`fixed left-3 top-1/2 z-40 -translate-y-1/2 overflow-hidden rounded-[24px] border border-white/[0.08] bg-white/[0.04] p-1.5 shadow-[0_8px_40px_rgba(0,0,0,0.3),inset_0_1px_0_rgba(255,255,255,0.06),inset_0_-1px_0_rgba(255,255,255,0.02)] backdrop-blur-2xl transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ${
        expanded ? 'w-[172px]' : 'w-[52px]'
      }`}
    >
      {/* Projects */}
      <Link
        href="/projects"
        className={`flex items-center rounded-[16px] transition-colors ${
          pathname === '/projects' || pathname === '/'
            ? 'bg-white/[0.08] text-fg'
            : 'text-muted hover:bg-white/[0.06] hover:text-fg'
        } ${expanded ? 'gap-2.5 px-2 py-2' : 'justify-center p-1.5'}`}
      >
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center">
          <FolderKanban className="h-[15px] w-[15px]" />
        </div>
        {expanded && <span className="truncate text-xs">Projects</span>}
      </Link>

      {/* Mode toggle */}
      {projectId && (
        <div className={`my-1.5 flex items-center gap-0.5 rounded-[14px] bg-white/[0.04] p-0.5 ${expanded ? '' : 'flex-col'}`}>
          <Link
            href={`/projects/${projectId}`}
            className={`flex items-center justify-center rounded-[12px] transition-colors ${
              mode === 'observe' ? 'bg-white/[0.08] text-fg' : 'text-muted hover:text-fg'
            } ${expanded ? 'flex-1 gap-1.5 px-2 py-1.5' : 'p-1.5'}`}
          >
            <Eye className="h-3 w-3 shrink-0" />
            {expanded && <span className="text-[10px] font-medium">Observe</span>}
          </Link>
          <Link
            href={`/projects/${projectId}/proposals`}
            className={`flex items-center justify-center rounded-[12px] transition-colors ${
              mode === 'act' ? 'bg-white/[0.08] text-fg' : 'text-muted hover:text-fg'
            } ${expanded ? 'flex-1 gap-1.5 px-2 py-1.5' : 'p-1.5'}`}
          >
            <Zap className="h-3 w-3 shrink-0" />
            {expanded && <span className="text-[10px] font-medium">Act</span>}
          </Link>
        </div>
      )}

      {/* Nav items for current mode */}
      {items.map(item => (
        <Link
          key={item.href}
          href={item.href}
          className={`flex items-center rounded-[16px] transition-colors ${
            item.active
              ? 'bg-white/[0.08] text-fg'
              : 'text-muted hover:bg-white/[0.06] hover:text-fg'
          } ${expanded ? 'gap-2.5 px-2 py-2' : 'justify-center p-1.5'}`}
        >
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center">
            <item.icon className="h-[15px] w-[15px]" />
          </div>
          {expanded && <span className="truncate text-xs">{item.label}</span>}
        </Link>
      ))}

      {/* Divider */}
      <div className={`my-1 h-px bg-white/[0.06] ${expanded ? 'mx-2' : 'mx-auto w-5'}`} />

      {/* Sign out */}
      <form action="/auth/signout" method="post">
        <button
          type="submit"
          className={`flex w-full items-center rounded-[16px] text-muted transition-colors hover:bg-white/[0.06] hover:text-fg ${
            expanded ? 'gap-2.5 px-2 py-2' : 'justify-center p-1.5'
          }`}
        >
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center">
            <LogOut className="h-[14px] w-[14px]" />
          </div>
          {expanded && <span className="truncate text-xs">Sign out</span>}
        </button>
      </form>
    </aside>
  )
}
```

**Step 2: Verify the build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -20`
Expected: Build succeeds (some pages may have issues due to missing routes — that's OK, we fix those in later tasks).

**Step 3: Commit**

```bash
git add packages/dashboard/src/components/sidebar.tsx
git commit -m "refactor: rewrite sidebar with observe/act mode toggle"
```

---

### Task 2: Merge Health into Findings Page

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/findings/page.tsx` (add health snapshot fetch)
- Modify: `packages/dashboard/src/app/projects/[id]/findings/client.tsx` (add health summary bar)

**Step 1: Update the Findings server page to also fetch health snapshots**

In `packages/dashboard/src/app/projects/[id]/findings/page.tsx`, add the health data fetch alongside findings:

```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { FindingsPageClient } from './client'
import type { Finding, HealthSnapshot } from '@/lib/types'

export default async function FindingsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', id)
    .single()

  if (!project) notFound()

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [{ data: findings }, { data: snapshots }] = await Promise.all([
    supabase
      .from('findings')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase
      .from('health_snapshots')
      .select('*')
      .eq('project_id', id)
      .gte('snapshot_date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('snapshot_date', { ascending: true }),
  ])

  return (
    <div className="mx-auto max-w-6xl px-6 pt-10 pb-16">
      <FindingsPageClient
        projectId={project.id}
        findings={(findings ?? []) as Finding[]}
        snapshots={(snapshots ?? []) as HealthSnapshot[]}
      />
    </div>
  )
}
```

**Step 2: Add health summary bar to the Findings client component**

In `packages/dashboard/src/app/projects/[id]/findings/client.tsx`, add the health summary bar above the existing filters. Add a `HealthSummaryBar` component and the `Sparkline` from the old health page. When a category card is clicked, it sets the `categoryFilter`.

Add to the Props type:
```tsx
import type { Finding, FindingCategory, FindingSeverity, FindingStatus, HealthSnapshot } from '@/lib/types'

type Props = {
  projectId: string
  findings: Finding[]
  snapshots: HealthSnapshot[]
}
```

Add these helper components before `FindingsPageClient`:

```tsx
const BREAKDOWN_LABELS: Record<string, string> = {
  bug_risk: 'Bug Risk',
  tech_debt: 'Tech Debt',
  security: 'Security',
  performance: 'Performance',
  accessibility: 'Accessibility',
  testing_gap: 'Testing',
  dx: 'DX',
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-success'
  if (score >= 40) return 'text-amber-400'
  return 'text-red-400'
}

function MiniSparkline({ snapshots }: { snapshots: HealthSnapshot[] }) {
  if (snapshots.length < 2) return null
  const w = 48, h = 20, pad = 2
  const scores = snapshots.map(s => s.score)
  const min = Math.min(...scores) - 5
  const max = Math.max(...scores) + 5
  const range = max - min || 1
  const pts = scores.map((s, i) => {
    const x = pad + (i / (scores.length - 1)) * (w - pad * 2)
    const y = h - pad - ((s - min) / range) * (h - pad * 2)
    return `${x},${y}`
  })
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p}`).join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible">
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5}
        className={scoreColor(scores[scores.length - 1])} />
    </svg>
  )
}
```

Add a `HealthSummaryBar` component:

```tsx
function HealthSummaryBar({
  snapshots,
  onCategoryClick,
  activeCategoryFilter,
}: {
  snapshots: HealthSnapshot[]
  onCategoryClick: (cat: FindingCategory | null) => void
  activeCategoryFilter: FindingCategory | null
}) {
  const latest = snapshots.length > 0 ? snapshots[snapshots.length - 1] : null
  if (!latest) return null

  const breakdown = latest.breakdown || {}

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`text-2xl font-bold tabular-nums ${scoreColor(latest.score)}`}>
            {latest.score}
          </span>
          <span className="text-xs text-muted">/100</span>
        </div>
        <MiniSparkline snapshots={snapshots} />
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Object.entries(BREAKDOWN_LABELS).map(([key, label]) => {
          const entry = breakdown[key]
          const count = entry?.count ?? 0
          const isActive = activeCategoryFilter === key
          return (
            <button
              key={key}
              onClick={() => onCategoryClick(isActive ? null : key as FindingCategory)}
              className={`rounded-lg p-2 text-center transition-colors ${
                isActive
                  ? 'bg-accent/20 ring-1 ring-accent/30'
                  : 'bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
            >
              <p className="text-[10px] text-muted">{label}</p>
              <p className={`text-sm font-semibold tabular-nums ${count > 0 ? 'text-fg' : 'text-dim'}`}>
                {count}
              </p>
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

Then in `FindingsPageClient`, accept the new `snapshots` prop and render `<HealthSummaryBar>` between the header and the filters:

```tsx
export function FindingsPageClient({ projectId, findings: initialFindings, snapshots }: Props) {
  // ... existing state ...

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <Search className="h-5 w-5 text-accent" />
        <h1 className="text-lg font-medium text-fg">Findings</h1>
        <span className="rounded-full bg-surface px-2 py-0.5 text-xs tabular-nums text-muted">
          {filtered.length}
        </span>
      </div>

      {/* Health summary bar */}
      <HealthSummaryBar
        snapshots={snapshots}
        onCategoryClick={setCategoryFilter}
        activeCategoryFilter={categoryFilter}
      />

      {/* Filters (existing) */}
      ...
    </>
  )
}
```

**Step 3: Verify the build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -20`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add packages/dashboard/src/app/projects/[id]/findings/
git commit -m "feat: merge health summary bar into findings page"
```

---

### Task 3: Merge Your Input into Settings Page

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/settings/page.tsx` (add ideas fetch)
- Modify: `packages/dashboard/src/app/projects/[id]/settings/client.tsx` (add internal tab bar, move nudges + ideas into "Your Input" tab)

**Step 1: Update Settings server page to also fetch user ideas**

Add to `settings/page.tsx` a parallel fetch for user_ideas alongside the existing project fetch:

```tsx
const [{ data: project }, { data: ideas }] = await Promise.all([
  supabase
    .from('projects')
    .select('id, name, github_repo, product_context, strategic_nudges, webhook_secret, github_installation_id, setup_status, setup_pr_url, setup_error, setup_progress, scout_schedule, autonomy_mode, max_concurrent_branches, paused')
    .eq('id', id)
    .single(),
  supabase
    .from('user_ideas')
    .select('*')
    .eq('project_id', id)
    .order('created_at', { ascending: false })
    .limit(50),
])
```

Pass `ideas` to the client:
```tsx
<SettingsPageClient
  ...existing props...
  initialIdeas={(ideas ?? []) as UserIdea[]}
/>
```

Import `UserIdea` type at the top.

**Step 2: Add internal tab bar to Settings client**

In `settings/client.tsx`:

1. Add `UserIdea` to the type import.
2. Add `initialIdeas` to the Props type.
3. Add a `tab` state: `const [tab, setTab] = useState<'config' | 'input'>('config')`
4. Move the "Strategic Nudges" section (Section 2) from config tab into the "Your Input" tab.
5. Add the ideas UI from the old Input page (Quick Idea submit box + ideas list) into the "Your Input" tab.
6. Add a "Manual Proposal" form (from old Input page) into the "Your Input" tab.

Add state for ideas and proposals at the top of the component:
```tsx
const [ideas, setIdeas] = useState(initialIdeas)
const [ideaText, setIdeaText] = useState('')
const [submittingIdea, setSubmittingIdea] = useState(false)
```

Add `submitIdea` handler:
```tsx
async function submitIdea() {
  if (!ideaText.trim()) return
  setSubmittingIdea(true)
  try {
    const res = await fetch(`/api/ideas/${projectId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: ideaText.trim() }),
    })
    if (res.ok) {
      const json = await res.json()
      setIdeas(prev => [json.idea, ...prev])
      setIdeaText('')
    }
  } finally {
    setSubmittingIdea(false)
  }
}
```

Add the tab bar at the top of the return, just below the back link + heading:
```tsx
{/* Internal tab bar */}
<div className="mb-8 flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-1 backdrop-blur-xl w-fit">
  <button
    onClick={() => setTab('config')}
    className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
      tab === 'config' ? 'bg-white/[0.08] text-fg' : 'text-muted hover:text-fg'
    }`}
  >
    Configuration
  </button>
  <button
    onClick={() => setTab('input')}
    className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
      tab === 'input' ? 'bg-white/[0.08] text-fg' : 'text-muted hover:text-fg'
    }`}
  >
    Your Input
  </button>
</div>
```

Wrap existing config sections (Product Context, Scout Schedule, Autonomy, Max Branches, Kill Switch, Setup) in `{tab === 'config' && (...)}`.

Create the "Your Input" tab content with `{tab === 'input' && (...)}` containing:
1. Strategic Nudges section (moved from config)
2. Quick Idea submit box
3. Manual Proposal form (optional — can be a link to proposals page)
4. Recent Ideas list

**Step 3: Verify the build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -20`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add packages/dashboard/src/app/projects/[id]/settings/
git commit -m "feat: add internal tabs to settings, merge Your Input"
```

---

### Task 4: Create Proposals Route (Move Minions)

**Files:**
- Create: `packages/dashboard/src/app/projects/[id]/proposals/page.tsx`
- Create: `packages/dashboard/src/app/projects/[id]/proposals/client.tsx`
- Create: `packages/dashboard/src/app/projects/[id]/proposals/proposals-tab.tsx`
- Create: `packages/dashboard/src/app/projects/[id]/proposals/pipeline-tab.tsx`

**Step 1: Copy files from minions to proposals**

The current `/projects/[id]/proposals/page.tsx` is a redirect to `/minions`. Replace it with the actual content from the minions directory. Copy all 4 files from `minions/` to `proposals/`, keeping the content identical except:
- Remove the "Your Input" section from `proposals-tab.tsx` (ideas and idea submit box), since that moved to Settings.
- The existing `proposals/page.tsx` redirect gets overwritten with the real page.

For `proposals/page.tsx`, use the same content as `minions/page.tsx` but remove the `ideas` fetch (no longer needed — ideas moved to Settings):

```tsx
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ProposalsPageClient } from './client'
import type { Proposal } from '@/lib/types'

export default async function ProposalsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, github_repo, github_installation_id')
    .eq('id', id)
    .single()

  if (!project) notFound()

  const [
    { data: proposals },
    { data: runs },
    { data: jobs },
  ] = await Promise.all([
    supabase
      .from('proposals')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('pipeline_runs')
      .select('id, github_issue_number, github_pr_number, stage, triggered_by, started_at, completed_at, result')
      .eq('project_id', id)
      .order('started_at', { ascending: false })
      .limit(50),
    supabase
      .from('job_queue')
      .select('id, project_id, job_type, status, github_issue_number')
      .eq('project_id', id)
      .in('status', ['pending', 'processing']),
  ])

  return (
    <div className="mx-auto max-w-6xl px-6 pt-10 pb-16">
      <ProposalsPageClient
        projectId={project.id}
        githubRepo={project.github_repo}
        proposals={(proposals ?? []) as Proposal[]}
        runs={runs ?? []}
        activeJobs={jobs ?? []}
      />
    </div>
  )
}
```

For `proposals/client.tsx`, rename `MinionsPageClient` to `ProposalsPageClient` and remove the `ideas` prop:

```tsx
'use client'

import { useState } from 'react'
import { Lightbulb, Workflow } from 'lucide-react'
import { ProposalsTab } from './proposals-tab'
import { PipelineTab } from './pipeline-tab'
import type { Proposal } from '@/lib/types'

// ... Run and Job types from minions/client.tsx ...

type Props = {
  projectId: string
  githubRepo: string | null
  proposals: Proposal[]
  runs: Run[]
  activeJobs: Job[]
}

const TABS = [
  { key: 'proposals', label: 'Proposals', icon: Lightbulb },
  { key: 'pipeline', label: 'Pipeline', icon: Workflow },
] as const

type TabKey = (typeof TABS)[number]['key']

export function ProposalsPageClient({ projectId, githubRepo, proposals, runs, activeJobs }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('proposals')

  return (
    <>
      <div className="mb-8 flex justify-center">
        <div className="inline-flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-1 backdrop-blur-xl">
          {TABS.map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-white/[0.08] text-fg' : 'text-muted hover:text-fg'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      {activeTab === 'proposals' ? (
        <ProposalsTab projectId={projectId} githubRepo={githubRepo} proposals={proposals} />
      ) : (
        <PipelineTab projectId={projectId} githubRepo={githubRepo} proposals={proposals} runs={runs} activeJobs={activeJobs} />
      )}
    </>
  )
}
```

For `proposals/proposals-tab.tsx`, copy from `minions/proposals-tab.tsx` but remove the "Your Input" section (quick idea box + ideas list + related state/handlers). Remove `ideas` from Props and all idea-related state.

For `proposals/pipeline-tab.tsx`, copy from `minions/pipeline-tab.tsx` as-is (no changes needed).

**Step 2: Verify the build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -20`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/projects/[id]/proposals/
git commit -m "feat: create proposals route from minions content"
```

---

### Task 5: Add Source Finding Links to Proposal Cards

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/proposals/proposals-tab.tsx`
- Modify: `packages/dashboard/src/app/projects/[id]/proposals/page.tsx` (fetch source findings)

**Step 1: Fetch source findings data**

In `proposals/page.tsx`, after fetching proposals, also fetch findings that are referenced by proposals. Build a map of finding IDs to titles.

Add to the parallel fetch:
```tsx
supabase
  .from('findings')
  .select('id, title, category')
  .eq('project_id', id),
```

Pass the findings to the client as `sourceFindings`.

**Step 2: Show source links on ProposalCard**

In `proposals/proposals-tab.tsx`, update `ProposalCard` to accept an optional `sourceFindings` map and display source badges. If `proposal.source_finding_ids` has entries, show them as small linked chips:

```tsx
{proposal.source_finding_ids.length > 0 && sourceFindings && (
  <div className="mt-1 flex items-center gap-1 flex-wrap">
    {proposal.source_finding_ids.slice(0, 3).map(fid => {
      const finding = sourceFindings.get(fid)
      if (!finding) return null
      return (
        <span key={fid} className="rounded-full bg-white/[0.06] px-1.5 py-0.5 text-[9px] text-muted">
          {finding.category.replace('_', ' ')}
        </span>
      )
    })}
    {proposal.source_finding_ids.length > 3 && (
      <span className="text-[9px] text-dim">+{proposal.source_finding_ids.length - 3}</span>
    )}
  </div>
)}
```

If `proposal.source_finding_ids` is empty and proposal has no scores (user-created), show the existing "User" badge.

**Step 3: Verify the build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -20`
Expected: Build succeeds.

**Step 4: Commit**

```bash
git add packages/dashboard/src/app/projects/[id]/proposals/
git commit -m "feat: show source finding links on proposal cards"
```

---

### Task 6: Update All Redirects

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/kanban/page.tsx` (redirect to `/proposals`)
- Modify: `packages/dashboard/src/app/projects/[id]/minions/page.tsx` (redirect to `/proposals`)
- Create: `packages/dashboard/src/app/projects/[id]/health/page.tsx` (redirect to `/findings`)
- Create: `packages/dashboard/src/app/projects/[id]/input/page.tsx` (redirect to `/settings`)

**Step 1: Update kanban redirect**

Change `kanban/page.tsx` from redirecting to `/minions` to redirecting to `/proposals`:

```tsx
import { redirect } from 'next/navigation'

export default async function KanbanPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/projects/${id}/proposals`)
}
```

**Step 2: Convert minions to redirect**

Replace `minions/page.tsx` (currently the full page) with a redirect. Delete the client files (`client.tsx`, `proposals-tab.tsx`, `pipeline-tab.tsx`) since the content now lives under `/proposals/`.

```tsx
import { redirect } from 'next/navigation'

export default async function MinionsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/projects/${id}/proposals`)
}
```

Delete:
- `packages/dashboard/src/app/projects/[id]/minions/client.tsx`
- `packages/dashboard/src/app/projects/[id]/minions/proposals-tab.tsx`
- `packages/dashboard/src/app/projects/[id]/minions/pipeline-tab.tsx`

**Step 3: Convert health page to redirect**

Replace `health/page.tsx` with a redirect. Delete `health/client.tsx`:

```tsx
import { redirect } from 'next/navigation'

export default async function HealthPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/projects/${id}/findings`)
}
```

Delete: `packages/dashboard/src/app/projects/[id]/health/client.tsx`

**Step 4: Convert input page to redirect**

Replace `input/page.tsx` with a redirect. Delete `input/client.tsx`:

```tsx
import { redirect } from 'next/navigation'

export default async function InputPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  redirect(`/projects/${id}/settings`)
}
```

Delete: `packages/dashboard/src/app/projects/[id]/input/client.tsx`

**Step 5: Verify the build**

Run: `cd packages/dashboard && npx next build 2>&1 | tail -20`
Expected: Build succeeds with no errors.

**Step 6: Commit**

```bash
git add -A packages/dashboard/src/app/projects/[id]/
git commit -m "refactor: update redirects — health, input, kanban, minions all redirect to new routes"
```

---

### Task 7: Final Build & Smoke Test

**Files:** None (verification only)

**Step 1: Full build**

Run: `npm run build`
Expected: All packages build successfully.

**Step 2: Verify route structure**

List all page files to confirm the final route structure:

```bash
find packages/dashboard/src/app/projects -name 'page.tsx' | sort
```

Expected routes:
- `[id]/page.tsx` — Activity (Graph)
- `[id]/findings/page.tsx` — Findings with health bar
- `[id]/proposals/page.tsx` — Proposals (from minions)
- `[id]/settings/page.tsx` — Settings with internal tabs
- `[id]/health/page.tsx` — redirect to findings
- `[id]/input/page.tsx` — redirect to settings
- `[id]/kanban/page.tsx` — redirect to proposals
- `[id]/minions/page.tsx` — redirect to proposals
- `[id]/runs/[runId]/page.tsx` — run detail (unchanged)

**Step 3: Commit any remaining changes**

```bash
git add -A && git status
# If clean, no commit needed
```

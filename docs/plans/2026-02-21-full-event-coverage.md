# Full Branch Event Coverage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `branch_events` the single source of truth for all agent activity by emitting all 16 event types at every lifecycle point.

**Architecture:** Add `branch_events` inserts at every worker transition point (strategize, build, review), in the proposals API (approve/reject), and in the GitHub webhook handler (PR merge). Also fix the ScheduledPanel duplicate polling and pass data from the parent.

**Tech Stack:** TypeScript, Supabase client, Octokit, Next.js API routes

---

## Event Coverage Matrix (current vs target)

| Event Type | Currently Emitted | Target Emission Point |
|---|---|---|
| `scout_finding` | `scout-worker.ts:401` | No change |
| `proposal_created` | NEVER | `strategize-worker.ts` after proposal insert |
| `proposal_approved` | NEVER | `proposals/route.ts` PATCH approve handler |
| `proposal_rejected` | NEVER | `proposals/route.ts` PATCH reject handler |
| `build_started` | NEVER | `managed-worker.ts` before `runBuilderJob()` |
| `build_completed` | `builder-worker.ts:252` | No change |
| `build_failed` | `builder-worker.ts:191,214` | No change |
| `build_remediation` | NEVER | `builder-worker.ts` inside remediation loop |
| `review_started` | NEVER | `managed-worker.ts` before `runReviewerJob()` |
| `review_approved` | `reviewer-worker.ts:274` | No change |
| `review_rejected` | `reviewer-worker.ts:274` | No change |
| `pr_created` | NEVER | `builder-worker.ts` after `octokit.pulls.create()` |
| `pr_merged` | NEVER | `webhook/route.ts` handlePR for proposal branches |
| `deploy_preview` | NEVER | Future (no deploy pipeline yet) - skip |
| `deploy_production` | NEVER | Future (no deploy pipeline yet) - skip |
| `branch_deleted` | NEVER | Future - skip |

**Out of scope:** `deploy_preview`, `deploy_production`, `branch_deleted` - no code path exists for these today. We'll add them when deploy tracking is built.

---

### Task 1: Emit `proposal_created` in strategize-worker

**Files:**
- Modify: `packages/agent/src/strategize-worker.ts:199-213`

**Step 1: Add `branch_events` insert after successful proposal insert**

After the existing proposal insert at line 199, add a `proposal_created` branch event. The branch name comes from the proposal title slug (matching the pattern used by the builder later). Since the branch doesn't exist yet at this point, use `main` as the branch name - the graph groups unbranched events separately.

In `strategize-worker.ts`, after the `if (error) {...} else {...}` block at line 209-213, add inside the else block:

```typescript
// Inside the else block after successful proposal insert (line 211-213)
// We need the inserted proposal's ID, so change the insert to return it

// Emit proposal_created branch event
await supabase.from('branch_events').insert({
  project_id: projectId,
  branch_name: 'main',
  event_type: 'proposal_created',
  event_data: {
    proposal_title: raw.title,
    scores,
    priority: raw.priority === 'high' ? 'high' : raw.priority === 'low' ? 'low' : 'medium',
    source_finding_count: sourceFindingIds.length,
  },
  actor: 'strategist',
})
```

The insert at line 199 needs to be changed to return the inserted row:
```typescript
const { data: inserted, error } = await supabase.from('proposals').insert({...}).select('id').single()
```

Then include `proposal_id: inserted.id` in the event_data.

**Step 2: Run build to verify**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/agent/src/strategize-worker.ts
git commit -m "feat: emit proposal_created branch event from strategize worker"
```

---

### Task 2: Emit `proposal_approved` and `proposal_rejected` in proposals API

**Files:**
- Modify: `packages/dashboard/src/app/api/proposals/[projectId]/route.ts:102-176`

**Step 1: Add `branch_events` insert in the reject handler**

After the strategy_memory insert at line 117-124, add:

```typescript
// Emit proposal_rejected branch event
await supabase.from('branch_events').insert({
  project_id: projectId,
  branch_name: 'main',
  event_type: 'proposal_rejected',
  event_data: {
    proposal_id: proposalId,
    proposal_title: proposal.title,
    reject_reason: rejectReason || null,
  },
  actor: 'user',
})
```

Note: We use the `supabase` client from `createClient()` (server-side, already available in this handler). The import is already there.

**Step 2: Add `branch_events` insert in the approve handler**

After the strategy_memory insert at line 165-173, add:

```typescript
// Emit proposal_approved branch event
await supabase.from('branch_events').insert({
  project_id: projectId,
  branch_name: branchName || 'main',
  event_type: 'proposal_approved',
  event_data: {
    proposal_id: proposalId,
    proposal_title: proposal.title,
    github_issue_number: issueNumber,
    branch_name: branchName || null,
    user_notes: userNotes || null,
  },
  actor: 'user',
})
```

**Step 3: Run build to verify**

Run: `cd packages/dashboard && npx next build`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/dashboard/src/app/api/proposals/[projectId]/route.ts
git commit -m "feat: emit proposal_approved/rejected branch events from proposals API"
```

---

### Task 3: Emit `build_started` and `review_started` in managed-worker

**Files:**
- Modify: `packages/agent/src/managed-worker.ts:312-365`

**Step 1: Add `build_started` event before `runBuilderJob()`**

In the `processJob` function, in the `job.job_type === 'build'` branch (line 312), after parsing the payload and before calling `runBuilderJob`, add:

```typescript
// Emit build_started event
await supabase.from('branch_events').insert({
  project_id: job.project_id,
  branch_name: payload.branch_name,
  event_type: 'build_started',
  event_data: {
    proposal_id: payload.proposal_id,
    title: payload.title || job.issue_title,
  },
  actor: 'builder',
})
```

Insert this between lines 319-320 (after the payload validation, before `runBuilderJob`).

**Step 2: Add `review_started` event before `runReviewerJob()`**

In the `job.job_type === 'review'` branch (line 348), after parsing the payload and before calling `runReviewerJob`, add:

```typescript
// Emit review_started event
await supabase.from('branch_events').insert({
  project_id: job.project_id,
  branch_name: payload.branch_name,
  event_type: 'review_started',
  event_data: {
    proposal_id: payload.proposal_id,
    pr_number: payload.pr_number,
    head_sha: payload.head_sha,
  },
  actor: 'reviewer',
})
```

Insert this between lines 354-357 (after payload validation, before `runReviewerJob`).

**Step 3: Run build to verify**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/agent/src/managed-worker.ts
git commit -m "feat: emit build_started and review_started branch events"
```

---

### Task 4: Emit `pr_created` in builder-worker

**Files:**
- Modify: `packages/agent/src/builder-worker.ts:249-262`

**Step 1: Add `pr_created` event after PR creation, before `build_completed`**

Between the `logger.event` at line 249 and the `build_completed` insert at line 252, add:

```typescript
// Emit pr_created event
await supabase.from('branch_events').insert({
  project_id: projectId,
  branch_name: branchName,
  event_type: 'pr_created',
  event_data: {
    proposal_id: proposalId,
    pr_number: pr.number,
    pr_url: pr.html_url,
    head_sha: headSha,
  },
  actor: 'builder',
})
```

This goes between lines 249-251 (after `logger.event('text', 'PR created...')`, before the existing `build_completed` event insert).

**Step 2: Run build to verify**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/agent/src/builder-worker.ts
git commit -m "feat: emit pr_created branch event when builder opens PR"
```

---

### Task 5: Emit `build_remediation` in builder-worker

**Files:**
- Modify: `packages/agent/src/builder-worker.ts:171-185`

**Step 1: Add `build_remediation` event inside the remediation loop**

Inside the `for` loop at line 171, after the `logger.event` at line 172 and before calling `runClaude`, add:

```typescript
// Emit build_remediation event
await supabase.from('branch_events').insert({
  project_id: projectId,
  branch_name: branchName,
  event_type: 'build_remediation',
  event_data: {
    proposal_id: proposalId,
    attempt,
    stage: validationResult.stage,
    error: validationResult.errorOutput.slice(-1000),
  },
  actor: 'builder',
})
```

Insert after line 172 (the logger.event line), before line 174 (the fixPrompt definition).

**Step 2: Run build to verify**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/agent/src/builder-worker.ts
git commit -m "feat: emit build_remediation branch event during retry loop"
```

---

### Task 6: Handle `pr_merged` in GitHub webhook

**Files:**
- Modify: `packages/dashboard/src/app/api/github-app/webhook/route.ts:164-186`

**Step 1: Expand `handlePR` to track proposal branch merges**

The current handler only checks for setup PR merges (line 177: `headRef === 'feedback-chat/setup'`). We need to also handle proposal branch merges.

Replace the `handlePR` function (lines 164-186) with:

```typescript
async function handlePR(
  supabase: ReturnType<typeof supabaseAdmin>,
  projectId: string,
  payload: Record<string, unknown>,
) {
  if ((payload.action as string) !== 'closed') {
    return NextResponse.json({ status: 'ignored' })
  }

  const pr = payload.pull_request as Record<string, unknown>
  const merged = pr?.merged as boolean
  const headRef = (pr?.head as Record<string, unknown>)?.ref as string
  const prNumber = pr?.number as number
  const mergeCommitSha = pr?.merge_commit_sha as string | null

  // Setup PR completion (existing logic)
  if (merged && headRef === 'feedback-chat/setup') {
    await supabase
      .from('projects')
      .update({ setup_status: 'complete' })
      .eq('id', projectId)
    return NextResponse.json({ status: 'setup_complete' })
  }

  // Proposal branch merged — emit pr_merged event
  if (merged && headRef) {
    await supabase.from('branch_events').insert({
      project_id: projectId,
      branch_name: headRef,
      event_type: 'pr_merged',
      event_data: {
        pr_number: prNumber,
        merge_commit_sha: mergeCommitSha,
      },
      actor: 'github',
    })

    // Update proposal status if this branch is linked to a proposal
    await supabase
      .from('proposals')
      .update({ status: 'done', completed_at: new Date().toISOString() })
      .eq('project_id', projectId)
      .eq('branch_name', headRef)
      .eq('status', 'implementing')

    return NextResponse.json({ status: 'pr_merged' })
  }

  return NextResponse.json({ status: 'ignored' })
}
```

**Step 2: Run build to verify**

Run: `cd packages/dashboard && npx next build`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/dashboard/src/app/api/github-app/webhook/route.ts
git commit -m "feat: emit pr_merged branch event when proposal PRs are merged"
```

---

### Task 7: Fix ScheduledPanel duplicate polling

**Files:**
- Modify: `packages/dashboard/src/components/graph-page-client.tsx`
- Modify: `packages/dashboard/src/components/scheduled-panel.tsx`

**Step 1: Pass scheduled data from GraphPageClient to ScheduledPanel**

In `graph-page-client.tsx`, change the ScheduledPanel usage to pass data:

```typescript
<ScheduledPanel projectId={projectId} initialData={data?.scheduled} />
```

The `ScheduledPanel` already accepts `initialData` and skips its own fetch when it's provided (line 93: `if (initialData) return`). However, `initialData` is only set on mount. We need it to update when the parent re-fetches.

**Step 2: Update ScheduledPanel to accept live data prop**

In `scheduled-panel.tsx`, change the component to use the prop directly when provided, updating on every render:

```typescript
export function ScheduledPanel({
  projectId,
  initialData,
}: {
  projectId: string
  initialData?: ScheduledData
}) {
  const [data, setData] = useState<ScheduledData | null>(initialData || null)

  // Sync from parent when initialData changes
  useEffect(() => {
    if (initialData) setData(initialData)
  }, [initialData])

  // Only self-poll if no initialData is provided
  useEffect(() => {
    if (initialData) return
    // ... existing polling logic unchanged ...
  }, [projectId, initialData])
```

**Step 3: Run build to verify**

Run: `cd packages/dashboard && npx next build`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/dashboard/src/components/graph-page-client.tsx packages/dashboard/src/components/scheduled-panel.tsx
git commit -m "fix: eliminate duplicate polling by passing scheduled data from parent"
```

---

### Task 8: Verify full pipeline with typecheck + build

**Step 1: Run agent package typecheck**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: PASS with no errors

**Step 2: Run dashboard build**

Run: `cd packages/dashboard && npx next build`
Expected: PASS

**Step 3: Final commit with all changes**

If any files were missed in previous commits, stage and commit them now.

---

## Summary of Changes

| File | Events Added |
|---|---|
| `packages/agent/src/strategize-worker.ts` | `proposal_created` |
| `packages/agent/src/managed-worker.ts` | `build_started`, `review_started` |
| `packages/agent/src/builder-worker.ts` | `pr_created`, `build_remediation` |
| `packages/dashboard/src/app/api/proposals/[projectId]/route.ts` | `proposal_approved`, `proposal_rejected` |
| `packages/dashboard/src/app/api/github-app/webhook/route.ts` | `pr_merged` |
| `packages/dashboard/src/components/graph-page-client.tsx` | Pass data to ScheduledPanel |
| `packages/dashboard/src/components/scheduled-panel.tsx` | Accept live data prop |

**After this:** 13 of 16 event types will be emitted. The remaining 3 (`deploy_preview`, `deploy_production`, `branch_deleted`) require new infrastructure (deploy webhooks, branch cleanup) that doesn't exist yet.

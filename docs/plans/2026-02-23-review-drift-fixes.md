# Review Drift Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 8 verified drift issues that break the autonomy loop, waste retry budget, and drop logs.

**Architecture:** All fixes are surgical edits to existing files — no new modules. One new SQL migration aligns CHECK constraints. Runtime code changes fix payloads, logger wiring, paused-job handling, and dead enqueue paths.

**Tech Stack:** TypeScript (agent package), SQL (Supabase migration), Vitest (tests)

---

### Task 1: Migration — Align DB constraints with runtime values

**Files:**
- Create: `packages/dashboard/supabase/migrations/00018_fix_constraints.sql`

**Step 1: Write the migration**

```sql
-- Fix CHECK constraints to match runtime values

-- 1. Add fix_build to job_type constraint
ALTER TABLE feedback_chat.job_queue DROP CONSTRAINT IF EXISTS job_queue_job_type_check;
ALTER TABLE feedback_chat.job_queue ADD CONSTRAINT job_queue_job_type_check
  CHECK (job_type IN ('agent', 'setup', 'self_improve', 'strategize', 'scout', 'build', 'review', 'fix_build', 'merge'));

-- 2. Add branch_updated and merge_conflict to event_type constraint
ALTER TABLE feedback_chat.branch_events DROP CONSTRAINT IF EXISTS branch_events_event_type_check;
ALTER TABLE feedback_chat.branch_events ADD CONSTRAINT branch_events_event_type_check
  CHECK (event_type IN (
    'scout_finding', 'proposal_created', 'proposal_approved', 'proposal_rejected',
    'build_started', 'build_completed', 'build_failed', 'build_remediation',
    'review_started', 'review_approved', 'review_rejected',
    'pr_created', 'pr_merged',
    'deploy_preview', 'deploy_production',
    'branch_deleted',
    'auto_approved', 'auto_merged', 'merge_failed',
    'cycle_started', 'cycle_completed',
    'checkpoint_created', 'checkpoint_reverted',
    -- New: conflict resolution events
    'branch_updated', 'merge_conflict'
  ));
```

**Step 2: Apply directly to production via Supabase MCP**

Run this SQL directly (replacing `feedback_chat` with `minions`):

```sql
ALTER TABLE minions.job_queue DROP CONSTRAINT IF EXISTS job_queue_job_type_check;
ALTER TABLE minions.job_queue ADD CONSTRAINT job_queue_job_type_check
  CHECK (job_type IN ('agent', 'setup', 'self_improve', 'strategize', 'scout', 'build', 'review', 'fix_build', 'merge'));

ALTER TABLE minions.branch_events DROP CONSTRAINT IF EXISTS branch_events_event_type_check;
ALTER TABLE minions.branch_events ADD CONSTRAINT branch_events_event_type_check
  CHECK (event_type IN (
    'scout_finding', 'proposal_created', 'proposal_approved', 'proposal_rejected',
    'build_started', 'build_completed', 'build_failed', 'build_remediation',
    'review_started', 'review_approved', 'review_rejected',
    'pr_created', 'pr_merged',
    'deploy_preview', 'deploy_production',
    'branch_deleted',
    'auto_approved', 'auto_merged', 'merge_failed',
    'cycle_started', 'cycle_completed',
    'checkpoint_created', 'checkpoint_reverted',
    'branch_updated', 'merge_conflict'
  ));
```

**Step 3: Commit**

```bash
git add packages/dashboard/supabase/migrations/00018_fix_constraints.sql
git commit -m "fix(schema): add fix_build, branch_updated, merge_conflict to CHECK constraints"
```

---

### Task 2: Fix `result: 'failure'` → `result: 'failed'`

**Files:**
- Modify: `packages/agent/src/managed-worker.ts:540`

**Step 1: Fix the enum value**

At line 540, change `result: 'failure'` to `result: 'failed'`:

```typescript
// BEFORE (line 540):
.update({ stage: 'failed', completed_at: new Date().toISOString(), result: 'failure' })

// AFTER:
.update({ stage: 'failed', completed_at: new Date().toISOString(), result: 'failed' })
```

**Step 2: Verify build**

Run: `cd packages/agent && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```bash
git add packages/agent/src/managed-worker.ts
git commit -m "fix: use 'failed' not 'failure' for pipeline_runs.result enum"
```

---

### Task 3: Fix conflict re-review missing `head_sha`

**Files:**
- Modify: `packages/agent/src/autonomy.ts:298-324`

**Step 1: Fetch updated HEAD SHA after branch update, include in review payload**

After the successful `update-branch` API call (line 298), the PR's HEAD has changed. We need to fetch the new SHA before queuing the review. Replace lines 300-324:

```typescript
          // Branch updated successfully — fetch new HEAD and re-trigger review
          const { data: updatedPr } = await octokit.pulls.get({
            owner,
            repo: repoName,
            pull_number: payload.pr_number,
          })
          const newHeadSha = updatedPr.head.sha

          console.log(`[autonomy] Branch updated via API — re-queuing review for PR #${payload.pr_number} (new HEAD: ${newHeadSha.slice(0, 7)})`)
          await notifySlack(`🔀 *Conflict resolved* via branch update — re-reviewing ${ghPrLink(repo, payload.pr_number)}`)
          await supabase.from('branch_events').insert({
            project_id: projectId,
            branch_name: payload.branch_name,
            event_type: 'branch_updated',
            event_data: { pr_number: payload.pr_number, reason: 'conflict_resolution', new_head_sha: newHeadSha },
            actor: 'autonomy',
          })

          // Re-queue review with the NEW head SHA
          await supabase.from('job_queue').insert({
            project_id: projectId,
            github_issue_number: 0,
            issue_title: `Re-review PR #${payload.pr_number} after conflict resolution`,
            issue_body: JSON.stringify({
              proposal_id: payload.proposal_id,
              pr_number: payload.pr_number,
              head_sha: newHeadSha,
              branch_name: payload.branch_name,
              remediation_attempt: 0,
            }),
            job_type: 'review',
            status: 'pending',
          })
          return
```

**Step 2: Verify build**

Run: `cd packages/agent && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/agent/src/autonomy.ts
git commit -m "fix: include head_sha in conflict re-review payload"
```

---

### Task 4: Fix logger FK mismatch + add error handling

**Files:**
- Modify: `packages/agent/src/logger.ts`
- Modify: `packages/agent/src/builder-worker.ts:85`
- Modify: `packages/agent/src/reviewer-worker.ts:74-75`
- Modify: `packages/agent/src/managed-worker.ts` (pass runId to workers)

**Step 1: Add error handling to logger**

In `packages/agent/src/logger.ts`, add error checking to both write methods:

```typescript
  async log(message: string, level = 'info') {
    console.log(`[${level}] ${message}`)
    const { error } = await this.supabase.from('run_logs').insert({
      run_id: this.runId,
      level,
      message,
    })
    if (error) console.error(`[logger] Failed to write log: ${error.message}`)
  }

  async event(eventType: LogEventType, message: string, payload?: LogPayload) {
    console.log(`[${eventType}] ${message}`)
    const { error } = await this.supabase.from('run_logs').insert({
      run_id: this.runId,
      level: eventType === 'error' ? 'error' : 'info',
      message,
      event_type: eventType,
      payload: payload ?? null,
    })
    if (error) console.error(`[logger] Failed to write log: ${error.message}`)
  }
```

**Step 2: Add `pipelineRunId` to BuilderInput and ReviewerInput**

In `builder-worker.ts`, add to `BuilderInput` interface:

```typescript
export interface BuilderInput {
  jobId: string
  projectId: string
  proposalId: string
  branchName: string
  spec: string
  title: string
  pipelineRunId?: string    // <-- add this
  supabase: Supabase
}
```

At line 85, use `pipelineRunId` when available:

```typescript
const logger = new DbLogger(supabase, input.pipelineRunId ?? jobId)
```

In `reviewer-worker.ts`, add to `ReviewerInput` interface:

```typescript
export interface ReviewerInput {
  jobId: string
  projectId: string
  proposalId: string
  prNumber: number
  headSha: string
  branchName: string
  pipelineRunId?: string    // <-- add this
  supabase: Supabase
}
```

At line 75, use `pipelineRunId` when available:

```typescript
const logger = new DbLogger(supabase, input.pipelineRunId ?? jobId)
```

Similarly for `FixBuildInput` in `builder-worker.ts`:

```typescript
export interface FixBuildInput {
  jobId: string
  projectId: string
  proposalId: string
  prNumber: number
  branchName: string
  reviewSummary: string
  reviewConcerns: Array<{ file: string; line?: number; severity: string; comment: string }>
  pipelineRunId?: string    // <-- add this
  supabase: Supabase
}
```

At the logger init in `runFixBuildJob`, use the same pattern:

```typescript
const logger = new DbLogger(supabase, input.pipelineRunId ?? jobId)
```

**Step 3: Pass `pipelineRunId` from managed-worker.ts**

For the `build` branch (line 479), `buildRunId` is already resolved at line 463. Pass it:

```typescript
const result = await runBuilderJob({
  jobId: job.id,
  projectId: job.project_id,
  proposalId: payload.proposal_id,
  branchName: payload.branch_name,
  spec: payload.spec,
  title: payload.title || job.issue_title,
  pipelineRunId: buildRunId,    // <-- add this
  supabase,
})
```

For the `review` branch (line 567), look up the run ID before calling the reviewer:

```typescript
    } else if (job.job_type === 'review') {
      // ... payload parsing ...

      // Find pipeline run for this review
      let reviewRunId: string | undefined
      try {
        reviewRunId = await findRunId(supabase, job.project_id, job.github_issue_number, job.id)
      } catch { /* no run found — logger will fall back to jobId */ }

      // ... branch_events insert ...

      const reviewResult = await runReviewerJob({
        jobId: job.id,
        projectId: job.project_id,
        proposalId: payload.proposal_id,
        prNumber: payload.pr_number,
        headSha: payload.head_sha,
        branchName: payload.branch_name,
        pipelineRunId: reviewRunId,    // <-- add this
        supabase,
      })
```

For the `fix_build` branch (line 685), similarly look up the run ID:

```typescript
      let fixRunId: string | undefined
      try {
        fixRunId = await findRunId(supabase, job.project_id, job.github_issue_number, job.id)
      } catch { /* no run found */ }

      const result = await runFixBuildJob({
        // ... existing params ...
        pipelineRunId: fixRunId,    // <-- add this
        supabase,
      })
```

**Step 4: Verify build**

Run: `cd packages/agent && npx tsc --noEmit`

**Step 5: Commit**

```bash
git add packages/agent/src/logger.ts packages/agent/src/builder-worker.ts packages/agent/src/reviewer-worker.ts packages/agent/src/managed-worker.ts
git commit -m "fix: logger uses pipeline_run_id, add error handling for log writes"
```

---

### Task 5: Fix paused jobs burning retry budget

**Files:**
- Modify: `packages/agent/src/managed-worker.ts:371-379`

**Step 1: Decrement attempt_count when releasing paused job**

Replace the paused-job handling block (lines 371-379):

```typescript
    if (project.paused) {
      console.log(`[${WORKER_ID}] Project ${job.project_id} is paused — releasing job back to pending`)
      await supabase.from('job_queue').update({
        status: 'pending',
        worker_id: null,
        locked_at: null,
        attempt_count: Math.max(0, (job.attempt_count ?? 1) - 1),
      }).eq('id', job.id)
      return
    }
```

This restores the attempt_count that `claim_next_job` incremented, so paused jobs don't burn retries.

**Step 2: Verify build**

Run: `cd packages/agent && npx tsc --noEmit`

**Step 3: Commit**

```bash
git add packages/agent/src/managed-worker.ts
git commit -m "fix: paused jobs don't burn retry budget (restore attempt_count on release)"
```

---

### Task 6: Remove dead job enqueue paths

**Files:**
- Modify: `packages/dashboard/src/app/projects/[id]/actions.ts`
- Modify: `packages/dashboard/src/app/api/webhook/[projectId]/route.ts`

**Step 1: Disable triggerSetup action**

In `actions.ts`, replace the `triggerSetup` function body to return an error (don't delete the export — UI may reference it):

```typescript
export async function triggerSetup(projectId: string) {
  // Setup worker was removed — setup is no longer handled by the agent pipeline
  return { error: 'Setup is not available. Configure your project via the Settings page.' }
}
```

**Step 2: Fix webhook default path**

In `route.ts`, the else branch at line 115-123 inserts a job with no `job_type`, which the worker can't handle. Replace it to reject unlinked issues:

```typescript
  } else {
    // No matching proposal — skip (only proposal-driven builds are supported)
    return NextResponse.json({ status: 'ignored', reason: 'no_matching_proposal' })
  }
```

**Step 3: Verify dashboard build**

Run: `cd packages/dashboard && npx next build` (or `npx tsc --noEmit`)

**Step 4: Commit**

```bash
git add packages/dashboard/src/app/projects/[id]/actions.ts packages/dashboard/src/app/api/webhook/[projectId]/route.ts
git commit -m "fix: remove dead setup/agent job enqueue paths"
```

---

### Task 7: Use `default_branch` instead of hardcoded `'main'`

**Files:**
- Modify: `packages/agent/src/builder-worker.ts:88-92, 314, 376-380, 413`

**Step 1: Fetch `default_branch` in runBuilderJob**

At line 89, add `default_branch` to the select:

```typescript
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo, github_installation_id, default_branch')
    .eq('id', projectId)
    .single()
```

At line 314, use it for PR base:

```typescript
  const { data: pr } = await pushOctokit.pulls.create({
    owner,
    repo,
    title: `feat: ${title}`,
    body: `...`,
    head: branchName,
    base: (project as any).default_branch || 'main',
  })
```

**Step 2: Fetch `default_branch` in runFixBuildJob**

At line 377, add `default_branch` to the select:

```typescript
  const { data: project } = await supabase
    .from('projects')
    .select('github_repo, github_installation_id, default_branch')
    .eq('id', projectId)
    .single()
```

At line 413, use it for the merge target:

```typescript
  const defaultBranch = (project as any).default_branch || 'main'
  // ... later:
  execFileSync('git', ['fetch', 'origin', defaultBranch, '--depth=50'], { ... })
  // ... and:
  execFileSync('git', ['merge', `origin/${defaultBranch}`, '--no-edit'], { ... })
```

**Step 3: Verify build**

Run: `cd packages/agent && npx tsc --noEmit`

**Step 4: Commit**

```bash
git add packages/agent/src/builder-worker.ts
git commit -m "fix: use project.default_branch instead of hardcoded 'main' for PR base and merge target"
```

---

### Task 8: Run full build + tests

**Step 1: Build all packages**

Run: `npm run build` from repo root.
Expected: Clean build, no errors.

**Step 2: Run tests**

Run: `npm run test` from repo root.
Expected: All existing tests pass (no regressions).

**Step 3: Final commit if any fixes needed**

If build/tests surface issues, fix and commit.

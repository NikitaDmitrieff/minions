-- Autonomy loop: auto-approve, auto-merge, cycle tracking, checkpoints

-- 1. Add cycle_id and is_wild_card to proposals
ALTER TABLE feedback_chat.proposals
  ADD COLUMN IF NOT EXISTS cycle_id uuid,
  ADD COLUMN IF NOT EXISTS is_wild_card boolean NOT NULL DEFAULT false;

-- 2. Add wild_card_frequency and merge_in_progress to projects
ALTER TABLE feedback_chat.projects
  ADD COLUMN IF NOT EXISTS wild_card_frequency real NOT NULL DEFAULT 0.2,
  ADD COLUMN IF NOT EXISTS merge_in_progress boolean NOT NULL DEFAULT false;

-- 3. Expand branch_events event_type CHECK to include autonomy events
ALTER TABLE feedback_chat.branch_events DROP CONSTRAINT IF EXISTS branch_events_event_type_check;
ALTER TABLE feedback_chat.branch_events ADD CONSTRAINT branch_events_event_type_check
  CHECK (event_type IN (
    'scout_finding', 'proposal_created', 'proposal_approved', 'proposal_rejected',
    'build_started', 'build_completed', 'build_failed', 'build_remediation',
    'review_started', 'review_approved', 'review_rejected',
    'pr_created', 'pr_merged',
    'deploy_preview', 'deploy_production',
    'branch_deleted',
    -- New autonomy events
    'auto_approved', 'auto_merged', 'merge_failed',
    'cycle_started', 'cycle_completed',
    'checkpoint_created', 'checkpoint_reverted'
  ));

-- 4. Expand job_queue job_type CHECK to include merge
ALTER TABLE feedback_chat.job_queue DROP CONSTRAINT IF EXISTS job_queue_job_type_check;
ALTER TABLE feedback_chat.job_queue ADD CONSTRAINT job_queue_job_type_check
  CHECK (job_type IN ('agent', 'setup', 'self_improve', 'strategize', 'scout', 'build', 'review', 'merge'));

-- 5. Create checkpoints table
CREATE TABLE IF NOT EXISTS feedback_chat.checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES feedback_chat.projects(id) ON DELETE CASCADE,
  cycle_id uuid,
  proposal_id uuid REFERENCES feedback_chat.proposals(id) ON DELETE SET NULL,
  checkpoint_type text NOT NULL CHECK (checkpoint_type IN ('merge', 'cycle_complete')),
  commit_sha text NOT NULL,
  pr_number integer,
  branch_name text,
  revert_pr_number integer,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_checkpoints_project_cycle
  ON feedback_chat.checkpoints(project_id, cycle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_checkpoints_project_recent
  ON feedback_chat.checkpoints(project_id, created_at DESC);

-- RLS
ALTER TABLE feedback_chat.checkpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checkpoints_all_own_project"
  ON feedback_chat.checkpoints
  FOR ALL USING (project_id IN (SELECT id FROM feedback_chat.projects WHERE user_id = auth.uid()));

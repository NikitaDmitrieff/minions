-- Branch events: timeline of actions on project branches
-- Used for the Graph page visualization and event slide-over

CREATE TABLE IF NOT EXISTS feedback_chat.branch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES feedback_chat.projects(id) ON DELETE CASCADE,
  branch_name text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'scout_run', 'proposal_created', 'build_started', 'build_succeeded',
    'build_failed', 'review_requested', 'review_approved', 'review_rejected',
    'merged', 'deployed', 'build_remediation'
  )),
  commit_sha text,
  payload jsonb DEFAULT '{}',
  actor text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fetching events on a branch (timeline view)
CREATE INDEX IF NOT EXISTS idx_branch_events_project_branch
  ON feedback_chat.branch_events(project_id, branch_name, created_at DESC);

-- Index for fetching all recent events for a project (graph view)
CREATE INDEX IF NOT EXISTS idx_branch_events_project_recent
  ON feedback_chat.branch_events(project_id, created_at DESC);

-- RLS
ALTER TABLE feedback_chat.branch_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "branch_events_all_own_project"
  ON feedback_chat.branch_events
  FOR ALL USING (project_id IN (SELECT id FROM feedback_chat.projects WHERE user_id = auth.uid()));

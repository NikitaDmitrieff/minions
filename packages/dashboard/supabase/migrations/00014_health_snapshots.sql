-- Health snapshots: periodic score computed by Scout after each analysis run
-- Stores per-category breakdown and an overall 0-100 score

CREATE TABLE IF NOT EXISTS feedback_chat.health_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES feedback_chat.projects(id) ON DELETE CASCADE,
  score int NOT NULL CHECK (score >= 0 AND score <= 100),
  breakdown jsonb NOT NULL DEFAULT '{}',
  findings_open int NOT NULL DEFAULT 0,
  findings_addressed int NOT NULL DEFAULT 0,
  snapshot_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Only one snapshot per project per day (prevent duplicate runs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_health_snapshots_project_day
  ON feedback_chat.health_snapshots(project_id, snapshot_date);

-- Index for fetching latest snapshot per project
CREATE INDEX IF NOT EXISTS idx_health_snapshots_project_latest
  ON feedback_chat.health_snapshots(project_id, snapshot_date DESC);

-- RLS
ALTER TABLE feedback_chat.health_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "health_snapshots_all_own_project"
  ON feedback_chat.health_snapshots
  FOR ALL USING (project_id IN (SELECT id FROM feedback_chat.projects WHERE user_id = auth.uid()));

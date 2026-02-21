-- New project columns for minions system
ALTER TABLE feedback_chat.projects
  ADD COLUMN IF NOT EXISTS repo_url text,
  ADD COLUMN IF NOT EXISTS default_branch text NOT NULL DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS scout_schedule text NOT NULL DEFAULT '0 6 * * 1',
  ADD COLUMN IF NOT EXISTS max_concurrent_branches int NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS paused boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS risk_paths jsonb DEFAULT '[]';

-- Add source_finding_ids to proposals (links proposals to the findings that inspired them)
ALTER TABLE feedback_chat.proposals
  ADD COLUMN IF NOT EXISTS source_finding_ids uuid[] DEFAULT '{}';

-- Expand job_type CHECK to include new minion worker types
ALTER TABLE feedback_chat.job_queue DROP CONSTRAINT IF EXISTS job_queue_job_type_check;
ALTER TABLE feedback_chat.job_queue ADD CONSTRAINT job_queue_job_type_check
  CHECK (job_type IN ('agent', 'setup', 'self_improve', 'strategize', 'scout', 'build', 'review'));

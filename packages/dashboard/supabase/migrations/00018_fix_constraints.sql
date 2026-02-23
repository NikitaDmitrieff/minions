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
    -- Conflict resolution events
    'branch_updated', 'merge_conflict'
  ));

export type PipelineRun = {
  id: string
  github_issue_number: number
  github_pr_number: number | null
  stage: string
  triggered_by: string | null
  started_at: string
  completed_at: string | null
  result: string | null
}

export type RunLog = {
  id: number
  timestamp: string
  level: string
  message: string
}

export type DeploymentInfo = {
  state: 'pending' | 'success' | 'failure' | 'error'
  previewUrl: string | null
  description: string | null
}

export type SetupStatus =
  | 'pending'
  | 'installing'
  | 'queued'
  | 'cloning'
  | 'generating'
  | 'committing'
  | 'pr_created'
  | 'complete'
  | 'failed'

export type ProjectSetupInfo = {
  github_installation_id: number | null
  setup_status: SetupStatus
  setup_pr_url: string | null
  setup_error: string | null
}

export type Proposal = {
  id: string
  project_id: string
  title: string
  rationale: string
  spec: string
  priority: 'high' | 'medium' | 'low'
  status: 'draft' | 'approved' | 'implementing' | 'done' | 'rejected'
  source_finding_ids: string[]
  source_theme_ids: string[]
  source_session_ids: string[]
  user_notes: string | null
  reject_reason: string | null
  github_issue_number: number | null
  branch_name: string | null
  scores: {
    impact?: number
    feasibility?: number
    novelty?: number
    alignment?: number
  }
  created_at: string
  reviewed_at: string | null
  completed_at: string | null
  cycle_id: string | null
  is_wild_card: boolean
}

export type StrategyMemoryEvent = {
  id: string
  project_id: string
  proposal_id: string | null
  event_type: 'proposed' | 'approved' | 'rejected' | 'completed' | 'failed' | 'reverted'
  title: string
  themes: string[]
  outcome_notes: string | null
  edit_distance: number | null
  created_at: string
}

export type UserIdea = {
  id: string
  project_id: string
  text: string
  status: 'pending' | 'incorporated' | 'dismissed'
  created_at: string
}

// --- Minions-specific types ---

// Must match CHECK constraint in 00013_findings.sql
export type FindingCategory = 'bug_risk' | 'tech_debt' | 'security' | 'performance' | 'accessibility' | 'testing_gap' | 'dx'
export type FindingSeverity = 'low' | 'medium' | 'high' | 'critical'
export type FindingStatus = 'open' | 'addressed' | 'dismissed' | 'wont_fix'

export type Finding = {
  id: string
  project_id: string
  category: FindingCategory
  severity: FindingSeverity
  title: string
  description: string
  file_path: string | null
  line_range: string | null // int4range stored as text
  evidence: string | null
  fingerprint: string
  status: FindingStatus
  created_at: string
  addressed_at: string | null
}

export type HealthSnapshot = {
  id: string
  project_id: string
  score: number
  breakdown: Record<string, { count: number; worst_severity: string }>
  findings_open: number
  findings_addressed: number
  snapshot_date: string
  created_at: string
}

// Must match CHECK constraint in 00015_branch_events.sql
export type BranchEventType =
  | 'scout_finding'
  | 'proposal_created'
  | 'proposal_approved'
  | 'proposal_rejected'
  | 'build_started'
  | 'build_completed'
  | 'build_failed'
  | 'build_remediation'
  | 'review_started'
  | 'review_approved'
  | 'review_rejected'
  | 'pr_created'
  | 'pr_merged'
  | 'deploy_preview'
  | 'deploy_production'
  | 'branch_deleted'
  | 'auto_approved'
  | 'auto_merged'
  | 'merge_failed'
  | 'cycle_started'
  | 'cycle_completed'
  | 'checkpoint_created'
  | 'checkpoint_reverted'

export type BranchEvent = {
  id: string
  project_id: string
  branch_name: string
  event_type: BranchEventType
  event_data: Record<string, unknown>
  actor: string
  commit_sha: string | null
  created_at: string
}

export type BranchState = 'active' | 'awaiting_approval' | 'needs_action' | 'merged' | 'rejected' | 'failed' | 'deployed' | 'pending'

export type Branch = {
  name: string
  state: BranchState
  events: BranchEvent[]
  lastActivity: string
}

export type AutonomyMode = 'audit' | 'assist' | 'automate'

export type Checkpoint = {
  id: string
  project_id: string
  cycle_id: string | null
  proposal_id: string | null
  checkpoint_type: 'merge' | 'cycle_complete'
  commit_sha: string
  pr_number: number | null
  branch_name: string | null
  revert_pr_number: number | null
  metadata: Record<string, unknown>
  created_at: string
}

export type RiskPaths = {
  high: string[]
  medium: string[]
}

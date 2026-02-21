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

export type FindingCategory = 'code_quality' | 'tests' | 'deps' | 'security' | 'perf' | 'docs' | 'dead_code'
export type FindingSeverity = 'low' | 'medium' | 'high' | 'critical'
export type FindingStatus = 'open' | 'addressed' | 'dismissed'

export type Finding = {
  id: string
  project_id: string
  category: FindingCategory
  severity: FindingSeverity
  title: string
  description: string
  file_path: string | null
  line_range: { start: number; end: number } | null
  scout_run_id: string | null
  status: FindingStatus
  created_at: string
}

export type HealthSnapshot = {
  id: string
  project_id: string
  score: number
  breakdown: {
    code_quality?: number
    test_coverage?: number
    dep_health?: number
    security?: number
    docs?: number
  }
  findings_count: number
  snapshot_date: string
  created_at: string
}

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

export type BranchEvent = {
  id: string
  project_id: string
  branch_name: string | null
  event_type: BranchEventType
  event_data: Record<string, unknown>
  actor: string
  commit_sha: string | null
  created_at: string
}

export type BranchState = 'active' | 'awaiting_approval' | 'merged' | 'rejected' | 'failed' | 'deployed' | 'pending'

export type Branch = {
  name: string
  state: BranchState
  events: BranchEvent[]
  lastActivity: string
}

export type AutonomyMode = 'audit' | 'assist' | 'automate'

export type RiskPaths = {
  high: string[]
  medium: string[]
}

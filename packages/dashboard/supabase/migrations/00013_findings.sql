-- Findings: issues discovered by the Scout worker during repo analysis
-- Categories: bug_risk, tech_debt, security, performance, accessibility, testing_gap, dx

CREATE TABLE IF NOT EXISTS feedback_chat.findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES feedback_chat.projects(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'bug_risk', 'tech_debt', 'security', 'performance',
    'accessibility', 'testing_gap', 'dx'
  )),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title text NOT NULL,
  description text NOT NULL,
  file_path text,
  line_range int4range,
  evidence text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'addressed', 'dismissed', 'wont_fix')),
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  addressed_at timestamptz
);

-- Index for fetching open findings by project (scout + strategist queries)
CREATE INDEX IF NOT EXISTS idx_findings_project_status
  ON feedback_chat.findings(project_id, status, severity, created_at DESC);

-- Unique fingerprint per project prevents duplicate findings across scout runs
CREATE UNIQUE INDEX IF NOT EXISTS idx_findings_fingerprint
  ON feedback_chat.findings(project_id, fingerprint);

-- RLS
ALTER TABLE feedback_chat.findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "findings_all_own_project"
  ON feedback_chat.findings
  FOR ALL USING (project_id IN (SELECT id FROM feedback_chat.projects WHERE user_id = auth.uid()));

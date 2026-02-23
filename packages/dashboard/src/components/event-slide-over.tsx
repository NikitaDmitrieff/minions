'use client'

import { useEffect, useCallback } from 'react'
import {
  X,
  ExternalLink,
  GitPullRequest,
  AlertTriangle,
  Search,
  Lightbulb,
  Hammer,
  Eye,
  Rocket,
  GitMerge,
  Trash2,
  RefreshCw,
  FileCode,
  CheckCircle,
  XCircle,
  Play,
  Flag,
  Shield,

  GitCommit,
} from 'lucide-react'
import type { BranchEvent } from '@/lib/types'

type Props = {
  event: BranchEvent
  githubRepo?: string
  onClose: () => void
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400 bg-red-400/10',
  high: 'text-orange-400 bg-orange-400/10',
  medium: 'text-amber-400 bg-amber-400/10',
  low: 'text-emerald-400 bg-emerald-400/10',
}

const EVENT_TYPE_CONFIG: Record<string, { icon: typeof Search; label: string; color: string }> = {
  scout_finding:      { icon: Search,      label: 'Scout Finding',     color: 'text-blue-400' },
  proposal_created:   { icon: Lightbulb,   label: 'Proposal Created',  color: 'text-accent' },
  proposal_approved:  { icon: Lightbulb,   label: 'Proposal Approved', color: 'text-success' },
  proposal_rejected:  { icon: Lightbulb,   label: 'Proposal Rejected', color: 'text-red-400' },
  build_started:      { icon: Hammer,      label: 'Build Started',     color: 'text-blue-400' },
  build_completed:    { icon: Hammer,      label: 'Build Completed',   color: 'text-success' },
  build_failed:       { icon: AlertTriangle,label: 'Build Failed',     color: 'text-red-400' },
  build_remediation:  { icon: RefreshCw,   label: 'Remediation',       color: 'text-amber-400' },
  review_started:     { icon: Eye,         label: 'Review Started',    color: 'text-blue-400' },
  review_approved:    { icon: Eye,         label: 'Review Approved',   color: 'text-success' },
  review_rejected:    { icon: Eye,         label: 'Review Rejected',   color: 'text-red-400' },
  pr_created:         { icon: GitPullRequest, label: 'PR Created',     color: 'text-accent' },
  pr_merged:          { icon: GitMerge,    label: 'PR Merged',         color: 'text-success' },
  deploy_preview:     { icon: Rocket,      label: 'Preview Deployed',  color: 'text-purple-400' },
  deploy_production:  { icon: Rocket,      label: 'Production Deploy', color: 'text-success' },
  branch_deleted:     { icon: Trash2,      label: 'Branch Deleted',    color: 'text-muted' },
  auto_approved:      { icon: CheckCircle, label: 'Auto-Approved',     color: 'text-success' },
  auto_merged:        { icon: GitMerge,    label: 'Auto-Merged',       color: 'text-success' },
  merge_failed:       { icon: XCircle,     label: 'Merge Failed',      color: 'text-red-400' },
  cycle_started:      { icon: Play,        label: 'Cycle Started',     color: 'text-blue-400' },
  cycle_completed:    { icon: Flag,        label: 'Cycle Completed',   color: 'text-success' },
  checkpoint_created: { icon: Shield,      label: 'Checkpoint Created',color: 'text-purple-400' },
  checkpoint_reverted:{ icon: RefreshCw,   label: 'Checkpoint Reverted',color: 'text-amber-400' },
}

/* ── Shared UI helpers ── */

function ShaLabel({ sha, githubRepo }: { sha: string; githubRepo?: string }) {
  const inner = (
    <>
      <GitCommit className="h-3 w-3 text-muted" />
      {sha.slice(0, 8)}
    </>
  )
  if (githubRepo) {
    return (
      <a
        href={`https://github.com/${githubRepo}/commit/${sha}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-accent transition-colors hover:bg-surface-hover"
      >
        {inner}
        <ExternalLink className="ml-0.5 h-2.5 w-2.5" />
      </a>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[11px] text-fg">
      {inner}
    </span>
  )
}

function PRLink({ prNumber, prUrl }: { prNumber?: number; prUrl?: string }) {
  if (!prUrl) return null
  return (
    <a
      href={prUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm text-accent transition-colors hover:bg-surface-hover"
    >
      <GitPullRequest className="h-4 w-4 shrink-0" />
      <span>{prNumber ? `PR #${prNumber}` : 'View Pull Request'}</span>
      <ExternalLink className="ml-auto h-3 w-3 text-muted" />
    </a>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">{label}</h3>
      {children}
    </div>
  )
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null
  return (
    <div className="flex items-center justify-between rounded-lg bg-surface px-3 py-2">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs text-fg">{value}</span>
    </div>
  )
}

/* ── Event-specific content ── */

function ScoutFindingContent({ data, githubRepo }: { data: Record<string, unknown>; githubRepo?: string }) {
  const severity = data.severity as string | undefined
  const category = data.category as string | undefined
  const filePath = data.file_path as string | undefined
  const totalFindings = data.total_findings as number | undefined
  const newFindings = data.new_findings as number | undefined
  const filesScanned = data.files_scanned as number | undefined
  const categories = data.categories as Record<string, number> | undefined

  return (
    <div className="space-y-4">
      {(severity || category) && (
        <div className="flex items-center gap-2">
          {severity && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${SEVERITY_COLORS[severity] || 'text-muted bg-surface'}`}>
              {severity}
            </span>
          )}
          {category && (
            <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted">
              {category.replace('_', ' ')}
            </span>
          )}
        </div>
      )}
      {typeof data.title === 'string' && (
        <Section label="Finding">
          <p className="text-sm text-fg">{data.title}</p>
        </Section>
      )}
      {filePath && (
        <Section label="File">
          {githubRepo ? (
            <a
              href={`https://github.com/${githubRepo}/blob/main/${filePath}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm text-accent transition-colors hover:bg-surface-hover"
            >
              <FileCode className="h-3.5 w-3.5 shrink-0" />
              <span className="font-[family-name:var(--font-mono)]">{filePath}</span>
              <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-muted" />
            </a>
          ) : (
            <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5">
              <FileCode className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="font-[family-name:var(--font-mono)] text-sm text-fg">{filePath}</span>
            </div>
          )}
        </Section>
      )}
      {(totalFindings != null || newFindings != null || filesScanned != null) && (
        <Section label="Scan Summary">
          <div className="space-y-1">
            <KeyValue label="Total findings" value={totalFindings} />
            <KeyValue label="New findings" value={newFindings} />
            <KeyValue label="Files scanned" value={filesScanned} />
          </div>
        </Section>
      )}
      {categories && Object.keys(categories).length > 0 && (
        <Section label="By Category">
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(categories).filter(([, v]) => v > 0).map(([cat, count]) => (
              <div key={cat} className="flex items-center justify-between rounded-lg bg-surface px-3 py-2">
                <span className="text-[11px] text-muted">{cat.replace('_', ' ')}</span>
                <span className="text-xs font-medium tabular-nums text-fg">{count}</span>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function ProposalContent({ data }: { data: Record<string, unknown> }) {
  const scores = data.scores as Record<string, number> | undefined
  const priority = data.priority as string | undefined
  const sourceFindingCount = data.source_finding_count as number | undefined

  return (
    <div className="space-y-4">
      {typeof data.proposal_title === 'string' && (
        <Section label="Proposal">
          <p className="text-sm text-fg">{data.proposal_title}</p>
        </Section>
      )}
      {(priority || sourceFindingCount != null) && (
        <div className="flex items-center gap-2">
          {priority && (
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              priority === 'high' ? 'text-red-400 bg-red-400/10' :
              priority === 'medium' ? 'text-amber-400 bg-amber-400/10' :
              'text-emerald-400 bg-emerald-400/10'
            }`}>
              {priority} priority
            </span>
          )}
          {sourceFindingCount != null && (
            <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-muted">
              {sourceFindingCount} finding{sourceFindingCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
      {scores && Object.keys(scores).length > 0 && (
        <Section label="Scores">
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(scores).map(([key, val]) => (
              <div key={key} className="rounded-lg bg-surface p-3">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted">
                  {key}
                </span>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${val * 100}%` }} />
                  </div>
                  <span className="text-xs tabular-nums text-fg">{(val * 100).toFixed(0)}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function AutoApprovedContent({ data }: { data: Record<string, unknown> }) {
  const proposalTitle = data.proposal_title as string | undefined
  const autonomyMode = data.autonomy_mode as string | undefined
  const score = data.score as number | undefined

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-success/20 bg-success/5 p-3">
        <p className="text-xs font-medium text-success">
          Automatically approved by autonomy engine
        </p>
      </div>
      {proposalTitle && (
        <Section label="Proposal">
          <p className="text-sm text-fg">{proposalTitle}</p>
        </Section>
      )}
      <div className="space-y-1">
        <KeyValue label="Autonomy mode" value={autonomyMode} />
        {score != null && <KeyValue label="Average score" value={`${(score * 100).toFixed(0)}%`} />}
      </div>
    </div>
  )
}

function BuildContent({ data, eventType, githubRepo }: { data: Record<string, unknown>; eventType: string; githubRepo?: string }) {
  const diffStats = data.diff_stats as string | undefined
  const error = data.error as string | undefined
  const stage = data.stage as string | undefined
  const attempt = data.attempt as number | undefined
  const remediationAttempts = data.remediation_attempts as number | undefined
  const prNumber = data.pr_number as number | undefined
  const prUrl = data.pr_url as string | undefined
  const headSha = data.head_sha as string | undefined
  const title = data.title as string | undefined

  return (
    <div className="space-y-4">
      {title && (
        <Section label="Proposal">
          <p className="text-sm text-fg">{title}</p>
        </Section>
      )}
      {eventType === 'build_failed' && (
        <div className="rounded-lg border border-red-400/20 bg-red-400/5 p-3">
          <p className="text-xs font-medium text-red-400">
            {stage ? `Failed at: ${stage}` : 'Build failed'}
            {attempt != null && ` (attempt #${attempt})`}
            {remediationAttempts != null && ` after ${remediationAttempts} remediation attempt${remediationAttempts !== 1 ? 's' : ''}`}
          </p>
        </div>
      )}
      {eventType === 'build_remediation' && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
          <p className="text-xs font-medium text-amber-400">
            Remediation attempt {attempt != null ? `#${attempt}` : ''}{stage ? ` — fixing ${stage}` : ''}
          </p>
        </div>
      )}
      {eventType === 'build_started' && (
        <div className="rounded-lg border border-blue-400/20 bg-blue-400/5 p-3">
          <p className="text-xs font-medium text-blue-400">Build in progress</p>
        </div>
      )}
      {error && (
        <Section label="Error Output">
          <pre className="overflow-x-auto rounded-lg bg-surface p-3 font-[family-name:var(--font-mono)] text-xs leading-relaxed text-fg">
            {error}
          </pre>
        </Section>
      )}
      {diffStats && (
        <Section label="Diff Stats">
          <pre className="overflow-x-auto rounded-lg bg-surface p-3 font-[family-name:var(--font-mono)] text-xs leading-relaxed text-fg">
            {diffStats}
          </pre>
        </Section>
      )}
      {prUrl && (
        <Section label="Pull Request">
          <PRLink prNumber={prNumber} prUrl={prUrl} />
        </Section>
      )}
      {headSha && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>HEAD:</span>
          <ShaLabel sha={headSha} githubRepo={githubRepo} />
        </div>
      )}
    </div>
  )
}

function ReviewContent({ data, eventType, githubRepo }: { data: Record<string, unknown>; eventType: string; githubRepo?: string }) {
  const comments = data.comments as string[] | undefined
  const riskLevel = data.risk_level as string | undefined
  const riskFiles = data.risk_files as string[] | undefined
  const summary = data.summary as string | undefined
  const concerns = data.concerns as string[] | undefined
  const scopeCreep = data.scope_creep as boolean | string | undefined
  const securityIssues = data.security_issues as string[] | undefined
  const verdict = data.verdict as string | undefined
  const prNumber = data.pr_number as number | undefined
  const headSha = data.head_sha as string | undefined
  const reviewId = data.review_id as number | undefined

  return (
    <div className="space-y-4">
      {verdict && (
        <div className={`rounded-lg border p-3 ${
          verdict === 'approve'
            ? 'border-success/20 bg-success/5'
            : 'border-red-400/20 bg-red-400/5'
        }`}>
          <p className={`text-xs font-medium ${verdict === 'approve' ? 'text-success' : 'text-red-400'}`}>
            Verdict: {verdict === 'approve' ? 'Approved' : 'Changes Requested'}
          </p>
        </div>
      )}
      {summary && (
        <Section label="Summary">
          <p className="text-sm text-fg">{summary}</p>
        </Section>
      )}
      {concerns && concerns.length > 0 && (
        <Section label="Concerns">
          <div className="space-y-2">
            {concerns.map((concern, i) => (
              <div key={i} className="rounded-lg border border-amber-400/10 bg-amber-400/5 px-3 py-2">
                <p className="text-xs text-amber-300">{concern}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
      {securityIssues && securityIssues.length > 0 && (
        <Section label="Security Issues">
          <div className="space-y-2">
            {securityIssues.map((issue, i) => (
              <div key={i} className="rounded-lg border border-red-400/10 bg-red-400/5 px-3 py-2">
                <p className="text-xs text-red-300">{issue}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
      {scopeCreep && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">
          <p className="text-xs font-medium text-amber-400">
            Scope creep detected{typeof scopeCreep === 'string' ? `: ${scopeCreep}` : ''}
          </p>
        </div>
      )}
      {riskLevel === 'high' && riskFiles && riskFiles.length > 0 && (
        <Section label="High-Risk Files Modified">
          <ul className="space-y-0.5">
            {riskFiles.map((f, i) => (
              <li key={i} className="flex items-center gap-2 rounded bg-red-400/5 px-2 py-1 font-[family-name:var(--font-mono)] text-xs text-red-300">
                <AlertTriangle className="h-3 w-3 shrink-0" />{f}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {comments && comments.length > 0 && (
        <Section label="Review Comments">
          <div className="space-y-2">
            {comments.map((comment, i) => (
              <div key={i} className="rounded-lg bg-surface p-3">
                <p className="text-sm text-fg">{comment}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
      {(!summary && (!comments || comments.length === 0) && eventType === 'review_approved') && (
        <div className="rounded-lg border border-success/20 bg-success/5 p-3">
          <p className="text-xs font-medium text-success">No issues found. Approved.</p>
        </div>
      )}
      <div className="space-y-1">
        {prNumber != null && <KeyValue label="PR" value={`#${prNumber}`} />}
        {reviewId != null && <KeyValue label="Review ID" value={reviewId} />}
      </div>
      {headSha && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>HEAD:</span>
          <ShaLabel sha={headSha} githubRepo={githubRepo} />
        </div>
      )}
    </div>
  )
}

function PRContent({ data, githubRepo }: { data: Record<string, unknown>; githubRepo?: string }) {
  const prNumber = data.pr_number as number | undefined
  const prUrl = data.pr_url as string | undefined
  const headSha = data.head_sha as string | undefined
  const mergeSha = data.merge_sha as string | undefined

  return (
    <div className="space-y-4">
      {prUrl && (
        <Section label="Pull Request">
          <PRLink prNumber={prNumber} prUrl={prUrl} />
        </Section>
      )}
      {!prUrl && prNumber != null && (
        <KeyValue label="PR" value={`#${prNumber}`} />
      )}
      <div className="space-y-1">
        {headSha && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>HEAD:</span>
            <ShaLabel sha={headSha} githubRepo={githubRepo} />
          </div>
        )}
        {mergeSha && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>Merge:</span>
            <ShaLabel sha={mergeSha} githubRepo={githubRepo} />
          </div>
        )}
      </div>
    </div>
  )
}

function AutoMergedContent({ data, githubRepo }: { data: Record<string, unknown>; githubRepo?: string }) {
  const prNumber = data.pr_number as number | undefined
  const mergeSha = data.merge_sha as string | undefined

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-success/20 bg-success/5 p-3">
        <p className="text-xs font-medium text-success">
          Automatically merged by autonomy engine
        </p>
      </div>
      <div className="space-y-1">
        {prNumber != null && <KeyValue label="PR" value={`#${prNumber}`} />}
      </div>
      {mergeSha && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>Merge SHA:</span>
          <ShaLabel sha={mergeSha} githubRepo={githubRepo} />
        </div>
      )}
    </div>
  )
}

function MergeFailedContent({ data, githubRepo }: { data: Record<string, unknown>; githubRepo?: string }) {
  const reason = data.reason as string | undefined
  const prNumber = data.pr_number as number | undefined
  const expected = data.expected as string | undefined
  const actual = data.actual as string | undefined

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-red-400/20 bg-red-400/5 p-3">
        <p className="text-xs font-medium text-red-400">
          {reason || 'Merge failed'}
        </p>
      </div>
      {(expected || actual) && (
        <Section label="SHA Mismatch">
          <div className="space-y-1">
            {expected && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>Expected:</span>
                <ShaLabel sha={expected} githubRepo={githubRepo} />
              </div>
            )}
            {actual && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>Actual:</span>
                <ShaLabel sha={actual} githubRepo={githubRepo} />
              </div>
            )}
          </div>
        </Section>
      )}
      {prNumber != null && <KeyValue label="PR" value={`#${prNumber}`} />}
    </div>
  )
}

function CycleContent({ data, eventType }: { data: Record<string, unknown>; eventType: string }) {
  const cycleId = data.cycle_id as string | undefined
  const triggeredBy = data.triggered_by as string | undefined
  const previousCycleId = data.previous_cycle_id as string | undefined

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border p-3 ${
        eventType === 'cycle_completed'
          ? 'border-success/20 bg-success/5'
          : 'border-blue-400/20 bg-blue-400/5'
      }`}>
        <p className={`text-xs font-medium ${eventType === 'cycle_completed' ? 'text-success' : 'text-blue-400'}`}>
          {eventType === 'cycle_completed' ? 'Cycle completed — all proposals resolved' : 'New cycle started'}
        </p>
      </div>
      <div className="space-y-1">
        {cycleId && <KeyValue label="Cycle ID" value={cycleId.slice(0, 8)} />}
        {triggeredBy && <KeyValue label="Triggered by" value={triggeredBy.replace('_', ' ')} />}
        {previousCycleId && <KeyValue label="Previous cycle" value={previousCycleId.slice(0, 8)} />}
      </div>
    </div>
  )
}

function CheckpointContent({ data, eventType, githubRepo }: { data: Record<string, unknown>; eventType: string; githubRepo?: string }) {
  const checkpointType = data.checkpoint_type as string | undefined
  const commitSha = data.commit_sha as string | undefined
  const prNumber = data.pr_number as number | undefined

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border p-3 ${
        eventType === 'checkpoint_reverted'
          ? 'border-amber-400/20 bg-amber-400/5'
          : 'border-purple-400/20 bg-purple-400/5'
      }`}>
        <p className={`text-xs font-medium ${eventType === 'checkpoint_reverted' ? 'text-amber-400' : 'text-purple-400'}`}>
          {eventType === 'checkpoint_reverted' ? 'Checkpoint reverted' : `Checkpoint saved (${checkpointType || 'unknown'})`}
        </p>
      </div>
      <div className="space-y-1">
        {checkpointType && <KeyValue label="Type" value={checkpointType} />}
        {prNumber != null && <KeyValue label="PR" value={`#${prNumber}`} />}
      </div>
      {commitSha && (
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>Commit:</span>
          <ShaLabel sha={commitSha} githubRepo={githubRepo} />
        </div>
      )}
    </div>
  )
}

function DeployContent({ data, eventType }: { data: Record<string, unknown>; eventType: string }) {
  const url = (data.preview_url || data.production_url || data.url) as string | undefined

  return (
    <div className="space-y-4">
      {url && (
        <Section label={eventType === 'deploy_production' ? 'Production URL' : 'Preview URL'}>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2.5 text-sm text-accent transition-colors hover:bg-surface-hover"
          >
            <Rocket className="h-4 w-4 shrink-0" />
            <span className="truncate">{url.replace('https://', '')}</span>
            <ExternalLink className="ml-auto h-3 w-3 shrink-0 text-muted" />
          </a>
        </Section>
      )}
    </div>
  )
}

function FallbackContent({ data }: { data: Record<string, unknown> }) {
  // Show all fields as key-value pairs, falling back to JSON for complex values
  const entries = Object.entries(data).filter(([, v]) => v != null && v !== '')
  if (entries.length === 0) return null

  return (
    <div className="space-y-1">
      {entries.map(([key, value]) => (
        <KeyValue
          key={key}
          label={key.replace(/_/g, ' ')}
          value={typeof value === 'object' ? JSON.stringify(value) : String(value)}
        />
      ))}
    </div>
  )
}

function renderEventContent(event: BranchEvent, githubRepo?: string) {
  const data = event.event_data

  switch (event.event_type) {
    case 'scout_finding':
      return <ScoutFindingContent data={data} githubRepo={githubRepo} />
    case 'proposal_created':
    case 'proposal_approved':
    case 'proposal_rejected':
      return <ProposalContent data={data} />
    case 'auto_approved':
      return <AutoApprovedContent data={data} />
    case 'build_started':
    case 'build_completed':
    case 'build_failed':
    case 'build_remediation':
      return <BuildContent data={data} eventType={event.event_type} githubRepo={githubRepo} />
    case 'review_started':
    case 'review_approved':
    case 'review_rejected':
      return <ReviewContent data={data} eventType={event.event_type} githubRepo={githubRepo} />
    case 'pr_created':
    case 'pr_merged':
      return <PRContent data={data} githubRepo={githubRepo} />
    case 'auto_merged':
      return <AutoMergedContent data={data} githubRepo={githubRepo} />
    case 'merge_failed':
      return <MergeFailedContent data={data} githubRepo={githubRepo} />
    case 'cycle_started':
    case 'cycle_completed':
      return <CycleContent data={data} eventType={event.event_type} />
    case 'checkpoint_created':
    case 'checkpoint_reverted':
      return <CheckpointContent data={data} eventType={event.event_type} githubRepo={githubRepo} />
    case 'deploy_preview':
    case 'deploy_production':
      return <DeployContent data={data} eventType={event.event_type} />
    default:
      return <FallbackContent data={data} />
  }
}

export function EventSlideOver({ event, githubRepo, onClose }: Props) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    },
    [onClose]
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const config = EVENT_TYPE_CONFIG[event.event_type] || {
    icon: Search,
    label: event.event_type.replace(/_/g, ' '),
    color: 'text-muted',
  }
  const Icon = config.icon

  return (
    <>
      {/* Backdrop */}
      <div className="slide-over-backdrop" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 z-50 flex h-screen w-full max-w-[480px] flex-col border-l border-edge bg-bg/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-edge px-6 py-4">
          <div className="flex items-center gap-3">
            <Icon className={`h-4 w-4 ${config.color}`} />
            <span className="text-sm font-medium text-fg">{config.label}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-hover hover:text-fg"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Branch name */}
          {event.branch_name && (
            <div className="mb-4 flex items-center gap-2 text-xs text-muted">
              <GitPullRequest className="h-3 w-3" />
              {githubRepo ? (
                <a
                  href={`https://github.com/${githubRepo}/tree/${event.branch_name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-[family-name:var(--font-mono)] text-accent transition-colors hover:text-fg"
                >
                  {event.branch_name}
                </a>
              ) : (
                <span className="font-[family-name:var(--font-mono)]">{event.branch_name}</span>
              )}
            </div>
          )}

          {/* Commit SHA */}
          {event.commit_sha && (
            <div className="mb-4 flex items-center gap-2 text-xs text-muted">
              <span>SHA:</span>
              <ShaLabel sha={event.commit_sha} githubRepo={githubRepo} />
            </div>
          )}

          {/* Actor */}
          <div className="mb-5 flex items-center gap-2 text-xs text-muted">
            <span>Actor:</span>
            <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] text-fg">{event.actor}</span>
          </div>

          {/* Event-specific content */}
          {renderEventContent(event, githubRepo)}

          {/* Timestamp */}
          <div className="mt-6 text-xs text-muted">
            <span className="tabular-nums text-fg">
              {new Date(event.created_at).toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

'use client'

import { useCallback, useState } from 'react'
import { Brain, Compass, Loader2, Plus, Sparkles, X, Clock, Shield, GitBranch, Pause, Play, Search, Check, Lightbulb } from 'lucide-react'
import { SetupSection } from '@/components/setup-section'
import { triggerScout } from '@/app/projects/[id]/actions'
import type { SetupStatus, AutonomyMode, UserIdea } from '@/lib/types'

type Props = {
  projectId: string
  githubRepo: string
  installationId: number | null
  initialContext: string
  initialNudges: string[]
  initialSetupStatus: SetupStatus
  initialPrUrl: string | null
  initialError: string | null
  webhookSecret: string
  apiKey?: string
  webhookUrl: string
  agentUrl: string
  setupProgress: Record<string, boolean>
  hasRuns: boolean
  initialScoutSchedule: string
  initialAutonomyMode: AutonomyMode
  initialMaxBranches: number
  initialPaused: boolean
  initialIdeas: UserIdea[]
}

const SCHEDULE_OPTIONS = [
  { value: '0 6 * * *', label: 'Daily (6am UTC)' },
  { value: '0 6,18 * * *', label: 'Twice daily (6am & 6pm UTC)' },
  { value: '0 6 * * 1', label: 'Weekly (Monday 6am UTC)' },
]

const AUTONOMY_OPTIONS: { value: AutonomyMode; label: string; description: string }[] = [
  { value: 'audit', label: 'Audit', description: 'Scout and Strategist auto-run. Builder and merge need your approval.' },
  { value: 'assist', label: 'Assist', description: 'Low-risk changes auto-build. High-risk and merge need your approval.' },
  { value: 'automate', label: 'Automate', description: 'Full automation. Auto-merge if tests pass and Reviewer approves.' },
]

export function SettingsPageClient({
  projectId,
  githubRepo,
  installationId,
  initialContext,
  initialNudges,
  initialSetupStatus,
  initialPrUrl,
  initialError,
  webhookSecret,
  apiKey,
  webhookUrl,
  agentUrl,
  setupProgress,
  hasRuns,
  initialScoutSchedule,
  initialAutonomyMode,
  initialMaxBranches,
  initialPaused,
  initialIdeas,
}: Props) {
  // Tab state
  const [tab, setTab] = useState<'config' | 'input'>('config')

  // Ideas state
  const [ideas, setIdeas] = useState(initialIdeas)
  const [ideaText, setIdeaText] = useState('')
  const [submittingIdea, setSubmittingIdea] = useState(false)

  // Product context state
  const [context, setContext] = useState(initialContext)
  const [editingContext, setEditingContext] = useState(false)
  const [contextDraft, setContextDraft] = useState(initialContext)
  const [generating, setGenerating] = useState(false)
  const [savingContext, setSavingContext] = useState(false)

  // Nudges state
  const [nudges, setNudges] = useState(initialNudges)
  const [newNudge, setNewNudge] = useState('')
  const [savingNudges, setSavingNudges] = useState(false)

  // Minions config state
  const [scoutSchedule, setScoutSchedule] = useState(initialScoutSchedule)
  const [autonomyMode, setAutonomyMode] = useState<AutonomyMode>(initialAutonomyMode)
  const [maxBranches, setMaxBranches] = useState(initialMaxBranches)
  const [paused, setPaused] = useState(initialPaused)
  const [savingConfig, setSavingConfig] = useState(false)
  const [scoutQueued, setScoutQueued] = useState(false)
  const [scoutLoading, setScoutLoading] = useState(false)

  const generateContext = useCallback(async () => {
    setGenerating(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/context/generate`, { method: 'POST' })
      if (res.ok) {
        const json = await res.json()
        setContext(json.product_context)
        setContextDraft(json.product_context)
      }
    } finally {
      setGenerating(false)
    }
  }, [projectId])

  const saveContext = useCallback(async () => {
    setSavingContext(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_context: contextDraft }),
      })
      if (res.ok) {
        setContext(contextDraft)
        setEditingContext(false)
      }
    } finally {
      setSavingContext(false)
    }
  }, [projectId, contextDraft])

  const saveNudges = useCallback(async (updated: string[]) => {
    setSavingNudges(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategic_nudges: updated }),
      })
      if (res.ok) {
        setNudges(updated)
      }
    } finally {
      setSavingNudges(false)
    }
  }, [projectId])

  const addNudge = useCallback(() => {
    if (!newNudge.trim()) return
    const updated = [...nudges, newNudge.trim()]
    setNewNudge('')
    saveNudges(updated)
  }, [nudges, newNudge, saveNudges])

  const removeNudge = useCallback((index: number) => {
    const updated = nudges.filter((_, i) => i !== index)
    saveNudges(updated)
  }, [nudges, saveNudges])

  const saveField = useCallback(async (field: string, value: unknown) => {
    setSavingConfig(true)
    try {
      await fetch(`/api/projects/${projectId}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
    } finally {
      setSavingConfig(false)
    }
  }, [projectId])

  const handleRunScout = useCallback(async () => {
    setScoutLoading(true)
    try {
      const result = await triggerScout(projectId)
      if (result.error) {
        // Reset on error — user can try again
        setScoutLoading(false)
        return
      }
      setScoutQueued(true)
    } finally {
      setScoutLoading(false)
    }
  }, [projectId])

  const handleScheduleChange = useCallback((value: string) => {
    setScoutSchedule(value)
    saveField('scout_schedule', value)
  }, [saveField])

  const handleAutonomyChange = useCallback((value: AutonomyMode) => {
    setAutonomyMode(value)
    saveField('autonomy_mode', value)
  }, [saveField])

  const handleMaxBranchesChange = useCallback((value: number) => {
    setMaxBranches(value)
    saveField('max_concurrent_branches', value)
  }, [saveField])

  const handleTogglePause = useCallback(() => {
    const newValue = !paused
    setPaused(newValue)
    saveField('paused', newValue)
  }, [paused, saveField])

  async function submitIdea() {
    if (!ideaText.trim()) return
    setSubmittingIdea(true)
    try {
      const res = await fetch(`/api/ideas/${projectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: ideaText.trim() }),
      })
      if (res.ok) {
        const json = await res.json()
        setIdeas(prev => [json.idea, ...prev])
        setIdeaText('')
      }
    } finally {
      setSubmittingIdea(false)
    }
  }

  return (
    <>
      {/* Internal tab bar */}
      <div className="mb-8 flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-1 backdrop-blur-xl w-fit">
        <button
          onClick={() => setTab('config')}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'config' ? 'bg-white/[0.08] text-fg' : 'text-muted hover:text-fg'
          }`}
        >
          Configuration
        </button>
        <button
          onClick={() => setTab('input')}
          className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'input' ? 'bg-white/[0.08] text-fg' : 'text-muted hover:text-fg'
          }`}
        >
          Your Input
        </button>
      </div>

      {tab === 'config' && (
      <div className="space-y-8">
        {/* Section 1: Product Context */}
      <div className="glass-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-fg">Product Context</h2>
          </div>
          <div className="flex items-center gap-2">
            {context && !editingContext && (
              <button
                onClick={() => { setContextDraft(context); setEditingContext(true) }}
                className="text-[11px] text-accent hover:text-fg"
              >
                Edit
              </button>
            )}
            <button
              onClick={generateContext}
              disabled={generating || !githubRepo}
              className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {context ? 'Regenerate' : 'Generate from GitHub'}
            </button>
          </div>
        </div>

        <p className="mb-3 text-xs text-muted">
          How the AI strategist understands your product. Auto-generated from your GitHub repo, or write your own.
        </p>

        {editingContext ? (
          <div>
            <textarea
              value={contextDraft}
              onChange={e => setContextDraft(e.target.value)}
              rows={6}
              className="w-full rounded-lg bg-white/[0.04] p-3 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="Describe your product: what it is, who it's for, what matters most..."
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={saveContext}
                disabled={savingContext}
                className="rounded-lg bg-accent/20 px-3 py-1.5 text-[11px] font-medium text-accent hover:bg-accent/30 disabled:opacity-50"
              >
                {savingContext ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => { setEditingContext(false); setContextDraft(context) }}
                className="text-[11px] text-muted hover:text-fg"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : context ? (
          <div className="rounded-lg bg-white/[0.04] p-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-fg">{context}</p>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-white/[0.08] p-4 text-center">
            <p className="text-xs text-muted">
              {githubRepo
                ? 'Click "Generate from GitHub" to auto-create your product context.'
                : 'Connect a GitHub repo first, or write your context manually.'}
            </p>
            {!githubRepo && (
              <button
                onClick={() => { setContextDraft(''); setEditingContext(true) }}
                className="mt-2 text-[11px] text-accent hover:text-fg"
              >
                Write manually
              </button>
            )}
          </div>
        )}
      </div>

      {/* Section 3: Scout Schedule */}
      <div className="glass-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-accent" />
            <h2 className="text-sm font-semibold text-fg">Scout Schedule</h2>
          </div>
          <button
            onClick={handleRunScout}
            disabled={scoutLoading || scoutQueued || paused || !installationId}
            className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
          >
            {scoutQueued ? (
              <Check className="h-3 w-3 text-success" />
            ) : scoutLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Search className="h-3 w-3" />
            )}
            {scoutQueued ? 'Scout queued' : 'Run Now'}
          </button>
        </div>

        <p className="mb-3 text-xs text-muted">
          How often the Scout scans your codebase for findings.
        </p>

        <div className="flex flex-wrap gap-2">
          {SCHEDULE_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleScheduleChange(opt.value)}
              disabled={savingConfig}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                scoutSchedule === opt.value
                  ? 'bg-accent/20 text-accent'
                  : 'bg-surface text-muted hover:text-fg'
              } disabled:opacity-50`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Section 4: Autonomy Mode */}
      <div className="glass-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-fg">Autonomy Mode</h2>
        </div>

        <p className="mb-3 text-xs text-muted">
          Control how much the minions can do without your approval.
        </p>

        <div className="space-y-2">
          {AUTONOMY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => handleAutonomyChange(opt.value)}
              disabled={savingConfig}
              className={`w-full rounded-lg p-3 text-left transition-colors ${
                autonomyMode === opt.value
                  ? 'border border-accent/30 bg-accent/10'
                  : 'border border-transparent bg-surface hover:bg-surface-hover'
              } disabled:opacity-50`}
            >
              <span className={`text-sm font-medium ${
                autonomyMode === opt.value ? 'text-accent' : 'text-fg'
              }`}>
                {opt.label}
              </span>
              <p className="mt-0.5 text-xs text-muted">{opt.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Section 5: Concurrent Branches */}
      <div className="glass-card p-5">
        <div className="mb-4 flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-semibold text-fg">Max Concurrent Branches</h2>
        </div>

        <p className="mb-3 text-xs text-muted">
          Maximum number of branches the Builder can work on simultaneously.
        </p>

        <div className="flex items-center gap-3">
          {[1, 2, 3, 5, 10].map(n => (
            <button
              key={n}
              onClick={() => handleMaxBranchesChange(n)}
              disabled={savingConfig}
              className={`rounded-lg px-3 py-2 text-xs font-medium tabular-nums transition-colors ${
                maxBranches === n
                  ? 'bg-accent/20 text-accent'
                  : 'bg-surface text-muted hover:text-fg'
              } disabled:opacity-50`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Section 6: Kill Switch */}
      <div className="glass-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {paused ? <Play className="h-4 w-4 text-success" /> : <Pause className="h-4 w-4 text-amber-400" />}
            <h2 className="text-sm font-semibold text-fg">
              {paused ? 'Minions Paused' : 'Minions Active'}
            </h2>
          </div>
          <button
            onClick={handleTogglePause}
            disabled={savingConfig}
            className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-medium transition-colors ${
              paused
                ? 'bg-success/10 text-success hover:bg-success/20'
                : 'bg-red-400/10 text-red-400 hover:bg-red-400/20'
            } disabled:opacity-50`}
          >
            {savingConfig ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {paused ? 'Resume All' : 'Pause All'}
          </button>
        </div>
        <p className="text-xs text-muted">
          {paused
            ? 'All minion activity is paused. No Scout scans, no builds, no reviews will run.'
            : 'Minions are active and will run according to the schedule above.'}
        </p>
      </div>

      {/* Section 7: Setup & Configuration (moved from Overview) */}
      <div>
        <h2 className="mb-4 text-sm font-semibold text-fg">Setup & Configuration</h2>
        <SetupSection
          projectId={projectId}
          githubRepo={githubRepo}
          installationId={installationId}
          initialStatus={initialSetupStatus}
          initialPrUrl={initialPrUrl}
          initialError={initialError}
          webhookSecret={webhookSecret}
          apiKey={apiKey}
          webhookUrl={webhookUrl}
          agentUrl={agentUrl}
          setupProgress={setupProgress}
          hasRuns={hasRuns}
        />
      </div>
    </div>
      )}

      {tab === 'input' && (
        <div className="space-y-8">
          {/* Strategic Nudges (moved from config) */}
          <div className="glass-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Compass className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-semibold text-fg">Strategic Nudges</h2>
            </div>

            <p className="mb-3 text-xs text-muted">
              Standing directives that guide all future proposal generation. The AI strategist treats these as high-priority constraints.
            </p>

            {nudges.length > 0 && (
              <div className="mb-3 space-y-1.5">
                {nudges.map((nudge, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2"
                  >
                    <span className="text-sm text-fg">{nudge}</span>
                    <button
                      onClick={() => removeNudge(i)}
                      disabled={savingNudges}
                      className="ml-2 rounded p-1 text-muted transition-colors hover:bg-white/[0.06] hover:text-fg disabled:opacity-50"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newNudge}
                onChange={e => setNewNudge(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addNudge() }}
                placeholder="e.g., Focus on mobile UX, Ignore performance for now..."
                className="flex-1 rounded-lg bg-white/[0.04] px-3 py-2 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={addNudge}
                disabled={!newNudge.trim() || savingNudges}
                className="flex items-center gap-1 rounded-lg bg-accent/10 px-3 py-2 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                Add
              </button>
            </div>
          </div>

          {/* Quick Idea */}
          <div className="glass-card p-5">
            <div className="mb-4 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-accent" />
              <h2 className="text-sm font-semibold text-fg">Quick Idea</h2>
            </div>
            <p className="mb-3 text-xs text-muted">
              Drop a feature direction or improvement idea. The strategist will consider it in the next run.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={ideaText}
                onChange={e => setIdeaText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitIdea() }}
                placeholder="e.g., Add dark mode, Optimize page load, Add API rate limiting..."
                className="flex-1 rounded-lg bg-white/[0.04] px-3 py-2.5 text-sm text-fg placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <button
                onClick={submitIdea}
                disabled={!ideaText.trim() || submittingIdea}
                className="flex items-center gap-1.5 rounded-lg bg-accent/10 px-4 py-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
              >
                {submittingIdea ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Submit
              </button>
            </div>
          </div>

          {/* Recent Ideas */}
          <div className="glass-card p-5">
            <h2 className="mb-3 text-sm font-semibold text-fg">Your Ideas</h2>
            {ideas.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted">
                No ideas submitted yet. Drop one above.
              </p>
            ) : (
              <div className="space-y-1.5">
                {ideas.map(idea => (
                  <div
                    key={idea.id}
                    className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="text-sm text-fg">{idea.text}</span>
                      <span className="ml-2 text-[11px] text-dim">
                        {new Date(idea.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <span className={`ml-3 shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      idea.status === 'incorporated' ? 'bg-green-400/10 text-green-400'
                        : idea.status === 'dismissed' ? 'bg-white/[0.06] text-muted'
                        : 'bg-amber-400/10 text-amber-400'
                    }`}>
                      {idea.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

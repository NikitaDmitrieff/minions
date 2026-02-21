"use client";
import { Timeline } from "@/components/ui/timeline";

const codeBlock = (code: string) => (
  <pre className="mt-4 overflow-x-auto rounded-md border border-white/[0.06] bg-[#0a0a0a] p-4 font-code text-[13px] leading-relaxed">
    <code>{code}</code>
  </pre>
);

const timelineData = [
  {
    title: "Scout",
    content: (
      <div>
        <h4 className="text-lg font-semibold text-zinc-100 font-display">
          Analyze your codebase
        </h4>
        <p className="mt-2 text-sm text-zinc-500 leading-relaxed max-w-lg">
          The Scout worker clones your repo with sandbox safety, then analyzes{" "}
          <code className="text-[#1a1ab0] font-code text-xs">7 categories</code> in
          parallel via Haiku: security, performance, DX, testing, accessibility,
          architecture, and docs.
        </p>
        {codeBlock(
          `# Scout analysis output
categories:
  security:     score: 82  findings: 3
  performance:  score: 91  findings: 1
  dx:           score: 74  findings: 4
  testing:      score: 68  findings: 2
  accessibility: score: 85 findings: 1
  architecture: score: 79  findings: 2
  docs:         score: 60  findings: 3

total_findings: 16
deduplicated:   12  (title+file fingerprint)`
        )}
      </div>
    ),
  },
  {
    title: "Strategize",
    content: (
      <div>
        <h4 className="text-lg font-semibold text-zinc-100 font-display">
          Propose improvements
        </h4>
        <p className="mt-2 text-sm text-zinc-500 leading-relaxed max-w-lg">
          The Strategist reads findings, user ideas, and strategy memory to
          propose improvements scored on{" "}
          <span className="text-zinc-300">4 dimensions</span>: impact, feasibility,
          novelty, and alignment. Proposals below 0.6 avg are filtered out.
        </p>
        {codeBlock(
          `# Proposal scoring
proposal: "Add input validation to API routes"
scores:
  impact:      0.85  # high — prevents injection
  feasibility: 0.90  # straightforward zod schemas
  novelty:     0.70  # no prior attempts
  alignment:   0.80  # matches security priority
  average:     0.81  ✓ above 0.6 threshold

proposal: "Rename internal utils"
scores:
  average:     0.45  ✗ filtered out`
        )}
      </div>
    ),
  },
  {
    title: "Build",
    content: (
      <div>
        <h4 className="text-lg font-semibold text-zinc-100 font-display">
          Implement changes
        </h4>
        <p className="mt-2 text-sm text-zinc-500 leading-relaxed max-w-lg">
          The Builder implements proposals using Claude CLI with{" "}
          <span className="text-zinc-300">sandbox safety</span>: stripped CLAUDE.md,
          disabled git hooks. Tiered validation runs lint → typecheck → build → test
          (fail fast), with up to 2 remediation retries.
        </p>
        {codeBlock(
          `# Builder pipeline
✓ Sandbox: hooks disabled, CLAUDE.md stripped
✓ Implementation: 4 files changed, 127 additions

Validation (fail fast):
  ✓ lint        0.8s
  ✓ typecheck   2.1s
  ✓ build       4.3s
  ✓ tests       6.7s

✓ Created PR #42 via Octokit
  branch: minions/add-input-validation
  sha:    a1b2c3d`
        )}
      </div>
    ),
  },
  {
    title: "Review",
    content: (
      <div>
        <h4 className="text-lg font-semibold text-zinc-100 font-display">
          Validate &amp; merge
        </h4>
        <p className="mt-2 text-sm text-zinc-500 leading-relaxed max-w-lg">
          The Reviewer uses the Anthropic SDK (not CLI — to free concurrency slots)
          for structured PR reviews. It checks risk tiers with minimatch patterns
          and verifies HEAD SHA before merge.
        </p>
        {codeBlock(
          `# Review output
PR #42: "Add input validation to API routes"

Risk assessment:
  modified files:  4
  risk_paths hit:  0 / 4  → tier: low
  SHA verified:    a1b2c3d ✓

Review:
  security:   ✓ no new vulnerabilities
  quality:    ✓ follows project conventions
  coverage:   ✓ tests added for new schemas

Decision: approved
Action:   auto-merged (low risk + autonomy=full)`
        )}
      </div>
    ),
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative pb-32">
      <div className="absolute inset-0 bg-black" />
      <div className="relative">
        <Timeline data={timelineData} />
      </div>
    </section>
  );
}

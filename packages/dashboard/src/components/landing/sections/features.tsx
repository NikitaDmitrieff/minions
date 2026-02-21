"use client";
import { motion, useInView, AnimatePresence } from "motion/react";
import { useRef, useState } from "react";

const features = [
  {
    name: "Graph",
    description: "Visualize the entire pipeline as a branch timeline.",
    usage: "Branch events grouped by branch",
    output: `branch: minions/add-validation
├── scout_finding      → 12 findings
├── proposal_created   → P-001
├── build_started      → sha: a1b2c3d
├── build_lint_pass    → 0.8s
├── build_test_pass    → 6.7s
├── pr_opened          → #42
├── review_approved    → tier: low
└── pr_merged          → main`,
  },
  {
    name: "Kanban",
    description: "Track proposals through their lifecycle stages.",
    usage: "Proposal pipeline view",
    output: `Created    Queued     Building   Review     Done
─────────  ─────────  ─────────  ─────────  ─────────
P-004      P-003      P-002                 P-001 ✓
P-005                                       P-000 ✓

5 proposals · 2 completed · 1 building`,
  },
  {
    name: "Findings",
    description: "Browse and filter scout analysis results.",
    usage: "Scout findings with filters",
    output: `Category     Severity  File                    Status
───────────  ────────  ──────────────────────  ────────
security     high      src/api/auth.ts         open
performance  medium    src/db/queries.ts       fixed
dx           low       src/utils/helpers.ts    open
testing      medium    src/api/routes.ts       open

12 findings · 3 fixed · 9 open`,
  },
  {
    name: "Health",
    description: "Monitor codebase health trends over time.",
    usage: "30-day health snapshots",
    output: `Category       Score  Trend (30d)
─────────────  ─────  ───────────
security        82    ▲ +7
performance     91    ▲ +3
dx              74    ▲ +12
testing         68    ▲ +15
accessibility   85    ─  0
architecture    79    ▲ +4
docs            60    ▲ +8`,
  },
  {
    name: "Input",
    description: "Submit your own improvement ideas for the swarm.",
    usage: "User ideas & proposals",
    output: `Your ideas:
  1. "Add rate limiting to public API"    → queued
  2. "Migrate to Zod v4 schemas"          → building
  3. "Add dark mode to admin panel"       → proposed

Swarm will prioritize based on alignment
with your strategic nudges.`,
  },
  {
    name: "Settings",
    description: "Configure autonomy level, risk paths, and schedules.",
    usage: "Project configuration",
    output: `autonomy_mode:   supervised
scout_schedule:  "0 */6 * * *"  (every 6h)
max_concurrent:  2 branches
risk_paths:
  - "src/api/**"        → high
  - "*.config.*"        → high
  - "src/components/**" → low
paused: false`,
  },
];

function FlowLines({ isInView }: { isInView: boolean }) {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none z-0"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="flow-grad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#1a1ab0" stopOpacity="0" />
          <stop offset="50%" stopColor="#1a1ab0" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#1a1ab0" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="flow-grad-v" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#1a1ab0" stopOpacity="0" />
          <stop offset="50%" stopColor="#1a1ab0" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#1a1ab0" stopOpacity="0" />
        </linearGradient>
      </defs>

      <motion.line
        x1="33.33%" y1="25%" x2="33.33%" y2="25%"
        stroke="url(#flow-grad)"
        strokeWidth="1"
        initial={{ x2: "33.33%" }}
        animate={isInView ? { x2: "36.66%" } : {}}
        transition={{ duration: 0.6, delay: 0.8 }}
      />
      <motion.line
        x1="63.33%" y1="25%" x2="63.33%" y2="25%"
        stroke="url(#flow-grad)"
        strokeWidth="1"
        initial={{ x2: "63.33%" }}
        animate={isInView ? { x2: "66.66%" } : {}}
        transition={{ duration: 0.6, delay: 1.0 }}
      />
      <motion.line
        x1="83.33%" y1="50%" x2="83.33%" y2="50%"
        stroke="url(#flow-grad-v)"
        strokeWidth="1"
        initial={{ y2: "50%" }}
        animate={isInView ? { y2: "55%" } : {}}
        transition={{ duration: 0.5, delay: 1.2 }}
      />
      <motion.line
        x1="66.66%" y1="75%" x2="66.66%" y2="75%"
        stroke="url(#flow-grad)"
        strokeWidth="1"
        initial={{ x2: "66.66%" }}
        animate={isInView ? { x2: "63.33%" } : {}}
        transition={{ duration: 0.6, delay: 1.4 }}
      />
      <motion.line
        x1="36.66%" y1="75%" x2="36.66%" y2="75%"
        stroke="url(#flow-grad)"
        strokeWidth="1"
        initial={{ x2: "36.66%" }}
        animate={isInView ? { x2: "33.33%" } : {}}
        transition={{ duration: 0.6, delay: 1.6 }}
      />
    </svg>
  );
}

export function Features() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const [selected, setSelected] = useState<string | null>(null);

  const gridOrder = [0, 1, 2, 5, 4, 3];

  const selectedFeature = features.find((f) => f.name === selected);

  return (
    <section id="features" className="relative py-28 overflow-hidden" ref={ref}>
      <div className="absolute inset-0 bg-grid opacity-30" />
      <div className="absolute inset-0 bg-radial-fade" />

      <div className="relative z-10 max-w-5xl mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="font-code text-sm font-medium text-[#1a1ab0] tracking-wider uppercase">
            Dashboard
          </span>
          <h2 className="mt-4 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
            Six views.{" "}
            <span className="text-zinc-500">Full visibility.</span>
          </h2>
          <p className="mt-4 text-lg text-zinc-500 max-w-lg mx-auto">
            Everything your swarm is doing &mdash; at a glance.
          </p>
        </motion.div>

        <div className="relative">
          <FlowLines isInView={isInView} />

          <div className="relative z-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((feature, i) => {
              const order = gridOrder.indexOf(i);
              const isActive = selected === feature.name;

              return (
                <motion.button
                  key={feature.name}
                  initial={{ opacity: 0, y: 20 }}
                  animate={isInView ? { opacity: 1, y: 0 } : {}}
                  transition={{ duration: 0.4, delay: 0.3 + order * 0.12 }}
                  onClick={() => setSelected(isActive ? null : feature.name)}
                  className={`group relative rounded-[3px] border p-5 text-left transition-all duration-200 ${
                    isActive
                      ? "border-[#1a1ab0]/40 bg-[#1a1ab0]/[0.06]"
                      : "border-white/[0.06] bg-white/[0.02] hover:border-[#1a1ab0]/20 hover:bg-white/[0.04]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <motion.div
                      className="flex h-7 w-7 items-center justify-center rounded-[3px] border"
                      animate={{
                        borderColor: isActive ? "rgba(26, 26, 176, 0.4)" : "rgba(255, 255, 255, 0.08)",
                        backgroundColor: isActive ? "rgba(26, 26, 176, 0.15)" : "rgba(26, 26, 176, 0.08)",
                      }}
                      transition={{ duration: 0.2 }}
                    >
                      <span className="font-code text-[10px] font-bold text-[#1a1ab0]">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                    </motion.div>
                    <span className="font-code text-xs text-zinc-600 group-hover:text-zinc-400 transition-colors">
                      &#9656;
                    </span>
                  </div>

                  <h3 className="font-[helvetica] text-base font-bold text-zinc-100">
                    {feature.name}
                  </h3>
                  <p className="mt-1 text-sm text-zinc-500 leading-relaxed">
                    {feature.description}
                  </p>

                  <motion.div
                    className="absolute bottom-0 left-4 right-4 h-px"
                    animate={{
                      background: isActive
                        ? "linear-gradient(90deg, transparent, rgba(26, 26, 176, 0.5), transparent)"
                        : "linear-gradient(90deg, transparent, transparent, transparent)",
                    }}
                    transition={{ duration: 0.3 }}
                  />
                </motion.button>
              );
            })}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {selectedFeature && (
            <motion.div
              key={selectedFeature.name}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3, ease: "easeInOut" }}
              className="mt-6 overflow-hidden"
            >
              <div className="rounded-[3px] border border-white/[0.06] bg-[#0a0a0a] overflow-hidden">
                <div className="flex items-center gap-2 border-b border-white/[0.04] px-4 py-2.5">
                  <div className="flex gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/60" />
                    <div className="h-2.5 w-2.5 rounded-full bg-[#febc2e]/60" />
                    <div className="h-2.5 w-2.5 rounded-full bg-[#28c840]/60" />
                  </div>
                  <span className="ml-2 font-code text-xs text-zinc-600">
                    {selectedFeature.usage}
                  </span>
                </div>
                <div className="p-4 font-code text-[13px] leading-relaxed">
                  <pre className="text-zinc-500 whitespace-pre-wrap">{selectedFeature.output}</pre>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

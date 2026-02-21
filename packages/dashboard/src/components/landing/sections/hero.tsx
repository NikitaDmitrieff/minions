"use client";
import { motion, AnimatePresence } from "motion/react";
import { useState } from "react";
import { TextHoverEffect } from "@/components/ui/text-hover-effect";
import { Terminal } from "@/components/landing/terminal";
import { CornerFrame } from "@/components/ui/corner-frame";
import { CanvasRevealEffect } from "@/components/ui/canvas-reveal-effect";

const heroTerminalLines = [
  { text: "minions scout --repo my-app", type: "command" as const },
  { text: "\u2713 Cloned repository", type: "output" as const, color: "#28c840" },
  { text: "\u2713 Analyzing 7 categories in parallel...", type: "output" as const, color: "#28c840" },
  { text: "\u2713 Found 12 findings across security, performance, DX", type: "output" as const, color: "#28c840" },
  { text: "", type: "empty" as const },
  { text: "minions strategize", type: "command" as const },
  { text: "\u2713 Generated 4 proposals (avg score: 0.78)", type: "output" as const, color: "#28c840" },
  { text: "  \u2192 Add input validation to API routes", type: "output" as const, color: "#1a1ab0" },
  { text: "  \u2192 Extract shared auth middleware", type: "output" as const, color: "#1a1ab0" },
  { text: "", type: "empty" as const },
  { text: "minions build --proposal P-001", type: "command" as const },
  { text: "\u2713 Implementing changes...", type: "output" as const, color: "#28c840" },
  { text: "\u2713 Lint \u2713 Typecheck \u2713 Build \u2713 Tests", type: "output" as const, color: "#28c840" },
  { text: "\u2713 Created PR #42", type: "output" as const, color: "#28c840" },
  { text: "", type: "empty" as const },
  { text: "minions review --pr 42", type: "command" as const },
  { text: "\u2713 Risk assessment: low", type: "output" as const, color: "#28c840" },
  { text: "\u2713 Approved and merged", type: "output" as const, color: "#28c840" },
];

const loopSteps = [
  {
    label: "Scout",
    description: "Clones & analyzes 7 categories in parallel",
    number: "01",
    colors: [[26, 26, 176]] as number[][],
  },
  {
    label: "Strategize",
    description: "Scores proposals on impact, feasibility, novelty",
    number: "02",
    colors: [[64, 64, 224]] as number[][],
  },
  {
    label: "Build",
    description: "Implements in sandbox, validates, ships PRs",
    number: "03",
    colors: [[26, 26, 176], [64, 64, 224]] as number[][],
  },
  {
    label: "Review",
    description: "Risk-tiered review, SHA-pinned merge",
    number: "04",
    colors: [[100, 100, 255]] as number[][],
  },
];

function LoopCard({
  step,
  index,
}: {
  step: (typeof loopSteps)[0];
  index: number;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: 0.2 + index * 0.1 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group/canvas-card relative flex items-center justify-center border border-white/[0.06] rounded-lg w-full mx-auto p-4 h-[14rem] overflow-hidden bg-black"
    >
      {/* Corner icons */}
      <Icon className="absolute h-6 w-6 -top-3 -left-3 text-white/20" />
      <Icon className="absolute h-6 w-6 -bottom-3 -left-3 text-white/20" />
      <Icon className="absolute h-6 w-6 -top-3 -right-3 text-white/20" />
      <Icon className="absolute h-6 w-6 -bottom-3 -right-3 text-white/20" />

      {/* Canvas effect on hover */}
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 h-full w-full"
          >
            <CanvasRevealEffect
              animationSpeed={3}
              containerClassName="bg-transparent"
              colors={step.colors}
              dotSize={2}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div className="relative z-20 flex flex-col items-center text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[#1a1ab0]/30 bg-black/80 shadow-[0_0_20px_rgba(26,26,176,0.1)] transition-all duration-300 group-hover/canvas-card:shadow-[0_0_30px_rgba(26,26,176,0.25)]">
          <span className="font-code text-sm font-bold text-[#4040e0]">
            {step.number}
          </span>
        </div>
        <h3 className="mt-3 font-display text-lg font-bold text-zinc-100 transition-colors group-hover/canvas-card:text-white">
          {step.label}
        </h3>
        <p className="mt-1.5 font-code text-[11px] text-zinc-500 max-w-[180px] leading-relaxed transition-colors group-hover/canvas-card:text-zinc-400">
          {step.description}
        </p>
      </div>
    </motion.div>
  );
}

function Icon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth="1.5"
      stroke="currentColor"
      className={className}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6" />
    </svg>
  );
}

function LoopVisualization() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="relative flex flex-col items-center"
    >
      {/* 4 cards grid */}
      <div className="grid grid-cols-2 gap-4 w-full max-w-2xl lg:grid-cols-4 lg:max-w-4xl">
        {loopSteps.map((step, i) => (
          <LoopCard key={step.label} step={step} index={i} />
        ))}
      </div>

      {/* Loop arrow — connecting the cards conceptually */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.8 }}
        className="mt-8 flex items-center gap-3 text-zinc-600"
      >
        <div className="h-px w-8 bg-gradient-to-r from-transparent to-[#1a1ab0]/30" />
        <motion.span
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          className="font-code text-xs text-[#1a1ab0]/60 select-none"
        >
          &#8734; continuous loop
        </motion.span>
        <div className="h-px w-8 bg-gradient-to-l from-transparent to-[#1a1ab0]/30" />
      </motion.div>

      {/* Descriptors below */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 1 }}
        className="mt-10 grid grid-cols-3 gap-10 text-center max-w-lg"
      >
        <div>
          <div className="font-code text-2xl font-bold text-white">24/7</div>
          <div className="mt-1 font-code text-[11px] text-zinc-600">Always running</div>
        </div>
        <div>
          <div className="font-code text-2xl font-bold text-white">Safe</div>
          <div className="mt-1 font-code text-[11px] text-zinc-600">Sandboxed builds</div>
        </div>
        <div>
          <div className="font-code text-2xl font-bold text-white">Yours</div>
          <div className="mt-1 font-code text-[11px] text-zinc-600">You set the rules</div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function Hero() {
  return (
    <section className="relative bg-black">
      {/* Above the fold — MINIONS + CTA */}
      <div className="flex min-h-screen flex-col items-center justify-center px-4">
        {/* MINIONS — the centerpiece */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1 }}
          className="w-full max-w-5xl h-[16rem] sm:h-[20rem] md:h-[24rem]"
        >
          <TextHoverEffect text="MINIONS" duration={0.3} textSize="text-7xl" />
        </motion.div>

        {/* CTA — GitHub link */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="mt-16"
        >
          <CornerFrame lines className="mt-4">
            <a
              href="https://github.com/NikitaDmitrieff/minions"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative mx-auto flex items-center gap-3 rounded-[3px] border border-[#1a1ab0]/20 bg-black/80 px-8 py-5 font-code text-base backdrop-blur-sm transition-all hover:border-[#1a1ab0]/40 hover:bg-white/[0.03]"
            >
              <span className="text-[#1a1ab0] select-none">&#9733;</span>
              <span className="text-zinc-300">Star on GitHub</span>
              <span className="ml-4 text-zinc-600 transition-colors group-hover:text-zinc-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </span>
            </a>
          </CornerFrame>
        </motion.div>
      </div>

      {/* The Loop — what Minions actually is */}
      <div className="relative py-32 overflow-hidden">
        <div className="absolute inset-0 bg-grid opacity-20" />
        <div className="absolute inset-0 bg-radial-fade" />

        <div className="relative z-10 max-w-4xl mx-auto px-4">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
              An autonomous loop that{" "}
              <span className="text-gradient">never stops working.</span>
            </h2>
            <p className="mt-6 text-lg text-zinc-500 max-w-2xl mx-auto leading-relaxed">
              Minions is an AI worker swarm that runs continuously on your codebase.
              It scans for problems, proposes fixes, implements them in sandboxed PRs,
              reviews its own work, and merges safely &mdash; then loops back and does it again.
              You set the strategy. The swarm executes. 24/7.
            </p>
          </motion.div>

          {/* Loop visualization */}
          <LoopVisualization />
        </div>
      </div>

      {/* Below — tagline + terminal */}
      <div className="flex flex-col items-center px-4 pb-32">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="text-center font-[helvetica] text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl"
        >
          Your codebase.{" "}
          <span className="text-gradient">Continuously improved.</span>
        </motion.h2>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mt-4 text-lg text-zinc-500 max-w-lg mx-auto text-center"
        >
          Watch the pipeline in action.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="mt-12 w-full max-w-2xl h-[420px]"
        >
          <Terminal
            lines={heroTerminalLines}
            title="minions — pipeline run"
            typingSpeed={4}
            lineDelay={60}
            startDelay={400}
          />
        </motion.div>
      </div>
    </section>
  );
}

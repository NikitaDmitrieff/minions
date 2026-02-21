"use client";
import { motion, useInView } from "motion/react";
import { useRef } from "react";

export function Comparison() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section id="compare" className="relative py-28 overflow-hidden" ref={ref}>
      <div className="relative z-10 max-w-4xl mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-16"
        >
          <span className="font-code text-sm font-medium text-[#1a1ab0] tracking-wider uppercase">
            Why not manual?
          </span>
          <h2 className="mt-4 font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
            Manual reviews weren&apos;t{" "}
            <span className="inline-block relative px-2 py-1 rounded-sm bg-neutral-900">
              designed for this
            </span>
          </h2>
        </motion.div>

        {/* Side-by-side comparison */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="grid grid-cols-1 md:grid-cols-2 gap-6"
        >
          {/* Manual — the problem */}
          <div className="rounded-[3px] border border-red-500/10 bg-gradient-to-br from-red-950/10 to-black p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-red-400 text-lg">&#10005;</span>
              <span className="font-display text-sm font-bold text-zinc-300">Manual Reviews</span>
            </div>
            <div className="font-code text-xs text-zinc-600 space-y-1.5">
              <div className="text-red-400/60">Monday morning</div>
              <div>&#9500;&#9472;&#9472; 23 PRs waiting for review</div>
              <div>&#9500;&#9472;&#9472; 5 stale branches</div>
              <div>&#9500;&#9472;&#9472; 0 security audits this month</div>
              <div className="text-red-500/40">&#9492;&#9472;&#9472; tech debt growing...</div>
            </div>
            <div className="mt-4 space-y-2 text-sm text-zinc-600">
              <div>N PRs = N hours of context-switching</div>
              <div>Code review is a full-time job</div>
              <div>Improvements never get prioritized</div>
            </div>
          </div>

          {/* AI Swarm — the solution */}
          <div className="rounded-[3px] border border-emerald-500/10 bg-gradient-to-br from-emerald-950/10 to-black p-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-emerald-400 text-lg">&#10003;</span>
              <span className="font-display text-sm font-bold text-zinc-300">AI Swarm</span>
            </div>
            <div className="font-code text-xs text-zinc-600 space-y-1.5">
              <div className="text-emerald-400/60">Always running</div>
              <div>&#9500;&#9472;&#9472; Scout every 6 hours</div>
              <div>&#9500;&#9472;&#9472; Proposals auto-generated</div>
              <div className="text-emerald-400/40">&#9500;&#9472;&#9472; Build + test + PR in minutes</div>
              <div className="text-emerald-400/40">&#9492;&#9472;&#9472; Risk-tiered auto-merge</div>
            </div>
            <div className="mt-4 space-y-2 text-sm text-zinc-600">
              <div>One swarm, all repos</div>
              <div>Consistent 24/7 coverage</div>
              <div>You set the strategy, they execute</div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

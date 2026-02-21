"use client";
import { motion, useInView } from "motion/react";
import { useRef } from "react";
import { CornerFrame } from "@/components/ui/corner-frame";

const workers = [
  { name: "Scout", color: "#06b6d4", features: "7 categories \u00b7 parallel analysis \u00b7 dedup findings" },
  { name: "Strategist", color: "#8b5cf6", features: "multi-grader scoring \u00b7 impact \u00b7 feasibility" },
  { name: "Builder", color: "#10b981", features: "sandbox safety \u00b7 tiered validation \u00b7 auto-PR" },
  { name: "Reviewer", color: "#f59e0b", features: "risk tiers \u00b7 SHA-pinned \u00b7 auto-merge" },
];

export function Workers() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section className="relative py-28 overflow-hidden" ref={ref}>
      <div className="absolute inset-0 bg-grid opacity-30" />
      <div className="absolute inset-0 bg-radial-fade" />

      <div className="relative z-10 max-w-5xl mx-auto px-4">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <span className="font-code text-sm font-medium text-[#1a1ab0] tracking-wider uppercase">
            The swarm
          </span>
          <h2 className="mt-4 font-display text-4xl font-extrabold tracking-tight sm:text-5xl md:text-6xl">
            One repo.{" "}
            <span className="text-gradient">Four specialized workers.</span>
          </h2>
          <p className="mt-4 text-lg text-zinc-500 max-w-lg mx-auto">
            Each worker handles a different stage of the improvement pipeline. Together, they never stop.
          </p>
        </motion.div>

        {/* Worker fan-out */}
        <div className="relative flex flex-col items-center">
          {/* Source node */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={isInView ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <CornerFrame lines className="relative z-10 flex items-center gap-3 rounded-[3px] border border-white/[0.1] bg-white/[0.04] px-6 py-3 backdrop-blur-sm">
              <div className="flex h-8 w-8 items-center justify-center rounded-[3px] bg-[#1a1ab0]/15 border border-white/[0.1]">
                <span className="font-code text-xs font-bold text-white">M</span>
              </div>
              <div>
                <div className="font-display text-sm font-bold text-zinc-100">your repository</div>
                <div className="font-code text-[11px] text-zinc-600">github.com/you/your-app</div>
              </div>
            </CornerFrame>
          </motion.div>

          {/* Connecting line */}
          <motion.div
            initial={{ scaleY: 0 }}
            animate={isInView ? { scaleY: 1 } : {}}
            transition={{ duration: 0.4, delay: 0.5 }}
            className="w-px h-12 bg-gradient-to-b from-white/[0.15] to-white/[0.05] origin-top"
          />

          {/* Worker cards grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full">
            {workers.map((w, i) => (
              <motion.div
                key={w.name}
                initial={{ opacity: 0, y: 30 }}
                animate={isInView ? { opacity: 1, y: 0 } : {}}
                transition={{ duration: 0.5, delay: 0.6 + i * 0.1 }}
                className="group relative rounded-[3px] border border-white/[0.06] bg-white/[0.02] p-5 transition-all duration-300 hover:bg-white/[0.04] hover:border-white/[0.12]"
              >
                {/* Color accent line */}
                <div
                  className="absolute top-0 left-4 right-4 h-px"
                  style={{ background: `linear-gradient(90deg, transparent, ${w.color}40, transparent)` }}
                />
                <div
                  className="mb-3 flex h-7 w-7 items-center justify-center rounded-md border border-white/[0.08]"
                  style={{ background: `${w.color}15` }}
                >
                  <span className="font-code text-[10px] font-bold" style={{ color: w.color }}>
                    {w.name[0]}
                  </span>
                </div>
                <div className="font-display text-sm font-bold text-zinc-100">{w.name}</div>
                <div className="mt-1 font-code text-[11px] text-zinc-600 leading-relaxed">
                  {w.features}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

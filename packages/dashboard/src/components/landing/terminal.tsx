"use client";
import { useEffect, useRef, useState } from "react";
import { useInView } from "motion/react";
import { cn } from "@/lib/utils";

interface TerminalLine {
  text: string;
  type: "command" | "output" | "comment" | "empty";
  color?: string;
}

interface TerminalProps {
  lines: TerminalLine[];
  title?: string;
  className?: string;
  typingSpeed?: number;
  lineDelay?: number;
  startDelay?: number;
}

export function Terminal({
  lines,
  title = "terminal",
  className,
  typingSpeed = 30,
  lineDelay = 200,
  startDelay = 800,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isInView = useInView(containerRef, { once: true, margin: "-50px" });
  const [visibleLines, setVisibleLines] = useState<
    Array<{ text: string; type: string; color?: string }>
  >([]);
  const [isDone, setIsDone] = useState(false);
  const [showInitialCursor, setShowInitialCursor] = useState(true);

  useEffect(() => {
    if (!isInView) return;

    let lineIdx = 0;
    let charIdx = 0;
    let currentLines: Array<{ text: string; type: string; color?: string }> =
      [];
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function tick() {
      if (cancelled) return;
      if (lineIdx >= lines.length) {
        setIsDone(true);
        return;
      }

      setShowInitialCursor(false);
      const line = lines[lineIdx];

      if (line.type !== "command") {
        currentLines = [
          ...currentLines,
          { text: line.text, type: line.type, color: line.color },
        ];
        setVisibleLines([...currentLines]);
        lineIdx++;
        charIdx = 0;
        timer = setTimeout(tick, line.type === "empty" ? 50 : lineDelay);
        return;
      }

      if (charIdx === 0) {
        currentLines = [
          ...currentLines,
          { text: "", type: "command", color: line.color },
        ];
      }

      if (charIdx < line.text.length) {
        currentLines[currentLines.length - 1] = {
          text: line.text.substring(0, charIdx + 1),
          type: "command",
          color: line.color,
        };
        setVisibleLines([...currentLines]);
        charIdx++;
        timer = setTimeout(tick, typingSpeed + Math.random() * 20);
      } else {
        lineIdx++;
        charIdx = 0;
        timer = setTimeout(tick, lineDelay * 2);
      }
    }

    timer = setTimeout(tick, startDelay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isInView, lines, typingSpeed, lineDelay, startDelay]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "overflow-hidden rounded-md border border-white/[0.08] bg-[#0a0a0a] shadow-2xl shadow-[#1a1ab0]/[0.03]",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <div className="flex gap-1.5">
          <div className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          <div className="h-3 w-3 rounded-full bg-[#febc2e]" />
          <div className="h-3 w-3 rounded-full bg-[#28c840]" />
        </div>
        <span className="ml-2 font-code text-xs text-zinc-600">{title}</span>
      </div>
      <div className="p-4 font-code text-[13px] leading-relaxed min-h-[100px] overflow-x-auto">
        {visibleLines.map((line, i) => (
          <div key={i} className="whitespace-pre">
            {line.type === "command" && (
              <span className="text-[#1a1ab0] select-none">$ </span>
            )}
            {line.type === "comment" && (
              <span className="text-zinc-600 select-none"># </span>
            )}
            <span
              className={cn(
                line.type === "output" && "text-zinc-400",
                line.type === "command" && "text-zinc-100",
                line.type === "comment" && "text-zinc-600"
              )}
              style={line.color ? { color: line.color } : undefined}
            >
              {line.text}
            </span>
          </div>
        ))}
        {showInitialCursor && (
          <div className="whitespace-pre">
            <span className="text-[#1a1ab0] select-none">$ </span>
            <span className="animate-blink text-zinc-100">▋</span>
          </div>
        )}
        {isDone && (
          <div className="whitespace-pre">
            <span className="text-[#1a1ab0] select-none">$ </span>
            <span className="animate-blink text-zinc-100">▋</span>
          </div>
        )}
      </div>
    </div>
  );
}

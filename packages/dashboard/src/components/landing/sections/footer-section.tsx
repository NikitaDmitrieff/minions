"use client";
import { TextHoverEffect } from "@/components/ui/text-hover-effect";

export function FooterSection() {
  return (
    <footer className="relative border-t border-white/[0.04] px-4 pt-12 pb-8">
      <div className="max-w-6xl mx-auto flex flex-col items-center gap-8 text-center">
        {/* Full MINIONS text — muted grey */}
        <div className="w-full max-w-4xl h-[10rem] sm:h-[14rem] md:h-[16rem] opacity-25">
          <TextHoverEffect text="MINIONS" duration={0.3} textSize="text-7xl" />
        </div>

        <div className="flex items-center gap-6 text-sm text-zinc-600">
          <a
            href="https://github.com/NikitaDmitrieff/minions"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-zinc-300"
          >
            GitHub
          </a>
          <a
            href="https://github.com/NikitaDmitrieff/minions#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-zinc-300"
          >
            Docs
          </a>
          <a
            href="https://github.com/NikitaDmitrieff/minions/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-zinc-300"
          >
            MIT License
          </a>
        </div>
        <p className="text-xs text-zinc-700">
          Built by{" "}
          <a
            href="https://github.com/NikitaDmitrieff"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Nikita Dmitrieff
          </a>
        </p>
      </div>
    </footer>
  );
}

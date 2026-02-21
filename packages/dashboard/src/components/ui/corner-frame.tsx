"use client";
import { cn } from "@/lib/utils";

export function CornerFrame({
  children,
  className,
  cornerClassName,
  animate = true,
  lines = false,
}: {
  children: React.ReactNode;
  className?: string;
  cornerClassName?: string;
  animate?: boolean;
  lines?: boolean;
}) {
  const dotBase = cn(
    "absolute h-2 w-2 rounded-full bg-[#1a1ab0] opacity-40",
    animate && "animate-pulse",
    cornerClassName
  );

  return (
    <div className={cn("relative", className)}>
      {children}

      {/* Corner dots */}
      <div className={cn(dotBase, "-top-[3px] -left-[3px]")} />
      <div className={cn(dotBase, "-top-[3px] -right-[3px]")} style={{ animationDelay: "0.4s" }} />
      <div className={cn(dotBase, "-bottom-[3px] -left-[3px]")} style={{ animationDelay: "0.8s" }} />
      <div className={cn(dotBase, "-bottom-[3px] -right-[3px]")} style={{ animationDelay: "1.2s" }} />

      {/* Optional L-bracket lines */}
      {lines && (
        <>
          <div className="absolute -top-px -left-px w-4 h-px bg-[#1a1ab0]/30" />
          <div className="absolute -top-px -left-px w-px h-4 bg-[#1a1ab0]/30" />
          <div className="absolute -top-px -right-px w-4 h-px bg-[#1a1ab0]/30" />
          <div className="absolute -top-px -right-px w-px h-4 bg-[#1a1ab0]/30" />
          <div className="absolute -bottom-px -left-px w-4 h-px bg-[#1a1ab0]/30" />
          <div className="absolute -bottom-px -left-px w-px h-4 bg-[#1a1ab0]/30" />
          <div className="absolute -bottom-px -right-px w-4 h-px bg-[#1a1ab0]/30" />
          <div className="absolute -bottom-px -right-px w-px h-4 bg-[#1a1ab0]/30" />
        </>
      )}
    </div>
  );
}

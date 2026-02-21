"use client";
import React, { useRef, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";

interface CanvasRevealEffectProps {
  animationSpeed?: number;
  colors?: number[][];
  containerClassName?: string;
  dotSize?: number;
  showGradient?: boolean;
}

export const CanvasRevealEffect: React.FC<CanvasRevealEffectProps> = ({
  animationSpeed = 3,
  colors = [[0, 255, 255]],
  containerClassName,
  dotSize = 3,
  showGradient = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;

  const config = useMemo(
    () => ({ animationSpeed, dotSize }),
    [animationSpeed, dotSize]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = 0;
    let height = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    startTimeRef.current = performance.now();

    const gap = config.dotSize * 3;

    const animate = (now: number) => {
      const elapsed = (now - startTimeRef.current) / 1000;
      const speed = config.animationSpeed;
      const ds = config.dotSize;
      const cols = Math.ceil(width / gap);
      const rows = Math.ceil(height / gap);
      const maxDist = Math.sqrt(cols * cols + rows * rows);
      const currentColors = colorsRef.current;

      ctx.clearRect(0, 0, width, height);

      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
          const dist = Math.sqrt(col * col + row * row);
          const delay = dist / maxDist;
          const t = Math.max(0, elapsed * speed - delay * 4);
          const opacity = Math.min(1, t);

          if (opacity <= 0) continue;

          const colorIdx =
            Math.floor(
              (col * 7 + row * 13 + Math.floor(elapsed * 2)) %
                currentColors.length
            );
          const [r, g, b] = currentColors[colorIdx];

          // Subtle shimmer
          const shimmer =
            0.6 +
            0.4 *
              Math.sin(elapsed * 1.5 + col * 0.3 + row * 0.3);

          ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${opacity * shimmer * 0.8})`;

          const x = col * gap + gap / 2;
          const y = row * gap + gap / 2;

          ctx.beginPath();
          ctx.arc(x, y, ds / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationRef.current);
      observer.disconnect();
    };
  }, [config]);

  return (
    <div className={cn("h-full relative w-full", containerClassName)}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
      />
      {showGradient && (
        <div className="absolute inset-0 [mask-image:radial-gradient(300px_at_center,white,transparent)] bg-black/60" />
      )}
    </div>
  );
};

"use client";

import { useEffect, useRef } from "react";

const LIGHT_LERP = 0.14;
const IDLE_SWEEP_MS = 5200;

// Écrin: the image stays in shadow except where the visitor's light falls.
// Pointer drives the light; on touch devices it sweeps on its own so phones see the same effect.
export function CursorLight({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let target = { x: 0.5, y: 0.45 };
    const pos = { ...target };
    let pointerSeen = false;
    let raf = 0;
    const start = performance.now();

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      pointerSeen = true;
      target = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    };

    const tick = (now: number) => {
      if (!pointerSeen && !reduced) {
        const t = ((now - start) % IDLE_SWEEP_MS) / IDLE_SWEEP_MS;
        target = { x: 0.5 + 0.34 * Math.sin(t * Math.PI * 2), y: 0.45 + 0.12 * Math.cos(t * Math.PI * 4) };
      }
      pos.x += (target.x - pos.x) * LIGHT_LERP;
      pos.y += (target.y - pos.y) * LIGHT_LERP;
      el.style.setProperty("--lx", `${(pos.x * 100).toFixed(2)}%`);
      el.style.setProperty("--ly", `${(pos.y * 100).toFixed(2)}%`);
      raf = requestAnimationFrame(tick);
    };

    el.addEventListener("pointermove", onMove);
    raf = requestAnimationFrame(tick);
    return () => {
      el.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={ref} className={`cursor-light ${className}`}>
      {children}
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import { PORTRAIT_QUERY } from "@/lib/film/config";

/** Film progress at which the shutter is fully up and the shop lit; the main film holds frame 0 until then. */
export const PRELUDE_END = 0.1;
/** Progress span over which the prelude hands over to the film's first frame. */
export const PRELUDE_FADE = 0.025;
const MAX_DPR = 2;

type Aspect = "16x9" | "9x16";

/**
 * Écrin's opening: the shop's real shutter rises and the lights come on, driven by scroll.
 * A short frame sequence drawn above the film canvas and below the living sign, so the gold sign
 * already glows while the shutter is down. Its last frame is the film's first frame, so it hands over
 * without a seam.
 */
export function Prelude({
  root,
  frameCount,
  progress,
}: {
  root: string;
  frameCount: number;
  progress: React.RefObject<number>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const aspect: Aspect = matchMedia(PORTRAIT_QUERY).matches ? "9x16" : "16x9";
    const tier = window.innerWidth * Math.min(devicePixelRatio, MAX_DPR) > 1600 ? "hi" : "lite";
    const frames: (ImageBitmap | null)[] = new Array(frameCount).fill(null);
    let alive = true;
    let raf = 0;
    let drawn = -1;

    const url = (i: number) => `${root}/${aspect}-prelude/${tier}/${String(i).padStart(4, "0")}.webp`;
    // Coarse to fine: every 4th frame first, so scrubbing works at once and sharpens as the rest arrive.
    const order = [...Array(frameCount).keys()].sort((a, b) => (a % 4) - (b % 4) || a - b);
    (async () => {
      for (const i of order) {
        if (!alive) return;
        try {
          const blob = await (await fetch(url(i))).blob();
          frames[i] = await createImageBitmap(blob);
        } catch {
          // A missing frame falls back to its nearest loaded neighbour.
        }
      }
    })();

    const nearest = (i: number) => {
      for (let d = 0; d < frameCount; d++) {
        if (frames[i - d]) return frames[i - d];
        if (frames[i + d]) return frames[i + d];
      }
      return null;
    };

    const resize = () => {
      const dpr = Math.min(devicePixelRatio, MAX_DPR);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      drawn = -1;
    };

    const tick = () => {
      const p = progress.current ?? 0;
      const t = Math.min(p / PRELUDE_END, 1);
      const i = Math.round(t * (frameCount - 1));
      canvas.style.opacity = String(p <= PRELUDE_END ? 1 : Math.max(0, 1 - (p - PRELUDE_END) / PRELUDE_FADE));
      const img = nearest(i);
      if (img && i !== drawn) {
        // Cover-fit around the frame centre, same as the film canvas and the finale plates.
        const s = Math.max(canvas.width / img.width, canvas.height / img.height);
        const w = img.width * s;
        const h = img.height * s;
        ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        if (frames[i]) drawn = i;
      }
      raf = requestAnimationFrame(tick);
    };

    resize();
    window.addEventListener("resize", resize);
    raf = requestAnimationFrame(tick);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      frames.forEach((f) => f?.close());
    };
  }, [root, frameCount, progress]);

  return <canvas ref={canvasRef} className="prelude" aria-hidden="true" />;
}

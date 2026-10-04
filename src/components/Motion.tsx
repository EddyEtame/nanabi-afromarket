"use client";

import { useEffect } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { usePrefs } from "@/lib/prefs";

gsap.registerPlugin(ScrollTrigger);

const PARALLAX_SHIFT = 7; // % the image travels inside its frame across one viewport
const MAGNET_PULL = 0.32; // share of the pointer offset a button follows
const TILT_DEG = 5; // Galerie: maximum tilt of a framed work toward the pointer
const INK_BAND = "-46% 0px -46% 0px"; // the thin band at mid-viewport that decides the page ink

/**
 * Page-wide motion. Everything here moves existing elements (transforms, CSS variables);
 * nothing rewrites React-managed DOM. Re-runs when the art direction changes.
 */
export function Motion() {
  const { ad } = usePrefs();

  useEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finePointer = matchMedia("(hover: hover) and (pointer: fine)").matches;
    const root = document.documentElement;
    const cleanups: Array<() => void> = [];

    const ctx = gsap.context(() => {
      if (reduced) return;

      // Images drift inside their frames: depth without moving the layout.
      gsap.utils.toArray<HTMLElement>("[data-parallax]").forEach((frame) => {
        const img = frame.querySelector("img");
        if (!img) return;
        gsap.fromTo(
          img,
          { yPercent: -PARALLAX_SHIFT, scale: 1.14 },
          {
            yPercent: PARALLAX_SHIFT,
            scale: 1.14,
            ease: "none",
            scrollTrigger: { trigger: frame, start: "top bottom", end: "bottom top", scrub: true },
          },
        );
      });

      // Magnetic actions: the button leans toward the pointer, then settles back.
      if (finePointer) {
        gsap.utils.toArray<HTMLElement>(".btn, .site-nav__cta").forEach((btn) => {
          const xTo = gsap.quickTo(btn, "x", { duration: 0.5, ease: "power3" });
          const yTo = gsap.quickTo(btn, "y", { duration: 0.5, ease: "power3" });
          const move = (e: PointerEvent) => {
            const r = btn.getBoundingClientRect();
            xTo((e.clientX - (r.left + r.width / 2)) * MAGNET_PULL);
            yTo((e.clientY - (r.top + r.height / 2)) * MAGNET_PULL);
          };
          const leave = () => {
            xTo(0);
            yTo(0);
          };
          btn.addEventListener("pointermove", move);
          btn.addEventListener("pointerleave", leave);
          cleanups.push(() => {
            btn.removeEventListener("pointermove", move);
            btn.removeEventListener("pointerleave", leave);
          });
        });
      }

      // Galerie: each framed work turns gently toward the visitor, like a canvas under gallery lights.
      if (ad === "galerie" && finePointer) {
        gsap.utils.toArray<HTMLElement>(".aisle__media, .heads__media").forEach((frame) => {
          gsap.set(frame, { transformPerspective: 1100 });
          const rx = gsap.quickTo(frame, "rotationX", { duration: 0.8, ease: "power3" });
          const ry = gsap.quickTo(frame, "rotationY", { duration: 0.8, ease: "power3" });
          const move = (e: PointerEvent) => {
            const r = frame.getBoundingClientRect();
            ry(((e.clientX - r.left) / r.width - 0.5) * 2 * TILT_DEG);
            rx(-((e.clientY - r.top) / r.height - 0.5) * 2 * TILT_DEG);
            frame.style.setProperty("--glare-x", `${((e.clientX - r.left) / r.width) * 100}%`);
            frame.style.setProperty("--glare-y", `${((e.clientY - r.top) / r.height) * 100}%`);
          };
          const leave = () => {
            rx(0);
            ry(0);
          };
          frame.addEventListener("pointermove", move);
          frame.addEventListener("pointerleave", leave);
          cleanups.push(() => {
            frame.removeEventListener("pointermove", move);
            frame.removeEventListener("pointerleave", leave);
            gsap.set(frame, { clearProps: "transform" });
          });
        });
      }
    });

    // Lexique: the page takes the colour of the cloth at the centre of the screen.
    if (ad === "lexique") {
      const io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) root.style.setProperty("--page-ink", (e.target as HTMLElement).dataset.ink ?? "transparent");
          }
        },
        { rootMargin: INK_BAND },
      );
      document.querySelectorAll<HTMLElement>("[data-ink]").forEach((el) => io.observe(el));
      const clear = new IntersectionObserver(
        (entries) => {
          for (const e of entries) if (e.isIntersecting) root.style.removeProperty("--page-ink");
        },
        { rootMargin: INK_BAND },
      );
      document.querySelectorAll<HTMLElement>("[data-ink-clear]").forEach((el) => clear.observe(el));
      cleanups.push(() => {
        io.disconnect();
        clear.disconnect();
        root.style.removeProperty("--page-ink");
      });
    }

    ScrollTrigger.refresh();
    return () => {
      cleanups.forEach((fn) => fn());
      ctx.revert();
    };
  }, [ad]);

  return null;
}

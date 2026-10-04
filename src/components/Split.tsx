"use client";

import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { usePrefs } from "@/lib/prefs";

gsap.registerPlugin(ScrollTrigger, SplitText);

type Mode = "lines" | "words-scrub";

/**
 * Text that composes itself on scroll. "lines": each line rises out of its own mask.
 * "words-scrub": words brighten one by one as the reader scrolls through, like a letter being written.
 * The element is re-keyed on language and art direction, so React never reconciles into split DOM
 * and the split always matches the current fonts.
 */
export function Split({
  as: Tag = "p",
  mode = "lines",
  className = "",
  id,
  children,
}: {
  as?: "h1" | "h2" | "p" | "span";
  mode?: Mode;
  className?: string;
  id?: string;
  children: React.ReactNode;
}) {
  const { ad, lang } = usePrefs();
  return (
    <SplitInner key={`${ad}-${lang}`} Tag={Tag} mode={mode} className={className} id={id}>
      {children}
    </SplitInner>
  );
}

function SplitInner({
  Tag,
  mode,
  className,
  id,
  children,
}: {
  Tag: "h1" | "h2" | "p" | "span";
  mode: Mode;
  className: string;
  id?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let split: SplitText | null = null;
    let tween: gsap.core.Tween | null = null;
    // Wait for the web fonts, or lines would be measured on the fallback face.
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      if (mode === "lines") {
        split = SplitText.create(el, { type: "lines", mask: "lines", linesClass: "split-line" });
        tween = gsap.from(split.lines, {
          yPercent: 108,
          duration: 1.25,
          ease: "expo.out",
          stagger: 0.09,
          scrollTrigger: { trigger: el, start: "top 88%", once: true },
        });
      } else {
        split = SplitText.create(el, { type: "words", wordsClass: "split-word" });
        tween = gsap.fromTo(
          split.words,
          { opacity: 0.14 },
          {
            opacity: 1,
            ease: "none",
            stagger: 0.06,
            scrollTrigger: { trigger: el, start: "top 80%", end: "bottom 45%", scrub: true },
          },
        );
      }
    });
    return () => {
      cancelled = true;
      tween?.scrollTrigger?.kill();
      tween?.kill();
      split?.revert();
    };
  }, [mode]);

  return (
    <Tag ref={ref as React.Ref<never>} className={className} id={id}>
      {children}
    </Tag>
  );
}

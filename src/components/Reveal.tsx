"use client";

import { useEffect, useRef } from "react";

// Marks children as revealed when they enter the viewport. Without JS the content is simply visible.
export function Reveal({
  as: Tag = "div",
  className = "",
  children,
  delay = 0,
  style,
}: {
  as?: "div" | "section" | "li" | "p" | "h2" | "figure";
  className?: string;
  children: React.ReactNode;
  delay?: number;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.dataset.revealed = "true";
            io.disconnect();
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref as React.Ref<never>}
      className={`reveal ${className}`}
      style={delay ? ({ ...style, "--reveal-delay": `${delay}ms` } as React.CSSProperties) : style}
    >
      {children}
    </Tag>
  );
}

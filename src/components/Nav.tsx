"use client";

import { useEffect, useRef, useState } from "react";
import { facts, ui } from "@/content/site";
import { usePrefs } from "@/lib/prefs";

const NAV_SOLID_OFFSET = 120; // px: the nav turns solid when the page below the film reaches this line
const NAV_REVEAL_ZONE = 80; // px: near the top of the page the nav always shows
const SCROLL_INTENT_PX = 6; // px: ignore jitter smaller than this when reading scroll direction

const LINKS = [
  { href: "#rayons", label: { fr: "Rayons", en: "Aisles" } },
  { href: "#lexique", label: { fr: "Lexique", en: "Lexicon" } },
  { href: "#tetes", label: { fr: "Coiffure", en: "Hair" } },
  { href: "#venir", label: { fr: "Venir", en: "Visit" } },
];

export function Nav() {
  const { t } = usePrefs();
  const ref = useRef<HTMLElement>(null);
  const [overFilm, setOverFilm] = useState(true);
  const [hidden, setHidden] = useState(false);

  // Transparent over the film, solid once the page below begins. While the film plays forward the nav
  // steps aside so it never covers the sign; any upward scroll brings it back.
  useEffect(() => {
    const target = document.getElementById("bienvenue");
    if (!target) return;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      const inFilm = target.getBoundingClientRect().top > NAV_SOLID_OFFSET;
      setOverFilm(inFilm);
      if (Math.abs(y - lastY) > SCROLL_INTENT_PX) {
        setHidden(inFilm && y > lastY && y > NAV_REVEAL_ZONE);
        lastY = y;
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Publishes the nav height so the film can slide underneath it.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--nav-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <header
      ref={ref}
      className="site-nav gutter"
      data-over-film={overFilm || undefined}
      data-hidden={hidden || undefined}
    >
      <a href="#top" className="flex items-center gap-3" aria-label="NANABi AFROMARKET">
        {/* Her real logo file, on its own black ground as on her profile picture. */}
        <img src="/brand/logo-mark.png" alt="" width={40} height={40} className="h-10 w-10 rounded-full" />
        <span className="site-nav__word">
          NANAB<span className="lowercase">i</span>
        </span>
      </a>
      <nav aria-label="Sections" className="hidden items-center gap-7 md:flex">
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} className="site-nav__link">
            {t(l.label)}
          </a>
        ))}
      </nav>
      <a href={facts.mapsHref} target="_blank" rel="noopener" className="site-nav__cta">
        {t(ui.directions)}
      </a>
    </header>
  );
}

"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { L10n, Lang } from "@/content/site";

export type ArtDirection = "lexique" | "galerie" | "ecrin";
export type Ending = "a" | "b";

export const ART_DIRECTIONS: { id: ArtDirection; label: string }[] = [
  { id: "lexique", label: "Lexique" },
  { id: "galerie", label: "Galerie" },
  { id: "ecrin", label: "Écrin" },
];

// Half of the wipe: the art direction swaps while the curtain fully covers the page.
const WIPE_HALF_MS = 520;

type Prefs = {
  ad: ArtDirection;
  ending: Ending;
  lang: Lang;
  switching: boolean;
  setAd: (ad: ArtDirection) => void;
  setEnding: (e: Ending) => void;
  setLang: (l: Lang) => void;
  t: (s: L10n) => string;
};

const PrefsContext = createContext<Prefs | null>(null);

function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the page still works without it.
  }
}

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [ad, setAdState] = useState<ArtDirection>("lexique");
  const [ending, setEndingState] = useState<Ending>("a");
  const [lang, setLangState] = useState<Lang>("fr");
  const [switching, setSwitching] = useState(false);

  // The boot script in <head> already applied saved values to <html>; adopt them after hydration.
  useEffect(() => {
    const d = document.documentElement.dataset;
    if (d.ad === "galerie" || d.ad === "ecrin" || d.ad === "lexique") setAdState(d.ad);
    if (d.ending === "a" || d.ending === "b") setEndingState(d.ending);
    if (d.lang === "fr" || d.lang === "en") setLangState(d.lang);
  }, []);

  const setAd = useCallback(
    (next: ArtDirection) => {
      if (next === ad || switching) return;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const apply = () => {
        document.documentElement.dataset.ad = next;
        history.replaceState(null, "", `#ad-${next}`);
        save("nb-ad", next);
        setAdState(next);
      };
      if (reduced) return apply();
      setSwitching(true);
      window.setTimeout(apply, WIPE_HALF_MS);
      window.setTimeout(() => setSwitching(false), WIPE_HALF_MS * 2);
    },
    [ad, switching],
  );

  const setEnding = useCallback((next: Ending) => {
    document.documentElement.dataset.ending = next;
    save("nb-ending", next);
    setEndingState(next);
  }, []);

  const setLang = useCallback((next: Lang) => {
    const root = document.documentElement;
    root.lang = next;
    root.dataset.lang = next;
    save("nb-lang", next);
    setLangState(next);
  }, []);

  const value = useMemo<Prefs>(
    () => ({ ad, ending, lang, switching, setAd, setEnding, setLang, t: (s) => s[lang] }),
    [ad, ending, lang, switching, setAd, setEnding, setLang],
  );

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used inside <PrefsProvider>");
  return ctx;
}

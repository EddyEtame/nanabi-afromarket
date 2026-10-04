"use client";

import { useEffect, useRef } from "react";
import { ART_DIRECTIONS, usePrefs } from "@/lib/prefs";
import { ui } from "@/content/site";

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex items-center gap-1">
      <span className="t-label mr-2 hidden opacity-60 md:inline">{label}</span>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className="demo-chip"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Demo-only control strip: lets Eddy and the client compare art directions, endings and languages live.
export function DemoBar() {
  const { ad, setAd, ending, setEnding, lang, setLang, switching, t } = usePrefs();
  const ref = useRef<HTMLDivElement>(null);

  // Publishes the bar height so the sticky nav sits right under it at every width.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      document.documentElement.style.setProperty("--demo-bar-h", `${el.offsetHeight}px`),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <div ref={ref} className="demo-bar gutter" data-switching={switching || undefined}>
        <Segmented label={t(ui.demoLabel)} options={ART_DIRECTIONS} value={ad} onChange={setAd} />
        <div className="flex items-center gap-4">
          <Segmented
            label={t(ui.endingLabel)}
            options={[
              { id: "a", label: "A" },
              { id: "b", label: "B" },
            ]}
            value={ending}
            onChange={setEnding}
          />
          <Segmented
            label={t(ui.langLabel)}
            options={[
              { id: "fr", label: "FR" },
              { id: "en", label: "EN" },
            ]}
            value={lang}
            onChange={setLang}
          />
        </div>
      </div>
      <div className="ad-wipe" aria-hidden="true" data-active={switching || undefined}>
        <span className="ad-wipe__line" />
      </div>
    </>
  );
}

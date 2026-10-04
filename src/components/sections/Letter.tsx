"use client";

import { letter } from "@/content/site";
import { usePrefs } from "@/lib/prefs";
import { Reveal } from "@/components/Reveal";
import { Split } from "@/components/Split";

export function Letter() {
  const { t, lang } = usePrefs();
  return (
    <section id="bienvenue" className="letter gutter" aria-labelledby="letter-title" data-ink-clear>
      <div className="letter__split">
        <Reveal as="p" className="letter__salute t-display">
          {t(letter.eyebrow)},
        </Reveal>
        <Split as="h2" className="letter__title t-display" id="letter-title">
          {t(letter.title)}
        </Split>
      </div>
      {/* The letter writes itself as the visitor reads down. */}
      <div className="letter__body">
        {letter.body[lang].map((p, i) => (
          <Split key={i} mode="words-scrub">
            {p}
          </Split>
        ))}
        <Reveal as="p" className="letter__sign t-display" delay={200}>
          {letter.signoff}
        </Reveal>
      </div>
    </section>
  );
}

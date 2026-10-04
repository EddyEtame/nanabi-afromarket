"use client";

import { letter } from "@/content/site";
import { usePrefs } from "@/lib/prefs";
import { Reveal } from "@/components/Reveal";

export function Letter() {
  const { t, lang } = usePrefs();
  return (
    <section id="bienvenue" className="letter gutter" aria-labelledby="letter-title">
      <div className="letter__split">
        <Reveal as="p" className="letter__salute t-display">
          {t(letter.eyebrow)},
        </Reveal>
        <Reveal as="h2" className="letter__title t-display" delay={120}>
          <span id="letter-title">{t(letter.title)}</span>
        </Reveal>
      </div>
      <div className="letter__body">
        {letter.body[lang].map((p, i) => (
          <Reveal key={i} as="p" delay={160 + i * 120}>
            {p}
          </Reveal>
        ))}
        <Reveal as="p" className="letter__sign t-display" delay={560}>
          {letter.signoff}
        </Reveal>
      </div>
    </section>
  );
}

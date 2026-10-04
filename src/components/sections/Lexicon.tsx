"use client";

import { lexicon } from "@/content/site";
import { usePrefs } from "@/lib/prefs";
import { Reveal } from "@/components/Reveal";

// The colour each entry lends to the page in the Lexique direction, sampled from her shop and feed.
const INKS = ["#276386", "#C9871F", "#A8172F", "#2E6B3F", "#23355E", "#A7935A", "#B2404E"];

export function Lexicon() {
  const { t } = usePrefs();
  return (
    <section id="lexique" className="lexicon gutter" aria-labelledby="lexicon-title">
      <header className="lexicon__head">
        <p className="t-label">{t({ fr: "Le lexique", en: "The lexicon" })}</p>
        <h2 id="lexicon-title" className="t-display lexicon__title">
          {t({ fr: "Les mots qu’on entend ", en: "The words you hear " })}
          <span className="t-italic-word">{t({ fr: "entre les rayons.", en: "between the aisles." })}</span>
        </h2>
      </header>
      <dl className="lexicon__list">
        {lexicon.map((e, i) => (
          <Reveal
            key={e.term}
            className="lexicon__entry"
            delay={(i % 3) * 80}
          >
            <dt className="lexicon__term t-display" style={{ "--ink": INKS[i % INKS.length] } as React.CSSProperties}>
              {/* A real piece from her shop: the word and the cloth, side by side. */}
              <img className="lexicon__swatch" src={`/img/swatch/${e.term}.jpg`} alt="" loading="lazy" decoding="async" />
              <span>{t(e.title)}</span>
            </dt>
            <dd className="lexicon__def">{t(e.def)}</dd>
          </Reveal>
        ))}
      </dl>
    </section>
  );
}

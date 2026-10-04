"use client";

import { aisles } from "@/content/site";
import { usePrefs } from "@/lib/prefs";
import { Reveal } from "@/components/Reveal";
import { CursorLight } from "@/components/CursorLight";
import { Split } from "@/components/Split";
import { Picture } from "@/components/Picture";

const ROMAN = ["I", "II", "III", "IV"];
// The ink each aisle lends the page in the Lexique direction (sampled from her shop and feed).
const AISLE_INK: Record<string, string> = {
  habillement: "#276386",
  coiffure: "#A8172F",
  cosmetique: "#C9871F",
  produits: "#2E6B3F",
};

// One markup, three stagings: an index of words (Lexique), framed works with cartels (Galerie),
// shadowed panels lit by the visitor (Écrin).
export function Aisles() {
  const { t, ad } = usePrefs();
  return (
    <section id="rayons" className="aisles gutter" aria-labelledby="aisles-title">
      <header className="aisles__head">
        <p className="t-label aisles__eyebrow">{t({ fr: "Les quatre rayons de l’enseigne", en: "The four aisles on the sign" })}</p>
        <Split as="h2" className="t-display aisles__title" id="aisles-title">
          {t({ fr: "Tout ce qui est écrit sur la façade, ", en: "Everything written on the facade, " })}
          <span className="t-italic-word">{t({ fr: "est à l’intérieur.", en: "is inside." })}</span>
        </Split>
      </header>
      <ol className="aisles__list">
        {aisles.map((a, i) => {
          const media = <Picture src={a.image} alt={t(a.alt)} className="aisles__img" sizes="(max-width: 760px) 92vw, 45vw" />;
          return (
            <Reveal as="li" key={a.id} className={`aisle aisle--${a.id}`} delay={i * 90}>
              <figure className="aisle__figure" data-parallax data-ink={AISLE_INK[a.id]}>
                {ad === "ecrin" ? <CursorLight className="aisle__media">{media}</CursorLight> : <div className="aisle__media">{media}</div>}
                <figcaption className="aisle__cartel">
                  <span className="t-label aisle__num">No. {ROMAN[i]}</span>
                  <span className="aisle__name t-display">{t(a.title)}</span>
                  <span className="aisle__items">{t(a.items)}</span>
                </figcaption>
              </figure>
            </Reveal>
          );
        })}
      </ol>
    </section>
  );
}

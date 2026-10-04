"use client";

import { heads } from "@/content/site";
import { usePrefs } from "@/lib/prefs";
import { Reveal } from "@/components/Reveal";
import { CursorLight } from "@/components/CursorLight";

// Landing zone of ending A: the heads cut out of the film's last frame settle here.
export function Heads() {
  const { t, ad } = usePrefs();
  const img = (
    <img
      src="/img/heads-wide.jpg"
      alt={t({ fr: "Le mur des têtes : perruques afro, geles et foulards en wax", en: "The wall of heads: afro wigs, geles and wax headwraps" })}
      loading="lazy"
      decoding="async"
      className="heads__img"
    />
  );
  return (
    <section id="tetes" className="heads gutter" aria-labelledby="heads-title">
      <div className="heads__text">
        <p className="t-label">{t(heads.eyebrow)}</p>
        <Reveal as="h2" className="t-display heads__title">
          <span id="heads-title">{t(heads.title)}</span>
        </Reveal>
        <Reveal as="p" className="t-lede" delay={120}>
          {t(heads.body)}
        </Reveal>
      </div>
      <Reveal as="figure" className="heads__figure" delay={180}>
        {ad === "ecrin" ? <CursorLight className="heads__media">{img}</CursorLight> : <div className="heads__media">{img}</div>}
      </Reveal>
    </section>
  );
}

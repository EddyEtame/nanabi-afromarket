"use client";

import { heads } from "@/content/site";
import { usePrefs } from "@/lib/prefs";
import { Reveal } from "@/components/Reveal";
import { CursorLight } from "@/components/CursorLight";
import { Split } from "@/components/Split";
import { Picture } from "@/components/Picture";

// Landing zone of ending A: the heads cut out of the film's last frame settle here.
export function Heads() {
  const { t, ad } = usePrefs();
  const img = (
    <Picture
      src="/img/heads-wide.jpg"
      alt={t({ fr: "Le mur des têtes : perruques afro, geles et foulards en wax", en: "The wall of heads: afro wigs, geles and wax headwraps" })}
      className="heads__img"
      sizes="92vw"
    />
  );
  return (
    <section id="tetes" className="heads gutter" aria-labelledby="heads-title">
      <div className="heads__text">
        <p className="t-label">{t(heads.eyebrow)}</p>
        <Split as="h2" className="t-display heads__title" id="heads-title">
          {t(heads.title)}
        </Split>
        <Reveal as="p" className="t-lede" delay={120}>
          {t(heads.body)}
        </Reveal>
      </div>
      <Reveal as="figure" className="heads__figure" delay={180}>
        <div data-parallax data-ink="#A8172F" className="heads__frame">
        {ad === "ecrin" ? <CursorLight className="heads__media">{img}</CursorLight> : <div className="heads__media">{img}</div>}
        </div>
      </Reveal>
    </section>
  );
}

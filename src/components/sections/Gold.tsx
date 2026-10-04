"use client";

import { gold } from "@/content/site";
import { usePrefs } from "@/lib/prefs";
import { Reveal } from "@/components/Reveal";
import { CursorLight } from "@/components/CursorLight";
import { Split } from "@/components/Split";
import { Picture } from "@/components/Picture";

export function Gold() {
  const { t, ad } = usePrefs();
  const img = (
    <Picture
      src="/img/gold-wide.jpg"
      alt={t({
        fr: "Présentoir de grandes médailles dorées devant des sacs en wax aux anses en rotin",
        en: "Display of large gold medallions in front of wax bags with rattan handles",
      })}
      className="gold__img"
      sizes="100vw"
    />
  );
  return (
    <section id="or" className="gold" aria-labelledby="gold-title">
      <Reveal as="figure" className="gold__figure">
        <div data-parallax data-ink="#A7935A" className="gold__frame">
        {ad === "ecrin" ? <CursorLight className="gold__media">{img}</CursorLight> : <div className="gold__media">{img}</div>}
        </div>
      </Reveal>
      <div className="gold__text gutter">
        <p className="t-label">{t(gold.eyebrow)}</p>
        <Split as="h2" className="t-display gold__title" id="gold-title">
          {t(gold.title)}
        </Split>
        <Reveal as="p" className="t-lede" delay={120}>
          {t(gold.body)}
        </Reveal>
      </div>
    </section>
  );
}

"use client";

import { facts, ui, visit } from "@/content/site";
import { usePrefs } from "@/lib/prefs";
import { Reveal } from "@/components/Reveal";
import { Split } from "@/components/Split";

export function Visit() {
  const { t } = usePrefs();
  return (
    <section id="venir" className="visit gutter" aria-labelledby="visit-title" data-ink-clear>
      <div className="visit__inner">
        <p className="t-label">{t(visit.eyebrow)}</p>
        <Split as="h2" className="t-display visit__title" id="visit-title">
          {t(visit.title)}
        </Split>

        {/* The address set as a signature, not a footer line. */}
        <Reveal as="div" className="visit__address" delay={120}>
          <address className="not-italic">
            <span className="visit__street t-display">{facts.street}</span>
            <span className="visit__city">
              {facts.postcode} {facts.city} · {facts.district}
            </span>
          </address>
          <p className="visit__metro">
            <span className="visit__metro-badge" aria-hidden="true">
              {facts.metro.line}
            </span>
            <span>
              {t(visit.metroLabel)} {facts.metro.line} · {facts.metro.station}
            </span>
          </p>
          <p className="visit__hours">{t(visit.hoursNote)}</p>
        </Reveal>

        <Reveal as="div" className="visit__actions" delay={220}>
          <a className="btn btn--solid" href={facts.mapsHref} target="_blank" rel="noopener">
            {t(ui.directions)}
          </a>
          <a className="btn" href={facts.phoneHref}>
            {t(ui.call)} · <span className="tabular-nums">{facts.phoneDisplay}</span>
          </a>
          <a className="btn" href={`mailto:${facts.email}`}>
            {t(ui.write)}
          </a>
        </Reveal>
      </div>
    </section>
  );
}

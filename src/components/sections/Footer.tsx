"use client";

import { facts, sign } from "@/content/site";
import { usePrefs } from "@/lib/prefs";

export function Footer() {
  const { lang } = usePrefs();
  return (
    <footer className="footer gutter">
      <div className="grille footer__grille" aria-hidden="true" />
      <div className="footer__row">
        <img src="/brand/logo-200.png" alt="NANABi AFROMARKET" width={88} height={88} className="footer__logo" loading="lazy" />
        <p className="footer__aisles t-label">{sign.aisles[lang].join(" · ")}</p>
        <ul className="footer__socials">
          {facts.socials.map((s) => (
            <li key={s.id}>
              <a href={s.href} target="_blank" rel="noopener">
                {s.label} <span className="opacity-60">{s.handle}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
      <p className="footer__legal">
        {facts.name} · {facts.street}, {facts.postcode} {facts.city} · {facts.phoneDisplay} · {facts.email}
      </p>
    </footer>
  );
}

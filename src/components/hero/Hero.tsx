"use client";

import { useMemo } from "react";
import { FilmHero } from "@/components/film/FilmHero";
import type { FilmChapter, FilmSource, TimeMap } from "@/lib/film/config";
import { chapters, facts, sign, ui } from "@/content/site";
import { usePrefs } from "@/lib/prefs";
import filmManifest from "./film-manifest.json";
import finale from "./finale.json";

/**
 * Ending A: the shelves of the last frame, cut out, lift off the film in depth.
 * Each plate mirrors the canvas cover-fit (focal centre), so the cut-outs sit exactly on their pixels.
 */
function HeadsFinale() {
  return (
    <div className="finale" aria-hidden="true">
      {(["16x9", "9x16"] as const).map((aspect) => (
        <div key={aspect} className={`finale__plate finale__plate--${aspect}`}>
          {finale[aspect].map((l, i) => (
            <img
              key={l.src}
              src={l.src}
              alt=""
              className={`finale__layer finale__layer--${i + 1}`}
              style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` }}
              loading="lazy"
              decoding="async"
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// Scroll ranges of the five chapters, aligned on the camera beats of the assembled film.
const CHAPTER_RANGES: Record<(typeof chapters)[number]["id"], [number, number]> = {
  rue: [0, 0.16],
  seuil: [0.16, 0.3],
  allee: [0.3, 0.55],
  or: [0.55, 0.76],
  tetes: [0.76, 1],
};

// Dwell on the storefront so the living sign can be read, and on the last frame for the finale.
const TIME_MAP: TimeMap = [
  [0, 0],
  [0.06, 0],
  [0.92, 1],
  [1, 1],
];

const ENDING_B_TITLE = { fr: "Le miroir", en: "The mirror" };
const ENDING_B_LINE = {
  fr: "Dans le marbre, la maison signe son nom.",
  en: "In the marble, the house signs its name.",
};

type Manifest = typeof filmManifest;
type FilmKey = keyof Manifest["films"];

function source(key: FilmKey): FilmSource {
  const f = filmManifest.films[key];
  return {
    pattern: "/film/v1/{set}/{tier}/{index:0000}.webp",
    set: key,
    frameCount: f.frameCount,
    tiers: f.tiers,
    focal: f.focal as [number, number],
    video: `/film/v1/${key}/film.mp4`,
  };
}

/** The physical sign, rebuilt in HTML and glued into the film's perspective. */
function LivingSign() {
  const { lang } = usePrefs();
  return (
    <div className="living-sign">
      <div className="living-sign__text">
        <p className="living-sign__name">
          NANAB<span className="living-sign__i">i</span>
          <span className="living-sign__gap" />
          AFROMARKET
        </p>
        <p className="living-sign__aisles">{sign.aisles[lang].join(" - ")}</p>
        <p className="living-sign__contact">
          Tél : {facts.phoneDisplay} - Email : {facts.email}
        </p>
      </div>
      <img className="living-sign__mark" src="/brand/logo-mark-alpha.png" alt="" />
    </div>
  );
}

export function Hero() {
  const { t, ending, lang } = usePrefs();

  const films = useMemo(
    () => ({
      "16x9": source(`16x9-${ending}` as FilmKey),
      "9x16": source(`9x16-${ending}` as FilmKey),
    }),
    [ending],
  );

  const filmChapters: FilmChapter[] = chapters.map((c) => ({
    id: c.id,
    label: `${c.numeral}. ${c.id === "tetes" && ending === "b" ? t(ENDING_B_TITLE) : t(c.title)}`,
    start: CHAPTER_RANGES[c.id][0],
    end: CHAPTER_RANGES[c.id][1],
  }));

  return (
    <FilmHero
      className="hero-film"
      films={films}
      chapters={filmChapters}
      timeMap={TIME_MAP}
      signTrack={{ "16x9": "/film/v1/16x9-a/sign.json", "9x16": "/film/v1/9x16-a/sign.json" }}
      sign={<LivingSign />}
      skipTargetId="bienvenue"
      poster={{
        "16x9": { src: "/film/v1/16x9-a/poster.jpg", avif: "/film/v1/16x9-a/poster.avif" },
        "9x16": { src: "/film/v1/9x16-a/poster.jpg", avif: "/film/v1/9x16-a/poster.avif" },
      }}
      lqip={{ "16x9": filmManifest.films["16x9-a"].lqip, "9x16": filmManifest.films["9x16-a"].lqip }}
      labels={{
        skip: t(ui.skipFilm),
        watch: t(ui.watchFilm),
        close: lang === "fr" ? "Fermer" : "Close",
        chapters: lang === "fr" ? "Chapitres du film" : "Film chapters",
        film: lang === "fr" ? "Le film" : "The film",
      }}
    >
      <h1 className="sr-only">
        {facts.name}, {lang === "fr" ? "boutique afro" : "afro boutique"}, {facts.street}, {facts.city}
      </h1>

      <p className="hero-cue t-label" aria-hidden="true">
        {t(ui.scrollCue)}
      </p>

      {chapters.map((c) => {
        const isB = c.id === "tetes" && ending === "b";
        return (
          <div key={c.id} className="chapter-card" data-card={c.id} aria-hidden="true">
            <span className="chapter-card__num t-label">
              {c.numeral} — {isB ? t(ENDING_B_TITLE) : t(c.title)}
            </span>
            <span className="chapter-card__line">{isB ? t(ENDING_B_LINE) : t(c.line)}</span>
          </div>
        );
      })}

      <p className="hero-address t-label" aria-hidden="true">
        {facts.street} · {facts.city}
      </p>

      {ending === "a" && <HeadsFinale />}

      {ending === "b" && (
        <div className="mirror-mark" aria-hidden="true">
          <img src="/brand/logo-mark-alpha.png" alt="" />
        </div>
      )}
    </FilmHero>
  );
}

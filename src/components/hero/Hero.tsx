"use client";

import { useCallback, useEffect, useMemo, useRef, type Ref } from "react";
import { FilmHero } from "@/components/film/FilmHero";
import type { FilmChapter, FilmSource, TimeMap } from "@/lib/film/config";
import type { FilmFinale, FilmPrelude } from "@/lib/film/film-engine";
import { chapters, facts, sign, ui } from "@/content/site";
import { usePrefs } from "@/lib/prefs";
import filmManifest from "./film-manifest.json";
import finale from "./finale.json";
import { Prelude, PRELUDE_END, PRELUDE_FADE } from "./Prelude";
import { paintSign } from "./sign-raster";

/** Versioned film root: a new folder on every re-encode, so immutable caching never serves stale frames. */
const FILM_ROOT = "/film/v2";
/** Both aspects ship the same prelude length. */
const PRELUDE_FRAMES = filmManifest.films["16x9-prelude"].frameCount;

/**
 * Ending A: the shelves of the last frame, cut out, lift off the film in depth.
 * Each plate mirrors the canvas cover-fit (focal centre), so the cut-outs sit exactly on their pixels.
 */
function HeadsFinale({ ref }: { ref: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="finale" aria-hidden="true">
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

// Endings, on the damped film progress. A: the cut-outs fade in as the film lands on its last frame, then lift
// over the dwell while the film behind sinks into shadow. B: the logo surfaces in the marble.
const FINALE_FADE_START = 0.918;
const FINALE_FADE_GAIN = 400;
const FINALE_START = 0.93;
const FINALE_SPAN = 0.065;
const CANVAS_DIM = 0.86;
const CANVAS_BLUR_PX = 5;
const MIRROR_START = 0.88;
const MIRROR_GAIN = 12;
const MIRROR_MAX = 0.92;

const clamp = (v: number, max = 1) => Math.min(max, Math.max(0, v));

/** Ending A on the film itself: darken + blur, and the cut-outs' lift, for the damped progress. */
function finaleAt(p: number) {
  const f = clamp((p - FINALE_START) / FINALE_SPAN);
  return {
    dim: f * CANVAS_DIM,
    blur: f * CANVAS_BLUR_PX,
    lift: f,
    liftOpacity: clamp((p - FINALE_FADE_START) * FINALE_FADE_GAIN),
  };
}

// The DOM cut-outs' motion (hero.css .finale__layer--n), so the render worker draws the same lift.
const LIFT_MOTION = [
  { tx: 0, ty: -0.05, scale: 0.05 },
  { tx: 0, ty: 0.03, scale: 0.12 },
  { tx: 0.03, ty: 0.07, scale: 0.22 },
] as const;

const FINALE: FilmFinale = {
  layers: {
    "16x9": finale["16x9"].map((l, i) => ({ url: l.src, x: l.x, y: l.y, w: l.w, h: l.h, ...LIFT_MOTION[i] })),
    "9x16": finale["9x16"].map((l, i) => ({ url: l.src, x: l.x, y: l.y, w: l.w, h: l.h, ...LIFT_MOTION[i] })),
  },
  at: finaleAt,
};

/**
 * Writes the DOM endings' styles (main-thread renderer: ending A's cut-outs; both: ending B's mirror) from the
 * film progress, and only when a value changes. They used to be calc() on the per-frame --film-p, which
 * restyled the finale's plates on every tick of the film even while they were invisible.
 */
function useEndings() {
  const finaleRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const last = useRef({ finale: "", mirror: "" });

  const drive = (p: number) => {
    const finale = finaleRef.current;
    if (finale) {
      const f = clamp((p - FINALE_START) / FINALE_SPAN).toFixed(3);
      const opacity = clamp((p - FINALE_FADE_START) * FINALE_FADE_GAIN).toFixed(3);
      const key = `${f}|${opacity}`;
      if (key !== last.current.finale) {
        last.current.finale = key;
        finale.style.setProperty("--f", f);
        finale.style.opacity = opacity;
      }
    }
    const mirror = mirrorRef.current;
    if (mirror) {
      const opacity = clamp((p - MIRROR_START) * MIRROR_GAIN, MIRROR_MAX).toFixed(3);
      if (opacity !== last.current.mirror) {
        last.current.mirror = opacity;
        mirror.style.opacity = opacity;
      }
    }
  };

  return { finaleRef, mirrorRef, last, drive };
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
// Écrin holds the first frame longer: the shutter rises over it before the camera moves.
const ECRIN_TIME_MAP: TimeMap = [
  [0, 0],
  [PRELUDE_END + 0.03, 0],
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
  const f: Manifest["films"][FilmKey] & { avc?: Partial<Record<"hi" | "lite", { codec: string }>> } = filmManifest.films[key];
  return {
    pattern: `${FILM_ROOT}/{set}/{tier}/{index:0000}.webp`,
    set: key,
    frameCount: f.frameCount,
    tiers: f.tiers,
    focal: f.focal as [number, number],
    video: `${FILM_ROOT}/${key}/film.mp4`,
    avc: f.avc ? { pattern: `${FILM_ROOT}/{set}/avc-{tier}/{index:0000}.h264`, tiers: f.avc } : undefined,
  };
}

/** Écrin's opening on the film's own canvas when it renders off the main thread (the <Prelude> canvas otherwise). */
const PRELUDE: FilmPrelude = {
  films: { "16x9": source("16x9-prelude"), "9x16": source("9x16-prelude") },
  end: PRELUDE_END,
  fade: PRELUDE_FADE,
};

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
  const { t, ending, lang, ad } = usePrefs();
  const progress = useRef(0);
  const endings = useEndings();
  const signRaster = useCallback((aspect: number) => paintSign(lang, aspect), [lang]);

  // Switching ending remounts the finale or the mirror: re-apply from the current progress.
  useEffect(() => {
    endings.last.current = { finale: "", mirror: "" };
    endings.drive(progress.current);
    // endings is stable in behaviour (refs + a pure writer); only the ending switch matters here
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ending]);

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
      timeMap={ad === "ecrin" ? ECRIN_TIME_MAP : TIME_MAP}
      onProgress={(p) => {
        progress.current = p;
        endings.drive(p);
      }}
      underlay={ad === "ecrin" ? <Prelude root={FILM_ROOT} frameCount={PRELUDE_FRAMES} progress={progress} /> : undefined}
      prelude={ad === "ecrin" ? PRELUDE : undefined}
      finale={ending === "a" ? FINALE : undefined}
      signTrack={{ "16x9": `${FILM_ROOT}/16x9-a/sign.json`, "9x16": `${FILM_ROOT}/9x16-a/sign.json` }}
      sign={<LivingSign />}
      signRaster={signRaster}
      signKey={lang}
      skipTargetId="bienvenue"
      poster={{
        "16x9": { src: `${FILM_ROOT}/16x9-a/poster.jpg`, avif: `${FILM_ROOT}/16x9-a/poster.avif` },
        "9x16": { src: `${FILM_ROOT}/9x16-a/poster.jpg`, avif: `${FILM_ROOT}/9x16-a/poster.avif` },
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

      {ending === "a" && <HeadsFinale ref={endings.finaleRef} />}

      {ending === "b" && (
        <div ref={endings.mirrorRef} className="mirror-mark" aria-hidden="true">
          <img src="/brand/logo-mark-alpha.png" alt="" />
        </div>
      )}
    </FilmHero>
  );
}

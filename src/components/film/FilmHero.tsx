'use client';

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  chapterAt,
  currentAspect,
  DEFAULT_FOCAL,
  IDENTITY_TIME_MAP,
  PORTRAIT_QUERY,
  REDUCED_MOTION_QUERY,
  type FilmAspect,
  type FilmChapter,
  type FilmSource,
  type TimeMap,
} from '@/lib/film/config';
import { FilmEngine } from '@/lib/film/film-engine';
import { chooseMode, type FilmMode } from '@/lib/film/mode';
import { acquireSmoothScroll, jumpTo, releaseSmoothScroll, scrollToOffset } from '@/lib/smooth-scroll';
import styles from './FilmHero.module.css';

export interface PosterImage {
  /** JPEG/WebP fallback, also the `<img>` src. */
  readonly src: string;
  readonly avif?: string;
}

export interface FilmHeroProps {
  /** Landscape film for desktop/landscape, portrait film for phones (`max-aspect-ratio: 4/5`). */
  films: Readonly<Record<FilmAspect, FilmSource>>;
  /** Scroll-progress ranges; the active id is mirrored to `data-chapter` on the section. */
  chapters: readonly FilmChapter[];
  /** Scroll progress → film progress. Defaults to linear. */
  timeMap?: TimeMap;
  /** Sign-track JSON URL per film (see tools/track_sign.py). */
  signTrack?: Readonly<Partial<Record<FilmAspect, string>>>;
  /** Decorative content glued onto the tracked sign (aria-hidden). */
  sign?: ReactNode;
  /** Id of the element "Passer le film" jumps to; it receives focus. */
  skipTargetId: string;
  /** Frame 0 of each film, same crop as the canvas. Rendered server-side as the LCP image. */
  poster: Readonly<Record<FilmAspect, string | PosterImage>>;
  /** Tiny data URIs painted behind the poster (lqip.txt from tools/build_film.py). */
  lqip?: Readonly<Partial<Record<FilmAspect, string>>>;
  /** Overlay layer (copy, CTA). In static mode it flows below the poster. */
  children?: ReactNode;
  /** Damped scroll progress, 0..1. Also exposed as `--film-p` on the section. */
  onProgress?: (p: number) => void;
  /** Extra scroll distance for the pinned film. Defaults to 400lvh / 340lvh. */
  pinLength?: { desktop: string; mobile: string };
  /** Shows the frame/decode HUD. */
  debug?: boolean;
  className?: string;
  /** UI strings, so the page can translate them. */
  labels?: Partial<FilmLabels>;
}

export interface FilmLabels {
  skip: string;
  watch: string;
  close: string;
  chapters: string;
  film: string;
}

const DEFAULT_LABELS: FilmLabels = {
  skip: 'Passer le film',
  watch: 'Voir le film',
  close: 'Fermer',
  chapters: 'Chapitres du film',
  film: 'Le film',
};

type ViewMode = FilmMode | 'pending';
type FilmStyle = CSSProperties & Record<`--${string}`, string>;

const DEFAULT_PIN_LENGTH = { desktop: '400lvh', mobile: '340lvh' } as const;
const SKIP_HIDE_PROGRESS = 0.97;
/** Lands a chapter jump just inside the chapter instead of on its boundary. */
const CHAPTER_NUDGE_PX = 2;

const subscribeReducedMotion = (onChange: () => void) => {
  const query = matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const serverMode = (): ViewMode => 'pending';

const toPoster = (poster: string | PosterImage): PosterImage =>
  typeof poster === 'string' ? { src: poster } : poster;

const objectPosition = (source: FilmSource): string => {
  const [x, y] = source.focal ?? DEFAULT_FOCAL;
  return `${x * 100}% ${y * 100}%`;
};

export function FilmHero({
  films,
  chapters,
  timeMap,
  signTrack,
  sign,
  skipTargetId,
  poster,
  lqip,
  children,
  onProgress,
  pinLength = DEFAULT_PIN_LENGTH,
  debug = false,
  className,
  labels,
}: FilmHeroProps) {
  const text = { ...DEFAULT_LABELS, ...labels };
  const detected = useSyncExternalStore<ViewMode>(subscribeReducedMotion, chooseMode, serverMode);
  const [failed, setFailed] = useState(false);
  const [chapterId, setChapterId] = useState<string | undefined>(undefined);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const mode: ViewMode = failed ? 'static' : detected;
  const filmMode = mode === 'hi' || mode === 'lite' ? mode : null;

  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const signRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<HTMLAnchorElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Engine callbacks read the latest props, so inline props never restart the film.
  const latest = useRef({ films, timeMap, signTrack, chapters, onProgress });
  useEffect(() => {
    latest.current = { films, timeMap, signTrack, chapters, onProgress };
  });

  const configKey = JSON.stringify([films, timeMap ?? null, signTrack ?? null]);
  const hasSign = sign !== undefined && sign !== null && sign !== false;

  useEffect(() => {
    const section = sectionRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!filmMode || !section || !stage || !canvas) return;
    const lenis = acquireSmoothScroll();
    let activeChapter: string | undefined;
    let engine: FilmEngine | null = null;
    try {
      const config = latest.current;
      engine = new FilmEngine(
        { section, stage, canvas, sign: signRef.current },
        {
          films: config.films,
          tier: filmMode,
          timeMap: config.timeMap ?? IDENTITY_TIME_MAP,
          signTracks: config.signTrack,
          lenis,
          debug,
          onProgress: (p) => {
            latest.current.onProgress?.(p);
            const id = chapterAt(latest.current.chapters, p)?.id;
            if (id !== activeChapter) {
              activeChapter = id;
              setChapterId(id);
            }
            skipRef.current?.toggleAttribute('data-hidden', p > SKIP_HIDE_PROGRESS);
          },
          onFatal: () => setFailed(true),
        },
      );
    } catch {
      setFailed(true); // init failure falls back to the static hero
    }
    return () => {
      engine?.destroy();
      releaseSmoothScroll();
    };
    // configKey stands in for films/timeMap/signTrack, which are read through `latest`.
  }, [filmMode, configKey, debug, hasSign]);

  const skip = (e: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(skipTargetId);
    if (!target) return;
    e.preventDefault();
    e.stopPropagation(); // keeps Lenis's anchor handler from smooth-scrolling through the film
    jumpTo(target);
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  };

  const goToChapter = (chapter: FilmChapter) => {
    const section = sectionRef.current;
    if (!section) return;
    const top = section.getBoundingClientRect().top + window.scrollY;
    const range = section.offsetHeight - window.innerHeight;
    scrollToOffset(top + chapter.start * range + CHAPTER_NUDGE_PX);
  };

  const video = films['16x9'].video ?? films['9x16'].video;
  const openVideo = () => {
    const src = films[currentAspect()].video ?? video;
    if (!src) return;
    setVideoSrc(src);
    dialogRef.current?.showModal();
  };

  const landscape = toPoster(poster['16x9']);
  const portrait = toPoster(poster['9x16']);
  const style: FilmStyle = {
    '--film-pin-desktop': pinLength.desktop,
    '--film-pin-mobile': pinLength.mobile,
    '--film-focal-l': objectPosition(films['16x9']),
    '--film-focal-p': objectPosition(films['9x16']),
  };
  if (lqip?.['16x9']) style['--film-lqip-l'] = `url("${lqip['16x9']}")`;
  if (lqip?.['9x16']) style['--film-lqip-p'] = `url("${lqip['9x16']}")`;

  return (
    <section
      ref={sectionRef}
      className={className ? `${styles.film} ${className}` : styles.film}
      data-mode={mode}
      data-chapter={filmMode ? chapterId : undefined}
      style={style}
    >
      <div ref={stageRef} className={styles.stage}>
        {mode !== 'static' && (
          <a ref={skipRef} href={`#${skipTargetId}`} className={styles.skip} onClick={skip} data-film-skip>
            {text.skip}
          </a>
        )}
        <picture className={styles.poster} data-film-poster>
          {portrait.avif && <source media={PORTRAIT_QUERY} srcSet={portrait.avif} type="image/avif" />}
          <source media={PORTRAIT_QUERY} srcSet={portrait.src} />
          {landscape.avif && <source srcSet={landscape.avif} type="image/avif" />}
          {/* eslint-disable-next-line @next/next/no-img-element -- art-directed <picture>, static export */}
          <img src={landscape.src} alt="" fetchPriority="high" />
        </picture>
        {mode !== 'static' && <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />}
        {mode !== 'static' && hasSign && (
          <div ref={signRef} className={styles.sign} aria-hidden="true" data-film-sign>
            {sign}
          </div>
        )}
        {mode === 'static' && video && (
          <div className={styles.watch}>
            <button type="button" onClick={openVideo}>
              {text.watch}
            </button>
          </div>
        )}
        <div className={styles.overlay} data-film-overlay>
          {children}
        </div>
        {mode !== 'static' && chapters.length > 0 && (
          <nav className={styles.chapters} aria-label={text.chapters} data-film-chapters>
            <ol>
              {chapters.map((chapter) => (
                <li key={chapter.id}>
                  <button
                    type="button"
                    aria-current={chapter.id === chapterId ? 'step' : undefined}
                    onClick={() => goToChapter(chapter)}
                  >
                    {chapter.label}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}
      </div>
      {video && (
        <dialog ref={dialogRef} className={styles.dialog} aria-label={text.film} onClose={() => setVideoSrc(null)}>
          {videoSrc && <video src={videoSrc} controls autoPlay muted playsInline />}
          <form method="dialog">
            <button className={styles.close}>{text.close}</button>
          </form>
        </dialog>
      )}
    </section>
  );
}

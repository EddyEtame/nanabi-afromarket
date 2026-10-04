'use client';

import { useRef } from 'react';
import type { FilmAspect, FilmChapter, FilmSource, TimeMap } from '@/lib/film/config';
import { FilmHero, type PosterImage } from './FilmHero';
import styles from './FilmLab.module.css';

/*
 * Development bench for the scroll film, built from the client's phone walkthrough
 * (public/film/dev, lite tier only). Mount it on a lab route; the HUD is always on.
 */

const DEV_ROOT = '/film/dev';
const PATTERN = '/film/{set}/{tier}/{index:0000}.webp';
const FRAME_COUNT = 240;
const AFTER_ID = 'film-lab-after';

const FILMS: Record<FilmAspect, FilmSource> = {
  '16x9': {
    pattern: PATTERN,
    set: 'dev/16x9',
    frameCount: FRAME_COUNT,
    tiers: { lite: { width: 1280, height: 720 } },
    video: `${DEV_ROOT}/16x9/film.mp4`,
  },
  '9x16': {
    pattern: PATTERN,
    set: 'dev/9x16',
    frameCount: FRAME_COUNT,
    tiers: { lite: { width: 720, height: 1280 } },
    focal: [0.5, 0.4],
    video: `${DEV_ROOT}/9x16/film.mp4`,
  },
};

const POSTERS: Record<FilmAspect, PosterImage> = {
  '16x9': { src: `${DEV_ROOT}/16x9/poster.jpg`, avif: `${DEV_ROOT}/16x9/poster.avif` },
  '9x16': { src: `${DEV_ROOT}/9x16/poster.jpg`, avif: `${DEV_ROOT}/9x16/poster.avif` },
};

// Contents of public/film/dev/<aspect>/lqip.txt
const LQIP: Record<FilmAspect, string> = {
  '16x9':
    'data:image/webp;base64,UklGRqYAAABXRUJQVlA4IJoAAAAwBQCdASogABIAPu1iqU2ppaQiMAgBMB2JZwDImCHu1gKiebMlg+r2B1DEcBJvHRKswAD+wmWSiQSYFRwv6K/L43Rr+2weXKyLPWLXth7QFA2UVOF9dK7hCQQfMMRbIJU/Rv/DI4bTLFhlPWZ/+i+GwmsO4xbCcpDb7MgycrIC3kB26w+d5mKKpIj3HLrbx2gHZOAWruLe0AAA',
  '9x16':
    'data:image/webp;base64,UklGRh4BAABXRUJQVlA4IBIBAAAQBwCdASoYACsAPu1uslKppiSipWmZMB2JYwC7AzAAb5pEZGiiioML9hqn8k+BEP9oev0od768rJp1KtUcD9ygAAD7neT4us58lBQOFPWcARDBaDTHn/h916qPPPa28mmHQ7Kkfnpmah1U/mSyl2qKpiYEgEjteA+7vEX+vVaAEHspUi8Ynw+PNu6D1+qXRYnfcetN3Gm0h7482vMSMj3n16Z4Z4Pvhe4Nbwlj8AMSEUeww1UzTu6+QBS1RQNxdt+kFCf4yJXdyEbJhSzki/Z4/btbZXpV3li9sfG5uFSOLJXFmvf0MkUiL4GRZx9OXaL2h7UJW0xuqKRef8ezp7rpXfOwrOmntAbKLM/nUNtAAAAA',
};

// Tracked on frames 0..29 of the 9:16 set; the landscape dev set is letterboxed, so it has no track.
const SIGN_TRACK: Partial<Record<FilmAspect, string>> = { '9x16': `${DEV_ROOT}/9x16/sign.json` };

// Holds the street frame while the title reads, then runs the walk-in at constant speed.
const TIME_MAP: TimeMap = [
  [0, 0],
  [0.08, 0],
  [1, 1],
];

// Dev footage: façade on frames 0-30, door 30-50, interior after (scroll progress through TIME_MAP).
const CHAPTERS: readonly FilmChapter[] = [
  { id: 'facade', label: 'La façade', start: 0, end: 0.2 },
  { id: 'entree', label: "L'entrée", start: 0.2, end: 0.3 },
  { id: 'boutique', label: 'La boutique', start: 0.3, end: 1 },
];

export function FilmLab() {
  const readout = useRef<HTMLOutputElement>(null);

  return (
    <>
      <FilmHero
        films={FILMS}
        chapters={CHAPTERS}
        timeMap={TIME_MAP}
        signTrack={SIGN_TRACK}
        sign={<span className={styles.sign}>NANABi AFROMARKET</span>}
        skipTargetId={AFTER_ID}
        poster={POSTERS}
        lqip={LQIP}
        debug
        onProgress={(p) => {
          if (readout.current) readout.current.value = `p ${p.toFixed(3)}`;
        }}
      >
        <div className={styles.beats}>
          <h1 className={`${styles.beat} ${styles.title} ${styles.facade}`}>Nanabi Afromarket</h1>
          <p className={`${styles.beat} ${styles.line} ${styles.entree}`}>Les saveurs d’Afrique, au coin de la rue.</p>
          <p className={`${styles.beat} ${styles.line} ${styles.boutique}`}>Épices · Wax · Beauté</p>
        </div>
        <div className={styles.progress} aria-hidden="true" />
        <output ref={readout} className={styles.readout} aria-hidden="true" />
      </FilmHero>
      <section id={AFTER_ID} className={styles.after}>
        <h2>Après le film</h2>
        <p>Cible du bouton « Passer le film ». La suite de la page défile ici.</p>
      </section>
    </>
  );
}

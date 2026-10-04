export type FilmAspect = '16x9' | '9x16';
export type Tier = 'hi' | 'lite';
/** Piecewise-linear map from scroll progress to film progress; flat segments hold a frame (dwell). */
export type TimeMap = ReadonlyArray<readonly [scroll: number, film: number]>;

export interface TierSize {
  readonly width: number;
  readonly height: number;
}

export interface FilmSource {
  /** Frame URL pattern. Tokens: `{set}`, `{tier}`, `{index}` or zero-padded `{index:0000}` (0-based). */
  readonly pattern: string;
  /** Value substituted for `{set}`, e.g. `v1/16x9`. */
  readonly set: string;
  readonly frameCount: number;
  /** Source frame size of every tier this film ships; at least one is required. */
  readonly tiers: Readonly<Partial<Record<Tier, TierSize>>>;
  /** Cover-crop focus (0..1). The poster's `object-position` is derived from the same value. */
  readonly focal?: readonly [x: number, y: number];
  /** Linear MP4 offered by "Voir le film" in static mode. */
  readonly video?: string;
}

export interface FilmChapter {
  readonly id: string;
  readonly label: string;
  /** Scroll progress (0..1) where the chapter begins. */
  readonly start: number;
  /** Scroll progress (0..1) where the chapter ends. */
  readonly end: number;
}

/** Same query in CSS (`<picture>` sources, module styles) and JS, so poster and canvas always agree. */
export const PORTRAIT_QUERY = '(max-aspect-ratio: 4/5)';
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
export const FRAME_WORKER_URL = '/workers/frame-worker.js';
export const DEFAULT_FOCAL: readonly [number, number] = [0.5, 0.5];
export const IDENTITY_TIME_MAP: TimeMap = [
  [0, 0],
  [1, 1],
];

const INDEX_TOKEN = /\{index(?::(0+))?\}/g;

export function currentAspect(): FilmAspect {
  return matchMedia(PORTRAIT_QUERY).matches ? '9x16' : '16x9';
}

export function frameUrl(source: FilmSource, tier: Tier, index: number): string {
  return source.pattern
    .replaceAll('{set}', source.set)
    .replaceAll('{tier}', tier)
    .replace(INDEX_TOKEN, (_, zeros: string | undefined) => String(index).padStart(zeros?.length ?? 0, '0'));
}

/** Picks the preferred tier, falling back to whichever tier the film ships. */
export function resolveTier(source: FilmSource, preferred: Tier): { tier: Tier; size: TierSize } | null {
  const order: readonly Tier[] = preferred === 'hi' ? ['hi', 'lite'] : ['lite', 'hi'];
  for (const tier of order) {
    const size = source.tiers[tier];
    if (size) return { tier, size };
  }
  return null;
}

export function remap(p: number, map: TimeMap): number {
  if (map.length === 0) return p;
  if (p <= map[0][0]) return map[0][1];
  for (let k = 1; k < map.length; k++) {
    const [x0, y0] = map[k - 1];
    const [x1, y1] = map[k];
    if (p <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (p - x0)) / (x1 - x0);
  }
  return map[map.length - 1][1];
}

/** First chapter whose [start, end] range contains `p`. */
export function chapterAt(chapters: readonly FilmChapter[], p: number): FilmChapter | undefined {
  return chapters.find((c) => p >= c.start && p <= c.end);
}

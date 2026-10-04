import type { CoverRect } from './cover';

/**
 * Living sign: a DOM element glued onto a planar-tracked quad of the film.
 *
 * Track JSON (written by tools/track_sign.py), corners in pixels of a `width` x `height` frame:
 *   { "width": W, "height": H, "aspect"?: number,
 *     "frames": { "<index>": { "q": [[x,y],[x,y],[x,y],[x,y]], "b"?: 0..1 } } }
 * Corners run TL, TR, BR, BL. Frames where the sign is not visible are simply absent.
 */
export interface SignTrack {
  /** Physical width / height of the sign; sizes the element so its content is not stretched. */
  readonly aspect: number;
  /** 1 where the film frame has a quad. */
  readonly present: Uint8Array;
  /** Eight normalised (0..1) coordinates per film frame. */
  readonly corners: Float32Array;
  /** Per-frame brightness 0..1, NaN where the track has none. */
  readonly brightness: Float32Array;
  /** Per-frame fade 0..1, ramping over the first and last frames of each visible run. */
  readonly fade: Float32Array;
}

/** 3×3 projective coefficients [a, b, c, d, e, f, g, h], with the bottom-right term fixed at 1. */
type Projective = [number, number, number, number, number, number, number, number];

const FADE_FRAMES = 6;
const AFFINE_EPSILON = 1e-9;
/** Smallest corner cross product (CSS px²) accepted; below it the quad is collapsed or flipped. */
const MIN_CORNER_CROSS = 1;
const COORDS = 8;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isPoint = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

const isPositive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export async function loadSignTrack(url: string, frameCount: number, signal: AbortSignal): Promise<SignTrack | null> {
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  return parseSignTrack(await res.json(), frameCount);
}

export function parseSignTrack(json: unknown, frameCount: number): SignTrack | null {
  if (!isRecord(json) || !isRecord(json.frames)) return null;
  const { width, height, aspect } = json;
  if (!isPositive(width) || !isPositive(height)) return null;
  const present = new Uint8Array(frameCount);
  const corners = new Float32Array(frameCount * COORDS);
  const brightness = new Float32Array(frameCount).fill(Number.NaN);
  let any = false;
  for (const [key, entry] of Object.entries(json.frames)) {
    const i = Number(key);
    if (!Number.isInteger(i) || i < 0 || i >= frameCount || !isRecord(entry)) continue;
    const { q, b } = entry;
    if (!Array.isArray(q) || q.length !== 4 || !q.every(isPoint)) continue;
    q.forEach(([x, y], k) => {
      corners[i * COORDS + k * 2] = x / width;
      corners[i * COORDS + k * 2 + 1] = y / height;
    });
    present[i] = 1;
    any = true;
    if (typeof b === 'number' && Number.isFinite(b)) brightness[i] = b;
  }
  if (!any) return null;
  return {
    aspect: isPositive(aspect) ? aspect : estimateAspect(corners, present, width, height),
    present,
    corners,
    brightness,
    fade: runFades(present),
  };
}

/** Edge-length aspect of the largest on-frame quad: the most frontal, least foreshortened view. */
function estimateAspect(corners: Float32Array, present: Uint8Array, width: number, height: number): number {
  let best = 0;
  let aspect = 1;
  const len = (o: number, p: number, q: number) =>
    Math.hypot((corners[o + q] - corners[o + p]) * width, (corners[o + q + 1] - corners[o + p + 1]) * height);
  for (let i = 0; i < present.length; i++) {
    if (!present[i]) continue;
    const o = i * COORDS;
    const horizontal = len(o, 0, 2) + len(o, 6, 4);
    const vertical = len(o, 0, 6) + len(o, 2, 4);
    if (vertical > 0 && horizontal * vertical > best) {
      best = horizontal * vertical;
      aspect = horizontal / vertical;
    }
  }
  return aspect;
}

/** Fade-in/out over FADE_FRAMES at each gap in the track. The film's own first and last frames are not gaps. */
function runFades(present: Uint8Array): Float32Array {
  const n = present.length;
  const fromGap = new Float32Array(n);
  let run = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    run = present[i] ? run + 1 : 0;
    fromGap[i] = run;
  }
  const fade = new Float32Array(n);
  run = Number.POSITIVE_INFINITY;
  for (let i = n - 1; i >= 0; i--) {
    run = present[i] ? run + 1 : 0;
    const distance = Math.min(fromGap[i], run) - 1;
    fade[i] = present[i] ? Math.min(1, distance / FADE_FRAMES) : 0;
  }
  return fade;
}

/**
 * Corners on the frame the canvas shows: integer frame `a`, cross-blended towards `a + 1` by `t`.
 * Catmull-Rom over a-1..a+2 (clamped to the visible run) keeps velocity continuous on slow scrubs.
 */
export function cornersAt(track: SignTrack, a: number, t: number, out: Float64Array): boolean {
  const { present, corners } = track;
  const n = present.length;
  if (a < 0 || a >= n || !present[a]) return false;
  if (t <= 0) {
    for (let k = 0; k < COORDS; k++) out[k] = corners[a * COORDS + k];
    return true;
  }
  const b = a + 1;
  if (b >= n || !present[b]) return false;
  const p0 = (a > 0 && present[a - 1] ? a - 1 : a) * COORDS;
  const p1 = a * COORDS;
  const p2 = b * COORDS;
  const p3 = (b + 1 < n && present[b + 1] ? b + 1 : b) * COORDS;
  const t2 = t * t;
  const t3 = t2 * t;
  for (let k = 0; k < COORDS; k++) {
    const c0 = corners[p0 + k];
    const c1 = corners[p1 + k];
    const c2 = corners[p2 + k];
    const c3 = corners[p3 + k];
    out[k] =
      0.5 * (2 * c1 + (c2 - c0) * t + (2 * c0 - 5 * c1 + 4 * c2 - c3) * t2 + (3 * c1 - c0 - 3 * c2 + c3) * t3);
  }
  return true;
}

const lerpAt = (values: Float32Array, a: number, t: number): number =>
  t <= 0 ? values[a] : values[a] + (values[a + 1] - values[a]) * t;

/** NaN when the track carries no brightness for these frames. */
export function brightnessAt(track: SignTrack, a: number, t: number): number {
  return lerpAt(track.brightness, a, t);
}

export function fadeAt(track: SignTrack, a: number, t: number): number {
  return lerpAt(track.fade, a, t);
}

/** Heckbert's closed-form unit square → quad. `q` = [x0,y0, x1,y1, x2,y2, x3,y3] (TL, TR, BR, BL). */
export function squareToQuad(q: ArrayLike<number>): Projective | null {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = [q[0], q[1], q[2], q[3], q[4], q[5], q[6], q[7]];
  const dx3 = x0 - x1 + x2 - x3;
  const dy3 = y0 - y1 + y2 - y3;
  if (Math.abs(dx3) < AFFINE_EPSILON && Math.abs(dy3) < AFFINE_EPSILON) {
    return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0];
  }
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < AFFINE_EPSILON) return null;
  const g = (dx3 * dy2 - dx2 * dy3) / den;
  const h = (dx1 * dy3 - dx3 * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h];
}

/** Convex, clockwise on screen (TL→TR→BR→BL) and not collapsed. */
export function isDrawableQuad(q: ArrayLike<number>): boolean {
  for (let k = 0; k < 4; k++) {
    const i = k * 2;
    const j = ((k + 1) % 4) * 2;
    const l = ((k + 2) % 4) * 2;
    const cross = (q[j] - q[i]) * (q[l + 1] - q[j + 1]) - (q[j + 1] - q[i + 1]) * (q[l] - q[j]);
    if (!(cross > MIN_CORNER_CROSS)) return false;
  }
  return true;
}

/** CSS `matrix3d` placing a `w`×`h` element (transform-origin 0 0) onto quad `q` (CSS px), or null to hide it. */
export function quadToMatrix3d(q: ArrayLike<number>, w: number, h: number): string | null {
  if (!isDrawableQuad(q)) return null;
  const m = squareToQuad(q);
  if (!m) return null;
  const [a, b, c, d, e, f, g, hh] = m;
  // Homogeneous w at the unit corners must stay positive, otherwise the plane passes behind the eye.
  if (!(1 + g > 0 && 1 + hh > 0 && 1 + g + hh > 0) || !m.every(Number.isFinite)) return null;
  return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${hh / h},0,0,1,0,${c},${f},0,1)`;
}

/**
 * Longest top or bottom edge of the track on screen, in CSS px. Sizing the element to it means the
 * lettering is only ever scaled down, so it stays crisp.
 */
export function maxHorizontalEdge(track: SignTrack, rect: CoverRect, scaleX: number, scaleY: number): number {
  const { present, corners } = track;
  const edge = (from: number, to: number) =>
    Math.hypot((corners[to] - corners[from]) * rect.w * scaleX, (corners[to + 1] - corners[from + 1]) * rect.h * scaleY);
  let max = 0;
  for (let i = 0; i < present.length; i++) {
    if (!present[i]) continue;
    const o = i * COORDS;
    max = Math.max(max, edge(o, o + 2), edge(o + 6, o + 4));
  }
  return max;
}

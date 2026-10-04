export interface CoverRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * `object-fit: cover` with a focal point, in the target's pixel space.
 * Same math as CSS `object-position` percentages, so the poster and the canvas crop identically.
 */
export function cover(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  focal: readonly [number, number],
): CoverRect {
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const w = Math.ceil(sourceWidth * scale);
  const h = Math.ceil(sourceHeight * scale);
  return { x: Math.round((targetWidth - w) * focal[0]), y: Math.round((targetHeight - h) * focal[1]), w, h };
}

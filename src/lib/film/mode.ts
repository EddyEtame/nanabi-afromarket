import { REDUCED_MOTION_QUERY } from './config';

export type FilmMode = 'hi' | 'lite' | 'static';

interface NetworkInformationLike {
  readonly saveData?: boolean;
  readonly effectiveType?: string;
}

/** Chromium-only hints; Safari and Firefox expose neither, so both are optional. */
type NavigatorHints = Navigator & {
  readonly connection?: NetworkInformationLike;
  readonly deviceMemory?: number;
};

const MB = 1_000_000;
const PHONE_BUDGET_BYTES = 128 * MB;
const DESKTOP_BUDGET_BYTES = 320 * MB;
const LOW_MEMORY_GB = 2;
const STATIC_CONNECTIONS = new Set(['slow-2g', '2g']);
const LITE_CONNECTIONS = new Set(['3g']);

const hints = (): NavigatorHints => navigator as NavigatorHints;

export function chooseMode(): FilmMode {
  if (matchMedia(REDUCED_MOTION_QUERY).matches) return 'static';
  if (typeof Worker !== 'function' || typeof createImageBitmap !== 'function') return 'static';
  const { connection, deviceMemory } = hints();
  if (connection?.saveData || STATIC_CONNECTIONS.has(connection?.effectiveType ?? '')) return 'static';
  if (LITE_CONNECTIONS.has(connection?.effectiveType ?? '')) return 'lite';
  if (deviceMemory !== undefined && deviceMemory <= LOW_MEMORY_GB) return 'lite';
  return 'hi';
}

/** Decoded RGBA bytes allowed alive at once. iOS reports no deviceMemory, so touch devices get the phone budget. */
export function decodedBudgetBytes(): number {
  return matchMedia('(pointer: coarse)').matches ? PHONE_BUDGET_BYTES : DESKTOP_BUDGET_BYTES;
}

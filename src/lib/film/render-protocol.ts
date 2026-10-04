import type { SignTrack } from './homography';

/** One frame list on a virtual timeline: the prelude's frames (if any), then the film's. */
export interface RenderSequence {
  readonly urls: string[];
  readonly width: number;
  readonly height: number;
  readonly focal: [number, number];
  /** Number of prelude frames before the film's frame 0. */
  readonly prelude: number;
  /** The same frames as H.264 keyframes, used when the worker's VideoDecoder supports the codec. */
  readonly avc?: { readonly urls: string[]; readonly codec: string };
}

/** A cut-out of the film's last frame that lifts off it (ending A), in fractions of the frame. */
export interface RenderLiftLayer {
  readonly url: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Translation at full lift, in fractions of the layer's own size (CSS translate %). */
  readonly tx: number;
  readonly ty: number;
  /** Extra scale at full lift (1 + scale), around 50% / 60% of the layer. */
  readonly scale: number;
}

/** Film-wide effects for the current progress. */
export interface RenderEffect {
  /** Darkening of the film, 0..1. */
  readonly dim: number;
  /** Blur of the film, CSS px. */
  readonly blur: number;
  /** How far the cut-outs have lifted, 0..1. */
  readonly lift: number;
  /** Cut-out opacity, 0..1 (they sit on their own pixels, so this only decides when they exist). */
  readonly liftOpacity: number;
}

/** Main thread → render worker. */
export type RenderIn =
  | { type: 'init'; canvas: OffscreenCanvas; budgetBytes: number }
  | { type: 'sequence'; sequence: RenderSequence }
  /** Backing size in device px, and device px per CSS px (shadow offsets and blurs are specified in CSS px). */
  | { type: 'resize'; width: number; height: number; scale: number }
  | { type: 'lift'; layers: RenderLiftLayer[] }
  | { type: 'effect'; effect: RenderEffect }
  /** Virtual frame to show (fractional = cross-blend), where the scroll is heading, and its direction. */
  | { type: 'frame'; f: number; target: number; dir: 1 | -1 }
  | { type: 'park'; parked: boolean }
  | { type: 'track'; track: SignTrack | null }
  | { type: 'sign'; bitmap: ImageBitmap }
  | { type: 'destroy' };

/** Render worker → main thread. */
export type RenderOut =
  | { type: 'ready' }
  | { type: 'loaded'; loaded: number; total: number }
  | { type: 'stats'; live: number; slots: number; shown: number; wanted: number; source: 'avc' | 'image' }
  | { type: 'fatal'; reason: string };

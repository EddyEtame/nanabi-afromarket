import type { SignTrack } from './homography';
import type { RenderEffect, RenderIn, RenderLiftLayer, RenderOut, RenderSequence } from './render-protocol';

let supported: boolean | null = null;

/**
 * True when the film can render off the main thread: transferable canvas + WebGL2 on OffscreenCanvas
 * (Chrome/Edge 69+, Firefox 105+, Safari 17+). Everything else keeps the main-thread Canvas2D engine.
 */
export function supportsRemoteFilm(): boolean {
  if (supported !== null) return supported;
  supported = false;
  try {
    if (
      typeof Worker === 'function' &&
      typeof OffscreenCanvas === 'function' &&
      'transferControlToOffscreen' in HTMLCanvasElement.prototype
    ) {
      const probe = new OffscreenCanvas(1, 1).getContext('webgl2');
      supported = !!probe;
      probe?.getExtension('WEBGL_lose_context')?.loseContext();
    }
  } catch {
    supported = false;
  }
  return supported;
}

export interface RemoteCallbacks {
  readonly onReady: () => void;
  readonly onLoaded: (loaded: number, total: number) => void;
  readonly onFatal: () => void;
  readonly onStats?: (live: number, slots: number, shown: number, wanted: number, source: 'avc' | 'image') => void;
}

/** Main-thread handle on the render worker. Messages are deduplicated so an idle film posts nothing. */
export class RemoteRenderer {
  private readonly worker: Worker;
  private lastFrame = '';
  private lastSize = '';
  private lastEffect = '';
  private dead = false;

  constructor(canvas: HTMLCanvasElement, budgetBytes: number, private readonly cb: RemoteCallbacks) {
    const offscreen = canvas.transferControlToOffscreen();
    this.worker = new Worker(new URL('./render-worker.ts', import.meta.url), { type: 'module', name: 'film-render' });
    this.worker.onmessage = (e: MessageEvent<RenderOut>) => this.onMessage(e.data);
    this.worker.onerror = () => cb.onFatal();
    this.send({ type: 'init', canvas: offscreen, budgetBytes }, [offscreen]);
  }

  sequence(sequence: RenderSequence): void {
    this.lastFrame = '';
    this.send({ type: 'sequence', sequence });
  }

  resize(width: number, height: number, scale: number): void {
    const key = `${width}x${height}@${scale}`;
    if (key === this.lastSize) return;
    this.lastSize = key;
    this.send({ type: 'resize', width, height, scale });
  }

  lift(layers: RenderLiftLayer[]): void {
    this.send({ type: 'lift', layers });
  }

  effect(effect: RenderEffect): void {
    const key = `${effect.dim.toFixed(3)}|${effect.blur.toFixed(2)}|${effect.lift.toFixed(4)}|${effect.liftOpacity.toFixed(3)}`;
    if (key === this.lastEffect) return;
    this.lastEffect = key;
    this.send({ type: 'effect', effect });
  }

  frame(f: number, target: number, dir: 1 | -1): void {
    const key = `${f.toFixed(4)}|${target.toFixed(2)}|${dir}`;
    if (key === this.lastFrame) return;
    this.lastFrame = key;
    this.send({ type: 'frame', f, target, dir });
  }

  park(parked: boolean): void {
    this.send({ type: 'park', parked });
  }

  track(track: SignTrack | null): void {
    this.send({ type: 'track', track });
  }

  sign(bitmap: ImageBitmap): void {
    this.send({ type: 'sign', bitmap }, [bitmap]);
  }

  destroy(): void {
    if (this.dead) return;
    this.send({ type: 'destroy' });
    this.dead = true;
    this.worker.terminate();
  }

  private send(m: RenderIn, transfer: Transferable[] = []): void {
    if (!this.dead) this.worker.postMessage(m, transfer);
  }

  private onMessage(m: RenderOut): void {
    if (this.dead) return;
    switch (m.type) {
      case 'ready':
        this.cb.onReady();
        break;
      case 'loaded':
        this.cb.onLoaded(m.loaded, m.total);
        break;
      case 'stats':
        this.cb.onStats?.(m.live, m.slots, m.shown, m.wanted, m.source);
        break;
      case 'fatal':
        this.cb.onFatal();
        break;
    }
  }
}

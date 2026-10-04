import { FRAME_WORKER_URL } from './config';

type WorkerMessage =
  | { type: 'fetched'; i: number; bytes: number }
  | { type: 'bitmap'; i: number; bmp: ImageBitmap; ms: number }
  | { type: 'error'; i: number; stage: 'fetch' | 'decode' };

export interface FrameStoreOptions {
  /** Absolute URL of every frame, in film order. */
  readonly urls: readonly string[];
  /** Decoded size of one frame in bytes (width × height × 4). */
  readonly frameBytes: number;
  /** Decoded RGBA bytes allowed alive at once. */
  readonly budgetBytes: number;
  readonly workers: number;
  readonly onReady: (index: number) => void;
  readonly onLoaded: (loaded: number, total: number) => void;
  /** A pinned frame (first or last) could not be decoded: the film cannot run. */
  readonly onFatal: () => void;
}

const FETCH_CONCURRENCY = 6;
const MAX_WORKERS = 2;
const DECODES_PER_WORKER = 2;
/** Floor for the decoded window so a tiny budget still holds current, target and their neighbours. */
const MIN_LIVE_FRAMES = 8;
/** Share of the free window spent ahead in the scroll direction; the rest stays behind. */
const AHEAD_SHARE = 0.65;
/** Slots reserved for the current frame, the target and the target's two neighbours. */
const LANDING_SLOTS = 3;
const MIN_BEHIND = 2;
const MAX_ATTEMPTS = 3;
const DECODE_SAMPLES = 120;

/** 0, n-1, then halving strides: the whole film is coarsely scrubbable after ~16 requests. */
export function coarseToFine(n: number): number[] {
  if (n < 2) return n === 1 ? [0] : [];
  const out = [0, n - 1];
  const seen = new Uint8Array(n);
  seen[0] = seen[n - 1] = 1;
  for (let step = 1 << Math.floor(Math.log2(n - 1)); step >= 1; step >>= 1) {
    for (let i = 0; i < n; i += step) {
      if (!seen[i]) {
        seen[i] = 1;
        out.push(i);
      }
    }
  }
  return out;
}

/**
 * Compressed bytes for every frame stay cached in the workers (cheap); only a sliding window of decoded
 * bitmaps lives on the main thread, bounded by the memory budget. First and last frames are pinned.
 */
export class FrameStore {
  readonly count: number;
  readonly maxLive: number;
  readonly decodeMs: number[] = [];

  private readonly bitmaps: (ImageBitmap | null)[];
  private readonly fetched: Uint8Array;
  private readonly attempts: Uint8Array;
  private readonly live = new Set<number>();
  private readonly decoding = new Set<number>();
  private readonly pinned: ReadonlySet<number>;
  private readonly order: number[];
  private readonly workers: Worker[];
  private readonly decodeSlots: number;
  private cursor = 0;
  private fetching = 0;
  private loadedCount = 0;
  private dead = false;

  constructor(private readonly o: FrameStoreOptions) {
    this.count = o.urls.length;
    this.bitmaps = new Array<ImageBitmap | null>(this.count).fill(null);
    this.fetched = new Uint8Array(this.count);
    this.attempts = new Uint8Array(this.count);
    this.order = coarseToFine(this.count);
    this.pinned = new Set([0, this.count - 1]);
    this.maxLive = Math.max(MIN_LIVE_FRAMES, Math.floor(o.budgetBytes / o.frameBytes));
    const workerCount = Math.max(1, Math.min(o.workers, MAX_WORKERS));
    this.decodeSlots = workerCount * DECODES_PER_WORKER;
    this.workers = Array.from({ length: workerCount }, () => {
      const worker = new Worker(FRAME_WORKER_URL);
      worker.onmessage = (e: MessageEvent<WorkerMessage>) => this.onMessage(e.data);
      worker.postMessage({ type: 'init', urls: o.urls });
      return worker;
    });
  }

  get liveCount(): number {
    return this.live.size;
  }

  get loaded(): number {
    return this.loadedCount;
  }

  start(): void {
    for (const i of this.pinned) this.decode(i);
    this.pump();
  }

  get(i: number): ImageBitmap | null {
    return this.bitmaps[i] ?? null;
  }

  nearestReady(f: number): number {
    const c = Math.min(this.count - 1, Math.max(0, Math.round(f)));
    for (let d = 0; d < this.count; d++) {
      if (c - d >= 0 && this.bitmaps[c - d]) return c - d;
      if (c + d < this.count && this.bitmaps[c + d]) return c + d;
    }
    return -1;
  }

  /** Chooses what stays decoded. Call when the displayed or target frame changes, or a decode lands. */
  plan(current: number, target: number, dir: 1 | -1): void {
    if (this.dead) return;
    const c = Math.round(current);
    const t = Math.round(target);
    const free = this.maxLive - this.pinned.size;
    const ahead = Math.ceil(free * AHEAD_SHARE);
    const behind = Math.max(MIN_BEHIND, free - ahead - LANDING_SLOTS);
    const keep = new Set<number>(this.pinned);
    const want: number[] = [];
    const add = (i: number) => {
      if (i >= 0 && i < this.count && !keep.has(i)) {
        keep.add(i);
        want.push(i);
      }
    };
    add(c);
    add(t);
    add(t + dir);
    add(t - dir);
    for (let k = 1; k <= Math.max(ahead, behind); k++) {
      if (k <= ahead) add(c + dir * k);
      if (k <= behind) add(c - dir * k);
    }

    if (this.reserved() >= this.maxLive) {
      const victims = [...this.live].filter((i) => !keep.has(i)).sort((a, b) => Math.abs(b - c) - Math.abs(a - c));
      for (const i of victims) {
        if (this.reserved() < this.maxLive) break;
        this.release(i);
      }
    }
    for (const i of want) {
      if (this.decoding.size >= this.decodeSlots || this.reserved() >= this.maxLive) break;
      this.decode(i);
    }
  }

  /** Releases everything except the pinned frames (hero off screen). */
  trim(): void {
    for (const i of [...this.live]) if (!this.pinned.has(i)) this.release(i);
  }

  destroy(): void {
    if (this.dead) return;
    this.dead = true;
    for (const worker of this.workers) worker.terminate();
    for (const i of [...this.live]) this.release(i);
    this.decoding.clear();
  }

  /** Bitmaps alive plus decodes in flight: both count against the budget. */
  private reserved(): number {
    return this.live.size + this.decoding.size;
  }

  private release(i: number): void {
    this.bitmaps[i]?.close();
    this.bitmaps[i] = null;
    this.live.delete(i);
  }

  private worker(i: number): Worker {
    return this.workers[i % this.workers.length];
  }

  private decode(i: number): void {
    if (this.bitmaps[i] || this.decoding.has(i) || this.attempts[i] >= MAX_ATTEMPTS) return;
    this.decoding.add(i);
    this.worker(i).postMessage({ type: 'decode', i });
  }

  private pump(): void {
    while (!this.dead && this.fetching < FETCH_CONCURRENCY && this.cursor < this.order.length) {
      const i = this.order[this.cursor++];
      if (this.fetched[i]) continue;
      this.fetching++;
      this.worker(i).postMessage({ type: 'fetch', i });
    }
  }

  private markFetched(i: number): void {
    if (this.fetched[i]) return;
    this.fetched[i] = 1;
    this.loadedCount++;
    this.o.onLoaded(this.loadedCount, this.count);
  }

  private onMessage(m: WorkerMessage): void {
    if (this.dead) {
      if (m.type === 'bitmap') m.bmp.close();
      return;
    }
    switch (m.type) {
      case 'fetched':
        this.fetching--;
        this.markFetched(m.i);
        this.pump();
        break;
      case 'bitmap':
        this.decoding.delete(m.i);
        this.markFetched(m.i);
        this.bitmaps[m.i]?.close();
        this.bitmaps[m.i] = m.bmp;
        this.live.add(m.i);
        this.decodeMs.push(m.ms);
        if (this.decodeMs.length > DECODE_SAMPLES) this.decodeMs.shift();
        this.o.onReady(m.i);
        break;
      case 'error':
        if (m.stage === 'fetch') {
          this.fetching--;
          this.pump(); // a later decode request retries the fetch
          break;
        }
        this.decoding.delete(m.i);
        this.attempts[m.i]++;
        if (this.attempts[m.i] >= MAX_ATTEMPTS && this.pinned.has(m.i)) this.o.onFatal();
        else if (this.pinned.has(m.i)) this.decode(m.i);
        break;
    }
  }
}

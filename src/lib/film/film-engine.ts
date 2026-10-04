import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import type Lenis from 'lenis';
import { setupScrollTrigger } from '@/lib/smooth-scroll';
import {
  currentAspect,
  DEFAULT_FOCAL,
  frameUrl,
  PORTRAIT_QUERY,
  remap,
  resolveTier,
  type FilmAspect,
  type FilmSource,
  type Tier,
  type TierSize,
  type TimeMap,
} from './config';
import { cover, type CoverRect } from './cover';
import { FrameStore } from './frame-store';
import {
  brightnessAt,
  cornersAt,
  fadeAt,
  loadSignTrack,
  maxHorizontalEdge,
  quadToMatrix3d,
  type SignTrack,
} from './homography';
import { decodedBudgetBytes } from './mode';

export interface FilmEngineElements {
  /** Tall section whose scroll range drives the film. */
  readonly section: HTMLElement;
  /** Sticky, viewport-sized box the canvas fills. */
  readonly stage: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** Element glued onto the tracked sign, if any. */
  readonly sign: HTMLElement | null;
}

export interface FilmEngineOptions {
  readonly films: Readonly<Record<FilmAspect, FilmSource>>;
  readonly tier: Tier;
  readonly timeMap: TimeMap;
  readonly signTracks?: Readonly<Partial<Record<FilmAspect, string>>>;
  readonly lenis: Lenis | null;
  readonly debug?: boolean;
  /** Damped scroll progress (0..1), called whenever it changes. */
  readonly onProgress: (p: number) => void;
  /** The film cannot run (missing first or last frame): fall back to static. */
  readonly onFatal: () => void;
}

interface ActiveFilm {
  readonly aspect: FilmAspect;
  readonly source: FilmSource;
  readonly tier: Tier;
  readonly size: TierSize;
  readonly focal: readonly [number, number];
  readonly store: FrameStore;
}

/** Progress damping rate (1/s). Lenis already smooths the wheel, so it gets a stiffer follow than touch. */
const WHEEL_DAMPING = 16;
const TOUCH_DAMPING = 9;
const SNAP_EPSILON = 1e-4;
const MAX_STEP_MS = 100;
/** Cross-blend alpha is quantised to bound redraws; the sign follows the same quantised value. */
const BLEND_STEPS = 16;
const MAX_BACKING_DPR = 2;
const RGBA_BYTES = 4;
const CORES_FOR_TWO_WORKERS = 6;
/** Caps the sign's raster size; past this the GPU layer costs more than the extra sharpness is worth. */
const MAX_SIGN_PX = 4096;
const BRIGHTNESS_EPSILON = 0.004;
const DECODE_PERCENTILE = 0.95;

/**
 * Scroll-scrubbed image-sequence film: CSS-sticky stage, canvas cover-fit, worker-decoded frames under a
 * memory budget, frame-rate independent damping, and a planar-tracked DOM element drawn in the same tick.
 */
export class FilmEngine {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly portrait = matchMedia(PORTRAIT_QUERY);
  private readonly damping: number;
  private readonly quad = new Float64Array(8);
  private readonly screenQuad = new Float64Array(8);
  private readonly trigger: ScrollTrigger;
  private readonly resizeObserver: ResizeObserver;
  private film: ActiveFilm;
  private track: SignTrack | null = null;
  private trackAbort: AbortController | null = null;
  private dprQuery: MediaQueryList | null = null;
  private rect: CoverRect = { x: 0, y: 0, w: 0, h: 0 };
  private cssWidth = 0;
  private cssHeight = 0;
  private signWidth = 1;
  private signHeight = 1;
  private p = 0;
  private sp = 0;
  private dir: 1 | -1 = 1;
  private lastCurrent = -1;
  private lastTarget = -1;
  private planDirty = true;
  private dirty = true;
  /** Scrolled past the film: only the pinned frames stay decoded. */
  private parked = false;
  private refreshed = false;
  private drawKey = '';
  private signVisible = false;
  private lastBrightness = Number.NaN;
  private ready = false;
  private destroyed = false;
  private hud: HTMLPreElement | null = null;

  constructor(
    private readonly el: FilmEngineElements,
    private readonly o: FilmEngineOptions,
  ) {
    setupScrollTrigger();
    const ctx = el.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('FilmEngine: 2D canvas unavailable');
    this.ctx = ctx;
    this.damping = o.lenis && !matchMedia('(pointer: coarse)').matches ? WHEEL_DAMPING : TOUCH_DAMPING;
    this.film = this.mountFilm(currentAspect());

    this.trigger = ScrollTrigger.create({
      trigger: el.section,
      start: 'top top',
      end: 'bottom bottom',
      onUpdate: (self) => this.setProgress(self.progress),
      onRefresh: (self) => {
        this.setProgress(self.progress);
        if (!this.refreshed) {
          this.refreshed = true; // restored scroll position: start there instead of easing in from 0
          this.sp = this.p;
        }
      },
      onLeave: () => this.park(true),
      onEnterBack: () => this.park(false),
    });
    this.p = this.sp = this.trigger.progress;
    this.parked = this.trigger.scroll() > this.trigger.end;

    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(el.stage);
    this.portrait.addEventListener('change', this.onAspectChange);
    window.addEventListener('pagehide', this.onPageHide);
    this.watchDpr();
    if (o.debug) this.mountHud();

    this.resize();
    this.loadTrack();
    this.film.store.start();
    this.emitProgress();
    gsap.ticker.add(this.tick);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    gsap.ticker.remove(this.tick);
    this.trigger.kill();
    this.resizeObserver.disconnect();
    this.portrait.removeEventListener('change', this.onAspectChange);
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    window.removeEventListener('pagehide', this.onPageHide);
    this.trackAbort?.abort();
    this.film.store.destroy();
    this.hud?.remove();
    const { section, sign, canvas } = this.el;
    section.removeAttribute('data-film-ready');
    section.style.removeProperty('--film-p');
    section.style.removeProperty('--film-loaded');
    sign?.removeAttribute('data-visible');
    sign?.style.removeProperty('transform');
    canvas.width = canvas.height = 0; // releases iOS canvas memory immediately
  }

  // Loop

  private readonly tick = (_time: number, deltaMs: number): void => {
    const dt = Math.min(deltaMs, MAX_STEP_MS) / 1000;
    const prev = this.sp;
    this.sp += (this.p - this.sp) * (1 - Math.exp(-this.damping * dt));
    if (Math.abs(this.p - this.sp) < SNAP_EPSILON) this.sp = this.p;
    if (this.sp !== prev) {
      this.dir = this.sp > prev ? 1 : -1;
      this.dirty = true;
      this.emitProgress();
    }
    if (!this.dirty && (this.parked || !this.planDirty)) return; // idle: one comparison per frame

    const last = this.film.store.count - 1;
    const f = remap(this.sp, this.o.timeMap) * last;
    const target = remap(this.p, this.o.timeMap) * last;
    const c = Math.round(f);
    const t = Math.round(target);
    if (!this.parked && (this.planDirty || c !== this.lastCurrent || t !== this.lastTarget)) {
      this.film.store.plan(f, target, this.dir);
      this.lastCurrent = c;
      this.lastTarget = t;
      this.planDirty = false;
    }
    this.render(f);
    if (this.hud) this.updateHud(f, target);
    this.dirty = this.sp !== this.p;
  };

  private park(parked: boolean): void {
    this.parked = parked;
    if (parked) this.film.store.trim();
    else this.planDirty = this.dirty = true;
  }

  private setProgress(p: number): void {
    this.p = p;
    this.dirty = true;
  }

  private emitProgress(): void {
    this.el.section.style.setProperty('--film-p', this.sp.toFixed(4));
    this.o.onProgress(this.sp);
  }

  private render(f: number): void {
    const store = this.film.store;
    let a = Math.floor(f);
    let b = Math.min(store.count - 1, a + 1);
    let t = f - a;
    if (!store.get(a)) {
      // Never wait on a decode: show the nearest decoded frame, unblended.
      a = store.nearestReady(f);
      if (a < 0) return; // nothing decoded yet; the poster stays visible
      b = a;
      t = 0;
    }
    if (t > 0 && !store.get(b)) t = 0;
    t = Math.round(t * BLEND_STEPS) / BLEND_STEPS;
    if (t >= 1) {
      a = b;
      t = 0;
    }

    const key = `${a}|${t}|${this.el.canvas.width}x${this.el.canvas.height}`;
    if (key === this.drawKey) return;
    const imageA = store.get(a);
    const imageB = t > 0 ? store.get(b) : null;
    if (!imageA) return;
    this.drawKey = key;

    const { ctx, rect: r } = this;
    ctx.globalAlpha = 1;
    ctx.drawImage(imageA, r.x, r.y, r.w, r.h);
    if (imageB) {
      ctx.globalAlpha = t;
      ctx.drawImage(imageB, r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
    }
    this.renderSign(a, t); // same tick as the blit, so both land in the same composited frame
    if (!this.ready) {
      this.ready = true;
      this.el.section.setAttribute('data-film-ready', '');
    }
  }

  private renderCurrent(): void {
    this.render(remap(this.sp, this.o.timeMap) * (this.film.store.count - 1));
  }

  private renderSign(a: number, t: number): void {
    const { sign } = this.el;
    const track = this.track;
    if (!sign) return;
    const matrix = track && cornersAt(track, a, t, this.quad) ? this.toScreen(this.quad) : null;
    if (!track || !matrix) {
      if (this.signVisible) {
        this.signVisible = false;
        sign.removeAttribute('data-visible');
      }
      return;
    }
    sign.style.transform = matrix;
    sign.style.setProperty('--sign-fade', fadeAt(track, a, t).toFixed(3));
    const brightness = brightnessAt(track, a, t);
    if (
      !Number.isNaN(brightness) &&
      (Number.isNaN(this.lastBrightness) || Math.abs(brightness - this.lastBrightness) > BRIGHTNESS_EPSILON)
    ) {
      this.lastBrightness = brightness;
      sign.style.setProperty('--sign-b', brightness.toFixed(3));
    }
    if (!this.signVisible) {
      this.signVisible = true;
      sign.setAttribute('data-visible', '');
    }
  }

  /** Normalised film coordinates → stage CSS px, through the canvas's own cover rect. */
  private toScreen(quad: Float64Array): string | null {
    const r = this.rect;
    const sx = this.cssWidth / this.el.canvas.width;
    const sy = this.cssHeight / this.el.canvas.height;
    for (let k = 0; k < 8; k += 2) {
      this.screenQuad[k] = (r.x + quad[k] * r.w) * sx;
      this.screenQuad[k + 1] = (r.y + quad[k + 1] * r.h) * sy;
    }
    return quadToMatrix3d(this.screenQuad, this.signWidth, this.signHeight);
  }

  // Layout

  private readonly resize = (): void => {
    const width = this.el.stage.clientWidth;
    const height = this.el.stage.clientHeight;
    if (!width || !height) return;
    const { size, focal } = this.film;
    const cssPerSourcePx = Math.max(width / size.width, height / size.height);
    // Never allocate more backing pixels than the source can fill.
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_BACKING_DPR, Math.max(1, 1 / cssPerSourcePx));
    const backingWidth = Math.round(width * dpr);
    const backingHeight = Math.round(height * dpr);
    const { canvas } = this.el;
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth; // resets the context state
      canvas.height = backingHeight;
      this.ctx.imageSmoothingQuality = 'medium';
    }
    this.cssWidth = width;
    this.cssHeight = height;
    this.rect = cover(size.width, size.height, backingWidth, backingHeight, focal);
    this.sizeSign();
    this.drawKey = '';
    this.dirty = true;
    this.renderCurrent(); // redraw now: resizing cleared the canvas and paint follows this callback
  };

  private sizeSign(): void {
    const { sign, canvas } = this.el;
    const track = this.track;
    if (!sign || !track || !canvas.width) return;
    const edge = maxHorizontalEdge(track, this.rect, this.cssWidth / canvas.width, this.cssHeight / canvas.height);
    this.signWidth = Math.max(1, Math.min(MAX_SIGN_PX, Math.ceil(edge)));
    this.signHeight = Math.max(1, Math.ceil(this.signWidth / track.aspect));
    sign.style.width = `${this.signWidth}px`;
    sign.style.height = `${this.signHeight}px`;
  }

  private watchDpr(): void {
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  private readonly onDprChange = (): void => {
    this.watchDpr();
    this.resize();
  };

  // Film sets

  private mountFilm(aspect: FilmAspect): ActiveFilm {
    const source = this.o.films[aspect];
    const resolved = resolveTier(source, this.o.tier);
    if (!resolved || source.frameCount < 1) throw new Error(`FilmEngine: no frames for ${aspect}`);
    const { tier, size } = resolved;
    // Absolute URLs: the worker resolves relative ones against its own script URL.
    const urls = Array.from(
      { length: source.frameCount },
      (_, i) => new URL(frameUrl(source, tier, i), document.baseURI).href,
    );
    const store = new FrameStore({
      urls,
      frameBytes: size.width * size.height * RGBA_BYTES,
      budgetBytes: decodedBudgetBytes(),
      workers: navigator.hardwareConcurrency >= CORES_FOR_TWO_WORKERS ? 2 : 1,
      onReady: () => {
        this.dirty = true;
        this.planDirty = true;
      },
      onLoaded: (loaded, total) => this.el.section.style.setProperty('--film-loaded', (loaded / total).toFixed(3)),
      onFatal: () => this.o.onFatal(),
    });
    return { aspect, source, tier, size, focal: source.focal ?? DEFAULT_FOCAL, store };
  }

  /** Rotating the device swaps frame set and track while keeping progress. */
  private readonly onAspectChange = (): void => {
    const aspect = currentAspect();
    if (aspect === this.film.aspect) return;
    this.film.store.destroy();
    try {
      this.film = this.mountFilm(aspect);
    } catch {
      this.o.onFatal();
      return;
    }
    this.ready = false;
    this.el.section.removeAttribute('data-film-ready');
    this.track = null;
    this.lastCurrent = this.lastTarget = -1;
    this.resize();
    this.loadTrack();
    this.film.store.start();
    this.planDirty = this.dirty = true;
  };

  private loadTrack(): void {
    this.trackAbort?.abort();
    this.trackAbort = null;
    const url = this.o.signTracks?.[this.film.aspect];
    if (!url || !this.el.sign) return;
    const controller = new AbortController();
    const film = this.film;
    this.trackAbort = controller;
    loadSignTrack(url, film.source.frameCount, controller.signal)
      .then((track) => {
        if (controller.signal.aborted || film !== this.film) return;
        this.track = track;
        this.sizeSign();
        this.drawKey = '';
        this.dirty = true;
      })
      .catch(() => {
        // Aborted or unreadable: the film runs without the living sign.
      });
  }

  // Lifecycle and debug

  private readonly onPageHide = (e: PageTransitionEvent): void => {
    if (!e.persisted) this.destroy();
  };

  private mountHud(): void {
    const hud = document.createElement('pre');
    hud.style.cssText =
      'position:fixed;left:8px;top:8px;z-index:2147483647;margin:0;padding:6px 8px;pointer-events:none;' +
      'max-width:calc(100vw - 16px);white-space:pre-wrap;' +
      'font:11px/1.35 ui-monospace,monospace;color:#7CFC8A;background:rgb(0 0 0 / .78);border-radius:4px';
    document.body.append(hud);
    this.hud = hud;
  }

  private updateHud(f: number, target: number): void {
    if (!this.hud) return;
    const { store, aspect, tier } = this.film;
    const samples = [...store.decodeMs].sort((x, y) => x - y);
    const p95 = samples.length ? samples[Math.floor(samples.length * DECODE_PERCENTILE)].toFixed(1) : '-';
    const dpr = this.el.canvas.width / this.cssWidth;
    this.hud.textContent =
      `${aspect}/${tier}  frame ${f.toFixed(1)} → ${target.toFixed(1)}  lag ${(target - f).toFixed(1)}\n` +
      `loaded ${store.loaded}/${store.count}  live ${store.liveCount}/${store.maxLive}  ` +
      `decode p95 ${p95} ms  dpr ${dpr.toFixed(2)}  sign ${this.signVisible ? 'on' : 'off'}`;
  }
}

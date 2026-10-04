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
import { RemoteRenderer, supportsRemoteFilm } from './remote-renderer';
import type { RenderEffect, RenderLiftLayer } from './render-protocol';

export interface FilmEngineElements {
  /** Tall section whose scroll range drives the film. */
  readonly section: HTMLElement;
  /** Sticky, viewport-sized box the canvas fills. */
  readonly stage: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  /** Element glued onto the tracked sign, if any. */
  readonly sign: HTMLElement | null;
  /**
   * Receives `--film-p` every frame (default: the section). Every descendant is restyled on each write,
   * so this should be the smallest box that holds the progress-driven copy.
   */
  readonly progressTarget?: HTMLElement | null;
}

/**
 * Frames shown before the film on the same canvas (off-main-thread renderer only; the Canvas2D path leaves
 * it to the page). The time map must hold the film's first frame until at least `end + fade`.
 */
export interface FilmPrelude {
  /** Per aspect; each must ship the same tier sizes as the film it opens. */
  readonly films: Readonly<Record<FilmAspect, FilmSource>>;
  /** Scroll progress at which the prelude's last frame is reached. */
  readonly end: number;
  /** Progress span over which it hands over to the film's first frame. */
  readonly fade: number;
}

/** Ending effects driven by the damped progress: the film darkens and blurs while cut-outs lift off it. */
export interface FilmFinale {
  /** Cut-outs of the last frame per aspect (drawn by the render worker; the page draws its own otherwise). */
  readonly layers: Readonly<Record<FilmAspect, readonly RenderLiftLayer[]>>;
  readonly at: (p: number) => RenderEffect;
}

export interface FilmEngineOptions {
  readonly films: Readonly<Record<FilmAspect, FilmSource>>;
  readonly tier: Tier;
  readonly timeMap: TimeMap;
  readonly signTracks?: Readonly<Partial<Record<FilmAspect, string>>>;
  /**
   * Paints the sign's lettering into a bitmap of the given width/height aspect, for the off-main-thread
   * renderer, which draws the sign in the same GPU frame as the film. Without it the DOM sign is used.
   */
  readonly signRaster?: (aspect: number) => Promise<ImageBitmap | null>;
  readonly prelude?: FilmPrelude;
  readonly finale?: FilmFinale;
  /** Allow the off-main-thread renderer when the browser supports it (default true). */
  readonly remote?: boolean;
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
  /** Main-thread frame store; null when the render worker owns the frames. */
  readonly store: FrameStore | null;
  /** Prelude frames ahead of the film on the render worker's timeline. */
  readonly prelude: number;
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
/** The sign follows the board's measured light: brightness(floor + b × gain), b in 0..1. */
const SIGN_BRIGHTNESS_FLOOR = 0.55;
const SIGN_BRIGHTNESS_GAIN = 0.6;
const DECODE_PERCENTILE = 0.95;

/**
 * Scroll-scrubbed image-sequence film: CSS-sticky stage, canvas cover-fit, worker-decoded frames under a
 * memory budget, frame-rate independent damping, and a planar-tracked DOM element drawn in the same tick.
 */
export class FilmEngine {
  private readonly ctx: CanvasRenderingContext2D | null = null;
  private readonly remote: RemoteRenderer | null = null;
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
  private lastFade = '';
  private ready = false;
  private destroyed = false;
  private hud: HTMLPreElement | null = null;
  private lastFilter = '';
  private remoteStats: { live: number; slots: number; shown: number; wanted: number; source: string } = {
    live: 0,
    slots: 0,
    shown: 0,
    wanted: 0,
    source: '-',
  };

  constructor(
    private readonly el: FilmEngineElements,
    private readonly o: FilmEngineOptions,
  ) {
    setupScrollTrigger();
    // Off the main thread when possible: the canvas goes to a worker that decodes, uploads and draws.
    // The DOM sign is then redundant (the worker draws it), unless the page cannot rasterise it.
    if (o.remote !== false && supportsRemoteFilm() && (!el.sign || o.signRaster)) {
      try {
        this.remote = new RemoteRenderer(el.canvas, decodedBudgetBytes(), {
          onReady: () => this.markReady(),
          onLoaded: (loaded, total) => this.el.section.style.setProperty('--film-loaded', (loaded / total).toFixed(3)),
          onFatal: () => this.o.onFatal(),
          onStats: (live, slots, shown, wanted, source) => (this.remoteStats = { live, slots, shown, wanted, source }),
        });
      } catch {
        this.remote = null;
      }
    }
    if (this.remote) {
      if (el.sign) el.sign.hidden = true;
    } else {
      const ctx = el.canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('FilmEngine: 2D canvas unavailable');
      this.ctx = ctx;
    }
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
    this.film.store?.start();
    this.emitProgress();
    gsap.ticker.add(this.tick);
  }

  /** Re-paints the sign's lettering (language switch) without restarting the film. */
  refreshSign(): void {
    if (this.remote && this.track) this.rasterSign(this.track);
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
    this.film.store?.destroy();
    this.remote?.destroy();
    this.hud?.remove();
    const { section, sign, canvas } = this.el;
    section.removeAttribute('data-film-ready');
    (this.el.progressTarget ?? section).style.removeProperty('--film-p');
    section.style.removeProperty('--film-loaded');
    sign?.removeAttribute('data-visible');
    for (const prop of ['transform', 'opacity', 'filter']) sign?.style.removeProperty(prop);
    if (sign) sign.hidden = false;
    // Releases iOS canvas memory at once. A transferred canvas is sized by its worker, which is gone now.
    if (!this.remote) canvas.width = canvas.height = 0;
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

    const last = this.film.source.frameCount - 1;
    const f = remap(this.sp, this.o.timeMap) * last;
    const target = remap(this.p, this.o.timeMap) * last;
    if (this.remote) {
      this.remote.frame(this.timeline(this.sp, f), this.timeline(this.p, target), this.dir);
      this.planDirty = false;
      if (this.hud) this.updateHud(f, target);
      this.dirty = this.sp !== this.p;
      return;
    }
    const store = this.film.store!;
    const c = Math.round(f);
    const t = Math.round(target);
    if (!this.parked && (this.planDirty || c !== this.lastCurrent || t !== this.lastTarget)) {
      store.plan(f, target, this.dir);
      this.lastCurrent = c;
      this.lastTarget = t;
      this.planDirty = false;
    }
    this.render(f);
    if (this.hud) this.updateHud(f, target);
    this.dirty = this.sp !== this.p;
  };

  /**
   * Film frame -> render-worker timeline. The prelude's frames come first: scrubbed over [0, end], then a
   * blend from its last frame (the film's first, re-shot) to the film's frame 0 over `fade`, then the film.
   */
  private timeline(p: number, f: number): number {
    const n = this.film.prelude;
    const prelude = this.o.prelude;
    if (!n || !prelude) return f;
    if (p <= prelude.end) return (Math.max(0, p) / prelude.end) * (n - 1);
    if (p <= prelude.end + prelude.fade) return n - 1 + (p - prelude.end) / prelude.fade;
    return n + f;
  }

  private park(parked: boolean): void {
    this.parked = parked;
    this.remote?.park(parked);
    if (parked) this.film.store?.trim();
    else this.planDirty = this.dirty = true;
  }

  private markReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.el.section.setAttribute('data-film-ready', '');
  }

  private setProgress(p: number): void {
    this.p = p;
    this.dirty = true;
  }

  private emitProgress(): void {
    (this.el.progressTarget ?? this.el.section).style.setProperty('--film-p', this.sp.toFixed(4));
    this.o.onProgress(this.sp);
    if (this.o.finale) this.applyEffect(this.o.finale.at(this.sp));
  }

  /**
   * Remote: the worker darkens/blurs the film and lifts the cut-outs in its shader. Main thread: a CSS filter
   * on the canvas, present only while it does something (a filter pass on every frame of the film is costly).
   */
  private applyEffect(e: RenderEffect): void {
    if (this.remote) {
      this.remote.effect(e);
      return;
    }
    const filter = e.dim > 0 || e.blur > 0 ? `brightness(${(1 - e.dim).toFixed(3)}) blur(${e.blur.toFixed(2)}px)` : '';
    if (filter !== this.lastFilter) {
      this.lastFilter = filter;
      this.el.canvas.style.filter = filter;
    }
  }

  private render(f: number): void {
    const store = this.film.store;
    const ctx = this.ctx;
    if (!store || !ctx) return;
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

    const r = this.rect;
    ctx.globalAlpha = 1;
    ctx.drawImage(imageA, r.x, r.y, r.w, r.h);
    if (imageB) {
      ctx.globalAlpha = t;
      ctx.drawImage(imageB, r.x, r.y, r.w, r.h);
      ctx.globalAlpha = 1;
    }
    this.renderSign(a, t); // same tick as the blit, so both land in the same composited frame
    this.markReady();
  }

  private renderCurrent(): void {
    this.render(remap(this.sp, this.o.timeMap) * (this.film.source.frameCount - 1));
  }

  private renderSign(a: number, t: number): void {
    const { sign } = this.el;
    const track = this.track;
    if (!sign) return;
    const matrix = track && cornersAt(track, a, t, this.quad) ? this.toScreen(this.quad) : null;
    if (!track || !matrix) {
      if (this.signVisible) {
        this.signVisible = false;
        this.lastFade = '';
        sign.style.opacity = '0';
        sign.removeAttribute('data-visible');
      }
      return;
    }
    // Transform, opacity and filter go straight on the element: none of them inherits, so the sign's text
    // subtree (a size container) is never restyled per frame. Custom properties would cascade into it.
    sign.style.transform = matrix;
    const fade = fadeAt(track, a, t).toFixed(3);
    if (fade !== this.lastFade) {
      this.lastFade = fade;
      sign.style.opacity = fade;
    }
    const brightness = brightnessAt(track, a, t);
    if (
      !Number.isNaN(brightness) &&
      (Number.isNaN(this.lastBrightness) || Math.abs(brightness - this.lastBrightness) > BRIGHTNESS_EPSILON)
    ) {
      this.lastBrightness = brightness;
      sign.style.filter = `brightness(${(SIGN_BRIGHTNESS_FLOOR + brightness * SIGN_BRIGHTNESS_GAIN).toFixed(3)})`;
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
    this.cssWidth = width;
    this.cssHeight = height;
    if (this.remote) {
      this.remote.resize(backingWidth, backingHeight, backingWidth / width);
      this.dirty = true;
      return;
    }
    const { canvas } = this.el;
    if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
      canvas.width = backingWidth; // resets the context state
      canvas.height = backingHeight;
      // 'low' is plain bilinear. 'medium' makes Chrome build a mip chain for every new frame on upload, which
      // doubled the per-frame upload cost on the main thread; the frame is drawn near 1:1, so mips add nothing.
      if (this.ctx) this.ctx.imageSmoothingQuality = 'low';
    }
    this.rect = cover(size.width, size.height, backingWidth, backingHeight, focal);
    this.sizeSign();
    this.drawKey = '';
    this.dirty = true;
    this.renderCurrent(); // redraw now: resizing cleared the canvas and paint follows this callback
  };

  private sizeSign(): void {
    const { sign, canvas } = this.el;
    const track = this.track;
    if (this.remote || !sign || !track || !canvas.width) return;
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
    const focal = source.focal ?? DEFAULT_FOCAL;
    // Absolute URLs: workers resolve relative ones against their own script URL.
    const absolute = (s: FilmSource, t: Tier) =>
      Array.from({ length: s.frameCount }, (_, i) => new URL(frameUrl(s, t, i), document.baseURI).href);
    const urls = absolute(source, tier);
    if (this.remote) {
      // The prelude shares the film's texture pool, so it must ship the same frame size.
      const pre = this.o.prelude?.films[aspect];
      const preTier = pre ? resolveTier(pre, tier) : null;
      const usePrelude =
        !!pre && !!preTier && preTier.size.width === size.width && preTier.size.height === size.height;
      const prelude = usePrelude ? absolute(pre, preTier.tier) : [];
      // Hardware-decodable copy, only if every frame of the timeline has one in the same codec.
      const avcOf = (s: FilmSource, t: Tier) => {
        const a = s.avc?.tiers[t];
        return a && s.avc
          ? {
              codec: a.codec,
              urls: Array.from(
                { length: s.frameCount },
                (_, i) => new URL(frameUrl(s, t, i, s.avc!.pattern), document.baseURI).href,
              ),
            }
          : null;
      };
      const filmAvc = avcOf(source, tier);
      const preludeAvc = usePrelude ? avcOf(pre, preTier.tier) : null;
      const avc =
        filmAvc && (!usePrelude || (preludeAvc && preludeAvc.codec === filmAvc.codec))
          ? { codec: filmAvc.codec, urls: [...(preludeAvc?.urls ?? []), ...filmAvc.urls] }
          : undefined;
      this.remote.sequence({
        urls: [...prelude, ...urls],
        width: size.width,
        height: size.height,
        focal: [focal[0], focal[1]],
        prelude: prelude.length,
        avc,
      });
      const lift = this.o.finale?.layers[aspect];
      if (lift) this.remote.lift(lift.map((l) => ({ ...l, url: new URL(l.url, document.baseURI).href })));
      return { aspect, source, tier, size, focal, store: null, prelude: prelude.length };
    }
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
    return { aspect, source, tier, size, focal, store, prelude: 0 };
  }

  /** Rotating the device swaps frame set and track while keeping progress. */
  private readonly onAspectChange = (): void => {
    const aspect = currentAspect();
    if (aspect === this.film.aspect) return;
    this.film.store?.destroy();
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
    this.film.store?.start();
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
        if (this.remote) {
          this.remote.track(track);
          if (track) this.rasterSign(track);
        }
        this.sizeSign();
        this.drawKey = '';
        this.dirty = true;
      })
      .catch(() => {
        // Aborted or unreadable: the film runs without the living sign.
      });
  }

  private rasterSign(track: SignTrack): void {
    const film = this.film;
    this.o
      .signRaster?.(track.aspect)
      .then((bitmap) => {
        if (!bitmap) return;
        if (this.destroyed || film !== this.film || !this.remote) bitmap.close();
        else this.remote.sign(bitmap);
      })
      .catch(() => {
        // Lettering unavailable: the film runs without the living sign.
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
    if (!store) {
      const s = this.remoteStats;
      this.hud.textContent =
        `${aspect}/${tier} (worker, ${s.source})  frame ${f.toFixed(1)} -> ${target.toFixed(1)}  lag ${(target - f).toFixed(1)}\n` +
        `gpu frames ${s.live}/${s.slots}  shown ${s.shown.toFixed(1)}  wanted ${s.wanted.toFixed(1)}`;
      return;
    }
    const samples = [...store.decodeMs].sort((x, y) => x - y);
    const p95 = samples.length ? samples[Math.floor(samples.length * DECODE_PERCENTILE)].toFixed(1) : '-';
    const dpr = this.el.canvas.width / this.cssWidth;
    this.hud.textContent =
      `${aspect}/${tier}  frame ${f.toFixed(1)} → ${target.toFixed(1)}  lag ${(target - f).toFixed(1)}\n` +
      `loaded ${store.loaded}/${store.count}  live ${store.liveCount}/${store.maxLive}  ` +
      `decode p95 ${p95} ms  dpr ${dpr.toFixed(2)}  sign ${this.signVisible ? 'on' : 'off'}`;
  }
}

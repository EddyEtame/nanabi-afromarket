import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { REDUCED_MOTION_QUERY } from '@/lib/film/config';

/**
 * One clock for the whole page: Lenis, ScrollTrigger and the film loop all run on gsap.ticker.
 * Lenis smooths wheel and trackpad only; touch keeps native momentum (syncTouch is unstable on older iOS).
 */

const LENIS_LERP = 0.1;
const DEFAULT_LAG_THRESHOLD_MS = 500;
const DEFAULT_LAG_ADJUSTED_MS = 33;

let lenis: Lenis | null = null;
let users = 0;
let scrollTriggerReady = false;

const raf = (time: number) => lenis?.raf(time * 1000);

export function setupScrollTrigger(): void {
  if (scrollTriggerReady) return;
  gsap.registerPlugin(ScrollTrigger);
  // Ignore the iOS toolbar show/hide so the pinned film never re-measures mid-scroll.
  ScrollTrigger.config({ ignoreMobileResize: true });
  scrollTriggerReady = true;
}

/** Reference-counted; pair every call with `releaseSmoothScroll()`. Null under reduced motion. */
export function acquireSmoothScroll(): Lenis | null {
  setupScrollTrigger();
  users++;
  if (lenis || matchMedia(REDUCED_MOTION_QUERY).matches) return lenis;
  lenis = new Lenis({ lerp: LENIS_LERP, smoothWheel: true, syncTouch: false, anchors: true, autoRaf: false });
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add(raf);
  gsap.ticker.lagSmoothing(0);
  return lenis;
}

export function releaseSmoothScroll(): void {
  users = Math.max(0, users - 1);
  if (users > 0 || !lenis) return;
  gsap.ticker.remove(raf);
  gsap.ticker.lagSmoothing(DEFAULT_LAG_THRESHOLD_MS, DEFAULT_LAG_ADJUSTED_MS);
  lenis.destroy();
  lenis = null;
}

/** Jumps to `el` at once (skip controls must not animate through the film). */
export function jumpTo(el: HTMLElement): void {
  if (lenis) lenis.scrollTo(el, { immediate: true, force: true });
  else el.scrollIntoView({ behavior: 'instant', block: 'start' });
}

/** Scrolls to an absolute page offset, smoothly when Lenis runs. */
export function scrollToOffset(y: number): void {
  if (lenis) lenis.scrollTo(y);
  else window.scrollTo({ top: y, behavior: matchMedia(REDUCED_MOTION_QUERY).matches ? 'instant' : 'smooth' });
}

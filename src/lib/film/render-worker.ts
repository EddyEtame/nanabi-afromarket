/// <reference lib="webworker" />
/**
 * Off-main-thread film renderer: the hero canvas is transferred here (OffscreenCanvas + WebGL2).
 *
 * The main thread only posts where the film should be. This worker fetches, decodes and uploads frames into
 * a fixed pool of GPU textures ahead of the scroll, then draws the cross-blended frame, the optional prelude
 * and the living sign (projective texture) in one GPU frame, so the sign can never drift off its board.
 * Nothing here touches the main thread: a 1080p texture upload costs 5-30 ms on an integrated GPU, and on the
 * main thread that cost landed in the middle of every scroll frame.
 *
 * Frames are addressed on one virtual timeline: the prelude's frames (if any) first, then the film's.
 *
 * Decoding: when the sequence ships H.264 keyframes and VideoDecoder supports them, frames are decoded by the
 * GPU's video engine (no CPU decode) and copied texture to texture (no upload). Otherwise WebP frames are
 * decoded with createImageBitmap and uploaded, a few per frame. A decoder failure falls back to WebP.
 */
import { cornersAt, fadeAt, brightnessAt, squareToQuad, isDrawableQuad, type SignTrack } from './homography';
import type { RenderEffect, RenderIn, RenderLiftLayer, RenderOut, RenderSequence } from './render-protocol';

declare const self: DedicatedWorkerGlobalScope;

const FETCH_CONCURRENCY = 6;
const DECODE_CONCURRENCY = 3;
const MAX_ATTEMPTS = 3;
const MIN_SLOTS = 8;
const AHEAD_SHARE = 0.65;
const MIN_BEHIND = 2;
/** Uploads done in one frame besides the ones the frame itself needs; keeps each frame's GPU work bounded. */
const SPARE_UPLOADS_PER_FRAME = 2;
const SIGN_BRIGHTNESS_FLOOR = 0.55;
const SIGN_BRIGHTNESS_GAIN = 0.6;
const STATS_EVERY_MS = 250;
// Ending A's cut-out shadow at full lift, in CSS px (the DOM fallback's drop-shadow).
const LIFT_SHADOW_Y = 28;
const LIFT_SHADOW_BLUR = 36;
const LIFT_SHADOW_ALPHA = 0.65;
/** CSS blur(r) is a Gaussian of deviation r; a disc of radius ~2r reads the same. */
const BLUR_DISC = 2;

type Frame = ImageBitmap | VideoFrame;
/** VideoFrame does not exist where WebCodecs does not (Firefox before 130): never reference it bare. */
const isVideoFrame = (f: Frame): f is VideoFrame => typeof VideoFrame === 'function' && f instanceof VideoFrame;

let canvas: OffscreenCanvas | null = null;
let gl: WebGL2RenderingContext | null = null;
let seq: RenderSequence | null = null;
let generation = 0;
let budgetBytes = 0;
let maxSlots = MIN_SLOTS;

// Per-frame state of the current sequence
let source: 'avc' | 'image' = 'image';
let urls: string[] = [];
let decoder: VideoDecoder | null = null;
let flushQueued = false;
let blobs: (Blob | null)[] = [];
let fetched: Uint8Array = new Uint8Array(0);
let attempts: Uint8Array = new Uint8Array(0);
let decoded = new Map<number, Frame>(); // decoded, waiting for upload
let decoding = new Set<number>();
let pendingFetch = new Map<number, Promise<Blob>>();
let order: number[] = [];
let cursor = 0;
let fetching = 0;
let loadedCount = 0;

// GPU texture pool
interface Slot {
  tex: WebGLTexture;
  frame: number;
}
let slots: Slot[] = [];
const frameSlot = new Map<number, Slot>();
let pinned = new Set<number>();
let keep = new Set<number>();
let want: number[] = [];

// Display state
let vf = 0;
let target = 0;
let dir: 1 | -1 = 1;
let parked = false;
let width = 0;
let height = 0;
let cssScale = 1;
let effect: RenderEffect = { dim: 0, blur: 0, lift: 0, liftOpacity: 0 };
interface Lift extends RenderLiftLayer {
  tex: WebGLTexture;
}
let lifts: Lift[] = [];
let liftGeneration = 0;
/** Lift textures and the blur/shadow shader paths have been drawn once (drivers upload and compile lazily). */
let warm = false;
let ready = false;
let raf = 0;
let lastStats = 0;
let dead = false;

// Sign
let track: SignTrack | null = null;
let signTex: WebGLTexture | null = null;
let signReady = false;

// GL programs
let filmProg: WebGLProgram | null = null;
let signProg: WebGLProgram | null = null;
let quadProg: WebGLProgram | null = null;
let quadDynVao: WebGLVertexArrayObject | null = null;
let quadDynBuf: WebGLBuffer | null = null;
const quadU: Record<string, WebGLUniformLocation | null> = {};
const quadVerts = new Float32Array(16);
let quadVao: WebGLVertexArrayObject | null = null;
let signVao: WebGLVertexArrayObject | null = null;
let signBuf: WebGLBuffer | null = null;
const filmU: Record<string, WebGLUniformLocation | null> = {};
const signU: Record<string, WebGLUniformLocation | null> = {};
const corners = new Float64Array(8);
const screenQuad = new Float64Array(8);
const signVerts = new Float32Array(8);

const post = (m: RenderOut, transfer: Transferable[] = []) => self.postMessage(m, transfer);

self.onmessage = (e: MessageEvent<RenderIn>) => {
  const m = e.data;
  if (dead && m.type !== 'destroy') return;
  switch (m.type) {
    case 'init':
      canvas = m.canvas;
      budgetBytes = m.budgetBytes;
      if (!initGl()) {
        post({ type: 'fatal', reason: 'webgl2' });
        return;
      }
      break;
    case 'sequence':
      setSequence(m.sequence);
      break;
    case 'lift':
      loadLifts(m.layers);
      break;
    case 'effect':
      effect = m.effect;
      requestDraw();
      break;
    case 'resize':
      width = m.width;
      height = m.height;
      cssScale = m.scale;
      if (canvas && (canvas.width !== width || canvas.height !== height)) {
        canvas.width = width;
        canvas.height = height;
      }
      requestDraw();
      break;
    case 'frame':
      vf = m.f;
      target = m.target;
      dir = m.dir;
      requestDraw();
      break;
    case 'park':
      parked = m.parked;
      if (parked) trim();
      requestDraw();
      break;
    case 'track':
      track = m.track;
      requestDraw();
      break;
    case 'sign':
      uploadSign(m.bitmap);
      requestDraw();
      break;
    case 'destroy':
      destroy();
      break;
  }
};

// ---------------------------------------------------------------- GL setup

const VERT_FILM = `#version 300 es
in vec2 aPos;
out vec2 vUv;
uniform vec4 uRect; // cover rect in clip space: x0, y0, x1, y1
void main() {
  vec2 p = mix(uRect.xy, uRect.zw, aPos);
  vUv = vec2(aPos.x, 1.0 - aPos.y);
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const FRAG_FILM = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uA;
uniform sampler2D uB;
uniform float uT;
uniform float uDim;
uniform vec2 uBlur; // disc radius in uv units; 0 = sharp
const vec2 DISC[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
vec3 film(vec2 uv) {
  return mix(texture(uA, uv).rgb, texture(uB, uv).rgb, uT);
}
void main() {
  vec3 c;
  if (uBlur.x > 0.0) {
    c = film(vUv);
    for (int k = 0; k < 12; k++) c += film(vUv + DISC[k] * uBlur);
    c /= 13.0;
  } else {
    c = film(vUv);
  }
  outColor = vec4(c * (1.0 - uDim), 1.0);
}`;

// Textured quad in backing pixels: the cut-outs and their shadows.
const VERT_QUAD = `#version 300 es
in vec2 aPos;
in vec2 aUv;
out vec2 vUv;
uniform vec2 uSize;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0);
}`;

const FRAG_QUAD = `#version 300 es
precision mediump float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform float uAlpha;
uniform float uShadow; // 1 = draw the blurred alpha as a black shadow
uniform vec2 uBlur;    // disc radius in uv units
const vec2 DISC[12] = vec2[](
  vec2(-0.326, -0.406), vec2(-0.840, -0.074), vec2(-0.696, 0.457), vec2(-0.203, 0.621),
  vec2(0.962, -0.195), vec2(0.473, -0.480), vec2(0.519, 0.767), vec2(0.185, -0.893),
  vec2(0.507, 0.064), vec2(0.896, 0.412), vec2(-0.322, -0.933), vec2(-0.792, -0.598));
float alphaAt(vec2 uv) {
  return (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) ? 0.0 : texture(uTex, uv).a;
}
void main() {
  if (uShadow > 0.5) {
    float a = alphaAt(vUv);
    for (int k = 0; k < 12; k++) a += alphaAt(vUv + DISC[k] * uBlur);
    outColor = vec4(0.0, 0.0, 0.0, a / 13.0 * uAlpha);
  } else {
    vec4 c = texture(uTex, vUv); // straight alpha, premultiplied here
    outColor = vec4(c.rgb * c.a, c.a) * uAlpha;
  }
}`;

const VERT_SIGN = `#version 300 es
in vec2 aPos; // quad corners in backing pixels (top-left origin)
uniform vec2 uSize;
void main() {
  vec2 clip = vec2(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const FRAG_SIGN = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uSign;
uniform mat3 uInv;      // backing pixel (top-left origin) -> sign unit square
uniform vec2 uSize;
uniform float uFade;
uniform float uGain;
void main() {
  vec2 px = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  vec3 h = uInv * vec3(px, 1.0);
  vec2 uv = h.xy / h.z;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
  vec4 c = texture(uSign, uv); // straight alpha: premultiplied here, never by the upload path
  outColor = vec4(c.rgb * c.a * uGain, c.a) * uFade;
}`;

function compile(type: number, src: string): WebGLShader | null {
  if (!gl) return null;
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
}

function program(vs: string, fs: string): WebGLProgram | null {
  if (!gl) return null;
  const v = compile(gl.VERTEX_SHADER, vs);
  const f = compile(gl.FRAGMENT_SHADER, fs);
  const p = gl.createProgram();
  if (!v || !f || !p) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.bindAttribLocation(p, 1, 'aUv');
  gl.linkProgram(p);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

function initGl(): boolean {
  if (!canvas) return false;
  gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  }) as WebGL2RenderingContext | null;
  if (!gl) return false;
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    post({ type: 'fatal', reason: 'context-lost' });
  });
  filmProg = program(VERT_FILM, FRAG_FILM);
  signProg = program(VERT_SIGN, FRAG_SIGN);
  quadProg = program(VERT_QUAD, FRAG_QUAD);
  if (!filmProg || !signProg || !quadProg) return false;
  for (const n of ['uRect', 'uA', 'uB', 'uT', 'uDim', 'uBlur']) filmU[n] = gl.getUniformLocation(filmProg, n);
  for (const n of ['uSize', 'uTex', 'uAlpha', 'uShadow', 'uBlur']) quadU[n] = gl.getUniformLocation(quadProg, n);
  for (const n of ['uSign', 'uInv', 'uSize', 'uFade', 'uGain']) signU[n] = gl.getUniformLocation(signProg, n);

  quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  const qb = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, qb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  signVao = gl.createVertexArray();
  gl.bindVertexArray(signVao);
  signBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, signBuf);
  gl.bufferData(gl.ARRAY_BUFFER, signVerts.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  quadDynVao = gl.createVertexArray();
  gl.bindVertexArray(quadDynVao);
  quadDynBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadDynBuf);
  gl.bufferData(gl.ARRAY_BUFFER, quadVerts.byteLength, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
  gl.bindVertexArray(null);

  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.disable(gl.DEPTH_TEST);
  return true;
}

// ---------------------------------------------------------------- sequence and store

function resetLoading(): void {
  generation++;
  for (const b of decoded.values()) b.close();
  decoded = new Map();
  decoding = new Set();
  pendingFetch = new Map();
  const n = urls.length;
  blobs = new Array<Blob | null>(n).fill(null);
  fetched = new Uint8Array(n);
  attempts = new Uint8Array(n);
  fetching = 0;
  loadedCount = 0;
  cursor = 0;
}

function closeDecoder(): void {
  if (decoder && decoder.state !== 'closed') decoder.close();
  decoder = null;
}

/** VideoDecoder for the sequence's H.264 copy, hardware first; null when the browser cannot decode it. */
async function openDecoder(next: RenderSequence): Promise<VideoDecoder | null> {
  if (!next.avc || typeof VideoDecoder !== 'function') return null;
  const base = { codec: next.avc.codec, codedWidth: next.width, codedHeight: next.height, optimizeForLatency: true };
  for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
    const config: VideoDecoderConfig = { ...base, hardwareAcceleration };
    try {
      if (!(await VideoDecoder.isConfigSupported(config)).supported) continue;
      const d: VideoDecoder = new VideoDecoder({
        output: (frame) => onVideoFrame(frame, d),
        error: () => fallBackToImages(d),
      });
      d.configure(config);
      return d;
    } catch {
      // try the next acceleration mode
    }
  }
  return null;
}

/** The video decoder failed mid-film: carry on with the WebP frames. Textures already on the GPU stay. */
function fallBackToImages(failed: VideoDecoder): void {
  if (failed !== decoder || !seq || source !== 'avc') return;
  closeDecoder();
  source = 'image';
  urls = seq.urls;
  resetLoading();
  startLoading();
}

function startLoading(): void {
  for (const i of pinned) decode(i);
  pump();
  plan();
  requestDraw();
}

function setSequence(next: RenderSequence): void {
  if (!gl) return;
  closeDecoder();
  for (const s of slots) gl.deleteTexture(s.tex);
  slots = [];
  frameSlot.clear();
  seq = next;
  source = 'image';
  urls = next.urls;
  resetLoading();
  const n = next.urls.length;
  ready = false;
  order = coarseToFine(n, next.prelude);
  pinned = new Set([0, next.prelude, n - 1]);
  const frameBytes = next.width * next.height * 4;
  maxSlots = Math.max(MIN_SLOTS, Math.min(n, Math.floor(budgetBytes / frameBytes)));
  for (let i = 0; i < maxSlots; i++) {
    const tex = gl.createTexture();
    if (!tex) break;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, next.width, next.height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    slots.push({ tex, frame: -1 });
  }
  const gen = generation;
  void openDecoder(next).then((d) => {
    if (gen !== generation || dead) {
      if (d && d.state !== 'closed') d.close();
      return;
    }
    if (d && next.avc) {
      decoder = d;
      source = 'avc';
      urls = next.avc.urls;
      resetLoading();
    }
    startLoading();
  });
}

/** Pinned frames, then halving strides over the prelude and the film: everything is coarsely scrubbable early. */
function coarseToFine(n: number, prelude: number): number[] {
  const out: number[] = [];
  const seen = new Uint8Array(n);
  const add = (i: number) => {
    if (i >= 0 && i < n && !seen[i]) {
      seen[i] = 1;
      out.push(i);
    }
  };
  add(0);
  add(prelude);
  add(n - 1);
  const pass = (lo: number, hi: number) => {
    const len = hi - lo;
    if (len < 1) return;
    for (let step = 1 << Math.floor(Math.log2(Math.max(1, len))); step >= 1; step >>= 1)
      for (let i = lo; i <= hi; i += step) add(i);
  };
  pass(prelude, n - 1);
  pass(0, prelude - 1);
  return out;
}

function load(i: number, priority: RequestPriority): Promise<Blob> {
  const hit = blobs[i];
  if (hit) return Promise.resolve(hit);
  let req = pendingFetch.get(i);
  if (!req) {
    const gen = generation;
    const url = urls[i];
    req = fetch(url, { priority })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.blob();
      })
      .then((b) => {
        if (gen === generation) {
          blobs[i] = b;
          markFetched(i);
        }
        return b;
      })
      .finally(() => {
        if (gen === generation) pendingFetch.delete(i);
      });
    pendingFetch.set(i, req);
  }
  return req;
}

function markFetched(i: number): void {
  if (fetched[i]) return;
  fetched[i] = 1;
  loadedCount++;
  post({ type: 'loaded', loaded: loadedCount, total: fetched.length });
}

function pump(): void {
  while (seq && fetching < FETCH_CONCURRENCY && cursor < order.length) {
    const i = order[cursor++];
    if (fetched[i]) continue;
    fetching++;
    const gen = generation;
    load(i, 'low')
      .catch(() => {})
      .finally(() => {
        if (gen !== generation) return;
        fetching--;
        pump();
      });
  }
}

function decode(i: number): void {
  if (!seq || frameSlot.has(i) || decoded.has(i) || decoding.has(i) || attempts[i] >= MAX_ATTEMPTS) return;
  decoding.add(i);
  const gen = generation;
  if (source === 'avc') {
    load(i, 'high')
      .then((blob) => blob.arrayBuffer())
      .then((data) => {
        if (gen !== generation || !decoder || decoder.state !== 'configured') {
          decoding.delete(i);
          return;
        }
        // Every file is a self-contained keyframe (SPS + PPS + IDR), so frames decode in any order.
        decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: i, data }));
      })
      .catch(() => {
        if (gen !== generation) return;
        decoding.delete(i);
        attempts[i]++;
        if (pinned.has(i) && attempts[i] >= MAX_ATTEMPTS && decoder) fallBackToImages(decoder);
      });
    return;
  }
  load(i, 'high')
    .then((blob) => createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
    .then((bmp) => {
      if (gen !== generation || dead) {
        bmp.close();
        return;
      }
      decoding.delete(i);
      if (keep.has(i) || pinned.has(i)) decoded.set(i, bmp);
      else bmp.close();
      requestDraw();
    })
    .catch(() => {
      if (gen !== generation) return;
      decoding.delete(i);
      attempts[i]++;
      if (pinned.has(i)) {
        if (attempts[i] >= MAX_ATTEMPTS) post({ type: 'fatal', reason: `frame ${i}` });
        else decode(i);
      }
    });
}

/**
 * Some decoders hold their last output until more input arrives; a flush once the burst of requests is
 * queued releases it, so the frame the scroll stops on always lands.
 */
function queueFlush(): void {
  if (flushQueued) return;
  flushQueued = true;
  queueMicrotask(() => {
    flushQueued = false;
    if (decoder && decoder.state === 'configured') decoder.flush().catch(() => {});
  });
}

function onVideoFrame(frame: VideoFrame, from: VideoDecoder): void {
  const i = frame.timestamp;
  if (from !== decoder || dead || !seq) {
    frame.close();
    return;
  }
  decoding.delete(i);
  markFetched(i);
  if (frameSlot.has(i) || !(keep.has(i) || pinned.has(i))) {
    frame.close();
    return;
  }
  decoded.get(i)?.close();
  decoded.set(i, frame);
  // A decoded video frame is already on the GPU: copy it into the pool now, which also hands the decoder
  // its output buffer back (hardware decoders stall when their frames are held).
  upload(i);
  requestDraw();
}

/** Chooses which frames stay on the GPU: current, target, then a window ahead in the scroll direction. */
function plan(): void {
  if (!seq) return;
  const n = seq.urls.length;
  const c = Math.round(vf);
  const t = Math.round(target);
  const free = maxSlots - pinned.size;
  const ahead = Math.ceil(free * AHEAD_SHARE);
  const behind = Math.max(MIN_BEHIND, free - ahead - 3);
  keep = new Set(pinned);
  want = [];
  const add = (i: number) => {
    if (i >= 0 && i < n && !keep.has(i) && keep.size < maxSlots) {
      keep.add(i);
      want.push(i);
    }
  };
  if (!parked) {
    add(c);
    add(t);
    add(t + dir);
    add(t - dir);
    for (let k = 1; k <= Math.max(ahead, behind); k++) {
      if (k <= ahead) add(c + dir * k);
      if (k <= behind) add(c - dir * k);
    }
  }
  for (const [i, bmp] of decoded) {
    if (!keep.has(i)) {
      bmp.close();
      decoded.delete(i);
    }
  }
  for (const i of [...pinned, ...want]) {
    if (decoding.size >= DECODE_CONCURRENCY) break;
    decode(i);
  }
}

function trim(): void {
  for (const s of slots) if (!pinned.has(s.frame)) {
    frameSlot.delete(s.frame);
    s.frame = -1;
  }
  for (const [i, bmp] of decoded) if (!pinned.has(i)) {
    bmp.close();
    decoded.delete(i);
  }
}

/** A free slot, or the one holding the frame farthest from the current position that is no longer wanted. */
function slotFor(): Slot | null {
  let best: Slot | null = null;
  let bestDist = -1;
  const c = Math.round(vf);
  for (const s of slots) {
    if (s.frame < 0) return s;
    if (keep.has(s.frame) || pinned.has(s.frame)) continue;
    const d = Math.abs(s.frame - c);
    if (d > bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

function upload(i: number): boolean {
  const bmp = decoded.get(i);
  if (!gl || !bmp || !seq) return false;
  const slot = slotFor();
  if (!slot) {
    // No room: never hold a decoder's frame waiting for one. It is decoded again if it is wanted later.
    if (isVideoFrame(bmp)) {
      bmp.close();
      decoded.delete(i);
    }
    return false;
  }
  const video = isVideoFrame(bmp);
  const w = video ? bmp.displayWidth : bmp.width;
  const h = video ? bmp.displayHeight : bmp.height;
  if (slot.frame >= 0) frameSlot.delete(slot.frame);
  gl.bindTexture(gl.TEXTURE_2D, slot.tex);
  if (w === seq.width && h === seq.height) {
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
    } catch {
      // A browser that decodes video frames but cannot upload them: carry on with the WebP frames.
      bmp.close();
      decoded.delete(i);
      slot.frame = -1;
      if (video && decoder) fallBackToImages(decoder);
      return false;
    }
  } else {
    // A frame of another size would not fit the immutable storage: skip it rather than distort it.
    bmp.close();
    decoded.delete(i);
    return false;
  }
  bmp.close();
  decoded.delete(i);
  slot.frame = i;
  frameSlot.set(i, slot);
  return true;
}

// ---------------------------------------------------------------- drawing

function requestDraw(): void {
  if (raf || dead) return;
  const rafFn = (self as unknown as { requestAnimationFrame?: (cb: FrameRequestCallback) => number }).requestAnimationFrame;
  if (rafFn) raf = rafFn.call(self, frame);
  else raf = self.setTimeout(() => frame(performance.now()), 0) as unknown as number;
}

function nearestUploaded(f: number): number {
  const n = seq ? seq.urls.length : 0;
  const c = Math.min(n - 1, Math.max(0, Math.round(f)));
  for (let d = 0; d < n; d++) {
    if (frameSlot.has(c - d)) return c - d;
    if (frameSlot.has(c + d)) return c + d;
  }
  return -1;
}

function frame(now: number): void {
  raf = 0;
  if (!gl || !seq || dead) return;
  plan();
  const n = seq.urls.length;
  let a = Math.max(0, Math.min(n - 1, Math.floor(vf)));
  let b = Math.min(n - 1, a + 1);
  let t = Math.max(0, Math.min(1, vf - a));
  // The frames this draw needs go up first; then a bounded number of the window's.
  if (!frameSlot.has(a)) upload(a);
  if (t > 0 && !frameSlot.has(b)) upload(b);
  let spare = SPARE_UPLOADS_PER_FRAME;
  for (const i of want) {
    if (spare <= 0) break;
    if (decoded.has(i) && !frameSlot.has(i) && upload(i)) spare--;
  }
  for (const i of pinned) if (decoded.has(i) && !frameSlot.has(i)) upload(i);

  if (!frameSlot.has(a)) {
    a = nearestUploaded(vf);
    b = a;
    t = 0;
  }
  if (a < 0) {
    if (decoded.size || decoding.size) requestDraw();
    return;
  }
  if (t > 0 && !frameSlot.has(b)) t = 0;
  draw(a, b, t);
  if (!ready) {
    ready = true;
    post({ type: 'ready' });
  }
  // Keep going while the window still has decoded frames waiting for the GPU.
  if (want.some((i) => decoded.has(i) && !frameSlot.has(i))) requestDraw();
  if (now - lastStats > STATS_EVERY_MS) {
    lastStats = now;
    post({ type: 'stats', live: frameSlot.size, slots: maxSlots, shown: a + t, wanted: vf, source });
  }
}

function coverRect(): [number, number, number, number] {
  const s = seq!;
  const scale = Math.max(width / s.width, height / s.height);
  const w = s.width * scale;
  const h = s.height * scale;
  const x = (width - w) * s.focal[0];
  const y = (height - h) * s.focal[1];
  return [x, y, w, h];
}

/**
 * Draws everything the ending needs into a single pixel, invisibly, right after the cut-outs arrive: the
 * driver uploads their textures and compiles the blur and shadow paths now instead of on the first frame of
 * the ending, which used to land as one long frame. The full draw that follows covers that pixel.
 */
function warmUp(a: number): void {
  if (!gl || warm || !lifts.length || !frameSlot.has(a)) return;
  warm = true;
  const saved = effect;
  effect = { dim: 0.5, blur: 4, lift: 0.5, liftOpacity: 1 };
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, 1, 1);
  const [x, y, w, h] = coverRect();
  drawFilm(a, a, 0, x, y, w, h);
  drawLifts(x, y, w, h);
  gl.disable(gl.SCISSOR_TEST);
  effect = saved;
}

function draw(a: number, b: number, t: number): void {
  if (!gl || !seq || !width || !height) return;
  warmUp(a);
  const [x, y, w, h] = coverRect();
  drawFilm(a, b, t, x, y, w, h);
  drawSign(a, t, x, y, w, h);
  drawLifts(x, y, w, h);
  gl.bindVertexArray(null);
}

function drawFilm(a: number, b: number, t: number, x: number, y: number, w: number, h: number): void {
  if (!gl) return;
  gl.viewport(0, 0, width, height);
  gl.disable(gl.BLEND);
  gl.useProgram(filmProg);
  // clip space: x right, y up; the rect's top edge (y) maps to +1 side
  const x0 = (x / width) * 2 - 1;
  const x1 = ((x + w) / width) * 2 - 1;
  const y0 = 1 - ((y + h) / height) * 2;
  const y1 = 1 - (y / height) * 2;
  gl.uniform4f(filmU.uRect, x0, y0, x1, y1);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, frameSlot.get(a)!.tex);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, frameSlot.get(t > 0 ? b : a)!.tex);
  gl.uniform1i(filmU.uA, 0);
  gl.uniform1i(filmU.uB, 1);
  gl.uniform1f(filmU.uT, t);
  gl.uniform1f(filmU.uDim, effect.dim);
  const blur = effect.blur * cssScale * BLUR_DISC;
  gl.uniform2f(filmU.uBlur, blur / w, blur / h);
  gl.bindVertexArray(quadVao);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

/** Uploads ending A's cut-outs once; they are drawn only while the ending shows them. */
function loadLifts(layers: RenderLiftLayer[]): void {
  const gen = ++liftGeneration;
  if (gl) for (const l of lifts) gl.deleteTexture(l.tex);
  lifts = [];
  void Promise.all(
    layers.map((layer) =>
      fetch(layer.url)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((b) => createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }))
        .then((bmp) => ({ layer, bmp }))
        .catch(() => null),
    ),
  ).then((loaded) => {
    if (gen !== liftGeneration || !gl || dead) {
      for (const l of loaded) l?.bmp.close();
      return;
    }
    for (const item of loaded) {
      if (!item) continue;
      const tex = gl.createTexture();
      if (!tex) continue;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, item.bmp);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      item.bmp.close();
      lifts.push({ ...item.layer, tex });
    }
    warm = false;
    requestDraw();
  });
}

/**
 * Ending A: each cut-out sits exactly on its own pixels of the last frame, then lifts towards the viewer
 * (translate in % of its own box, scale around 50% / 60%), over a soft shadow that deepens as it rises.
 */
function drawLifts(rx: number, ry: number, rw: number, rh: number): void {
  if (!gl || !lifts.length || !(effect.liftOpacity > 0)) return;
  const k = effect.lift;
  gl.useProgram(quadProg);
  gl.bindVertexArray(quadDynVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadDynBuf);
  gl.uniform2f(quadU.uSize, width, height);
  gl.uniform1i(quadU.uTex, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  for (const l of lifts) {
    const bw = l.w * rw;
    const bh = l.h * rh;
    const ox = rx + l.x * rw + bw * 0.5;
    const oy = ry + l.y * rh + bh * 0.6;
    const s = 1 + l.scale * k;
    const x0 = ox + l.tx * bw * k + s * (rx + l.x * rw - ox);
    const y0 = oy + l.ty * bh * k + s * (ry + l.y * rh - oy);
    const x1 = x0 + s * bw;
    const y1 = y0 + s * bh;
    gl.bindTexture(gl.TEXTURE_2D, l.tex);
    if (k > 0) {
      // Shadow: the blurred silhouette, offset down, grown by the blur so its edge is never clipped.
      const blur = LIFT_SHADOW_BLUR * cssScale * k;
      const pad = blur * BLUR_DISC;
      const dy = LIFT_SHADOW_Y * cssScale * k;
      const pu = pad / (x1 - x0);
      const pv = pad / (y1 - y0);
      setQuad(x0 - pad, y0 - pad + dy, x1 + pad, y1 + pad + dy, -pu, -pv, 1 + pu, 1 + pv);
      gl.uniform1f(quadU.uShadow, 1);
      gl.uniform1f(quadU.uAlpha, LIFT_SHADOW_ALPHA * k * effect.liftOpacity);
      gl.uniform2f(quadU.uBlur, (blur * BLUR_DISC) / (x1 - x0), (blur * BLUR_DISC) / (y1 - y0));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    setQuad(x0, y0, x1, y1, 0, 0, 1, 1);
    gl.uniform1f(quadU.uShadow, 0);
    gl.uniform1f(quadU.uAlpha, effect.liftOpacity);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  gl.disable(gl.BLEND);
}

function setQuad(x0: number, y0: number, x1: number, y1: number, u0: number, v0: number, u1: number, v1: number): void {
  if (!gl) return;
  quadVerts.set([x0, y0, u0, v0, x1, y0, u1, v0, x0, y1, u0, v1, x1, y1, u1, v1]);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, quadVerts);
}

function drawSign(a: number, t: number, rx: number, ry: number, rw: number, rh: number): void {
  if (!gl || !seq || !track || !signTex || !signReady) return;
  // During the prelude the camera rests on the film's first frame: the sign sits on frame 0's board.
  const fa = Math.max(0, a - seq.prelude);
  const ft = a < seq.prelude ? 0 : t;
  if (!cornersAt(track, fa, ft, corners)) return;
  const fade = fadeAt(track, fa, ft);
  if (!(fade > 0)) return;
  for (let k = 0; k < 8; k += 2) {
    screenQuad[k] = rx + corners[k] * rw;
    screenQuad[k + 1] = ry + corners[k + 1] * rh;
  }
  if (!isDrawableQuad(screenQuad)) return;
  const m = squareToQuad(screenQuad);
  if (!m || !m.every(Number.isFinite)) return;
  const [A, B, C, D, E, F, G, H] = m;
  if (!(1 + G > 0 && 1 + H > 0 && 1 + G + H > 0)) return;
  // Forward: [x y w]^T = M [u v 1]^T with M = [[A B C],[D E F],[G H 1]]; the shader needs M^-1.
  const inv = invert3(A, B, C, D, E, F, G, H, 1);
  if (!inv) return;
  const brightness = brightnessAt(track, fa, ft);
  const gain = Number.isNaN(brightness) ? 1 : SIGN_BRIGHTNESS_FLOOR + brightness * SIGN_BRIGHTNESS_GAIN;
  for (let k = 0; k < 8; k++) signVerts[k] = screenQuad[k];
  // TL, TR, BR, BL is a convex fan
  gl.useProgram(signProg);
  gl.bindVertexArray(signVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, signBuf);
  gl.bufferSubData(gl.ARRAY_BUFFER, 0, signVerts);
  gl.uniform2f(signU.uSize, width, height);
  // mat3 is column-major
  gl.uniformMatrix3fv(signU.uInv, false, [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]]);
  gl.uniform1f(signU.uFade, fade);
  gl.uniform1f(signU.uGain, gain);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, signTex);
  gl.uniform1i(signU.uSign, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
  gl.disable(gl.BLEND);
}

function invert3(
  a: number, b: number, c: number,
  d: number, e: number, f: number,
  g: number, h: number, i: number,
): number[] | null {
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

function uploadSign(bitmap: ImageBitmap): void {
  if (!gl) {
    bitmap.close();
    return;
  }
  if (!signTex) signTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, signTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  bitmap.close();
  signReady = true;
}

function destroy(): void {
  dead = true;
  closeDecoder();
  for (const b of decoded.values()) b.close();
  decoded.clear();
  if (gl) {
    for (const s of slots) gl.deleteTexture(s.tex);
    if (signTex) gl.deleteTexture(signTex);
    for (const l of lifts) gl.deleteTexture(l.tex);
  }
  slots = [];
  self.close();
}

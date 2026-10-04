import { facts, sign } from "@/content/site";

/**
 * Her sign's lettering as a bitmap, for the off-main-thread film renderer, which draws it in perspective
 * in the same GPU frame as the film. Same layout as `.living-sign` in hero.css (the DOM fallback) and as
 * tools/bake_sign_poster.py (the poster): three lines on the left, her monogram on the right.
 */

type Lang = "fr" | "en";

/** Texture width; the board is never shown wider than this, so the lettering is only ever scaled down. */
const TEXTURE_WIDTH = 2048;
const GOLD = "#e0ae4f";
const IVORY = "#f2efe8";
const GLOW = "rgba(224, 174, 79, 0.35)";
const FONT = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
const MARK_SRC = "/brand/logo-mark-alpha.png";
// Box model of .living-sign, as fractions of the board (cqw / cqh in the CSS).
const PAD_X = 0.04;
const PAD_Y = 0.07;
const COLUMN_GAP = 0.03;
const ROW_GAP = 0.04;
const MARK_HEIGHT = 0.62;
const GLOW_BLUR = 0.024;
const NAME_TRACKING = 0.02;
const NAME_GAP_EM = 0.6;
/** Arial's ascent/descent: with line-height 1 the baseline sits at 0.8465 em from the top of the line box. */
const ARIAL_ASCENT = 0.905;
const ARIAL_DESCENT = 0.212;
const BASELINE = ARIAL_ASCENT - (ARIAL_ASCENT + ARIAL_DESCENT - 1) / 2;

interface Line {
  readonly parts: readonly string[];
  size: number;
  readonly color: string;
  readonly glow: boolean;
  readonly tracking: number;
}

let mark: Promise<HTMLImageElement | null> | null = null;

function loadMark(): Promise<HTMLImageElement | null> {
  mark ??= new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.src = MARK_SRC;
    img
      .decode()
      .then(() => resolve(img))
      .catch(() => resolve(null));
  });
  return mark;
}

function lineWidth(ctx: CanvasRenderingContext2D, line: Line): number {
  setFont(ctx, line);
  const words = line.parts.reduce((w, part) => w + ctx.measureText(part).width, 0);
  return words + (line.parts.length - 1) * NAME_GAP_EM * line.size;
}

function setFont(ctx: CanvasRenderingContext2D, line: Line): void {
  ctx.font = `700 ${line.size}px ${FONT}`;
  // letterSpacing is recent (Chrome 99, Safari 17, Firefox 115); without it the name is 2% tighter.
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${line.tracking * line.size}px`;
}

export async function paintSign(lang: Lang, aspect: number): Promise<ImageBitmap | null> {
  const w = TEXTURE_WIDTH;
  const h = Math.round(w / aspect);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = await loadMark();

  const markH = MARK_HEIGHT * h;
  const markW = img ? (markH * img.naturalWidth) / img.naturalHeight : 0;
  const textW = w - 2 * PAD_X * w - (img ? markW + COLUMN_GAP * w : 0);
  // Each line is sized by whichever is tighter, the board's height or its width (min(cqh, cqw) in the CSS).
  const lines: Line[] = [
    { parts: ["NANABi", "AFROMARKET"], size: Math.min(0.3 * h, 0.056 * w), color: GOLD, glow: true, tracking: NAME_TRACKING },
    { parts: [sign.aisles[lang].join(" - ")], size: Math.min(0.13 * h, 0.0235 * w), color: GOLD, glow: true, tracking: 0 },
    {
      parts: [`Tél : ${facts.phoneDisplay} - Email : ${facts.email}`],
      size: Math.min(0.095 * h, 0.022 * w),
      color: IVORY,
      glow: false,
      tracking: 0,
    },
  ];
  // A longer translation must still fit its column: shrink that line rather than let it run off the board.
  for (const line of lines) {
    const width = lineWidth(ctx, line);
    if (width > textW) line.size *= textW / width;
  }

  const rowGap = ROW_GAP * h;
  const total = lines.reduce((sum, l) => sum + l.size, 0) + rowGap * (lines.length - 1);
  let y = (h - total) / 2;
  ctx.textBaseline = "alphabetic";
  for (const line of lines) {
    setFont(ctx, line);
    ctx.fillStyle = line.color;
    ctx.shadowColor = line.glow ? GLOW : "transparent";
    ctx.shadowBlur = line.glow ? GLOW_BLUR * h : 0;
    let x = PAD_X * w;
    const baseline = y + BASELINE * line.size;
    for (const part of line.parts) {
      ctx.fillText(part, x, baseline);
      x += ctx.measureText(part).width + NAME_GAP_EM * line.size;
    }
    y += line.size + rowGap;
  }
  ctx.shadowColor = "transparent";
  if (img) ctx.drawImage(img, w - PAD_X * w - markW, (h - markH) / 2, markW, markH);
  // Straight alpha: the render worker premultiplies in its shader (upload-path premultiplication varies).
  return createImageBitmap(canvas, { premultiplyAlpha: "none" });
}

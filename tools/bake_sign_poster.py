"""Bakes the living sign into frame-0 posters (LCP image, static mode, social card).

The film ships a blank sign board; the page lays HTML lettering into it. The poster paints before the
film engine starts and is all reduced-motion visitors ever see, so it must carry the same lettering.
Usage: python tools/bake_sign_poster.py public/film/v1/16x9-a [more film dirs...]
"""
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

FONT_BOLD = r"C:\Windows\Fonts\arialbd.ttf"
GOLD = (224, 174, 79, 255)
WHITE = (242, 239, 232, 255)
MARK = Path("public/brand/logo-mark.png")
SIGN_W = 2400  # texture width; height follows the tracked board aspect

NAME = "NANABi    AFROMARKET"
AISLES = "Produits Afro - Habillement - Coiffure - Cosmétique"
CONTACT = "Tél : 07 84 60 89 09 - Email : nanabi.afromarket@gmail.com"


def fit_font(draw: ImageDraw.ImageDraw, text: str, size: int, max_w: float) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(FONT_BOLD, size)
    while draw.textlength(text, font=font) > max_w and size > 8:
        size -= 2
        font = ImageFont.truetype(FONT_BOLD, size)
    return font


def render_sign(aspect: float) -> Image.Image:
    """Same layout as .living-sign in hero.css: three lines left, her monogram right."""
    w, h = SIGN_W, int(SIGN_W / aspect)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad_x, pad_y = int(w * 0.04), int(h * 0.07)
    mark_h = int(h * 0.62)
    mark = Image.open(MARK).convert("RGBA").resize((mark_h, mark_h), Image.LANCZOS)
    text_w = w - 2 * pad_x - mark_h - int(w * 0.03)
    f1 = fit_font(d, NAME, int(h * 0.30), text_w)
    f2 = fit_font(d, AISLES, int(h * 0.13), text_w)
    f3 = fit_font(d, CONTACT, int(h * 0.095), text_w)
    lines = [(NAME, f1, GOLD), (AISLES, f2, GOLD), (CONTACT, f3, WHITE)]
    gap = int(h * 0.04)
    total = sum(f.getbbox(t)[3] for t, f, _ in lines) + gap * 2
    y = (h - total) // 2
    for text, font, color in lines:
        d.text((pad_x, y), text, font=font, fill=color)
        y += font.getbbox(text)[3] + gap
    # Her monogram sits on black; screen-blend by using its luminance as alpha.
    m = np.asarray(mark).astype(np.float32)
    m[..., 3] = m[..., :3].max(axis=2)
    img.alpha_composite(Image.fromarray(m.astype(np.uint8)), (w - pad_x - mark_h, (h - mark_h) // 2))
    return img


def bake(film_dir: Path) -> None:
    track = json.loads((film_dir / "sign.json").read_text(encoding="utf-8"))
    f0 = track["frames"]["0"]
    quad = np.float32(f0["q"])
    brightness = 0.55 + float(f0.get("b", 0.8)) * 0.6
    sign = render_sign(float(track.get("aspect", 4.0)))
    poster = Image.open(film_dir / "poster.jpg").convert("RGB")
    pw, ph = poster.size
    # The track is in film pixels of the hi tier; the poster is the same size.
    sw, sh = sign.size
    src = np.float32([[0, 0], [sw, 0], [sw, sh], [0, sh]])
    hom = cv2.getPerspectiveTransform(src, quad * np.float32([pw / track["width"], ph / track["height"]]))
    rgba = np.asarray(sign).astype(np.float32)
    rgba[..., :3] *= min(brightness, 1.0)
    warped = cv2.warpPerspective(rgba, hom, (pw, ph), flags=cv2.INTER_AREA)
    glow = cv2.GaussianBlur(warped, (0, 0), 6) * np.float32([1, 1, 1, 0.35])
    base = np.asarray(poster).astype(np.float32)
    for layer in (glow, warped):
        a = layer[..., 3:4] / 255
        base = base * (1 - a) + layer[..., :3] * a
    out = Image.fromarray(base.clip(0, 255).astype(np.uint8))
    out.save(film_dir / "poster.jpg", quality=86, optimize=True, progressive=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(film_dir / "poster.jpg"), "-c:v", "libaom-av1",
                    "-still-picture", "1", "-crf", "28", str(film_dir / "poster.avif")], check=True)
    print(f"baked sign into {film_dir}/poster.jpg + .avif")


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        bake(Path(arg))

"""Builds AVIF + WebP variants at several widths for every section image, plus a manifest the
<Picture> component reads. Usage: python tools/optimize_images.py
"""
import json
import subprocess
from pathlib import Path

from PIL import Image

ROOT = Path("public/img")
WIDTHS = (640, 1024, 1600, 2200)
WEBP_Q = 74
AVIF_CRF = 34
MANIFEST = Path("src/components/picture-manifest.json")


def main() -> None:
    manifest: dict[str, dict] = {}
    for src in sorted(ROOT.glob("*.jpg")):
        im = Image.open(src).convert("RGB")
        w0, h0 = im.size
        widths = [w for w in WIDTHS if w < w0] + [w0]
        stem = src.with_suffix("")
        for w in widths:
            h = round(h0 * w / w0)
            resized = im.resize((w, h), Image.LANCZOS) if w != w0 else im
            resized.save(f"{stem}-{w}.webp", quality=WEBP_Q, method=6)
            png = Path(f"{stem}-{w}.tmp.png")
            resized.save(png)
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(png), "-c:v", "libaom-av1", "-still-picture", "1",
                            "-crf", str(AVIF_CRF), "-cpu-used", "4", f"{stem}-{w}.avif"], check=True)
            png.unlink()
        manifest["/img/" + src.name] = {"w": w0, "h": h0, "widths": widths}
        print(src.name, widths)
    MANIFEST.write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()

"""Build the scroll-film assets for one aspect from a master video.

Outputs, under <out>/<aspect>/:
  <tier>/0000.webp ... <tier>/NNNN.webp   frame sets (0-based, zero-padded to 4)
  poster.avif, poster.jpg                 frame 0 at the largest tier size (LCP image)
  lqip.txt                                tiny WebP data URI for the stage background
  film.mp4                                linear H.264 film for static mode
  manifest.json                           sizes, frame count and byte totals

Usage:
  python tools/build_film.py masters/film-16x9.mov --aspect 16x9 --out public/film/v1 --deflicker --denoise
  python tools/build_film.py masters/9x16-segments/ --aspect 9x16 --out public/film/v1 --tiers hi,lite
A directory input is concatenated in file-name order (all segments must share codec and size).
"""

from __future__ import annotations

import argparse
import base64
import json
import subprocess
import sys
import tempfile
from fractions import Fraction
from pathlib import Path

# (width, height, WebP quality) per tier
TIERS: dict[str, dict[str, tuple[int, int, int]]] = {
    "16x9": {"hi": (1920, 1080, 54), "lite": (1280, 720, 50)},
    "9x16": {"hi": (900, 1600, 54), "lite": (720, 1280, 50)},
}
# (width, height, CRF) of the linear film
VIDEO: dict[str, tuple[int, int, int]] = {"16x9": (1920, 1080, 23), "9x16": (1080, 1920, 24)}
LQIP_WIDTH = {"16x9": 32, "9x16": 24}
LQIP_QUALITY = 40
POSTER_AVIF_CRF = 26
POSTER_JPEG_QSCALE = 3
VIDEO_GOP = 48
VIDEO_MAX_FPS = 30  # H.264 level 4.1 at 1080p tops out at 30 fps
SEGMENT_EXTENSIONS = {".mp4", ".mov", ".mkv", ".webm"}

DEFLICKER = "deflicker=size=5:mode=pm"
DENOISE = "hqdn3d=1.5:1.5:6:6"
PAD_BACKDROP_BLUR = "boxblur=24:2"
PAD_BACKDROP_DIM = "eq=brightness=-0.12"
# Pads the tail with copies of the last frame so the resampler always reaches N frames.
TAIL_PAD = "tpad=stop_mode=clone:stop_duration=2"


def run(cmd: list[str]) -> None:
    subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-y", *cmd], check=True)


def probe(path: Path, entries: str) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", entries, "-of", "json", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)


def duration_of(path: Path) -> float:
    info = probe(path, "format=duration:stream=duration")
    value = info.get("format", {}).get("duration") or info["streams"][0].get("duration")
    return float(value)


def fps_of(path: Path) -> float:
    rate = probe(path, "stream=r_frame_rate")["streams"][0]["r_frame_rate"]
    return float(Fraction(rate))


def fit_graph(fit: str, width: int, height: int, src: str, dst: str) -> str:
    """Filtergraph fitting `src` into width x height: `cover` crops the centre, `pad` letterboxes over a blurred copy."""
    if fit == "cover":
        return (
            f"[{src}]scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos,"
            f"crop={width}:{height},setsar=1[{dst}]"
        )
    return (
        f"[{src}]split[bg_in][fg_in];"
        f"[bg_in]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
        f"{PAD_BACKDROP_BLUR},{PAD_BACKDROP_DIM}[bg];"
        f"[fg_in]scale={width}:{height}:force_original_aspect_ratio=decrease:flags=lanczos[fg];"
        f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[{dst}]"
    )


def prepare_master(source: Path, work: Path) -> Path:
    if source.is_file():
        return source
    segments = sorted(p for p in source.iterdir() if p.suffix.lower() in SEGMENT_EXTENSIONS)
    if not segments:
        sys.exit(f"no video segments in {source}")
    listing = work / "segments.txt"
    listing.write_text("".join(f"file '{p.resolve().as_posix()}'\n" for p in segments), encoding="utf-8")
    master = work / "master.mkv"
    run(["-f", "concat", "-safe", "0", "-i", str(listing), "-map", "0:v:0", "-an", "-c:v", "ffv1", str(master)])
    print(f"concatenated {len(segments)} segments")
    return master


def clean_chain(args: argparse.Namespace) -> list[str]:
    return [f for f, on in ((DEFLICKER, args.deflicker), (DENOISE, args.denoise)) if on]


def resample(master: Path, work: Path, args: argparse.Namespace, size: tuple[int, int]) -> Path:
    """Exactly `args.frames` cleaned, fitted frames at the largest tier size, stored losslessly."""
    duration = duration_of(master)
    rate = args.frames / duration
    pre = ",".join([*clean_chain(args), TAIL_PAD, f"fps={rate:.6f}"])
    graph = f"[0:v]{pre}[r];" + fit_graph(args.fit, *size, "r", "v")
    frames = work / "frames.mkv"
    run(["-i", str(master), "-filter_complex", graph, "-map", "[v]", "-frames:v", str(args.frames),
         "-c:v", "ffv1", str(frames)])
    print(f"resampled {duration:.2f}s to {args.frames} frames ({rate:.3f} fps)")
    return frames


def encode_tier(frames: Path, outdir: Path, width: int, height: int, quality: int, expected: int) -> int:
    outdir.mkdir(parents=True, exist_ok=True)
    for stale in outdir.glob("*.webp"):
        stale.unlink()
    run(["-i", str(frames), "-vf", f"scale={width}:{height}:flags=lanczos,setsar=1",
         "-c:v", "libwebp", "-quality", str(quality), "-compression_level", "6", "-preset", "photo",
         "-start_number", "0", str(outdir / "%04d.webp")])
    files = sorted(outdir.glob("*.webp"))
    if len(files) != expected:
        sys.exit(f"{outdir}: expected {expected} frames, got {len(files)}")
    return sum(f.stat().st_size for f in files)


def encode_stills(frames: Path, outdir: Path, aspect: str) -> str:
    avif, jpg, lqip = outdir / "poster.avif", outdir / "poster.jpg", outdir / "lqip.webp"
    run(["-i", str(frames), "-frames:v", "1", "-c:v", "libaom-av1", "-still-picture", "1",
         "-crf", str(POSTER_AVIF_CRF), "-cpu-used", "4", "-pix_fmt", "yuv420p", str(avif)])
    run(["-i", str(frames), "-frames:v", "1", "-q:v", str(POSTER_JPEG_QSCALE), "-update", "1", str(jpg)])
    run(["-i", str(jpg), "-vf", f"scale={LQIP_WIDTH[aspect]}:-1:flags=area",
         "-c:v", "libwebp", "-quality", str(LQIP_QUALITY), str(lqip)])
    uri = "data:image/webp;base64," + base64.b64encode(lqip.read_bytes()).decode("ascii")
    lqip.unlink()
    (outdir / "lqip.txt").write_text(uri, encoding="ascii")
    return uri


def encode_video(master: Path, outdir: Path, args: argparse.Namespace, size: tuple[int, int], crf: int) -> Path:
    pre = clean_chain(args)
    if fps_of(master) > VIDEO_MAX_FPS:
        pre.append(f"fps={VIDEO_MAX_FPS}")
    head = f"[0:v]{','.join(pre)}[c];" if pre else ""
    graph = head + fit_graph(args.fit, *size, "c" if pre else "0:v", "f") + ";[f]format=yuv420p[v]"
    out = outdir / "film.mp4"
    run(["-i", str(master), "-filter_complex", graph, "-map", "[v]", "-an",
         "-c:v", "libx264", "-profile:v", "high", "-level", "4.1", "-crf", str(crf), "-preset", "slow",
         "-tune", "film", "-g", str(VIDEO_GOP), "-movflags", "+faststart", str(out)])
    return out


def parse_size(value: str) -> tuple[int, int]:
    w, h = value.lower().split("x")
    return int(w), int(h)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path, help="master video, or a folder of segments concatenated by name")
    ap.add_argument("--aspect", choices=sorted(TIERS), required=True)
    ap.add_argument("--out", type=Path, required=True, help="film root, e.g. public/film/v1")
    ap.add_argument("--name", help="output folder name under --out (default: the aspect), e.g. 16x9-a")
    ap.add_argument("--frames", type=int, default=240)
    ap.add_argument("--tiers", default="hi,lite", help="comma list of: hi, lite")
    ap.add_argument("--fit", choices=("cover", "pad"), default="cover",
                    help="how a master of another aspect is fitted (pad = letterbox over a blurred copy)")
    ap.add_argument("--deflicker", action="store_true")
    ap.add_argument("--denoise", action="store_true")
    ap.add_argument("--video-size", type=parse_size, help="linear film WxH (default 1920x1080 / 1080x1920)")
    ap.add_argument("--video-crf", type=int, help="linear film CRF (default 23 for 16x9, 24 for 9x16)")
    ap.add_argument("--no-video", action="store_true", help="skip the linear MP4")
    args = ap.parse_args()

    tiers = [t.strip() for t in args.tiers.split(",") if t.strip()]
    unknown = set(tiers) - set(TIERS[args.aspect])
    if unknown or not tiers:
        sys.exit(f"unknown tiers: {', '.join(sorted(unknown)) or '(none given)'}")
    if not args.input.exists():
        sys.exit(f"not found: {args.input}")

    outdir = args.out / (args.name or args.aspect)
    outdir.mkdir(parents=True, exist_ok=True)
    largest = max((TIERS[args.aspect][t] for t in tiers), key=lambda s: s[0] * s[1])
    poster_size = (largest[0], largest[1])
    manifest: dict = {"aspect": args.aspect, "frameCount": args.frames, "tiers": {}}

    with tempfile.TemporaryDirectory(prefix="film-") as tmp:
        work = Path(tmp)
        master = prepare_master(args.input, work)
        frames = resample(master, work, args, poster_size)
        for tier in tiers:
            w, h, q = TIERS[args.aspect][tier]
            total = encode_tier(frames, outdir / tier, w, h, q, args.frames)
            manifest["tiers"][tier] = {"width": w, "height": h, "quality": q, "bytes": total}
            print(f"{args.aspect}/{tier}: {args.frames} frames {w}x{h} q{q}, {total / 1e6:.1f} MB")
        manifest["lqip"] = encode_stills(frames, outdir, args.aspect)
        manifest["poster"] = {"width": poster_size[0], "height": poster_size[1],
                              "avifBytes": (outdir / "poster.avif").stat().st_size,
                              "jpgBytes": (outdir / "poster.jpg").stat().st_size}
        if not args.no_video:
            vw, vh, crf = VIDEO[args.aspect]
            size = args.video_size or (vw, vh)
            video = encode_video(master, outdir, args, size, args.video_crf or crf)
            manifest["video"] = {"width": size[0], "height": size[1], "bytes": video.stat().st_size}
            print(f"{args.aspect}/film.mp4: {size[0]}x{size[1]}, {video.stat().st_size / 1e6:.1f} MB")

    (outdir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {outdir}")


if __name__ == "__main__":
    main()

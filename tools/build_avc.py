"""Hardware-decodable frame set for the film: every frame an independent H.264 keyframe, one file per frame.

The scroll film used to decode WebP on the CPU, about 65 full-HD frames a second during a fast scroll; on a
laptop chip that pushed the page's own thread onto slow cores and the scroll stuttered. WebCodecs decodes these
on the GPU's video engine instead, and the decoded frame is already a GPU texture: no CPU decode, no upload.

Frames are resampled exactly like tools/build_film.py (same fps filter and fit), so frame N here is frame N of
the WebP tiers and every sign track and time map stays valid.

Outputs, under <out>/<name>/avc-<tier>/:
  0000.h264 ... NNNN.h264   Annex B access units, each self-contained (SPS + PPS + IDR)
  codec.json                { codec, width, height, frames, bytes }

Usage:
  python tools/build_avc.py .research/film/masters/film-16x9-a.mp4 --aspect 16x9 --name 16x9-a --out public/film/v2
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from build_film import TIERS, prepare_master, resample, run  # noqa: E402

# x264 CRF per tier: all-intra needs a little more bitrate than WebP for the same look on this footage.
CRF = {"hi": 22, "lite": 22}
# avc1.PPCCLL: High profile (0x64), no constraints, level 4.0 (1080p at the frame rates a scrub ever needs).
CODEC = "avc1.640028"
AUD = b"\x00\x00\x00\x01\x09"


def split_access_units(stream: bytes) -> list[bytes]:
    """x264 runs with aud=1, so every access unit starts with an access-unit delimiter NAL."""
    starts = []
    i = stream.find(AUD)
    while i != -1:
        starts.append(i)
        i = stream.find(AUD, i + len(AUD))
    return [stream[a:b] for a, b in zip(starts, starts[1:] + [len(stream)])]


def encode(frames: Path, outdir: Path, width: int, height: int, crf: int, expected: int, work: Path) -> int:
    outdir.mkdir(parents=True, exist_ok=True)
    for stale in outdir.glob("*.h264"):
        stale.unlink()
    raw = work / f"{outdir.name}.h264"
    run(["-i", str(frames), "-vf", f"scale={width}:{height}:flags=lanczos,setsar=1,format=yuv420p",
         "-c:v", "libx264", "-profile:v", "high", "-level", "4.0", "-preset", "slow", "-tune", "film",
         "-crf", str(crf), "-bf", "0",
         # Tagged BT.601 limited range, like WebP's own YUV: decoders then convert both to identical RGB,
         # so the film looks the same on either path and the finale's WebP cut-outs match it pixel for pixel.
         "-x264-params", "keyint=1:min-keyint=1:scenecut=0:repeat-headers=1:aud=1:"
                         "colorprim=smpte170m:transfer=smpte170m:colormatrix=smpte170m:fullrange=off",
         "-colorspace", "smpte170m", "-color_primaries", "smpte170m", "-color_trc", "smpte170m", "-color_range", "tv",
         "-f", "h264", str(raw)])
    units = split_access_units(raw.read_bytes())
    if len(units) != expected:
        sys.exit(f"{outdir}: expected {expected} access units, got {len(units)}")
    total = 0
    for i, unit in enumerate(units):
        (outdir / f"{i:04d}.h264").write_bytes(unit)
        total += len(unit)
    return total


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", type=Path)
    ap.add_argument("--aspect", choices=sorted(TIERS), required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--frames", type=int, default=240)
    ap.add_argument("--tiers", default="hi,lite")
    ap.add_argument("--fit", choices=("cover", "pad"), default="cover")
    args = ap.parse_args()
    args.deflicker = args.denoise = False  # same clean chain as the WebP build (none)

    tiers = [t.strip() for t in args.tiers.split(",") if t.strip()]
    outdir = args.out / args.name
    largest = max((TIERS[args.aspect][t] for t in tiers), key=lambda s: s[0] * s[1])
    with tempfile.TemporaryDirectory(prefix="avc-") as tmp:
        work = Path(tmp)
        master = prepare_master(args.input, work)
        frames = resample(master, work, args, (largest[0], largest[1]))
        for tier in tiers:
            w, h, _ = TIERS[args.aspect][tier]
            total = encode(frames, outdir / f"avc-{tier}", w, h, CRF[tier], args.frames, work)
            meta = {"codec": CODEC, "width": w, "height": h, "frames": args.frames, "bytes": total}
            (outdir / f"avc-{tier}" / "codec.json").write_text(json.dumps(meta) + "\n", encoding="utf-8")
            print(f"{args.name}/avc-{tier}: {args.frames} frames {w}x{h} crf{CRF[tier]}, {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()

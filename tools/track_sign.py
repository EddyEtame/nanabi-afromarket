"""Planar-track a quad (the shop sign) across a shipped frame sequence for the living-sign overlay.

The quad is annotated once on a reference frame and carried frame to frame by a homography of the
façade plane (SIFT keypoints, or dense optical flow for smooth repainted walls; RANSAC either way).
Tracking runs forwards and backwards from the reference and stops where the sign is lost or
leaves the frame; frames outside that visible range are omitted from the output.

Output JSON (pixel coordinates of the tracked frames; the player normalises by width/height, so a track
computed on the hi tier also serves the lite tier):
  { "width": W, "height": H, "aspect": 4.2?, "frames": { "<index>": { "q": [[x,y] x4 TL,TR,BR,BL], "b": 0..1 } } }

Usage (run it on the exact frames you ship, after resampling and cropping):
  python tools/track_sign.py --frames public/film/v2/16x9-a/hi --ref 0 --method flow --grow 150 \
      --quad "[[585,134],[1355,174],[1354,337],[585,302]]" --range 0 60 --aspect 4.4 \
      --out public/film/v2/16x9-a/sign.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy.signal import savgol_filter

FRAME_EXTENSIONS = {".webp", ".png", ".jpg", ".jpeg"}
SIFT_FEATURES = 4000
RATIO_TEST = 0.75
RANSAC_REPROJ_PX = 3.0
SMOOTH_ORDER = 2
# A frame-to-frame area change beyond this factor means RANSAC locked onto the wrong plane.
MAX_AREA_JUMP = 1.6
COORD_DECIMALS = 2
BRIGHTNESS_DECIMALS = 3


class FrameSequence:
    def __init__(self, folder: Path):
        self.paths = sorted(p for p in folder.iterdir() if p.suffix.lower() in FRAME_EXTENSIONS)
        if not self.paths:
            sys.exit(f"no frames in {folder}")
        first = self.read(0)
        self.height, self.width = first.shape[:2]

    def __len__(self) -> int:
        return len(self.paths)

    def read(self, i: int) -> np.ndarray:
        img = cv2.imread(str(self.paths[i]), cv2.IMREAD_GRAYSCALE)
        if img is None:
            sys.exit(f"cannot read {self.paths[i]}")
        return img


def quad_mask(shape: tuple[int, int], quad: np.ndarray, grow: int) -> np.ndarray:
    mask = np.zeros(shape, np.uint8)
    cv2.fillConvexPoly(mask, np.round(quad).astype(np.int32), 255)
    if grow > 1:
        mask = cv2.dilate(mask, np.ones((grow, grow), np.uint8))
    return mask


def quad_area(quad: np.ndarray) -> float:
    return abs(float(cv2.contourArea(quad.astype(np.float32))))


def is_convex(quad: np.ndarray) -> bool:
    signs = []
    for k in range(4):
        (ux, uy), (vx, vy) = quad[(k + 1) % 4] - quad[k], quad[(k + 2) % 4] - quad[(k + 1) % 4]
        signs.append(ux * vy - uy * vx > 0)
    return all(signs) or not any(signs)


def overlaps_frame(quad: np.ndarray, width: int, height: int) -> bool:
    xs, ys = quad[:, 0], quad[:, 1]
    return xs.max() > 0 and ys.max() > 0 and xs.min() < width and ys.min() < height


def track(seq: FrameSequence, ref: int, ref_quad: np.ndarray, lo: int, hi: int, grow: int,
          min_matches: int) -> dict[int, np.ndarray]:
    """Chains frame-to-frame homographies of the facade plane around the quad.

    Matching every frame back to the reference fails on a long push-in (scale, perspective and the
    generator's subtle warping all accumulate), so each frame is matched to its neighbour instead
    and the quad is carried forward; smoothing afterwards removes the small accumulated jitter.
    """
    sift = cv2.SIFT_create(SIFT_FEATURES)
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    shape = (seq.height, seq.width)
    kp0, d0 = sift.detectAndCompute(seq.read(ref), quad_mask(shape, ref_quad, grow))
    if d0 is None or len(kp0) < min_matches:
        sys.exit(f"only {0 if d0 is None else len(kp0)} features around the reference quad; widen --grow")
    quads = {ref: ref_quad}
    for step in (1, -1):
        prev, j = ref_quad, ref + step
        kp_prev, d_prev = kp0, d0
        while lo <= j <= hi:
            mask = quad_mask(shape, prev, grow)
            kp1, d1 = sift.detectAndCompute(seq.read(j), mask)
            if d1 is None or len(kp1) < min_matches:
                break
            good = [m for m, n in (p for p in matcher.knnMatch(d_prev, d1, k=2) if len(p) == 2)
                    if m.distance < RATIO_TEST * n.distance]
            if len(good) < min_matches:
                break
            src = np.float32([kp_prev[g.queryIdx].pt for g in good])
            dst = np.float32([kp1[g.trainIdx].pt for g in good])
            hom, _ = cv2.findHomography(src, dst, cv2.RANSAC, RANSAC_REPROJ_PX)
            if hom is None:
                break
            quad = cv2.perspectiveTransform(prev.reshape(-1, 1, 2).astype(np.float32), hom).reshape(4, 2)
            ratio = quad_area(quad) / max(quad_area(prev), 1.0)
            if not is_convex(quad) or not 1 / MAX_AREA_JUMP < ratio < MAX_AREA_JUMP:
                break
            if not overlaps_frame(quad, seq.width, seq.height):
                break
            quads[j], prev, j = quad, quad, j + step
            # Re-seed from this frame so the next match compares neighbours.
            kp_prev, d_prev = sift.detectAndCompute(seq.read(j - step), quad_mask(shape, quad, grow))
            if d_prev is None:
                break
    return quads


FLOW_GRID_PX = 6  # sampling step of the dense flow field
FLOW_EDGE_PERCENTILE = 55  # keep only the better-textured half of the samples


def track_flow(seq: FrameSequence, ref: int, ref_quad: np.ndarray, lo: int, hi: int, grow: int,
               min_matches: int) -> dict[int, np.ndarray]:
    """Same chaining as track(), but each step fits the homography to a dense optical-flow field.

    A freshly repainted, even facade has too few corners for SIFT (a few dozen), and the homography
    then swings on noise. Dense flow uses every edge pixel around the board instead of a handful
    of keypoints, so the plane stays locked on smooth walls.
    """
    clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    shape = (seq.height, seq.width)
    gy, gx = np.mgrid[0:seq.height:FLOW_GRID_PX, 0:seq.width:FLOW_GRID_PX]
    quads = {ref: ref_quad}
    for step in (1, -1):
        prev, j = ref_quad, ref + step
        img_prev = clahe.apply(seq.read(ref))
        while lo <= j <= hi:
            img = clahe.apply(seq.read(j))
            flow = dis.calc(img_prev, img, None)
            mask = quad_mask(shape, prev, grow)[gy, gx] > 0
            grad = cv2.magnitude(cv2.Sobel(img_prev, cv2.CV_32F, 1, 0), cv2.Sobel(img_prev, cv2.CV_32F, 0, 1))[gy, gx]
            if mask.sum() < min_matches:
                break
            keep = mask & (grad >= np.percentile(grad[mask], FLOW_EDGE_PERCENTILE))
            src = np.stack([gx[keep], gy[keep]], axis=1).astype(np.float32)
            dst = src + flow[gy[keep], gx[keep]]
            if len(src) < min_matches:
                break
            hom, inliers = cv2.findHomography(src, dst, cv2.RANSAC, RANSAC_REPROJ_PX)
            if hom is None or inliers.sum() < min_matches:
                break
            quad = cv2.perspectiveTransform(prev.reshape(-1, 1, 2).astype(np.float32), hom).reshape(4, 2)
            ratio = quad_area(quad) / max(quad_area(prev), 1.0)
            if not is_convex(quad) or not 1 / MAX_AREA_JUMP < ratio < MAX_AREA_JUMP:
                break
            if not overlaps_frame(quad, seq.width, seq.height):
                break
            quads[j], prev, img_prev, j = quad, quad, img, j + step
    return quads


def smooth(quads: dict[int, np.ndarray], window: int) -> dict[int, np.ndarray]:
    """Savitzky-Golay over the contiguous run; tracker jitter reads as fake immediately."""
    idx = sorted(quads)
    win = min(window | 1, len(idx) if len(idx) % 2 else len(idx) - 1)
    if win <= SMOOTH_ORDER:
        return quads
    arr = savgol_filter(np.array([quads[i] for i in idx]).reshape(len(idx), 8), win, SMOOTH_ORDER, axis=0)
    return {i: arr[n].reshape(4, 2) for n, i in enumerate(idx)}


def brightness(seq: FrameSequence, i: int, quad: np.ndarray) -> float:
    img = seq.read(i)
    mask = quad_mask(img.shape, quad, 0)
    if not mask.any():
        return 0.0
    return cv2.mean(img, mask)[0] / 255


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--frames", type=Path, required=True, help="folder of shipped frames (0000.webp ...)")
    ap.add_argument("--ref", type=int, required=True, help="index of the annotated reference frame")
    ap.add_argument("--quad", required=True, help="JSON [[x,y] x4] TL,TR,BR,BL in pixels of the reference frame")
    ap.add_argument("--range", type=int, nargs=2, metavar=("FROM", "TO"), help="frame range to track (inclusive)")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--aspect", type=float, help="physical sign width/height, written to the JSON")
    ap.add_argument("--grow", type=int, default=61, help="mask dilation (px) around the quad")
    ap.add_argument("--min-matches", type=int, default=12)
    ap.add_argument("--smooth", type=int, default=9, help="Savitzky-Golay window (odd)")
    ap.add_argument("--method", choices=("sift", "flow"), default="sift",
                    help="sift: keypoints (textured facades); flow: dense optical flow (smooth, repainted walls)")
    args = ap.parse_args()

    seq = FrameSequence(args.frames)
    lo, hi = args.range if args.range else (0, len(seq) - 1)
    lo, hi = max(0, lo), min(len(seq) - 1, hi)
    if not lo <= args.ref <= hi:
        sys.exit(f"--ref {args.ref} is outside the range {lo}..{hi}")
    ref_quad = np.float32(json.loads(args.quad))
    if ref_quad.shape != (4, 2):
        sys.exit("--quad needs four [x, y] corners")

    tracker = track_flow if args.method == "flow" else track
    quads = smooth(tracker(seq, args.ref, ref_quad, lo, hi, args.grow, args.min_matches), args.smooth)
    frames = {
        str(i): {
            "q": [[round(float(x), COORD_DECIMALS), round(float(y), COORD_DECIMALS)] for x, y in quads[i]],
            "b": round(brightness(seq, i, quads[i]), BRIGHTNESS_DECIMALS),
        }
        for i in sorted(quads)
    }
    out = {"width": seq.width, "height": seq.height, "frames": frames}
    if args.aspect:
        out["aspect"] = args.aspect
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    idx = sorted(quads)
    print(f"tracked {idx[0]}..{idx[-1]} ({len(idx)} of {hi - lo + 1} frames) -> {args.out}")


if __name__ == "__main__":
    main()

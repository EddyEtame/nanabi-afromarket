"""Collects the per-film manifests written by build_film.py into the one the hero imports.

Usage: python tools/film_manifest.py public/film/v1 src/components/hero/film-manifest.json
"""
import json
import sys
from pathlib import Path

# Centre focal: the ending-A cut-out plates assume the canvas crops around the frame centre.
FOCAL = [0.5, 0.5]


def main() -> None:
    root, dst = Path(sys.argv[1]), Path(sys.argv[2])
    films = {}
    for manifest in sorted(root.glob("*/manifest.json")):
        m = json.loads(manifest.read_text(encoding="utf-8"))
        films[manifest.parent.name] = {
            "frameCount": m["frameCount"],
            "tiers": {k: {"width": v["width"], "height": v["height"]} for k, v in m["tiers"].items()},
            "focal": FOCAL,
            "lqip": m.get("lqip", ""),
        }
    missing = {"16x9-a", "16x9-b", "9x16-a", "9x16-b"} - films.keys()
    if missing:
        sys.exit(f"missing films: {', '.join(sorted(missing))}")
    dst.write_text(json.dumps({"films": films}, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {dst} ({', '.join(sorted(films))})")


if __name__ == "__main__":
    main()

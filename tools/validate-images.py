"""Read-only validation of real browser downloads and unedited MCP screenshots."""

import json
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = {"square": (1080, 1080), "portrait": (1080, 1350), "wide": (1920, 1080)}
report = {"exports": [], "screenshots": []}


def inspect(path):
    with Image.open(path) as image:
        dimensions = image.size
        kind = image.format
        image.verify()
    with Image.open(path) as image:
        image.load()
    return {"file": path.name, "format": kind, "width": dimensions[0],
            "height": dimensions[1], "bytes": path.stat().st_size}


for name, dimensions in EXPECTED.items():
    path = ROOT / ".verification" / "exports" / f"{name}.png"
    item = inspect(path)
    assert item["format"] == "PNG", f"Not a PNG: {path}"
    assert (item["width"], item["height"]) == dimensions, f"Wrong export dimensions: {path}"
    with path.open("rb") as image:
        assert image.read(8) == b"\x89PNG\r\n\x1a\n", f"Invalid PNG signature: {path}"
    report["exports"].append(item)

if "--exports-only" not in sys.argv:
    names = ["1-cover.jpg", "2-editor.jpg", "3-cover-portrait.jpg", "4-cover-wide.jpg"]
    actual = sorted(path.name for path in (ROOT / "screenshots").iterdir() if path.is_file())
    assert actual == names, f"Expected exactly the four named screenshots, found {actual}"
    for name in names:
        item = inspect(ROOT / "screenshots" / name)
        assert item["format"] in ("PNG", "JPEG"), f"Unsupported screenshot: {name}"
        assert item["bytes"] <= 262144, f"Screenshot over 256 KiB: {name}"
        assert max(item["width"], item["height"]) <= 1280, f"Long side over 1280: {name}"
        assert min(item["width"], item["height"]) >= 480, f"Short side below 480: {name}"
        if name == "2-editor.jpg":
            assert (item["width"], item["height"]) == (1280, 720), "Editor must be 1280 × 720"
        report["screenshots"].append(item)

print(json.dumps(report, indent=2))

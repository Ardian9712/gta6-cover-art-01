"""Decode pass-2 downloads, JPEG quality tables, and the four fresh MCP captures."""

import json
import hashlib
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
EXPECTED = {"square": (1080, 1080), "portrait": (1080, 1350),
            "wide": (1920, 1080), "story": (1080, 1920), "banner": (1920, 640)}
JPEG_QUALITIES = (70, 85, 95)
SCREENSHOTS = {"1-cover.jpg": (720, 1280), "2-editor.jpg": (1280, 720),
               "3-cover-portrait.jpg": (800, 1000), "4-cover-wide.jpg": (1280, 720)}
EVIDENCE = ROOT / ".verification" / "pass-2"
report = {"exports": [], "additional_downloads": [], "screenshots": []}


def inspect(path):
    with Image.open(path) as image:
        dimensions = image.size
        kind = image.format
        tables = getattr(image, "quantization", {}) or {}
        quantization_sum = sum(sum(table) for table in tables.values())
        image.verify()
    with Image.open(path) as image:
        image.load()
    return {"file": path.name, "format": kind, "width": dimensions[0],
            "height": dimensions[1], "bytes": path.stat().st_size,
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "jpeg_quantization_sum": quantization_sum if kind == "JPEG" else None}


for name, dimensions in EXPECTED.items():
    path = EVIDENCE / "exports" / f"{name}.png"
    item = inspect(path)
    assert item["format"] == "PNG", f"Not a PNG: {path}"
    assert (item["width"], item["height"]) == dimensions, f"Wrong export dimensions: {path}"
    with path.open("rb") as image:
        assert image.read(8) == b"\x89PNG\r\n\x1a\n", f"Invalid PNG signature: {path}"
    report["exports"].append(item)
    qualities = []
    for quality in JPEG_QUALITIES:
        jpeg_path = EVIDENCE / "exports" / f"{name}-q{quality}.jpg"
        jpeg = inspect(jpeg_path)
        assert jpeg["format"] == "JPEG", f"Not a JPEG: {jpeg_path}"
        assert (jpeg["width"], jpeg["height"]) == dimensions, f"Wrong JPEG dimensions: {jpeg_path}"
        payload = jpeg_path.read_bytes()
        assert payload.startswith(b"\xff\xd8") and payload.endswith(b"\xff\xd9"), "Invalid JPEG markers"
        jpeg["quality"] = quality
        qualities.append(jpeg)
        report["exports"].append(jpeg)
    assert qualities[0]["bytes"] < qualities[1]["bytes"] < qualities[2]["bytes"], f"Quality has no size effect: {name}"
    assert qualities[0]["jpeg_quantization_sum"] > qualities[1]["jpeg_quantization_sum"] > qualities[2]["jpeg_quantization_sum"], f"Quality has no encoder-table effect: {name}"

baseline = ROOT / ".verification" / "revision" / "mcp" / "pass-1-preflight" / "pass-1-square.png"
original = inspect(baseline)
assert original["format"] == "PNG" and (original["width"], original["height"]) == EXPECTED["square"]
report["baseline_export"] = original

extra = {"shortcut-control.png": "square", "shortcut-meta.jpg": "square",
         "recent-redownload.png": "portrait", "upload.webp": "square"}
format_keys = list(EXPECTED)
for index in range(7):
    extension = "jpg" if index % 2 else "png"
    extra[f"recent-{index}.{extension}"] = format_keys[index % len(format_keys)]
for filename, size in extra.items():
    item = inspect(EVIDENCE / "exports" / filename)
    assert (item["width"], item["height"]) == EXPECTED[size], f"Wrong fixture dimensions: {filename}"
    report["additional_downloads"].append(item)
assert (EVIDENCE / "exports" / "recent-6.png").read_bytes() == (EVIDENCE / "exports" / "recent-redownload.png").read_bytes(), "Recent re-download changed the captured PNG"
report["recent_redownload_byte_identical"] = True

if "--exports-only" not in sys.argv:
    names = list(SCREENSHOTS)
    actual = sorted(path.name for path in (ROOT / "screenshots").iterdir() if path.is_file())
    assert actual == names, f"Expected exactly the four named screenshots, found {actual}"
    for name in names:
        item = inspect(ROOT / "screenshots" / name)
        assert item["format"] == "JPEG", f"Named screenshot is not a JPEG: {name}"
        assert item["bytes"] <= 262144, f"Screenshot over 256 KiB: {name}"
        assert max(item["width"], item["height"]) <= 1280, f"Long side over 1280: {name}"
        assert min(item["width"], item["height"]) >= 480, f"Short side below 480: {name}"
        assert (item["width"], item["height"]) == SCREENSHOTS[name], f"Wrong screenshot dimensions: {name}"
        report["screenshots"].append(item)

    evidence = json.loads((EVIDENCE / "screenshot-evidence.json").read_text())
    recorded = {item["name"]: item for item in evidence["screenshots"]}
    assert evidence["pass"] == 2, "Screenshot evidence is from an earlier pass"
    assert evidence["networkRequests"] == 0, "Capture made a network request"
    assert evidence["browserErrors"] == 0, "Capture had a browser error"
    for item in report["screenshots"]:
        capture = recorded[item["file"]]
        assert capture["sha256"] == item["sha256"], "Image differs from its MCP capture"
        assert capture["width"] == item["width"] and capture["height"] == item["height"]
    assert recorded["1-cover.jpg"]["source"].startswith("app-exported PNG")
    assert recorded["2-editor.jpg"]["source"] == "editor with a File API upload"
    assert recorded["1-cover.jpg"]["view"]["format"] == "story"
    assert "42% split comparison" in recorded["2-editor.jpg"]["visibleNewFeatures"]
    report["screenshot_capture_hashes_match"] = True

report["validated_export_formats"] = len(EXPECTED)
report["validated_encoding_quality_pairs"] = len(report["exports"])
report["validated_additional_downloads"] = len(report["additional_downloads"])
report["limits"] = {"screenshot_bytes": 262144, "long_side": 1280,
                    "short_side_minimum": 480, "screenshots_maximum": 4}

print(json.dumps(report, indent=2))

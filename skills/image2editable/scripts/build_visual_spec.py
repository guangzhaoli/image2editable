#!/usr/bin/env python3
"""Compile an authored visual-study/v1 into portable visual-spec/v1 evidence.

Uses Python's standard library and Pillow. No model, network, or creative image
generation is used: observations are authored, crops are explicit pixel extracts,
and sampled colors are measurements of decoded source pixels.
"""
from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import html
import io
import json
import math
import os
from pathlib import Path
import re
import shutil
import statistics
import sys
from urllib.parse import urlsplit
import warnings

from PIL import Image, ImageDraw, ImageFont, ImageOps


ID = re.compile(r"[A-Za-z][A-Za-z0-9_-]*\Z")
HASH = re.compile(r"[0-9a-fA-F]{64}\Z")
HEX = re.compile(r"#[0-9a-fA-F]{6}\Z")
ASPECTS = {"palette", "layout", "typography", "imagery", "lighting", "spacing"}
FORMATS = {"PNG": "png", "JPEG": "jpg", "WEBP": "webp"}
CJK_FONT_CANDIDATES = (
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/System/Library/Fonts/STHeiti Medium.ttc",
    "/System/Library/Fonts/Supplemental/Songti.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/google-noto-sans-cjk-fonts/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    *(str(Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / name)
      for name in ("msyh.ttc", "msyh.ttf", "simhei.ttf", "simsun.ttc", "mingliu.ttc")),
)
REFERENCE_FIELDS = (
    "id", "sourceId", "locator", "role", "delivery", "inspected",
    "inspectionNote", "use", "avoidCopy", "preserve", "reason",
)
PIXEL_POLICY = (
    "Pillow decoded RGBA channel values; no ICC conversion, EXIF rotation, "
    "resampling, alpha compositing, or alpha weighting. Fully transparent "
    "pixels are ignored; partially transparent pixels retain their RGB values."
)
LIMITATIONS = [
    "Visual observations, inspection declarations, and adaptation decisions are supplied by the author/model; this builder does not infer or independently verify them.",
    "Regions and crops use integer pixels of the original decoded raster, before any EXIF display rotation; originals are copied byte-for-byte.",
    "Sampled colors measure this raster's decoded RGB channels, not the source author's original vector fills, font identities, or layout certainty.",
    PIXEL_POLICY,
    "Median is calculated per channel and rounded half-up to integer RGB. Exact RGB mode ties choose the lexicographically smallest RGB tuple.",
    "The PNG board is a diagnostic evidence contact sheet. It is not a creative target and is not an automatic image attachment; HTML and JSON retain the full notes.",
    "No scientific truth, exact-text correctness, visual quality, native editability, or target rendering is certified. Design-plan and the existing content packet retain content authority.",
]


def need(condition, message):
    if not condition:
        raise ValueError(message)


def text(value, where):
    need(isinstance(value, str) and value.strip(), f"{where}: expected nonempty text")
    need(not any(ord(c) < 32 and c not in "\n\r\t" for c in value), f"{where}: invalid control character")
    return value


def array(value, where):
    need(isinstance(value, list), f"{where}: expected array")
    return value


def texts(value, where):
    return [text(v, f"{where}[{i}]") for i, v in enumerate(array(value, where))]


def objects(value, where):
    result = {}
    for entry in array(value, where):
        need(isinstance(entry, dict), f"{where}: expected object entries")
        ident = entry.get("id")
        need(isinstance(ident, str) and ID.fullmatch(ident), f"{where}: invalid ID")
        need(ident not in result, f"{where}: duplicate ID {ident}")
        result[ident] = entry
    return result


def digest(data):
    return hashlib.sha256(data).hexdigest()


def hash_check(value, actual, where):
    need(isinstance(value, str) and HASH.fullmatch(value), f"{where}: expected SHA256")
    need(value.lower() == actual, f"{where}: stale or conflicting SHA256")


def rect(box, size, where):
    need(isinstance(box, list) and len(box) == 4 and all(type(v) is int for v in box),
         f"{where}: expected integer [x,y,width,height]")
    x, y, w, h = box
    need(x >= 0 and y >= 0 and w > 0 and h > 0 and x + w <= size[0] and y + h <= size[1],
         f"{where}: outside original image dimensions {size}")
    return x, y, x + w, y + h


def local_path(value, base, where):
    value = text(value, where)
    need(not re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", value) and "\x00" not in value,
         f"{where}: requires a local filesystem path, not a URI")
    return (base / Path(value).expanduser()).resolve(strict=True)


def safe_uri(value, where):
    value = text(value, where)
    need(not any(c.isspace() for c in value) and "\\" not in value, f"{where}: malformed URI")
    parsed = urlsplit(value)
    need(parsed.scheme.lower() in {"http", "https"} and parsed.hostname and not parsed.username and not parsed.password,
         f"{where}: only absolute HTTP(S) source URIs are allowed")
    return value


def unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, f"JSON: duplicate object key {key}")
        result[key] = value
    return result


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def decode_image(data, where):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as probe:
                need(probe.format in FORMATS, f"{where}: use a decodable PNG/JPEG/WebP")
                need(getattr(probe, "n_frames", 1) == 1, f"{where}: select one image frame first")
                fmt = probe.format
                probe.verify()
            with Image.open(io.BytesIO(data)) as source:
                source.load()
                orientation = source.getexif().get(274)
                need(orientation not in (2, 3, 4, 5, 6, 7, 8),
                     f"{where}: nontrivial EXIF orientation {orientation}; normalize orientation during reference preparation, inspect the normalized image, and update its hash and pixel boxes before measurement")
                image = source.convert("RGBA")
                metadata = {"decodedMode": source.mode, "exifOrientation": orientation,
                            "iccProfileSha256": digest(source.info["icc_profile"]) if source.info.get("icc_profile") else None}
        return image, fmt, metadata
    except (OSError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
        raise ValueError(f"{where}: image decoding failed: {exc}") from exc


def png_bytes(image):
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    return stream.getvalue()


def sample_palette(entry, references, images):
    ident = entry["id"]
    method = entry.get("method")
    need(method in {"declared", "median", "mode"}, f"palette {ident}: invalid method")
    result = {"id": ident, "method": method, "usage": text(entry.get("usage"), f"palette {ident}.usage")}
    if "name" in entry:
        result["name"] = text(entry["name"], f"palette {ident}.name")
    ref_id = entry.get("referenceId")
    if ref_id is not None:
        need(ref_id in references, f"palette {ident}: unknown referenceId")
        need(references[ref_id]["delivery"] != "exclude", f"palette {ident}: excluded source")
        result["referenceId"] = ref_id
    if method == "declared":
        need(isinstance(entry.get("hex"), str) and HEX.fullmatch(entry["hex"]), f"palette {ident}: expected #RRGGBB")
        need("box" not in entry, f"palette {ident}: declared color cannot have a sample box")
        rgb = tuple(int(entry["hex"][i:i+2], 16) for i in (1, 3, 5))
        provenance = {"kind": "declared", "statement": "Explicit author design choice; not measured from an image."}
    else:
        need(ref_id in images, f"palette {ident}: sampled source must have a local image")
        need("hex" not in entry, f"palette {ident}: sampled colors cannot predeclare hex")
        original = images[ref_id]
        box = entry.get("box", [0, 0, original["image"].width, original["image"].height])
        patch = original["image"].crop(rect(box, original["image"].size, f"palette {ident}.box"))
        decoded = patch.get_flattened_data() if hasattr(patch, "get_flattened_data") else patch.getdata()
        pixels = [p[:3] for p in decoded if p[3] != 0]
        need(pixels, f"palette {ident}: sample has no usable nontransparent pixels")
        provenance = {"kind": "sampled", "referenceId": ref_id, "box": box,
                      "sourceSha256": original["sha256"], "sampleCount": len(pixels),
                      "ignoredTransparentCount": patch.width * patch.height - len(pixels), "pixelPolicy": PIXEL_POLICY}
        result["box"] = box
        if method == "median":
            rgb = tuple(math.floor(statistics.median(p[i] for p in pixels) + .5) for i in range(3))
        else:
            counts = Counter(pixels)
            ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
            rgb, count = ranked[0]
            provenance.update(modeCount=count, modeTied=len(ranked) > 1 and ranked[1][1] == count)
    result.update(hex="#%02X%02X%02X" % rgb, rgb=list(rgb), provenance=provenance)
    return result


def compile_study(study, source_bytes, base):
    need(isinstance(study, dict) and study.get("schema") == "visual-study/v1", "Expected visual-study/v1")
    mode = study.get("mode")
    need(mode in {"generate", "restyle"}, "mode: expected generate or restyle")
    intent = text(study.get("intent"), "intent")
    preserve = texts(study.get("preserve", []), "preserve")
    authored_refs = objects(study.get("references", []), "references")
    observations = list(objects(study.get("observations", []), "observations").values())
    authored_palette = objects(study.get("palette", []), "palette")
    selected, cards, images, assets = [], [], {}, {}
    targets = []
    for i, (ident, authored) in enumerate(authored_refs.items(), 1):
        r = {k: authored[k] for k in REFERENCE_FIELDS if k in authored}
        for key in ("sourceId", "locator"):
            text(r.get(key), f"reference {ident}.{key}")
        need(ID.fullmatch(r["sourceId"]), f"reference {ident}: invalid sourceId")
        need(r.get("role") in {"content", "style", "edit-target"}, f"reference {ident}: invalid role")
        need(r.get("delivery") in {"attach", "text-only", "exclude"}, f"reference {ident}: invalid delivery")
        if r["delivery"] != "exclude" or "path" in authored:
            need(r.get("inspected") is True, f"reference {ident}: must declare actual author/model inspection")
            for key in ("inspectionNote", "use"):
                text(r.get(key), f"reference {ident}.{key}")
        else:
            if "inspected" in r:
                need(type(r["inspected"]) is bool, f"reference {ident}.inspected: expected boolean")
            for key in ("inspectionNote", "use"):
                if key in r:
                    text(r[key], f"reference {ident}.{key}")
        if r["delivery"] != "attach":
            text(r.get("reason"), f"reference {ident}.reason")
        if r["role"] == "style" and r["delivery"] != "exclude":
            text(r.get("avoidCopy"), f"reference {ident}.avoidCopy")
        for key in ("avoidCopy", "preserve", "reason"):
            if key in r:
                text(r[key], f"reference {ident}.{key}")
        if r["role"] == "edit-target":
            need(mode == "restyle", "generate mode cannot have an edit-target")
            need(r["delivery"] == "attach", f"reference {ident}: edit-target must attach")
            need(r.get("preserve") or preserve, f"reference {ident}: requires a global or target preservation statement")
            if not r.get("preserve"):
                r["preserve"] = "\n".join(preserve)
            targets.append(ident)
        display = {}
        if "title" in authored:
            display["title"] = text(authored["title"], f"reference {ident}.title")
        if "uri" in authored:
            display["uri"] = safe_uri(authored["uri"], f"reference {ident}.uri")
        if "path" in authored:
            source_path = local_path(authored["path"], base, f"reference {ident}.path")
            need(source_path.is_file(), f"reference {ident}: local path must be a file")
            data = source_path.read_bytes()
            sha = digest(data)
            if "sha256" in authored:
                hash_check(authored["sha256"], sha, f"reference {ident}.sha256")
            image, fmt, metadata = decode_image(data, f"reference {ident}")
            filename = f"images/{i:03d}-original.{FORMATS[fmt]}"
            assets[filename] = data
            original = {"file": filename, "sha256": sha, "width": image.width, "height": image.height,
                        "format": fmt.lower(), **metadata}
            card = {"referenceId": ident, **display, "original": original, "regions": []}
            images[ident] = {"image": image, "sha256": sha, "card": card}
            regions = objects(authored.get("regions", []), f"reference {ident}.regions")
            for region in regions.values():
                text(region.get("label"), f"region {region['id']}.label")
                rect(region.get("bbox"), image.size, f"region {region['id']}.bbox")
                saved = {k: region[k] for k in ("id", "label", "bbox", "note") if k in region}
                if "note" in saved:
                    text(saved["note"], f"region {region['id']}.note")
                card["regions"].append(saved)
            r.update(path=filename, sha256=sha)
            if "crop" in authored:
                box = authored["crop"]
                cropped = image.crop(rect(box, image.size, f"reference {ident}.crop"))
                cropfile = f"images/{i:03d}-crop.png"
                cropdata = png_bytes(cropped)
                assets[cropfile] = cropdata
                card["crop"] = {"file": cropfile, "sha256": digest(cropdata), "width": cropped.width,
                                "height": cropped.height, "box": box, "sourceSha256": sha,
                                "operation": "pixel-crop",
                                "pixelPolicy": "Integer rectangular crop of decoded original pixels; RGBA PNG; no EXIF rotation, ICC transform, resampling, enhancement, or alpha removal."}
                images[ident]["cropImage"] = cropped
                r.update(path=cropfile, sha256=digest(cropdata))
            cards.append(card)
        else:
            need(r["delivery"] != "attach", f"reference {ident}: attach requires a local path")
            need(not any(k in authored for k in ("crop", "regions", "sha256")),
                 f"reference {ident}: crop, regions, and hash require a local original")
            if display:
                cards.append({"referenceId": ident, **display, "regions": []})
        selected.append(r)
    need(mode != "restyle" or targets, "restyle requires an actual attached edit-target")
    for observation in observations:
        ident = observation["id"]
        need(observation.get("referenceId") in authored_refs, f"observation {ident}: unknown referenceId")
        need(observation.get("aspect") in ASPECTS, f"observation {ident}: invalid aspect")
        for key in ("finding", "apply"):
            text(observation.get(key), f"observation {ident}.{key}")
    palette = [sample_palette(entry, authored_refs, images) for entry in authored_palette.values()]
    spec = {"schema": "visual-spec/v1", "mode": mode, "intent": intent, "preserve": preserve,
            "references": selected, "observations": observations, "palette": palette,
            "evidence": {"cards": cards, "htmlFile": "visual-spec.html", "boardFile": "visual-spec-board.png"},
            "sourceStudy": {"file": "visual-study.json", "sha256": digest(source_bytes)}, "limitations": LIMITATIONS}
    return spec, images, assets


def esc(value):
    return html.escape(str(value), quote=True)


def image_html(card):
    original = card.get("original")
    if not original:
        return "<p class='muted'>No local image is packaged for this reference.</p>"
    width, height = original["width"], original["height"]
    overlays = []
    for region in card["regions"]:
        x, y, w, h = region["bbox"]
        overlays.append(f"<rect x='{x}' y='{y}' width='{w}' height='{h}'/><text x='{x+2}' y='{min(height-1, y+14)}'>{esc(region['label'])}</text>")
    parts = [f"<figure><div class='source-image'><img src='{esc(original['file'])}' alt='Original reference pixels'/>",
             f"<svg viewBox='0 0 {width} {height}' aria-label='Author supplied layout regions'>{''.join(overlays)}</svg></div>",
             f"<figcaption>Original {width} × {height} pixels · {esc(original['format'])}<br>SHA256 <code>{original['sha256']}</code></figcaption></figure>"]
    if card.get("crop"):
        crop = card["crop"]
        parts.append(f"<figure><img class='crop' src='{esc(crop['file'])}' alt='Explicit reference crop'/><figcaption>Selected crop {esc(crop['box'])}; {crop['width']} × {crop['height']} pixels<br>SHA256 <code>{crop['sha256']}</code></figcaption></figure>")
    return "".join(parts)


def render_html(spec):
    cards = {c["referenceId"]: c for c in spec["evidence"]["cards"]}
    parts = ["<!doctype html><html lang='en'><head><meta charset='utf-8'>",
             "<meta name='viewport' content='width=device-width, initial-scale=1'>",
             "<meta http-equiv='Content-Security-Policy' content=\"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\">",
             "<title>Visual reference study</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#f3f5f8;color:#172034;margin:0}main{max-width:1140px;margin:auto;padding:28px}h1,h2,h3{line-height:1.2}.intro,article,.palette,.limits{background:white;border:1px solid #cbd4df;border-radius:12px;padding:24px;margin-bottom:20px}.target{border:3px solid #255acb}.excluded{border-style:dashed}.muted,figcaption{color:#526174;font-size:14px}.images{display:flex;flex-wrap:wrap;gap:20px;align-items:start}figure{margin:12px 0;max-width:100%;flex:1 1 340px}img{display:block;max-width:100%;height:auto;background:repeating-conic-gradient(#fff 0% 25%,#e8e8e8 0% 50%) 0/20px 20px}.source-image{position:relative}.source-image img{width:100%}.source-image svg{position:absolute;width:100%;height:100%;top:0;left:0;pointer-events:none;fill:none;stroke:#d11473;stroke-width:2}.source-image svg text{fill:#d11473;stroke:#fff;stroke-width:.6;paint-order:stroke;font:14px sans-serif}.crop{max-height:520px;width:auto}p,li,dd{white-space:pre-wrap;overflow-wrap:anywhere}dt{font-weight:700}dd{margin:0 0 12px}code{overflow-wrap:anywhere}.swatches{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.swatch{border:1px solid #cbd4df;border-radius:8px;padding:16px}.chip{height:55px;border:1px solid #697586;margin-bottom:12px}a{color:#164daf}.badge{font-weight:700;font-size:13px;text-transform:uppercase}.region-notes{font-size:14px}</style></head><body><main>",
             f"<section class='intro'><h1>Visual reference study · {esc(spec['mode'])}</h1><p>{esc(spec['intent'])}</p>",
             "<p class='muted'>Author/model observations and adaptation decisions are recorded below. This script packages evidence and measures declared pixel patches; it does not perform visual analysis.</p>"]
    if spec["preserve"]:
        parts.append("<h2>Preserve</h2><ul>" + "".join(f"<li>{esc(v)}</li>" for v in spec["preserve"]) + "</ul>")
    parts.append("</section>")
    for ref in spec["references"]:
        card = cards.get(ref["id"], {"referenceId": ref["id"]})
        classes = "target" if ref["role"] == "edit-target" else ("excluded" if ref["delivery"] == "exclude" else "")
        parts.append(f"<article class='{classes}'><p class='badge'>{esc(ref['role'])} · {esc(ref['delivery'])}</p><h2>{esc(card.get('title', ref['id']))}</h2>")
        parts.append(f"<p class='muted'>Reference {esc(ref['id'])} · source {esc(ref['sourceId'])} · {esc(ref['locator'])}</p>")
        if card.get("uri"):
            parts.append(f"<p><a href='{esc(card['uri'])}' rel='noopener noreferrer'>Source link</a></p>")
        parts.append("<div class='images'>" + image_html(card) + "</div><dl>")
        for key, label in (("inspectionNote", "Author declared inspection"), ("use", "Intended use"),
                           ("avoidCopy", "Avoid copying"), ("preserve", "Target preview: preserve"), ("reason", "Delivery reason")):
            if key in ref:
                parts.append(f"<dt>{label}</dt><dd>{esc(ref[key])}</dd>")
        parts.append("</dl>")
        if card.get("regions"):
            parts.append("<h3>Original source layout annotations</h3><ul class='region-notes'>")
            for region in card["regions"]:
                parts.append(f"<li>{esc(region['id'])}: {esc(region['label'])} · source pixels {esc(region['bbox'])}{' · ' + esc(region['note']) if region.get('note') else ''}</li>")
            parts.append("</ul>")
        observations = [o for o in spec["observations"] if o["referenceId"] == ref["id"]]
        if observations:
            parts.append("<h3>Author/model observations and adaptations</h3>")
            if ref["delivery"] == "exclude":
                parts.append("<p class='muted'>These excluded-source notes are visible only as evidence; the generator must omit them.</p>")
            for obs in observations:
                parts.append(f"<h4>{esc(obs['aspect'])} · {esc(obs['id'])}</h4><dl><dt>Finding (author supplied)</dt><dd>{esc(obs['finding'])}</dd><dt>Apply to target (author supplied)</dt><dd>{esc(obs['apply'])}</dd></dl>")
        parts.append("</article>")
    parts.append("<section class='palette'><h2>Palette: measured samples and declared choices</h2><div class='swatches'>")
    for entry in spec["palette"]:
        p = entry["provenance"]
        parts.append(f"<div class='swatch'><div class='chip' style='background:{entry['hex']}'></div><h3>{esc(entry.get('name', entry['id']))}</h3><p>{entry['hex']} · RGB {esc(entry['rgb'])} · {esc(entry['method'])}</p><p>{esc(entry['usage'])}</p>")
        if p["kind"] == "sampled":
            parts.append(f"<p class='muted'>Original source {esc(p['referenceId'])} · box {esc(p['box'])}<br>{p['sampleCount']} usable pixels; {p['ignoredTransparentCount']} fully transparent pixels ignored<br>Source SHA256 <code>{p['sourceSha256']}</code></p>")
        else:
            parts.append(f"<p class='muted'>{esc(p['statement'])}</p>")
        parts.append("</div>")
    parts.append("</div></section><section class='limits'><h2>Evidence boundaries</h2><ul>" + "".join(f"<li>{esc(v)}</li>" for v in spec["limitations"]) + "</ul>")
    parts.append(f"<p>Saved source study SHA256 <code>{spec['sourceStudy']['sha256']}</code></p><p><a href='visual-spec.json'>Machine manifest</a> · <a href='visual-study.json'>Original authored study</a> · <a href='visual-spec-board.png'>Diagnostic PNG board</a></p></section></main></body></html>")
    return "\n".join(parts).encode("utf-8")


def has_cjk_glyphs(font):
    """Reject fonts whose Chinese characters render as the missing-glyph box."""
    def signature(char):
        mask = font.getmask(char, mode="L")
        return mask.size, bytes(mask)

    missing = signature("\U0010ffff")
    chinese = [signature(char) for char in "中文汉字"]
    return len(set(chinese)) == len(chinese) and all(glyph != missing and any(glyph[1]) for glyph in chinese)


def load_font(font_path, size):
    if font_path:
        return ImageFont.truetype(str(font_path), size)
    for candidate in CJK_FONT_CANDIDATES:
        if Path(candidate).is_file():
            try:
                font = ImageFont.truetype(candidate, size)
                if has_cjk_glyphs(font):
                    return font
            except (OSError, ValueError):
                pass
    warnings.warn("No usable CJK board font was found; falling back to a Latin/default font. "
                  "Chinese labels in the diagnostic PNG may show missing glyphs; provide --font. "
                  "HTML and JSON retain the complete text.", UserWarning, stacklevel=2)
    candidates = ("/System/Library/Fonts/Helvetica.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                  "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf", "C:/Windows/Fonts/arial.ttf")
    for candidate in candidates:
        if Path(candidate).is_file():
            try:
                return ImageFont.truetype(candidate, size)
            except OSError:
                pass
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # Older Pillow still has a portable bitmap fallback.
        return ImageFont.load_default()


def wrap_lines(draw, value, font, width, max_lines):
    # Wrap by measured glyph width, including scripts that do not use spaces.
    lines, current = [], ""
    for char in str(value):
        if char == "\n" or (current and draw.textlength(current + char, font=font) > width):
            lines.append(current)
            current = "" if char == "\n" else char
        else:
            current += char
    if current:
        lines.append(current)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1][:-3] + "..."
    return lines


def board_text(draw, xy, value, font, width, max_lines=2, fill="#172034", spacing=22):
    x, y = xy
    for line in wrap_lines(draw, value, font, width, max_lines):
        draw.text((x, y), line, fill=fill, font=font)
        y += spacing
    return y


def board_image(board, image, xy, size, regions, font):
    preview = ImageOps.contain(image, size, Image.Resampling.LANCZOS)
    x = xy[0] + (size[0] - preview.width) // 2
    y = xy[1] + (size[1] - preview.height) // 2
    board.paste(preview, (x, y), preview)
    draw = ImageDraw.Draw(board)
    sx, sy = preview.width / image.width, preview.height / image.height
    for region in regions:
        rx, ry, w, h = region["bbox"]
        draw.rectangle((x+rx*sx, y+ry*sy, x+(rx+w)*sx-1, y+(ry+h)*sy-1), outline="#D11473", width=2)
        board_text(draw, (x+rx*sx+3, y+ry*sy+2), region["label"], font, max(30, w*sx-6), 1, fill="#D11473", spacing=16)


def render_board(spec, images, font_path=None):
    regular, small, heading = (load_font(font_path, size) for size in (18, 14, 26))
    width, row_height, header = 1400, 390, 190
    height = header + row_height * len(spec["references"]) + max(100, 108 * len(spec["palette"])) + 65
    board = Image.new("RGB", (width, height), "#F3F5F8")
    draw = ImageDraw.Draw(board)
    board_text(draw, (24, 18), f"Visual evidence board | {spec['mode']}", heading, width-48, 1, spacing=32)
    board_text(draw, (24, 62), spec["intent"], regular, width-48, 2)
    board_text(draw, (24, 114), "Author supplied observations. Original pixels / explicit crops. Diagnostic evidence only.", small, width-48, 1)
    if spec["preserve"]:
        board_text(draw, (24, 144), "Preserve: " + "; ".join(spec["preserve"]), small, width-48, 1)
    cards = {c["referenceId"]: c for c in spec["evidence"]["cards"]}
    for i, ref in enumerate(spec["references"]):
        top = header + i * row_height
        draw.rounded_rectangle((16, top, width-16, top+row_height-12), radius=9, fill="white", outline="#255ACB" if ref["role"] == "edit-target" else "#CBD4DF", width=2)
        card = cards.get(ref["id"], {})
        title = f"{ref['id']} | {ref['role']} | {ref['delivery']}"
        board_text(draw, (30, top+12), title, regular, 660, 1)
        if ref["id"] in images:
            loaded = images[ref["id"]]
            board_image(board, loaded["image"], (30, top+58), (455, 260), card.get("regions", []), small)
            original = card["original"]
            board_text(draw, (30, top+326), f"Original {original['width']} x {original['height']} px | SHA256 {original['sha256'][:16]}...", small, 455, 2, spacing=17)
            if "cropImage" in loaded:
                board_image(board, loaded["cropImage"], (505, top+58), (220, 260), [], small)
                board_text(draw, (505, top+326), f"Selected crop {card['crop']['box']}", small, 220, 2, spacing=17)
        else:
            board_text(draw, (30, top+76), "No local image packaged. " + ref.get("reason", ""), regular, 680, 3)
        y = board_text(draw, (750, top+18), card.get("title", ref["locator"]), regular, 610, 2)
        y = board_text(draw, (750, y+6), "Use: " + ref.get("use", ref.get("reason", "")), small, 610, 2, spacing=18)
        if ref.get("preserve"):
            y = board_text(draw, (750, y+6), "Preserve: " + ref["preserve"], small, 610, 2, spacing=18)
        for observation in [o for o in spec["observations"] if o["referenceId"] == ref["id"]][:3]:
            if y > top + 292:
                break
            y = board_text(draw, (750, y+6), f"{observation['aspect']}: {observation['finding']}", small, 610, 2, spacing=18)
            y = board_text(draw, (750, y+2), "Apply: " + observation["apply"], small, 610, 2, spacing=18)
    top = header + row_height * len(spec["references"])
    if not spec["palette"]:
        board_text(draw, (24, top+20), "No palette entries declared. Full notes and provenance are in HTML/JSON.", regular, width-48, 2)
    for i, color in enumerate(spec["palette"]):
        y = top + i * 108 + 12
        draw.rectangle((24, y, 142, y+78), fill=color["hex"], outline="#697586")
        board_text(draw, (164, y), f"{color.get('name', color['id'])} | {color['hex']} | RGB {color['rgb']} | {color['method']}", regular, width-190, 1)
        board_text(draw, (164, y+28), color["usage"], small, width-190, 2, spacing=17)
        p = color["provenance"]
        detail = (f"Original {p['referenceId']} | box {p['box']} | usable pixels {p['sampleCount']} | source SHA256 {p['sourceSha256'][:16]}..."
                  if p["kind"] == "sampled" else p["statement"])
        board_text(draw, (164, y+65), detail, small, width-190, 1)
    board_text(draw, (24, height-40), "View-only diagnostic board; notes may be shortened here. Portable HTML/JSON preserve full authored evidence.", small, width-48, 1)
    return png_bytes(board)


def build_visual_spec(study_path, out_path, font_path=None):
    """Validate/compile before output; create a new package or leave none on error."""
    study_path = Path(study_path).expanduser().resolve(strict=True)
    raw_out = Path(out_path).expanduser().absolute()
    need(not raw_out.exists() and not raw_out.is_symlink(), "Output directory must be new; existing paths are never overwritten")
    out = raw_out.resolve()
    source_bytes = study_path.read_bytes()
    study = json.loads(source_bytes, object_pairs_hook=unique_pairs,
                       parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f"JSON: invalid constant {value}")))
    spec, images, assets = compile_study(study, source_bytes, study_path.parent)
    if font_path is not None:
        font_path = Path(font_path).expanduser().resolve(strict=True)
        need(font_path.is_file(), "font: expected a local font file")
    files = {**assets, "visual-study.json": source_bytes, "visual-spec.json": json_bytes(spec),
             "visual-spec.html": render_html(spec), "visual-spec-board.png": render_board(spec, images, font_path)}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.mkdir()  # Exclusive creation, including racing existing empty directories.
    try:
        if assets:
            (out / "images").mkdir()
        for relative, data in files.items():
            with (out / relative).open("xb") as handle:
                handle.write(data)
    except BaseException:
        shutil.rmtree(out)
        raise
    return spec


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("study", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--font", type=Path)
    args = parser.parse_args(argv)
    try:
        spec = build_visual_spec(args.study, args.out, args.font)
        print(json.dumps({"schema": spec["schema"], "mode": spec["mode"], "output": str(args.out.expanduser().resolve()),
                          "references": len(spec["references"]), "palette": len(spec["palette"]),
                          "called": False, "observations": "author/model supplied; not automatically inferred"}))
        return 0
    except (ValueError, OSError, TypeError, KeyError) as exc:
        print("error: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

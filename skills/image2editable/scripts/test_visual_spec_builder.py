#!/usr/bin/env python3
"""Behavioral tests for authored evidence compilation; no creative demos."""
import copy
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from PIL import Image, ImageFont

import build_visual_spec as builder


class AssetParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.images = []
        self.scripts = []
        self.handlers = []
        self.links = []

    def handle_starttag(self, tag, attrs):
        attr = dict(attrs)
        if tag == "img":
            self.images.append(attr["src"])
        if tag == "script":
            self.scripts.append(attr)
        if tag == "a":
            self.links.append(attr.get("href"))
        self.handlers.extend((k, v) for k, v in attrs if k.startswith("on"))


class VisualSpecBuilderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.image_path = self.root / "reference source.png"
        image = Image.new("RGBA", (4, 2))
        image.putdata([
            (10, 20, 30, 255), (10, 20, 30, 255), (200, 210, 220, 255), (9, 8, 7, 0),
            (10, 20, 30, 128), (100, 110, 120, 255), (200, 210, 220, 255), (9, 8, 7, 0),
        ])
        image.save(self.image_path)
        self.study_path = self.root / "study.json"
        self.out = self.root / "package"
        self.study = {
            "schema": "visual-study/v1", "mode": "generate", "intent": "Study palette and composition.",
            "preserve": ["Use the exact labels from the content plan."],
            "references": [{"id": "styleA", "sourceId": "sourceA", "locator": "Figure 1",
                            "role": "style", "delivery": "attach", "path": self.image_path.name,
                            "inspected": True, "inspectionNote": "Author viewed the source pixels.",
                            "use": "Borrow the panel spacing.", "avoidCopy": "Do not import source claims or labels.",
                            "title": "Reference image", "uri": "https://example.org/source",
                            "regions": [{"id": "left", "label": "Left panel", "bbox": [0, 0, 2, 2], "note": "Authored layout annotation."}]}],
            "observations": [{"id": "space", "referenceId": "styleA", "aspect": "spacing",
                              "finding": "Author observed a narrow gap.", "apply": "Use a similar gap around target panels."}],
            "palette": [{"id": "main", "method": "mode", "referenceId": "styleA", "box": [0, 0, 4, 2],
                         "usage": "Target panel outlines."},
                        {"id": "designed", "method": "declared", "hex": "#aBcDeF", "usage": "Explicit accent choice."}],
        }

    def tearDown(self):
        self.tmp.cleanup()

    def write_study(self, study=None):
        self.study_path.write_text(json.dumps(study or self.study, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    def build(self, study=None, out=None):
        self.write_study(study)
        return builder.build_visual_spec(self.study_path, out or self.out)

    def assert_rejected(self, study, message):
        with self.assertRaisesRegex(ValueError, message):
            self.build(study)
        self.assertFalse(self.out.exists())

    def test_actual_original_hashes_pixel_sample_and_contract_subset(self):
        original = self.image_path.read_bytes()
        spec = self.build()
        self.assertEqual(spec["schema"], "visual-spec/v1")
        self.assertEqual(spec["observations"], self.study["observations"])
        self.assertEqual(spec["references"][0]["sha256"], hashlib.sha256(original).hexdigest())
        self.assertEqual(spec["references"][0]["path"], "images/001-original.png")
        self.assertEqual((self.out / spec["references"][0]["path"]).read_bytes(), original)
        self.assertEqual(set(spec["references"][0]), set(builder.REFERENCE_FIELDS).intersection(self.study["references"][0]) | {"path", "sha256"})
        card = spec["evidence"]["cards"][0]
        self.assertEqual((card["original"]["width"], card["original"]["height"]), (4, 2))
        self.assertEqual(card["regions"], self.study["references"][0]["regions"])
        color = spec["palette"][0]
        self.assertEqual(color["hex"], "#0A141E")
        self.assertEqual(color["rgb"], [10, 20, 30])
        self.assertEqual(color["provenance"]["sampleCount"], 6)
        self.assertEqual(color["provenance"]["ignoredTransparentCount"], 2)
        self.assertEqual(color["provenance"]["modeCount"], 3)
        self.assertFalse(color["provenance"]["modeTied"])
        self.assertEqual(color["provenance"]["sourceSha256"], card["original"]["sha256"])
        self.assertEqual(spec["palette"][1]["hex"], "#ABCDEF")
        self.assertEqual(spec["palette"][1]["provenance"]["kind"], "declared")
        saved_study = (self.out / spec["sourceStudy"]["file"]).read_bytes()
        self.assertEqual(saved_study, self.study_path.read_bytes())
        self.assertEqual(spec["sourceStudy"]["sha256"], hashlib.sha256(saved_study).hexdigest())
        self.assertEqual(json.loads((self.out / "visual-spec.json").read_bytes()), spec)

    def test_crop_keeps_original_and_samples_original_coordinates(self):
        study = copy.deepcopy(self.study)
        study["references"][0]["crop"] = [2, 0, 2, 2]
        # This patch is outside the selected crop and must still sample the original.
        study["palette"][0]["box"] = [0, 0, 2, 2]
        spec = self.build(study)
        card = spec["evidence"]["cards"][0]
        crop = card["crop"]
        self.assertEqual(crop["operation"], "pixel-crop")
        self.assertEqual(crop["box"], [2, 0, 2, 2])
        self.assertEqual(crop["sourceSha256"], card["original"]["sha256"])
        self.assertEqual(spec["references"][0]["path"], crop["file"])
        self.assertEqual(spec["references"][0]["sha256"], hashlib.sha256((self.out / crop["file"]).read_bytes()).hexdigest())
        with Image.open(self.out / crop["file"]) as image:
            self.assertEqual(image.size, (2, 2))
            decoded = image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata()
            self.assertEqual(list(decoded), [(200, 210, 220, 255), (9, 8, 7, 0), (200, 210, 220, 255), (9, 8, 7, 0)])
        self.assertEqual(spec["palette"][0]["provenance"]["sampleCount"], 4)
        self.assertEqual(spec["palette"][0]["hex"], "#0A141E")
        self.assertNotEqual(crop["sha256"], card["original"]["sha256"])
        self.assertEqual((self.out / card["original"]["file"]).read_bytes(), self.image_path.read_bytes())

    def test_median_rounding_and_exact_mode_tie_with_partial_alpha(self):
        image = Image.new("RGBA", (3, 1))
        image.putdata([(0, 1, 10, 1), (1, 2, 11, 255), (255, 0, 0, 0)])
        image.save(self.image_path)
        study = copy.deepcopy(self.study)
        study["references"][0].pop("regions")
        study["palette"] = [
            {"id": "medianA", "method": "median", "referenceId": "styleA", "usage": "Median example."},
            {"id": "modeA", "method": "mode", "referenceId": "styleA", "usage": "Mode example."},
        ]
        spec = self.build(study)
        self.assertEqual(spec["palette"][0]["rgb"], [1, 2, 11])
        self.assertEqual(spec["palette"][0]["box"], [0, 0, 3, 1])
        self.assertEqual(spec["palette"][0]["provenance"]["sampleCount"], 2)
        self.assertEqual(spec["palette"][1]["rgb"], [0, 1, 10])
        self.assertTrue(spec["palette"][1]["provenance"]["modeTied"])
        self.assertEqual(spec["palette"][1]["provenance"]["modeCount"], 1)

    def test_no_usable_pixels_is_an_error_before_output(self):
        study = copy.deepcopy(self.study)
        study["palette"][0]["box"] = [3, 0, 1, 2]
        self.assert_rejected(study, "no usable")

    def test_crop_and_region_and_sample_bounds(self):
        for key in ("crop", "region", "sample"):
            for box in ([-1, 0, 1, 1], [0, 0, 0, 1], [3, 1, 2, 1], [0, 0, 4, 3], [0, 0, 1.0, 1], [False, 0, 1, 1], [1, 2, 3]):
                with self.subTest(key=key, box=box):
                    study = copy.deepcopy(self.study)
                    if key == "crop":
                        study["references"][0]["crop"] = box
                    elif key == "region":
                        study["references"][0]["regions"][0]["bbox"] = box
                    else:
                        study["palette"][0]["box"] = box
                    self.assert_rejected(study, "integer|outside")

    def test_hash_conflicts_and_duplicate_ids_fail(self):
        for sha in ("0" * 64, "not-a-hash"):
            study = copy.deepcopy(self.study)
            study["references"][0]["sha256"] = sha
            self.assert_rejected(study, "SHA256")
        for group in ("references", "observations", "palette"):
            study = copy.deepcopy(self.study)
            study[group].append(copy.deepcopy(study[group][0]))
            self.assert_rejected(study, "duplicate ID")
        self.study_path.write_text('{"schema":"visual-study/v1","schema":"visual-study/v1"}')
        with self.assertRaisesRegex(ValueError, "duplicate object key"):
            builder.build_visual_spec(self.study_path, self.out)
        self.assertFalse(self.out.exists())

    def test_matching_optional_hash_is_accepted_and_computed_for_selected_crop(self):
        study = copy.deepcopy(self.study)
        study["references"][0]["sha256"] = hashlib.sha256(self.image_path.read_bytes()).hexdigest().upper()
        study["references"][0]["crop"] = [0, 0, 2, 2]
        spec = self.build(study)
        self.assertNotEqual(spec["references"][0]["sha256"], study["references"][0]["sha256"].lower())
        self.assertEqual(spec["evidence"]["cards"][0]["original"]["sha256"], study["references"][0]["sha256"].lower())

    def test_image_validation_decodes_instead_of_accepting_signature_only(self):
        for content in (b"\x89PNG\r\n\x1a\nnot-a-real-image", b"not an image"):
            self.image_path.write_bytes(content)
            self.assert_rejected(copy.deepcopy(self.study), "decoding failed")
        image = Image.new("RGB", (4, 2), "red")
        image.save(self.image_path, format="GIF")
        self.assert_rejected(copy.deepcopy(self.study), "decodable PNG/JPEG/WebP")
        other = Image.new("RGBA", (4, 2), "blue")
        image.save(self.image_path, format="PNG", save_all=True, append_images=[other], duration=10, loop=0)
        self.assert_rejected(copy.deepcopy(self.study), "one image frame")

    def test_jpeg_and_webp_use_real_format_not_filename_extension(self):
        for fmt, expected in (("JPEG", "jpeg"), ("WEBP", "webp")):
            with self.subTest(fmt=fmt):
                Image.new("RGB", (4, 2), (10, 20, 30)).save(self.image_path, format=fmt)
                spec = self.build(out=self.root / (fmt.lower() + "-package"))
                self.assertEqual(spec["evidence"]["cards"][0]["original"]["format"], expected)

    def test_oriented_jpeg_requires_normalized_reference_before_measurement(self):
        source = Image.new("RGB", (4, 2), (10, 20, 30))
        exif = Image.Exif()
        exif[274] = 6
        source.save(self.image_path, format="JPEG", exif=exif)
        original_bytes = self.image_path.read_bytes()
        with Image.open(self.image_path) as encoded:
            self.assertEqual(encoded.format, "JPEG")
            self.assertEqual(encoded.getexif().get(274), 6)
            self.assertEqual(encoded.size, (4, 2))
        self.assert_rejected(copy.deepcopy(self.study), "EXIF orientation 6; normalize orientation during reference preparation")
        self.assertEqual(self.image_path.read_bytes(), original_bytes)

    def test_restyle_requires_target_and_preservation_and_forwards_global_preserve(self):
        study = copy.deepcopy(self.study)
        study["mode"] = "restyle"
        self.assert_rejected(study, "actual attached edit-target")
        study["references"][0]["role"] = "edit-target"
        spec = self.build(study)
        self.assertEqual(spec["references"][0]["preserve"], study["preserve"][0])
        self.assertIn("Target preview: preserve", (self.out / "visual-spec.html").read_text())
        shutil_package = self.root / "without-preservation"
        study["preserve"] = []
        self.write_study(study)
        with self.assertRaisesRegex(ValueError, "preservation statement"):
            builder.build_visual_spec(self.study_path, shutil_package)
        self.assertFalse(shutil_package.exists())
        study["references"][0]["preserve"] = "Keep scientific nodes and their exact labels."
        self.write_study(study)
        self.assertEqual(builder.build_visual_spec(self.study_path, shutil_package)["references"][0]["preserve"], study["references"][0]["preserve"])
        study["mode"] = "generate"
        with self.assertRaisesRegex(ValueError, "generate mode cannot"):
            self.build(study, out=self.root / "invalid-generate")
        study["mode"] = "restyle"
        study["references"][0]["delivery"] = "text-only"
        study["references"][0]["reason"] = "No image attachment selected."
        with self.assertRaisesRegex(ValueError, "edit-target must attach"):
            self.build(study, out=self.root / "invalid-delivery")

    def test_nonattached_without_image_and_excluded_observations_are_retained_as_evidence(self):
        study = copy.deepcopy(self.study)
        study["references"] += [
            {"id": "textA", "sourceId": "textSource", "locator": "User summary", "role": "style", "delivery": "text-only",
             "reason": "No image available.", "inspected": True, "inspectionNote": "Author summary reviewed.",
             "use": "Typography only.", "avoidCopy": "No labels.", "title": "Summary reference"},
            {"id": "excludedA", "sourceId": "excludeSource", "locator": "Unused image", "role": "style", "delivery": "exclude",
             "reason": "Out of scope.", "title": "Excluded reference"},
        ]
        study["observations"].append({"id": "excludedNote", "referenceId": "excludedA", "aspect": "layout",
                                      "finding": "Excluded finding retained for traceability.", "apply": "Do not apply."})
        spec = self.build(study)
        for card in spec["evidence"]["cards"][1:]:
            self.assertNotIn("original", card)
        self.assertEqual(spec["observations"], study["observations"])
        page = (self.out / "visual-spec.html").read_text()
        self.assertIn("Excluded finding retained", page)
        self.assertIn("generator must omit", page)
        for method in ("mode", "median", "declared"):
            bad = copy.deepcopy(study)
            bad["palette"][0]["referenceId"] = "excludedA"
            bad["palette"][0]["method"] = method
            with self.assertRaisesRegex(ValueError, "excluded source"):
                self.build(bad, out=self.root / ("invalid-" + method))

    def test_portable_relative_assets_and_board_png(self):
        study = copy.deepcopy(self.study)
        study["references"][0]["crop"] = [0, 0, 2, 2]
        self.build(study)
        self.image_path.unlink()
        self.study_path.unlink()
        manifest = json.loads((self.out / "visual-spec.json").read_text())
        files = [manifest["sourceStudy"]["file"], manifest["evidence"]["htmlFile"], manifest["evidence"]["boardFile"]]
        for card in manifest["evidence"]["cards"]:
            for key in ("original", "crop"):
                if key in card:
                    record = card[key]
                    files.append(record["file"])
                    self.assertEqual(record["sha256"], hashlib.sha256((self.out / record["file"]).read_bytes()).hexdigest())
        parser = AssetParser()
        parser.feed((self.out / "visual-spec.html").read_text())
        files.extend(parser.images)
        self.assertEqual(len(parser.images), 2)
        for filename in files:
            self.assertFalse(Path(filename).is_absolute())
            self.assertNotIn("..", Path(filename).parts)
            self.assertTrue((self.out / filename).is_file())
        self.assertNotIn(str(self.root), (self.out / "visual-spec.json").read_text())
        self.assertNotIn(str(self.root), (self.out / "visual-spec.html").read_text())
        with Image.open(self.out / "visual-spec-board.png") as board:
            board.load()
            self.assertEqual(board.format, "PNG")
            self.assertEqual(board.width, 1400)
            self.assertGreater(board.height, 600)

    def test_html_escapes_every_authored_display_context(self):
        study = copy.deepcopy(self.study)
        attack = "<script>alert('x')</script><img src=x onerror=alert(1)> & \"quoted\""
        study["intent"] = attack
        study["preserve"] = [attack]
        ref = study["references"][0]
        for key in ("title", "locator", "inspectionNote", "use", "avoidCopy"):
            ref[key] = attack
        ref["regions"][0]["label"] = attack
        ref["regions"][0]["note"] = attack
        study["observations"][0]["finding"] = attack
        study["observations"][0]["apply"] = attack
        study["palette"][0]["name"] = attack
        study["palette"][0]["usage"] = attack
        ref["uri"] = 'https://example.org/?q="onmouseover=alert(1)"&a=<test>'
        self.build(study)
        page = (self.out / "visual-spec.html").read_text()
        self.assertIn("&lt;script&gt;", page)
        self.assertIn("&quot;onmouseover=", page)
        parser = AssetParser()
        parser.feed(page)
        self.assertEqual(parser.scripts, [])
        self.assertEqual(parser.handlers, [])
        self.assertEqual(len(parser.images), 1)
        self.assertIn(ref["uri"], parser.links)

    def test_unsafe_uri_and_nonlocal_paths_are_rejected(self):
        for uri in ("javascript:alert(1)", "data:text/html,test", "file:///tmp/source.png", "//example.org/x", "https://example.org/a b", "https://user:password@example.org/"):
            study = copy.deepcopy(self.study)
            study["references"][0]["uri"] = uri
            self.assert_rejected(study, "URI")
        for uri in ("https://example.org/source.png", "data:image/png,abc", "file:///tmp/source.png"):
            study = copy.deepcopy(self.study)
            study["references"][0]["path"] = uri
            self.assert_rejected(study, "local filesystem path")
        for change in ("false-inspection", "missing-path", "unknown-observation", "unknown-palette"):
            study = copy.deepcopy(self.study)
            if change == "false-inspection":
                study["references"][0]["inspected"] = False
            elif change == "missing-path":
                study["references"][0].pop("path")
            elif change == "unknown-observation":
                study["observations"][0]["referenceId"] = "missing"
            else:
                study["palette"][0]["referenceId"] = "missing"
            self.assert_rejected(study, "inspection|local path|unknown referenceId")

    def test_existing_file_directory_and_symlink_never_overwritten(self):
        self.write_study()
        occupied = self.root / "occupied"
        occupied.mkdir()
        occupied_file = occupied / "accepted.txt"
        occupied_file.write_text("accepted evidence")
        empty = self.root / "empty"
        empty.mkdir()
        regular = self.root / "file"
        regular.write_text("keep")
        linked = self.root / "link"
        linked.symlink_to(empty, target_is_directory=True)
        dangling = self.root / "dangling"
        dangling.symlink_to(self.root / "missing")
        for out in (occupied, empty, regular, linked, dangling):
            with self.subTest(out=out):
                with self.assertRaisesRegex(ValueError, "never overwritten"):
                    builder.build_visual_spec(self.study_path, out)
        self.assertEqual(occupied_file.read_text(), "accepted evidence")
        self.assertEqual(regular.read_text(), "keep")
        self.assertEqual(list(empty.iterdir()), [])
        self.assertTrue(dangling.is_symlink())

    def test_partial_write_is_rolled_back(self):
        self.write_study()
        original_open = Path.open

        def failing_open(path, mode="r", *args, **kwargs):
            if path == self.out.resolve() / "visual-spec.html" and mode == "xb":
                raise OSError("Simulated disk failure")
            return original_open(path, mode, *args, **kwargs)

        with mock.patch.object(Path, "open", failing_open):
            with self.assertRaisesRegex(OSError, "Simulated disk failure"):
                builder.build_visual_spec(self.study_path, self.out)
        self.assertFalse(self.out.exists())
        self.assertTrue(self.study_path.is_file())
        self.assertTrue(self.image_path.is_file())

    def test_invalid_explicit_font_is_rejected_before_output(self):
        self.write_study()
        font = self.root / "fake-font.ttf"
        font.write_text("not a font")
        with self.assertRaises(OSError):
            builder.build_visual_spec(self.study_path, self.out, font)
        self.assertFalse(self.out.exists())

    def test_available_cjk_font_renders_distinct_real_chinese_glyphs(self):
        def masks(font):
            glyphs = []
            for char in "中文汉字":
                mask = font.getmask(char, mode="L")
                glyphs.append((mask.size, bytes(mask)))
            missing_mask = font.getmask("\U0010ffff", mode="L")
            return glyphs, (missing_mask.size, bytes(missing_mask))

        available = []
        for candidate in builder.CJK_FONT_CANDIDATES:
            if Path(candidate).is_file():
                try:
                    font = ImageFont.truetype(candidate, 26)
                    glyphs, missing = masks(font)
                    if len(set(glyphs)) == 4 and all(g != missing and any(g[1]) for g in glyphs):
                        available.append(candidate)
                except (OSError, ValueError):
                    pass
        if not available:
            self.skipTest("No host CJK font has distinct usable Chinese glyphs; builder discloses its Latin/default fallback.")
        for size in (14, 18, 26):
            with self.subTest(size=size):
                font = builder.load_font(None, size)
                glyphs, missing = masks(font)
                self.assertEqual(len(set(glyphs)), 4)
                self.assertTrue(all(g != missing and any(g[1]) for g in glyphs))
                # A valid explicit --font always wins over automatic discovery.
                with mock.patch.object(builder, "CJK_FONT_CANDIDATES", ()):
                    explicit = builder.load_font(available[0], size)
                self.assertEqual(masks(explicit)[0], masks(ImageFont.truetype(available[0], size))[0])

    def test_font_fallback_is_disclosed_if_no_cjk_font_is_available(self):
        with mock.patch.object(builder, "CJK_FONT_CANDIDATES", ()):
            with self.assertWarnsRegex(UserWarning, "No usable CJK board font.*falling back.*--font"):
                font = builder.load_font(None, 18)
        self.assertTrue(any(bytes(font.getmask("A", mode="L"))))

    def test_generate_has_no_fixed_reference_or_palette_quota(self):
        study = {"schema": "visual-study/v1", "mode": "generate", "intent": "Authored text direction."}
        spec = self.build(study)
        self.assertEqual(spec["references"], [])
        self.assertEqual(spec["palette"], [])
        self.assertEqual(spec["evidence"]["cards"], [])
        self.assertTrue((self.out / "visual-spec-board.png").is_file())

    def test_cli_compiles_and_reports_actual_fields_without_a_model_call(self):
        self.write_study()
        command = [sys.executable, str(Path(builder.__file__).resolve()), str(self.study_path), "--out", str(self.out)]
        result = subprocess.run(command, text=True, capture_output=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertEqual(report["schema"], "visual-spec/v1")
        self.assertEqual(report["references"], 1)
        self.assertEqual(report["palette"], 2)
        self.assertFalse(report["called"])
        self.assertIn("not automatically inferred", report["observations"])
        again = subprocess.run(command, text=True, capture_output=True, check=False)
        self.assertEqual(again.returncode, 2)
        self.assertIn("never overwritten", again.stderr)


if __name__ == "__main__":
    unittest.main(verbosity=2)

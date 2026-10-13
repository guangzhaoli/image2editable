#!/usr/bin/env python3
"""Deterministic raster previews and visual comparison for paper figures.

Requires Pillow. PDF input additionally requires pdftoppm or pypdfium2.
No automatic alignment, cropping, color correction, or pass/fail judgment.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import shutil
import subprocess
import sys
import tempfile
import warnings
from pathlib import Path

try:
    from PIL import Image, ImageChops, ImageOps, ImageStat, UnidentifiedImageError
except ImportError:
    raise SystemExit("error: Pillow is required. Use a Python environment with Pillow installed.")


class InputError(Exception):
    pass


def positive_page(value: str) -> int:
    try:
        page = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("page must be a positive integer") from exc
    if page < 1:
        raise argparse.ArgumentTypeError("page is 1-based and must be at least 1")
    return page


def dpi_value(value: str) -> float:
    try:
        dpi = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("DPI must be a number") from exc
    if not math.isfinite(dpi) or not 1 <= dpi <= 1200:
        raise argparse.ArgumentTypeError("DPI must be between 1 and 1200")
    return dpi


def threshold_value(value: str) -> int:
    try:
        threshold = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("threshold must be an integer") from exc
    if not 0 <= threshold <= 255:
        raise argparse.ArgumentTypeError("threshold must be between 0 and 255")
    return threshold


def crop_value(value: str) -> tuple[int, int, int, int]:
    try:
        numbers = tuple(int(part.strip()) for part in value.split(","))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("crop must be x,y,width,height in integer pixels") from exc
    if len(numbers) != 4 or min(numbers[:2]) < 0 or min(numbers[2:]) < 1:
        raise argparse.ArgumentTypeError("crop must have x,y >= 0 and width,height > 0")
    return numbers


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_paths(inputs: list[Path], output: Path) -> None:
    for path in inputs:
        if not path.is_file():
            raise InputError(f"input is not a file: {path}")
        if path == output or output in path.parents:
            raise InputError(f"input must be outside the output directory: {path}")
    if output.exists():
        if not output.is_dir():
            raise InputError(f"output is not a directory: {output}")
        if any(output.iterdir()):
            raise InputError(f"output directory is not empty: {output}; choose a new directory")


def normalize(image: Image.Image) -> tuple[Image.Image, dict]:
    orientation = image.getexif().get(274)
    original_size = list(image.size)
    icc_present = bool(image.info.get("icc_profile"))
    original_mode = image.mode
    alpha = "A" in image.getbands() or "transparency" in image.info
    image = ImageOps.exif_transpose(image)
    if alpha:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        image = Image.alpha_composite(background, rgba).convert("RGB")
    else:
        image = image.convert("RGB")
    return image, {
        "decoded_size_px": original_size,
        "decoded_mode": original_mode,
        "exif_orientation": orientation,
        "exif_transpose_applied": orientation in (2, 3, 4, 5, 6, 7, 8),
        "alpha_composited_on_white": alpha,
        "embedded_icc_profile_present": icc_present,
        "icc_transform_applied": False,
        "normalized_size_px": list(image.size),
        "normalized_mode": "RGB",
    }


def render_pdf(path: Path, page: int, dpi: float, requested_backend: str) -> tuple[Image.Image, str]:
    backend = requested_backend
    executable = shutil.which("pdftoppm")
    if backend == "auto":
        backend = "pdftoppm" if executable else "pdfium"
    if backend == "pdftoppm":
        if not executable:
            raise InputError("pdftoppm is not on PATH; use --pdf-backend pdfium with pypdfium2")
        with tempfile.TemporaryDirectory(prefix="figure-render-") as temp:
            prefix = str(Path(temp) / "page")
            command = [executable, "-f", str(page), "-l", str(page), "-singlefile",
                       "-r", str(dpi), "-png", str(path), prefix]
            try:
                result = subprocess.run(command, capture_output=True, text=True, timeout=120)
            except subprocess.TimeoutExpired as exc:
                raise InputError("PDF render exceeded 120 seconds; lower DPI or extract the page") from exc
            if result.returncode:
                raise InputError(f"pdftoppm failed (page {page}): {result.stderr.strip()[:800]}")
            rendered = Path(prefix + ".png")
            if not rendered.is_file():
                raise InputError(f"pdftoppm produced no image for page {page}")
            with Image.open(rendered) as decoded:
                decoded.load()
                image = decoded.copy()
    else:
        if importlib.util.find_spec("pypdfium2") is None:
            raise InputError("PDF input needs pdftoppm on PATH or Python package pypdfium2")
        import pypdfium2 as pdfium
        try:
            document = pdfium.PdfDocument(str(path))
            try:
                if page > len(document):
                    raise InputError(f"PDF page {page} does not exist (document has {len(document)} pages)")
                pdf_page = document[page - 1]
                try:
                    bitmap = pdf_page.render(scale=dpi / 72.0)
                    try:
                        image = bitmap.to_pil().copy()
                    finally:
                        bitmap.close()
                finally:
                    pdf_page.close()
            finally:
                document.close()
        except InputError:
            raise
        except Exception as exc:
            raise InputError(f"PDFium failed to render page {page}: {exc}") from exc
    return image, backend


def load_image(path: Path, page: int, dpi: float, backend: str,
               crop: tuple[int, int, int, int] | None) -> tuple[Image.Image, dict]:
    with path.open("rb") as stream:
        pdf = path.suffix.lower() == ".pdf" or b"%PDF-" in stream.read(1024)
    if pdf:
        image, selected_backend = render_pdf(path, page, dpi, backend)
    else:
        if page != 1:
            raise InputError("--page options other than 1 apply only to PDF input")
        with Image.open(path) as decoded:
            if getattr(decoded, "n_frames", 1) != 1:
                raise InputError("multi-frame raster input is ambiguous; export the desired frame first")
            decoded.load()
            image = decoded.copy()
        selected_backend = "Pillow"
    image, normalization = normalize(image)
    crop_record = None
    if crop is not None:
        x, y, width, height = crop
        if x + width > image.width or y + height > image.height:
            raise InputError(f"crop {crop} exceeds {path.name} dimensions {image.size}")
        image = image.crop((x, y, x + width, y + height))
        crop_record = {"x": x, "y": y, "width": width, "height": height,
                       "coordinate_space": "normalized raster pixels; top-left origin"}
    return image, {
        "path": str(path), "sha256": sha256(path),
        "input_type": "pdf" if pdf else "raster", "page_1_based": page,
        "requested_dpi": dpi, "render_dpi": dpi if pdf else None,
        "renderer": selected_backend, "normalization": normalization,
        "crop": crop_record, "size_after_crop_px": list(image.size),
        "resize": None,
    }


def measure(reference: Image.Image, candidate: Image.Image, threshold: int) -> tuple[dict, Image.Image]:
    diff = ImageChops.difference(reference, candidate)
    stats = ImageStat.Stat(diff)
    channels = diff.split()
    maximum_delta = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
    histogram = maximum_delta.histogram()
    pixels = reference.width * reference.height
    changed = sum(histogram[threshold + 1:])
    return {
        "width_px": reference.width, "height_px": reference.height,
        "pixel_count": pixels, "channel_count": 3,
        "mae": sum(stats.sum) / (3 * pixels),
        "rmse": math.sqrt(sum(stats.sum2) / (3 * pixels)),
        "max_channel_delta": max(high for low, high in diff.getextrema()),
        "threshold": threshold,
        "threshold_rule": "pixel differs if any RGB channel absolute delta > threshold",
        "pixels_above_threshold": changed,
        "fraction_pixels_above_threshold": changed / pixels,
        "value_range": [0, 255],
    }, diff


def save_png(image: Image.Image, destination: Path) -> None:
    # Exclusive creation is a second safeguard against overwriting concurrent work.
    with destination.open("xb") as stream:
        image.save(stream, format="PNG")


def save_json(value: dict, destination: Path) -> None:
    with destination.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
        stream.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    render = subcommands.add_parser("render", help="render a raster/PDF page for inspection and crop measurement")
    render.add_argument("input", type=Path)
    render.add_argument("--page", type=positive_page, default=1, help="1-based PDF page (default: 1)")
    render.add_argument("--crop", type=crop_value, help="x,y,width,height in normalized raster pixels")
    compare = subcommands.add_parser("compare", help="compare equally sized images after explicit crops")
    compare.add_argument("reference", type=Path)
    compare.add_argument("candidate", type=Path)
    compare.add_argument("--reference-page", type=positive_page, default=1)
    compare.add_argument("--candidate-page", type=positive_page, default=1)
    compare.add_argument("--reference-crop", type=crop_value)
    compare.add_argument("--candidate-crop", type=crop_value)
    compare.add_argument("--resize-candidate", action="store_true",
                         help="explicitly resize candidate to reference size with Lanczos; may distort aspect ratio")
    compare.add_argument("--threshold", type=threshold_value, default=8,
                         help="RGB channel difference threshold, 0..255; strict greater-than (default: 8)")
    for command in (render, compare):
        command.add_argument("--out-dir", required=True, type=Path, help="new or empty output directory")
        command.add_argument("--dpi", type=dpi_value, default=144,
                             help="PDF rasterization DPI; raster inputs keep their pixel dimensions (default: 144)")
        command.add_argument("--pdf-backend", choices=("auto", "pdftoppm", "pdfium"), default="auto",
                             help="auto prefers installed pdftoppm, then pypdfium2")
    args = parser.parse_args()
    output = args.out_dir.expanduser().resolve()
    inputs = [args.input] if args.command == "render" else [args.reference, args.candidate]
    inputs = [path.expanduser().resolve() for path in inputs]
    try:
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        validate_paths(inputs, output)
        report = {
            "schema_version": 1, "command": args.command,
            "scope": "Visual raster comparison only; no scientific correctness, text accuracy, editability, or pass/fail judgment.",
            "color_policy": "8-bit RGB; alpha composited on white; EXIF orientation applied; embedded ICC profiles are not transformed.",
            "alignment": "none; only explicitly requested crop/resize operations",
        }
        if args.command == "render":
            rendered, metadata = load_image(inputs[0], args.page, args.dpi, args.pdf_backend, args.crop)
            report["input"] = metadata
            report["outputs"] = ["rendered.png", "render.json"]
            validate_paths(inputs, output)
            output.mkdir(parents=True, exist_ok=True)
            save_png(rendered, output / "rendered.png")
            save_json(report, output / "render.json")
        else:
            reference, reference_meta = load_image(inputs[0], args.reference_page, args.dpi,
                                                   args.pdf_backend, args.reference_crop)
            candidate, candidate_meta = load_image(inputs[1], args.candidate_page, args.dpi,
                                                   args.pdf_backend, args.candidate_crop)
            if args.resize_candidate:
                old_size = candidate.size
                if old_size != reference.size:
                    candidate = candidate.resize(reference.size, Image.Resampling.LANCZOS)
                candidate_meta["resize"] = {
                    "explicitly_requested": True, "applied": old_size != reference.size,
                    "from_size_px": list(old_size), "to_size_px": list(reference.size),
                    "filter": "Lanczos", "aspect_ratio_preserved": old_size[0] * reference.height == old_size[1] * reference.width,
                }
            if reference.size != candidate.size:
                raise InputError(f"dimensions differ: reference={reference.size}, candidate={candidate.size}; "
                                 "use explicit crops, re-export at matching size, or opt into --resize-candidate")
            metrics, diff = measure(reference, candidate, args.threshold)
            comparison = Image.new("RGB", (reference.width * 2, reference.height), "white")
            comparison.paste(reference, (0, 0))
            comparison.paste(candidate, (reference.width, 0))
            report.update({"reference": reference_meta, "candidate": candidate_meta, "metrics": metrics,
                           "outputs": ["reference.png", "candidate.png", "side-by-side.png", "overlay.png", "diff.png", "metrics.json"],
                           "visuals": {"side-by-side.png": "reference left, candidate right; no scaling or padding",
                                       "overlay.png": "50% reference + 50% candidate",
                                       "diff.png": "absolute RGB channel differences at original scale; black = identical"}})
            validate_paths(inputs, output)
            output.mkdir(parents=True, exist_ok=True)
            for name, visual in (("reference.png", reference), ("candidate.png", candidate),
                                 ("side-by-side.png", comparison), ("overlay.png", Image.blend(reference, candidate, 0.5)),
                                 ("diff.png", diff)):
                save_png(visual, output / name)
            save_json(report, output / "metrics.json")
        print(json.dumps({"output_directory": str(output), "files": report["outputs"]}, ensure_ascii=False))
        return 0
    except (InputError, OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError,
            Image.DecompressionBombWarning) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

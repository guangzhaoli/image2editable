# Visual comparison helper

`scripts/figure_compare.py` renders reference and reconstructed figures, then produces inspectable comparisons. Use it after exporting from the target editor. It requires Python 3.10+ and Pillow. PDF input additionally needs `pdftoppm` on PATH or `pypdfium2` in the same Python environment. No network service is used.

All output directories must be new or empty. Inputs must live outside the output directory. The script never overwrites existing files. Commands below assume the skill directory is the current working directory; otherwise use its absolute script path.

## Render first to measure crops

```sh
python3 scripts/figure_compare.py render paper.pdf \
  --page 3 --dpi 144 --out-dir work/paper-page-3
```

Open `rendered.png`, inspect the image, and measure the figure bounds. Coordinates are integer pixels from the top-left of the rasterized page, after EXIF orientation normalization for raster input. Crops use `x,y,width,height`, not two corner coordinates. Crops must stay fully inside the image. PDF page numbers are 1-based. `--dpi` determines PDF pixel size; it does not resample existing raster images. `render.json` records input hash, page, DPI, renderer, orientation, dimensions, and any crop.

## Compare an exported figure

```sh
python3 scripts/figure_compare.py compare reference.png exported.png \
  --out-dir work/comparison-01 --threshold 8
```

To compare selected regions of a PDF page and an exported PDF:

```sh
python3 scripts/figure_compare.py compare paper.pdf figure.pdf \
  --reference-page 3 --candidate-page 1 --dpi 144 \
  --reference-crop 120,240,900,420 \
  --candidate-crop 0,0,900,420 \
  --out-dir work/comparison-02
```

The crop numbers above are illustrative; measure actual files. Images must have equal dimensions after crops. Prefer matching the export size. If scaling is deliberate, add `--resize-candidate` to resize the candidate to the reference dimensions with Lanczos. This can change aspect ratio, hide scale differences, and affect metrics. The JSON records the original/new dimensions, filter, and whether aspect ratio was preserved. There is no automatic registration, whitespace trimming, crop discovery, or resizing.

PDF backend selection is recorded. `--pdf-backend pdftoppm` or `--pdf-backend pdfium` makes it explicit; `auto` prefers `pdftoppm`. Use the same renderer, DPI, and crops across revisions. Multi-frame rasters are rejected; export the intended frame first. Transparency is composited on white; all outputs use 8-bit RGB. Embedded ICC profiles are recorded but not transformed, so this is not a color-managed proofing tool.

## Inspect the outputs

| File | Meaning |
| --- | --- |
| `reference.png` | Reference after recorded normalization and crop |
| `candidate.png` | Candidate after recorded normalization, crop, and optional resize |
| `side-by-side.png` | Reference left, candidate right at identical pixel scale |
| `overlay.png` | 50/50 blend; doubled contours reveal displacement |
| `diff.png` | Absolute RGB differences, not amplified; black means identical |
| `metrics.json` | Provenance, every crop/resize, renderer/page/DPI, and metrics |

MAE and RMSE average over **all RGB channels** in units of 0–255. `max_channel_delta` is the largest absolute channel difference. `fraction_pixels_above_threshold` counts a pixel when **any channel difference is strictly greater than** `--threshold` (integer 0–255, default 8). A threshold of 0 counts all changed pixels; 255 counts none. No automatic quality pass/fail is assigned.

Inspect the comparison images as well as numbers. Empty margins can dominate the aggregate score, and a tiny changed label or arrow can be scientifically decisive. Antialiasing, missing fonts, font rasterizers, and color conversion can produce pixel differences without geometric differences. Evaluate panels separately with explicit crops when helpful. Verify labels, data, topology, layering, and native editability independently; raster similarity cannot certify those properties.

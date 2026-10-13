# Runtime and export guide

[English README](../README.md) · [中文 README](../README.zh-CN.md)

Image2Editable is a skill plus deterministic helpers. Its host supplies reasoning, image inspection/generation, source retrieval, and application control. Installing the folder does not install those services.

## Capability requirements

| Task | Requirement |
|---|---|
| Read and follow the workflow | An Agent Skills-capable host with local file access |
| Inspect references and papers | Image inspection and a suitable PDF/web reader |
| Generate or restyle bitmap targets | A working image-generation/editing tool in the host |
| Validate a drawing spec or export SVG | Node.js; Node 22+ recommended |
| Prepare image/text visual specs and raster comparisons | Python 3.10+ and Pillow; tested runtime versions are recorded in `release-manifest.json` |
| Render PDF inputs for comparison | `pdftoppm` or optional `pypdfium2` |
| Automatically export PPTX or PPTX component catalogs | Node.js, Python, and host-provided `@oai/artifact-tool` |
| Check native editability | The target application and an available native API or computer-use route |

The image tools and application integrations are not bundled. The Node-only SVG route is independent of the optional PPTX package. No npm installation command for `@oai/artifact-tool` is assumed.

## Install Python helper dependencies

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Use a suitable CJK font for Chinese diagnostic boards if your environment's fallback lacks Chinese glyphs. See the visual-spec builder's options.

## Check and render an executable spec

```bash
node skills/image2editable/scripts/render_figure.mjs \
  examples/renderer-demo/figure-spec.json --check

node skills/image2editable/scripts/render_figure.mjs \
  examples/renderer-demo/figure-spec.json \
  --out _build/svg-demo --format svg
```

Each output directory must be new. The included `examples/renderer-demo/rendered/` is a generated reference output. The SVG retains live text, paths, and named groups; font rendering still depends on the viewer.

For PPTX, first use your host's workspace-dependency discovery to locate its actual Node package and Python directories. The renderer accepts `--runtime-modules` and `--python`, or the corresponding `RUNTIME_NODE_MODULES` and `RUNTIME_PYTHON` environment variables. After those point to a compatible installed runtime:

```bash
node skills/image2editable/scripts/render_figure.mjs \
  examples/renderer-demo/figure-spec.json \
  --out _build/pptx-demo --format both
```

This generates native-object PPTX and a preview through the artifact runtime. Inspect the result in PowerPoint before claiming native application compatibility. Affinity/Illustrator users can import SVG, check the objects and fonts, and save in the native application.

## Build an image + text visual spec

The synthetic fixture is safe to run without fetching a paper or calling image generation:

```bash
python3 skills/image2editable/scripts/build_visual_spec.py \
  skills/image2editable/assets/visual-study.example.json \
  --out _build/visual-spec-demo
```

Open `_build/visual-spec-demo/visual-spec.html` locally. It contains the actual packaged reference image, region annotations, palette measurements, and text observations. This command prepares evidence; it does not make an image-generation call or infer the reference's scientific meaning.

The separate `prepare_imagegen_input.mjs` assembles a content plan, selected reference attachments, and prompt. Its output is a request payload and preparation report. The agent must then make and record the actual image-generation call. See the [input contract](../skills/image2editable/references/imagegen-input.md).

## Extract components and palettes

```bash
node skills/image2editable/scripts/build_library.mjs \
  examples/renderer-demo/figure-spec.json --out _build/library-demo
```

The default route creates SVG/JSON/ASE without the PPTX runtime. `--format both` adds PPTX catalog pages when that runtime is available. Extraction uses analyzed spec objects. It neither segments arbitrary photographs nor registers native application panels by itself.

## Runtime boundaries

- PNG generation does not create live text or native diagram objects.
- SVG placed in a PowerPoint slide can remain a single image; that is not native text/shape reconstruction.
- The automatic renderer does not write `.ai` or Affinity proprietary files directly.
- Fixed routes and detached component snapshots do not provide automatic Symbols/theme synchronization.
- Existing native edits must be preserved in a separate file; regeneration does not read them back.

## 中文要点

安装 skill 只安装指令和脚本，不附带生图模型、软件授权或应用控制工具。SVG/spec 检查仅需 Node；视觉 spec、取色与像素比较需要 Python 和 Pillow。自动 PPTX 导出另需宿主提供的 `@oai/artifact-tool`，通过运行时发现工具取得真实路径后再使用。原生可编辑性仍要在目标软件中检查，不能用导出成功代替。

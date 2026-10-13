# Sources and third-party notices

The MIT license covers this project's original code and documentation. The maintainers also make their original contributions to the included generated examples available under MIT to the extent they hold those rights. It does not relicense external research, reference designs, software, brands, or other third-party content.

## Included gallery

| Files | Origin and use |
|---|---|
| `assets/gallery/clip.png`, `clip-initial.png` | Generated conceptual explanations informed by [Radford et al., ICML 2021](https://proceedings.mlr.press/v139/radford21a.html). The car/dog/flower batch and dog label are illustrative, not reported CLIP outputs. The original paper and its Figure 1 are not bundled in this public release. |
| `assets/gallery/water-cycle.png` | Generated explainer informed by [USGS water-cycle material](https://www.usgs.gov/media/images/water-cycle-png). It shows selected natural processes and is not to scale. The official source PNG is not bundled here. |
| `assets/gallery/speaker.png` and images in `examples/style-study-speaker/` | Locally generated fictional product and style-reference studies from this project's development. No product brand, commercial specification, or real advertisement is claimed. |
| `assets/gallery/night-poster.png` | Generated fictional event poster. [NASA/JPL's Grand Tour poster](https://www.jpl.nasa.gov/images/the-grand-tour-jpl-travel-poster/) informed typography, scale contrast, and print-style organization. The original poster, logo, and source travel copy are not bundled. |
| `skills/image2editable/assets/visual-study-reference.png` | Authored synthetic diagnostic fixture used to exercise visual-spec preparation; not a paper result or real design reference. |
| `examples/renderer-demo/` | Authored synthetic renderer/library example; not a research figure. |

Generation used the host's built-in image tool. An image's inclusion does not imply endorsement from a cited institution, paper author, product vendor, or application developer.

## Workflow influences

[Editable Design](https://github.com/yejy53/Editable-Design) and other projects/papers informed workflow decisions. The skill's [design research notes](skills/image2editable/references/design-research.md) identify those influences and distinguish them from imported implementation. This package does not bundle Editable Design source code, prompt templates, or gallery assets.

The README's information order was studied from public project READMEs. Their text and visual identity were not copied into this project. The dated [README research notes](docs/readme-research.md) record the references.

## External tools and fonts

- `@oai/artifact-tool` is an optional host-provided dependency for automatic PPTX export. It is not redistributed by this repository.
- Image generation, computer-use tools, native applications, and fonts are supplied by the user's environment and retain their own terms.
- Font names in a spec do not bundle font files or prove that the font is installed.
- Links to third-party sources and optional runtimes do not make them part of the MIT-licensed code in this repository.

## 中文说明

MIT 适用于本项目的原创代码和文档；我们对所附生成示例拥有的原创贡献也按 MIT 提供。外部论文、参考图、运行时、软件和字体保留各自的许可条件。公开包不附带 CLIP 原论文、USGS 官方原图或 NASA/JPL 原始海报。科学案例属于带来源的解释性示意，产品与活动属于虚构概念，不代表相关机构、作者或厂商背书。

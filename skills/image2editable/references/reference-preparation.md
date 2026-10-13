# 取色、素材提取与原位描绘

目标是把“看图后猜测绘制”变成“原图上有坐标、有证据地重建”。原图、spec、色板和素材始终一同提供给绘制阶段。该路线尚未完成新的启用/不启用消融，不能沿用旧版消融结果宣称效果提高。

## 1. 保存可追溯的参考

优先保留用户给的原始文件。论文 PDF 先检查是否有矢量路径、live text 或嵌入图像。已有矢量直接复用；扫描页/截图才走描绘。

从 PDF 渲染或裁剪时记录页码、DPI、坐标、页面旋转和输入哈希。不要从聊天中缩小的预览或已经被界面调暗的底图取色。放大查看可以帮助判断，但插值放大不恢复真实细节。不要对科学图像做生成式补细节、锐化去噪后再声称忠实复刻。

## 2. 颜色如何提取

| 来源 | 方法 | 记录 |
| --- | --- | --- |
| 原始矢量 / 原生对象 | 在填充、描边或渐变面板读取实际值，保留色彩空间与透明度 | 原对象 ID、填充/描边/渐变 stops、RGB/CMYK/专色、profile |
| 平色栅格块 | 选择不含文字/边框的小区域，统计 RGB 众数；压缩噪声较大时比较中位数或多个区域 | 原图坐标、样本数、方法、HEX/RGB、主色占比和邻近颜色 |
| 渐变 / 半透明区域 | 多位置采样并检查背景与透明度，不能用一个 HEX 代表整块 | 采样位置、候选 stops、背景、透明度未知项 |

大面积颜色聚类可以提出候选色板，但每一种语义颜色仍需回到对应对象内部取样。不能把全图出现次数最多的几个颜色直接当完整设计系统；细箭头、图例或小图标可能只占极少像素。

截图的抗锯齿、压缩与色彩管理会产生邻近色。主色占比只表示样本区域的纯度，不是“原作者色号”的置信概率。源图存在 ICC 时先进行可追溯的色彩转换；无 profile 的 RGB 按 sRGB 假定时必须标明。

Affinity 的 Colour Picker 支持当前对象/全局采样和不同 Radius 的区域平均；向已有选中对象自动应用颜色是独立选项。使用时避免误改选中的正式对象。[官方吸管说明](https://affinity.help/designer2/English.lproj/pages/Tools/tools_clrpicker.html)。得到颜色后创建**文档色板**，不要改全局应用默认色板。[官方 Swatches 说明](https://affinity.help/designer2/English.lproj/pages/Panels/swatchesPanel.html)。

## 3. 素材如何提取

- **照片、显微图、热图、实验样本图：**优先提取源 PDF 中已有图像或用户源素材。Poppler `pdfimages -list paper.pdf` 可先盘点；`pdfimages -f 3 -l 3 -all paper.pdf work/assets/image` 可导出指定页嵌入图像。先以当前 `pdfimages -h` 核对参数。导出的图像可能受旋转、裁剪、软蒙版或多块拼接影响；资产不一定一一对应视觉 panel，必须回到原页核对。
- **只剩截图：**按明确 bbox 裁出原区域，不做自动补全。保存裁剪坐标和原始比例。边框、文字覆盖已成为像素时，无法通过裁剪恢复其下的内容。
- **矢量图标：**优先从矢量源复用；没有源时，单独裁一块作为描摹输入，使用 Image Trace 或钢笔/节点修形。
- **规则框、箭头、文字：**分别重建为原生对象，不把它们都作为位图素材保存。

每项素材标明 `use`：`preserve-raster`、`reuse-vector` 或 `trace-reference`。保留栅格是合适的科学内容表达方式，不能用“矢量对象数量更多”代替质量。裁出的不透明白底仍是白底；没有可靠 alpha 时不要假装已去背。

## 4. 建立一比一底图

1. 以参考像素坐标建立统一坐标系，例如 `465 × 660`、左上原点。需要版面毫米数时，另外记录像素到物理尺寸的比例；不能把 465 px 自动解释为 465 pt。
2. 用应用的置入/导入功能放入原图，设置数值 X/Y/W/H，保持纵横比。核对画布四角及至少两个结构锚点。若有旋转或透视，先明确参考本身是否需要校正，并保留变换记录。
3. 放在 `REFERENCE_DO_NOT_EXPORT` 层，**在应用内锁定**。可将底图显示透明度降至约 30–50% 帮助看线，具体按图调整；取色仍用未调暗的文件或色板。
4. 在上面创建重建组。需要辅助 bbox/中心线时放在 `GUIDES_DO_NOT_EXPORT`，与真正的重建对象分开。
5. 描绘时交替显隐、检查双影，或使用适用的描边预览；正常颜色检查不能一直在叠加状态下进行。

Illustrator 可使用 Layers 的 **Template、Lock、Dim Images to**；这些选项只帮助显示与组织，不免除导出时隐藏参考层的检查。[官方图层选项](https://helpx.adobe.com/ca/illustrator/desktop/manage-layers/create-and-organize-layers/set-layer-and-sub-layer-options.html)。Affinity 使用独立参考图层、锁定、不透明度及变换/吸附工具，按实际版本确认操作入口。

## 5. 原生工具的分工

| 内容 | 推荐工具 | 要核对的结果 |
| --- | --- | --- |
| 圆角框、圆、规则重复模块 | 原生形状、数值变换、复制、对齐/分布 | 中心、宽高、圆角、边界、重复间距 |
| 箭头和连接 | 钢笔/节点工具、直线段、描边和箭头头部 | 线中心、端口、方向、转弯控制点、残差拓扑 |
| 文字 | OCR/模型转录作为草稿，原生文字工具重排 | 原文、基线、字体真实样式、宽度、上下标 |
| 不规则扁平图标 | 区域 Image Trace 后清理，或钢笔描边 | 轮廓、孔洞、角点、节点数、是否误并对象 |
| 实验图像 | 原素材置入/裁剪 | 内容、比例、标尺和边界不变 |

**Illustrator：**Image Trace 提供有限色板或 Document Library、Paths、Corners、Noise、Fills/Strokes、Shapes、Auto Grouping 和 Expand。先在独立的裁剪副本上预览；确认结果后 Expand，再整理对象。Shapes 检测有形状与图像条件限制；自动分组不等于理解论文关系。[当前官方选项](https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/image-trace-panel-options.html)。

**新版 Affinity：**官方列出 Image Trace；2026 年 3 月还增加了将像素选区 Convert to Curves 的功能，可配合对象选择建立轮廓。只转换选区得到的是轮廓，不能据此恢复内部文字、箭头中心线或渐变。实际支持和参数以安装版本为准，不能把新版功能套到 Designer 2。[官方功能](https://www.affinity.studio/get-affinity) · [官方选区转曲说明](https://www.affinity.studio/blog/affinity-update-march-2026)。

不要给整张论文图套一个固定自动描摹预设。它容易把字形变成路径、描边变成双边轮廓、交叉线变成连通形状，并生成大量难以编辑的节点。用 spec 决定区域该保留、自动描摹还是原生重建，再在底图上校正。

## 6. 准备脚本

Python 3.10+、Pillow（含 ImageCms）。先把 PDF 页用现有 `figure_compare.py render` 渲染成参考 PNG；该脚本本身接受单帧栅格。

```sh
python3 scripts/prepare_reference.py reference.png --plan regions.json --out-dir work/reference-kit
```

`regions.json` 示例与对象约定见 [spec-contract.md](spec-contract.md)。输出目录须为新目录或空目录。

输出包括：`reference.png`（记录了色彩处理的未调暗参考）、`palette.json/png/svg`、`sample-locations.png`、`assets.json` 与资产裁剪、`reference-measurements.json`、嵌入原图的 `trace-board.svg`。`--color-policy srgb` 为默认；有 profile 则通过 CMS 转换，无 profile 的 RGB 会记录 sRGB 假定；`raw` 仅用于明确需要原通道值的情况。取色采用明确区域内的 RGB 众数，输出前五种颜色和频率，不自动剔除文字或识别渐变。

v2.1 将准备记录命名为 `reference-measurements.json`，避免和完整的可执行 `figure-spec.json` 混淆。旧版准备文件仍可作为测量证据，按 [统一 spec 渲染](spec-renderer.md) 映射并补全后使用；不要仅修改 schema 字符串。

准备板中 SVG 分组名称不是应用锁定属性；导入后仍需锁参考层。空的重建组可能被应用忽略，应在应用中创建正式重建组。准备板内有整张参考位图，不能将它作为“已完成复刻”导出。

## 7. 描绘后的验收

隐藏参考层与辅助线，独立导出，再按 spec 核对对象、文字与关系。先比较各区域与坐标锚点，再看整体像素指标，不能通过移动或拉伸整个结果来掩盖局部错误。抽查文字与路径的实际编辑；证明“一比一几何对齐”与证明“可编辑”分别需要证据。

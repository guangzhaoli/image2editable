# 组件库与配色列表

此模式用于从图形中整理可复制的模块、图标、连线、文字样式和配色。输入是已完成分析的 `paper-figure-spec/v1`，不是任意 PNG 的自动对象识别器。保留 v2 的原图、取样框与素材证据。对原生文件，可先读取实际对象和样式；对截图，先按主流程建立和核对 spec，再运行提取器。

## 创建

```sh
node scripts/build_library.mjs figure-spec.json --out work/library-01
node scripts/build_library.mjs figure-spec.json --recipe selections.json --out work/library-02 --format both --runtime-modules /actual/node_modules --python /actual/python3
```

默认只输出 SVG/JSON/ASE；`--format both` 增加一份多页原生对象 `library.pptx` 和逐页 PNG。运行时通过 workspace dependency 工具发现，沿用 [统一 spec 渲染](spec-renderer.md)。输出目录必须尚不存在，保护手工编辑过的组件。

不提供 recipe 时，以场景顶层分组和未归组对象为组件候选，连接作为独立类别。顶层整图大组不会被擅自猜拆。需按语义挑选模块时，给出选择文件，例如：

```json
{"components":[
  {"id":"attention","name":"Attention module","roots":["encoder-attention-group"],"category":"module"},
  {"id":"residual","name":"Residual route","roots":["residual-connection"],"category":"connection"}
]}
```

`roots` 必须是真实对象、组或连接 ID。同一组件内部不能同时选择祖先和后代，也不能重复选择同一个 root。允许不同组件有意复用共同对象。recipe 中的名称与分类由本次图的语义确定，不用论文专属 ID 限制其他图。

## 输出与编辑

- `components/*.svg`：每个独立组件的文字、形状和组。画布无额外背景矩形，便于置入其他底色；组件本身的背景形状保留。
- `specs/*.json`：每个组件及目录页的可执行 spec。组件坐标转为局部原点，锚定文字先求出位置，描边边界留出空间，旋转文字按可见外接框计入画布；必要图片复制到共享 `specs/assets/` 并保留 SHA256。
- `boards/*.svg`：分页的组件清单、配色列表和文字样式页；样例是实际矢量/文字对象，可以选中和复制。
- `library.pptx`：相同目录内容的多页 PPTX，样例为命名原生分组、文字、形状和自由路径；位图素材保留为局部图片。
- `library.json`：来源哈希、组件指纹、来源 ID/位置、实例数量、分组和文件清单。
- `palette.json`：每个源 token 的 HEX、RGB、取样/设计依据、具体使用对象与字段（含 `fill.stops[i].color` 渐变色标）、同色异名 token。未使用的 token 也保留并显示零次使用。
- `text-styles.json`：字体候选、字号、行距、字重、对齐与颜色的组合，以及使用它的文字对象；显式 rotation 也记录在样式中。
- `palette.ase`：Adobe Swatch Exchange 的普通 RGB 色样，供支持 ASE 的软件导入；不是已注册的原生面板，也不建立全局色绑定。

清单页上的组件按比例缩放以适应样例区；原尺寸在旁边标注，独立组件 SVG/spec 保留原尺寸。过长名称或证据在可见页中缩略，完整内容保留在 JSON。文字样式样例超出行高时缩小展示，但旁边仍标注原始值。字体是否正确替换需实际应用验收。

修改导出的独立组件 spec 后，用 `node scripts/render_figure.mjs edited-component.json --out work/component-edited --format svg --transparent-svg` 保持 SVG 画布透明。普通整图渲染默认保留声明的画布底色；这个显式选项仅移除 SVG 的额外画布矩形，不删除组件自身的填充，也不改变 PPTX 的页面背景。也可重新运行 `build_library.mjs`，其独立组件 SVG 始终使用透明画布。

## 渐变与旋转的提取、复用

提取器保留 [统一 spec 的线性渐变与旋转契约](spec-renderer.md#线性渐变与旋转文字)。渐变只支持 `0/90/180/270` 四个方向；每个色标的颜色分别进入配色使用清单。独立组件会重建自己的 palette token，并重写每个色标的引用；置入目录页或通过 `placeComponent` 复用时，每个色标继续按新前缀映射，保留色标位置和渐变方向。SVG/PPTX 样例仍是矢量渐变/原生渐变填充，不是渐变截图。ASE 保存这些颜色的普通 RGB 色样，不保存渐变预设或全局联动。

旋转文字保留 `rotation` 和旋转前文本框；组件画布及留白由旋转后的可见边界决定。局部归一后，旋转前 bbox 的 x/y 可以是负值，只要其旋转后的可见框位于组件画布内；不要为消除负值而改写文字几何。复制、平移或同比例缩放组件时，文字角度不变。文字样式页以水平样例展示字形，源旋转角度另行标注；完整组件保留实际旋转。

## 去重与关系边界

去重比较局部几何、文字、样式、分组顺序及素材内容，忽略源 ID 和整体平移；只为消除浮点误差，在几何指纹中使用 0.000001 px 数值精度。发出的组件几何不因此修改。标签、颜色、尺寸或布局不同的变体分别保留；渐变的方向、色标位置/颜色及文字旋转角度也参与指纹，不能在去重时丢失。不能用“长得差不多”自动合并具有不同含义的模块。

每个去重项保存所有源实例及出现次数。提取范围之外的箭头不会被自动带入或补造。已选择的连接会成为独立的固定路径与箭头分组，保留其外观；脱离原场景后不会继续绑定原来的外部模块。

当前组件是可编辑快照。复制之后的实例彼此独立；原生应用手改不会回写 spec。需要更改所有组件的源样式时，修改源 spec 并生成一个新库。不要声称已经建立 Symbols 实例同步、主题绑定或双向回写。

## 三种软件

**Affinity：**打开目录 SVG 或独立组件 SVG，检查对象与文字并保存本机原生文件。可以把选中组加入 Assets，将 ASE 导入文档 Swatches。需要实例联动时另建 Symbols 并实测修改传播。Assets、Symbols 和色板面板的入口按实际版本确认；没有操作和检查过的步骤标为未完成。[Assets](https://affinity.help/designer2/en-US.lproj/pages/Panels/assetsPanel.html) / [Swatches 与 ASE 导入](https://affinity.help/designer2/en-US.lproj/pages/Panels/swatchesPanel.html)。

**Illustrator：**打开 SVG 检查后保存 `.ai`；可把组注册为 Symbols、把 ASE 作为色板库载入。需要改色联动时将对象实际绑定到全局色；载入色板不等于完成绑定。复杂公式若是路径，仍不具备文字编辑语义。[Symbols](https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/create-and-place-symbols.html) / [Swatches](https://helpx.adobe.com/illustrator/desktop/manage-colors/use-swatches/about-swatches.html)。

**PowerPoint：**直接打开 `library.pptx`，目录即组件页、色板页和文字样式页。通过选择窗格定位 `sample-*` 命名组，复制到目标幻灯片后修改。这里纯色和渐变色标使用明确的 RGB，尚未映射主题槽；不会随主题自动变化。ASE 不作为 PowerPoint 色板格式。按需要再建立真正的主题映射。[选择窗格](https://support.microsoft.com/en-us/powerpoint/select-individual-objects-on-a-slide)。

## 验证

运行 `node scripts/test_library_core.mjs` 检查提取、去重、独立坐标、资产和来源记录。PPTX 生成后沿用 Presentations finalizer 和 `pptx_inspect.py`，渲染逐页查看，避免名字、色号或样例裁切。

软件内验收应取一个组件：复制到新工程或新页面、修改标签、换色、保存重开。再检查一项配色的实际 RGB。如果注册了原生库，则额外验证列表存在、拖入可用，以及确实支持的联动行为。文件工具预览和 ZIP/XML 盘点不能替代这些步骤。

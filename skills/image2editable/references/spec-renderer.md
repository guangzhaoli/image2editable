# spec 作为统一绘图输入

`figure-spec.json → 校验 / 解析 → SVG 或原生对象 PPTX → 目标应用验收`。

保留 v2 的取色、素材提取和锁定底图策略。改变的是数据流：绘图程序不再根据文字描述猜布局，也不再先硬编码绘图、最后补写 spec。所有图形参数来自同一 JSON。生成的 `resolved-scene.json` 是检查用的派生文件，不是第二份可手改的输入。

## 执行

先使用已有工具定位 Node；SVG 和校验只依赖 Node 标准库。PPTX 额外需要 `@oai/artifact-tool` 和 Python 3 标准库，在 Codex 桌面使用 workspace dependency 工具发现实际运行时，别把某台机器的路径写进技能。

```sh
node scripts/render_figure.mjs figure-spec.json --check
node scripts/render_figure.mjs figure-spec.json --out work/render-01 --format svg
node scripts/render_figure.mjs figure-spec.json --out work/render-02 --format pptx --runtime-modules /actual/node_modules
node scripts/render_figure.mjs figure-spec.json --out work/render-03 --format both --runtime-modules /actual/node_modules --python /actual/python3
```

`--out` 必须是尚不存在的目录，保护已在应用里编辑的工程。每次改 spec 后输出到新目录。输入不完整或任一后端失败时不交付部分生成结果；错误应修回输入或运行时。PPTX 工具链按可用 Presentations 技能完成其要求的最终文件验证，不把这个生成器的重导入检查当作全部验收。

输出含所选 `figure.svg` / `figure.pptx`、派生场景、源 spec SHA256 与每个输出的哈希。PPTX 另有从该文件重新导入的 `figure.pptx.png`；它明确是文件工具渲染，不是 PowerPoint 原生导出。SVG 用于导入 Affinity/Illustrator，再检查和保存原生工程。

先读可直接运行的 [合成示例](../assets/example-spec.json)。它用于演示格式和测试，不代表真实论文复刻质量。

## 输入契约：paper-figure-spec/v1

程序会拒绝未知字段，避免拼错字段后被静默忽略。可选说明写入指定的 `notes` 或 `evidence`；不能临时发明绘图字段。

| 字段 | 内容 |
| --- | --- |
| `schema`, `state` | 固定 `paper-figure-spec/v1`、`ready`。准备状态、旧版测量记录不能直接执行。 |
| `canvas` | `width`, `height`, `unit: px96`, `background` 色板 token。左上原点，尺寸和字号均为 96 DPI CSS px。 |
| `provenance` | `kind: measured/synthetic`, `source`；真实测量必须有参考文件 `sha256`。可记录 `page`、`crop`、`reference_to_canvas`、`notes`。 |
| `palette` | token → `{hex: "#RRGGBB", evidence: "来源、取样框、统计方法或明确的设计修改"}`。所有绘图颜色均引用 token；有透明填充需求时形状可用 `none`。 |
| `fonts` | token → `{family, evidence, native_verified}`。`native_verified` 为可选布尔值，只在实际验证后置真。字号放在文字对象上。 |
| `assets` | 列表：`id`, `file`, `sha256`, `role: content/reference`, `source`；可有 `crop`, `notes`。文件为 spec 所在目录下的相对 PNG/JPEG，禁止目录外路径；逐字节验哈希。`reference` 不能作为成图对象。 |
| `objects` | 可编辑对象列表。稳定 `id`、`type`、`bbox: [x,y,w,h]`、`evidence`；可有 `z` 与 `anchor: {object: id}`。 |
| `connections` | `id`, `source/target: {object,port,offset?}`, `stroke`, `evidence`；可有 `waypoints`, `arrow`, `arrowLength`, `arrowWidth`, `z`。 |
| `groups` | `{id, children: [id,...], z}`；可嵌套。每个成员只允许一个组父节点，不接受循环或未定义成员。 |
| `curveTolerance` | PPTX 曲线线段化的几何容差（px），默认 0.15，可取 0.001–2。SVG 保留原始二次/三次贝塞尔曲线。 |

对象、连接、组 ID 在同一命名空间且以字母开头，只含字母、数字、`_`、`-`。绘制顺序由每层 `z` 决定，数值小在后；同值按 ID 排序。组作为整体排序，不能与组外对象交错。连接自动生成 `id__line` / `id__start` / `id__end` 子对象，不能和自定义 ID 冲突。

`anchor` 存在时，bbox 的 x/y 是相对被引用对象左上角的偏移；尺寸仍为绝对 px。不自动改变对象尺寸。标签可以锚在模块上，移动模块后标签一同移动。锚点链允许多级，禁止循环。

### 对象字段

| type | 专属字段 |
| --- | --- |
| `rect`, `ellipse` | `fill` token、`none` 或下述线性渐变对象；可选 `stroke: {color: token, width: px, dash: solid/dashed/dotted}`。 |
| `roundrect` | 同上，加 `radius`（px，不能大于较小边的一半）。 |
| `text` | `text`, `font` token, `size`, `color` token；可有 `lineHeight`（px）、`align: left/center/right`、`valign: top/middle/bottom`、`bold`, `italic`、`rotation`（顺时针角度，默认 0）。用换行明确分行，禁止自动缩小。 |
| `path` | `commands` 列表，局部 bbox 坐标：`["M",x,y]`, `["L",x,y]`, `["Q",cx,cy,x,y]`, `["C",c1x,c1y,c2x,c2y,x,y]`, `["Z"]`；同样有 fill/stroke。控制点须包含在声明 bbox 内。 |
| `image` | `asset` ID，`fit: contain/cover`。保留真实科学素材；不能插整图作为唯一成品。 |

### 线性渐变与旋转文字

`rect`、`roundrect`、`ellipse` 和 `path` 的 `fill` 可使用原生线性渐变。颜色仍引用 `palette` token；例如先登记 `blue-light` 和 `blue-deep`，再使用：

```json
{"fill":{"type":"linear-gradient","angle":90,"stops":[
  {"offset":0,"color":"blue-light"},
  {"offset":1,"color":"blue-deep"}
]}}
```

只支持四个方向：`0` 左→右、`90` 上→下、`180` 右→左、`270` 下→上；省略 `angle` 时为 `0`。至少两个色标，`offset` 在 `[0,1]` 内严格递增，首尾必须为 `0` 和 `1`。SVG 输出真正的线性渐变，PPTX 输出可编辑的原生渐变填充，不转成图片。当前不支持其他渐变角度、径向渐变或透明色标；文字、描边和画布底色仍使用原有纯色色板 token。

文字的 `rotation` 为有限角度数值，正值顺时针，围绕声明 `bbox` 的中心旋转，并归一到 `[0,360)`。`bbox` 始终描述**旋转前的文本框**；不要把旋转后的外接框写回它。SVG 使用中心旋转，PPTX 保留带原生旋转的 live text。编译器用旋转后的文本框外接矩形检查画布边界及计算组边界，因此靠边的竖排标签可使用超出画布的旋转前文本框，只要旋转后的框完整留在画布内。`visualBbox` 是派生场景字段，不能写入源 spec。未指定这些新字段时保留原有行为。

字体排版引擎不同，不能保证 SVG 与 PPTX 的字宽和基线逐像素一致。当前格式用普通 live text；混排上/下标可拆成明确定位的文字对象和分组。原生公式、富文本 run、滤镜、任意仿射变换、上述范围之外的渐变和真实数据图表仍不在该渲染器范围，不能靠未支持字段假装完成。按具体需求扩展契约与两端实现，或明确保留人工原生编辑范围。

### 关系与路线

端口为 `left/right/top/bottom/center`。四个边端口可加 `offset: 0..1`：`top/bottom` 从左向右计，`left/right` 从上向下计，默认 `0.5` 保持原来的中点。`center` 固定为中心，不能提供 `offset`。例如 `target: {"object":"shared-module","port":"bottom","offset":0.75}` 接到该模块下边缘的四分之三处。若端点对象是旋转文字，端口也随文本框旋转。路线从源端口开始，经 `waypoints: [[x,y],...]` 的绝对坐标到目标端口；未给拐点时为直线。箭头 `none/start/end/both` 默认 end，长/宽默认 8/6 px。

端点在每次生成时从对象位置计算。路线在 SVG 为分组路径，在 PPTX 为命名的原生自由路径及箭头分组；不会变成图片。**应用中直接拖动模块不会自动重算这类固定路径，改 spec 后重新生成会。** 需要应用内自动连接线时按 PowerPoint 分支在工程副本中建立并验证，明确其与 spec 的同步边界。

## 可选的路线—标签交叉检查

```sh
node scripts/check_route_labels.mjs figure-spec.json --out work/route-labels.json
```

此脚本通过 `spec_core` 解析现有 spec，只比较 canonical `connections` 的直线/折线路径与无关 live-text 文本框。文本框按旋转处理，路线包络包含半个描边宽度；可用 `--clearance PX` 增加检查余量，默认 `0`。报告给出 connection/text ID、从 `0` 开始的段号、段端点及候选交叉坐标。它不修改 spec 或渲染结果，也不自动排版。

仅排除显式 anchor 链上的源/目标标签，或与端点同属直接分组且文本框完全位于端点内的标签；排除理由仍写入报告。确需例外时，`--exceptions pairs.json` 接受精确的 `[{"connectionId":"...","textId":"...","reason":"具体理由","evidence":"复核依据"}]`，不接受通配符或空理由/依据。例外属于声明的复核结论，不由脚本证明。

这是候选警告，不是可读性验收：框内留白、虚线空隙、遮挡和字体实际像素均可能影响结果；箭头头部、图片内文字及独立 `path` 路线不在检查范围，独立曲线会明确列为 `unknown`。`no-candidates` 只表示已检查范围没有候选，不能当作全图通过。成功生成警告/unknown 报告时退出码仍为 `0`，非法输入为 `2`；输出 JSON 必须是新文件。

## 从 v2 迁移

1. 旧 `prepare_reference.py` 的 `paper-figure-replica.spec.v2` 是准备记录；v2.1 改名为 `reference-measurements.json`。保留它以及取样框、颜色分布、素材清单。
2. 把画布映射到 `canvas`，颜色和字体登记为 token，资产路径放在 spec 目录内并填 SHA256。
3. 把 `bbox_px` 映射为 `bbox`，`rounded-rectangle` 映射为 `roundrect`，`fill_token` 映射为 `fill`。文本需补齐实际 bbox、字号和字体；仅有候选字体/部分基线的记录还不能执行。
4. 将 `source/target` 对象 ID 与旧 `top-center` 等端口映射到新端点对象；显式路线去掉已由端口推导的首尾点，保留中间拐点。
5. 补齐缺失的目标对象、分组和素材，执行 `--check`。不能只改 schema 字符串掩盖未解析的对象或未知值。

自动生成没有改善错误测量的能力。仍要把候选与原图叠合，修改对应 ID 或 token，再生成到新目录。原生软件手改的内容不会回读进 JSON；先把接受的修改同步到 spec，或将原生工程明确作为后续唯一来源。

## 维护验证

`node scripts/test_spec_renderer.mjs` 检查重放、单处编辑的依赖更新、坐标/ID/拓扑错误、素材哈希与目录边界、底图排除以及曲线容差。需要验证 PPTX 后端时设置真实 `RUNTIME_NODE_MODULES` 并加 `--pptx`；它实际生成文件、检查原生文字/分组/EMU 坐标及未改对象、并验证本地图片路径。PPTX 的随机 creation GUID 与 ZIP 时间戳不承诺逐字节重复，比较稳定几何与内容。以上测试均不替代目标应用实测。

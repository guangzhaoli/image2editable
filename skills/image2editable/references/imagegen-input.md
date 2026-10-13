# 将前三步的成果一起交给 ImageGen

用于需要调用 ImageGen 的自主设计或图像修订。把需求、核对过的内容关系和参考观察汇合成一次明确输入，必要时附上实际图像；沿用用户已接受的决定。忠实复刻、组件提取、简单直接矢量图和已有工程局部修改继续走原分支，不为它们强制新增整图生成。

## 组织输入

- **需求：**从 `design-plan.brief` 取得用途、受众、语言、画布比例/最终物理尺寸、目标软件与已接受范围。缺失印刷规格可采用说明过的工作尺寸，不让组装程序猜测单位。
- **内容：**按已有 claim/node/relation ID 选择本图需要的事实、对象和方向。准确标签、数字、训练/推理状态以及有用的原文/图注一起提供。`proposed` 保持设想/示意身份；未确定项保留。需在后续原生重建加入的细节可以明确延后并写理由，不能悄悄删掉必需事实。内容来源保持可定位，生成器不负责重新读论文或验证引文。
- **视觉参考：**从实际查看的成品中选少量有用图像，说明各自的观察、应用区域和借鉴边界。记录原始来源、论文版本/页码/图号与本地派生关系。必要时用清楚标注的局部裁切减少无关信息。不要原样塞入整篇 PDF、全部搜索结果或不相关旧工程。
- **本次设计：**给出视觉重点、关键对象的表示方式、区域优先级、颜色含义、文字层级和编辑粒度。保留布局探索空间，不在生图前强制列完最终坐标。原生重建仍由 `figure-spec.json` 唯一驱动。

精确文字和科学摘要比参考图中的文字优先；内容与 style 冲突时先修正/排除冲突。图像中的观测事实、生成示意和实验结果分别说明。视觉稿中的数字与科学关系需要后续核对，不能回写为内容依据。

## 逐张限定作用，并实际附图

每份参考用一个主角色：

| role | 用途 | 必须写清 |
| --- | --- | --- |
| `content` | 当前对象、方法、样例身份的内容参考 | 依据哪处内容；需保留的对应关系；是否只参考科学含义、允许重新设计布局。 |
| `style` | 构图、密度、表示、字体层级或光色参考 | 学习哪个规律并用在哪；不借用的算法、结果、标签、商标或独特元素。 |
| `edit-target` | 这轮真正要修改的图像 | 修改范围与必须保持的部分；不把其放在可自由变化的风格图位置。 |

同图有多个用途时，把作用明确分开描述；必要时裁切或只选一个主角色。style 图不能支持论文事实。此前被用户排除的工程/构图不进入输入包；目标论文的原始科学资源可按用户范围使用。

查看可用参考图后，按当前工具参数真的附上它们。所有目标/参考都是本地文件时，使用 `referenced_image_paths`，顺序与提示词里的 Image 1、Image 2 完全一致；PDF 先渲染/裁切成可辨认图像。有会话图片没有本地路径时，按当前工具的 `num_last_images_to_include` 规则处理，并重新核对实际包含的图片；不同时传两种机制。普通无参考的新生成省略两者。当前工具约定优先，不借此改走 CLI 或添加不存在的工具参数。

参考记录的 `delivery` 为 `attach` / `text-only` / `exclude`。前者要有本地文件、哈希与实际查看说明；`text-only` 写具体观察和无法附图原因；`exclude` 写排除原因。URL/文件路径文字只提供出处，不算图像输入。可选参考不可用时明确降级并重新组装索引；必需的编辑目标或需要保持身份的主体不可用时，保留依赖缺口，不静默换成虚构素材。排除的图片不会进入 prompt 或工具列表。

## 轻量侧车与组装

使用 `imagegen-input/v1` 侧车选取已有计划，不复制另一套事实/绘图模型。示例 [imagegen-input.example.json](../assets/imagegen-input.example.json) 是明确标注的无附图合成例，和已有设计计划示例一起运行。

```json
{
  "schema": "imagegen-input/v1",
  "designPlan": "design-plan.json",
  "useCase": "scientific-educational",
  "selection": {
    "claimIds": ["claim-id"],
    "nodeIds": ["node-id"],
    "relationIds": [],
    "deferredClaims": []
  },
  "designBrief": {
    "request": "本次完整视觉目标",
    "composition": ["重点与布局规律"],
    "style": "视觉语言",
    "palette": "颜色及其含义",
    "exactText": ["必须准确的标签"],
    "constraints": ["内容与素材边界"]
  },
  "references": [{
    "id": "ref-id", "sourceId": "source-id", "locator": "v2 p.5 Figure 2",
    "role": "content", "delivery": "attach", "path": "refs/method.png",
    "sha256": "实际文件哈希", "inspected": true,
    "inspectionNote": "实际查看的内容", "use": "提供准确关系，重新设计布局"
  }]
}
```

`designPlan` 和图片路径相对侧车所在目录（也支持真实本地绝对路径）。`selection` 可省略，默认选计划中的全部内容；显式选择时，关系端点与 claimRefs 需同时选入。`deferredClaims` 为 `{claimId,reason}` 数组，必需事实未选入时需说明在 caption/原生重建等处如何保留。`excerpts` 可补 `{sourceId,locator,text}` 的相关原文/图注。style 参考额外填写 `avoidCopy` 字符串；edit-target 填写 `preserve` 字符串并实际附图。`text-only` / `exclude` 填写 `reason`。无编辑目标时 `transparentBackground` 默认 false；有编辑目标则需显式设置，依据现有 alpha 状态保留透明度，用户要求更改时才改变。`designPlanSha256` 可锁定计划版本，未设置时组装报告记录当前实际哈希。

```sh
node scripts/prepare_imagegen_input.mjs imagegen-input.json --out NEW_DIRECTORY
```

工具只读取本地记录与文件，生成：

- `visual-prompt.txt`：需求、事实、关系、相关摘录、观察与逐张附图作用组成的提示词。
- `imagegen-request.json`：当前内置工具的 prompt / transparent_background / referenced_image_paths 参数。最后一项仅在有真实附图时出现。
- `input-report.json`：计划/侧车/图片哈希、有序图片列表、未附/排除参考、延后事实和检查边界，状态为 `prepared`。

脚本验证引用、文件、图像格式标识和哈希，并拒绝覆盖已有目录；不联网、不读懂论文、不生图、不自动认证 `inspected` 声明，也不检查图像像素是否完整可解码。组装结果交给当前内置工具执行，实际调用前重新核对文件仍是检查过的版本。不能据 `prepared` 声称 ImageGen 已收到图片。

## 可选的图文混合视觉 spec

用户给参考来学习风格、配色或布局时，依 [参考风格适配](reference-style.md) 构建 `visual-spec.json`、配套HTML与实际素材。在现有侧车加入 `visualSpec: "viz/visual-spec.json"`，可用 `visualSpecSha256` 锁定该文件版本。不要把HTML或诊断板路径放在此字段。

组装器读取图文spec里的参考学习记录、色板用途和保持项，与已有references按ID合并：同ID的角色/路径/哈希/说明一致则只传一份，冲突会报错。参考sourceId必须在design-plan.sources登记；style仍不能支持事实。实际附图是spec中选定的原图或裁切，edit-target继续先排列，显式设置transparentBackground。查看用的HTML/诊断板不自动作为生成图片，以免模糊各图片角色。

该字段缺省时保持v4.2原有提示词和参数。只在使用时增加风格适配内容及report.visualSpec；图片准备、实际调用和看图验收仍分别记录。机器记录的字体/布局观察属于模型或作者判断，图文打包成功不代表参考风格一定已执行。

## 调用后核对并接入重建

保存本次实际调用的完整参数与返回结果、选定输出路径/哈希；在计划的 `design.generationInput` 记录侧车/组装结果与调用证据。实际参数若有改动，重新组装或记录差异，确保有序图像列表与 Image 编号相符。无需为这一记录增加用户审批。

查看全图与关键局部：必需事实是否覆盖或已明确延后；各参考是否只影响指定范围；是否混入其他方法的模块/结果；真实样例与生成示意是否分清；文字与数值待重建项是否列出。修正后保留选定目标，并按已有 spec / 素材 / 原生对象流程重建。局部生图修订使用当前目标与必要参考、沿用事实和不变项，避免为小改动重新传全部历史材料。

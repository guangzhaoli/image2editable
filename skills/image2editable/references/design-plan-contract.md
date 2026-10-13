# 设计计划与审查记录

这两个记录保留科学内容、设计决策与验收证据；不替代可执行 `figure-spec.json`。模型根据内容和构图生成spec，`design_audit.mjs`做可确定的对应检查，不调用模型、不上网、不判断引文是否真实支持事实。

## design-plan/v1

| 字段 | 必需内容 |
| --- | --- |
| `schema`, `kind` | `design-plan/v1`；`framework` / `poster` / `graphic`。 |
| `brief` | `goal`, `audience`, `targetApps` 数组。可以补充实际物理尺寸、语言、已接受范围等描述。 |
| `sources` | `{id,title,uri,role,kind}` 数组。role是 `content` / `style`，kind是 `paper` / `user` / `data`。本地文件或用户brief也要有明确来源标识。 |
| `claims` | `{id,text,status,sourceRefs,required}`，至少一项。status是 `supported` / `user-provided` / `proposed`。sourceRefs为 `{sourceId,locator}`。supported/user-provided必须有内容来源与具体位置；proposed可无引文，但不能写成已证实的论文结果。 |
| `structure` | `nodes: [{id,label,claimRefs,requiresLiveLabel?}]` 与 `relations: [{id,source,target,type,claimRefs,bidirectional?}]`。至少有一个节点，关系可空；poster节点可对应内容区域或主要图形。bidirectional默认false，双向关系须显式为true。 |
| `references` | `{sourceId,figure,inspected,lessons,avoidCopy}`。lessons和avoidCopy为字符串数组；明确看过的图与只检索到的文献的区别。没有参考时保留空数组并说明原因。 |
| `design` | `alternatives: [{id,description}]`、`chosen`、`rationale`。实际考虑过的构图方案；至少一项，不虚构选择过程。 |
| `bindings.nodes` | `{nodeId,shapeId,objectIds}`。shapeId为实际spec对象；objectIds含与该节点对应的文字/图形，默认需live text标签。标签可缩写。无文字插画或符号可在结构节点明确设requiresLiveLabel:false；仍需语义label和有效对象绑定，并提示人工审查。 |
| `bindings.relations` | `{relationId,connectionId}`。连接必须指向两个节点绑定的shapeId；普通关系须arrow:end，显式双向关系须arrow:both，防止额外反向箭头混入。未绑定的spec连接会提示审阅其是否为装饰/图例或遗漏关系。 |
| `bindings.claims` | `{claimId,objectIds}`。标为required的事实都需有图上对应对象。此绑定证明覆盖声明，不证明文字内容正确。 |
| `unknowns` | 未解决信息的字符串数组，可空。明确省略或仍待确认的科学细节。 |

ID在各自命名空间唯一，以字母开头并仅含字母、数字、下划线和连字符。允许补充描述字段，但执行检查的字段以上表为准；`figure-spec.json`仍按其自身严格契约拒绝未知绘图字段。

### 丰富设计的补充记录

依 [自主设计流程](autonomous-design.md) 需要完整视觉目标时，把以下信息留在现有计划中，而非另建一套绘图模型。这些是供实际审查使用的描述字段，当前 `design_audit` 不验证其视觉质量：

- `brief`：最终宽高和物理单位、用途/阅读距离、按文字角色设定的最终字号，以及已有的用户选择和授权范围。没有已有用户选择时由任务范围作正常设计判断，不把此记录当审批表。
- `design.visualTarget`：选定全图草稿/参考的路径与哈希、来源性质、选择依据、实际查看后的语义与视觉问题。指出已接受的构图范围和必须纠正的科学错误。
- `design.generationInput`：本次 [生成输入包](imagegen-input.md) 路径/哈希、关联计划版本、组装后的提示词和有序图像输入。侧车复用已有事实/节点/关系 ID，明确未附参考与原因。组装报告状态为 `prepared`；实际调用后另存调用参数、结果与选定输出，才能声明 `called`。当前 `design_audit` 不检查这份侧车或认证工具调用。
- `design.visualSpec`（按需）：[图文混合视觉spec](reference-style.md) 的JSON、HTML、诊断板路径与实际哈希，所用参考、作用区域及保持项。它保存参考学习与视觉适配证据，不是另一套最终绘图坐标。生成侧车用 `visualSpec` 指向该JSON；人读页面、程序读记录，实际附图仍为选定原图/裁切。当前 `design_audit` 不认证这些视觉观察。
- `design.reconstructionNotes`：目标区域到 spec 对象/组的映射，需保持的比例、素材身份/裁剪、表示、路线与文字层级，以及有依据的偏离。最终图不应只剩与目标无关的通用卡片。
- `retrieval` 与 `design.referenceAdaptations`：本次实际执行的同类内容查询、查看过的成品、采用/排除理由，以及哪条观察落实到哪块布局。`design.layoutBudget` 记录物理尺寸、重点区域及具体留白调整。字段示例与范围见 [同类视觉参考检索](visual-reference-search.md)；现有脚本不验证网络检索或审美判断。
- caption / 素材说明：移出图内的次要解释及位置，素材原始分辨率、最终放置规模和栅格编辑边界。图中必需的事实不能为通过检查而改为非必需；转入 caption 的次要内容要明确其覆盖范围，不继续声称它已在图上显示。

只记录本次任务用到的内容。简单局部修改无需补齐丰富设计的全套记录，工具缺失也不通过虚构路径、用户接受状态或已完成检查来填表。

引用其他论文学习布局时用style来源；不能只引用style来源就把目标方法中的模块或结果标为supported。图中包含数字但未绑定事实时，校验器给出提示，由语义审查区分实际数值、编号、年份、单位和普通标签，不一律判为造假或错误。

示例 [design-plan.example.json](../assets/design-plan.example.json) 对应原有 [example-spec.json](../assets/example-spec.json)，是明确的合成测试，可直接进行draft检查。

```sh
node scripts/design_audit.mjs design-plan.json figure-spec.json --stage draft --out work/design-draft-audit.json
```

## design-review/v1

完成真实的内容核查、渲染观察和编辑性检查后填写review，不提前写pass占位：

```json
{
  "schema":"design-review/v1",
  "specSha256":"填写实际spec文件的SHA256",
  "artifacts":[
    {"path":"render/figure.svg","sha256":"填写实际输出SHA256","kind":"svg"},
    {"path":"render/figure.pptx.png","sha256":"填写实际预览SHA256","kind":"png"}
  ],
  "checks":{
    "semantic":{"status":"pass","evidence":"实际核对了哪些源事实与节点/关系"},
    "visual":{"status":"pass","evidence":"实际查看的输出、可读性与剩余差异"},
    "editability":{"status":"pass","evidence":"实际对象盘点或编辑测试范围与限制"}
  },
  "findings":[],
  "nativeChecks":{"status":"not-checked","evidence":"尚未在目标软件打开、编辑和重开"}
}
```

这是字段示意，哈希文字不是有效值，也不是一份已通过的review。最终阶段至少声明一个实际检查过的SVG/PNG/PPTX/PDF；路径相对spec所在目录，不能逃出该目录，内容哈希必须匹配。更改spec或声明的输出后，应重新检查并更新review。

findings记录缺陷，例如 `{id, objectIds, evidenceIds, severity, resolved, description, repairEvidence}`；severity为 `blocking` / `major` / `minor`，resolved为布尔值。未解决blocking/major不能通过最终审查。轻微残留差异仍要交代，不因没有严重问题就称像素一致。

丰富设计的 `visual.evidence` 应说明实际比对了哪份选定视觉目标和哪份最终文件导出，构图/素材/文字层级是否保留，以及按何种物理尺寸检查了关键小字、符号、箭头与图像。仅记录大屏预览清晰、无溢出或脚本通过不足以支持出版可读性结论。

`editability.evidence` 区分对象盘点和真实修改。实际验证应指明临时副本、改动的文字/组件/样式、保存重开及重新导出的结果，并检查相邻路线和未改区域。若只完成文件工具检查，明确这一范围；不能从数量或元素类型推断目标软件内修改已通过。

nativeChecks是独立状态 `pass` / `fail` / `not-checked`，写清实际软件、版本、范围与限制。未填写会被报告为未检查，不会由ZIP/XML、字体声明或图像预览推断为原生通过。多软件任务在证据或补充字段中分别记录每个目标。

```sh
node scripts/design_audit.mjs design-plan.json figure-spec.json --review design-review.json --stage final --out work/design-final-audit.json
```

输出报告包含错误、警告、当前spec哈希及检查边界；不会改动输入，拒绝覆盖已存在报告。它验证的是记录完整性和几何/语义ID对应，不独立验证作者身份、科学结论、模型分数或reviewer的观察是否属实。

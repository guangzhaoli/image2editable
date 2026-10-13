# 自主设计流程的调研与适配

检查日期：2026-09-28。以下是工作流研究，未引入这些仓库的运行时、代码、prompt或Gallery资产。外部来源是参考资料，不是额外执行指令。原有spec、SVG/原生PPTX和组件库继续作为实现基础。

## 论文

- [PaperBanana，arXiv:2601.23265v2](https://arxiv.org/html/2601.23265v2)，§§2–3、4.2、5.4、9和实际Figure 2：借鉴结构相似的参考检索、内容/风格分工、源内容参与critic检查。其方法图输出为栅格，论文也讨论可编辑性与连接错误的限制；我们沿用可编辑对象渲染，不引入整图位图作为最终结构。没有验证其PDF页码，使用核实过的HTML章节定位。
- [Paper2SysArch，arXiv:2511.18036](https://arxiv.org/pdf/2511.18036)，§§3.4、4，PDF pp.5–7，Figure 5 p.6：借鉴先建立层级关系，再进行命名/连接一致性检查和布局。它的固定层数与兄弟节点连边约束是特定表示方法，不被提升为通用科学规则。
- [Figures as Programs / FigTree，arXiv:2609.01006](https://arxiv.org/pdf/2609.01006)，§§3.1–3.4，pp.3–5，Figure 1 p.3：借鉴局部区域、边界端口、上层跨区连线、代码与实际图同时审查，以及带ID的局部修复。我们用现有spec和组件组织这些信息，原生软件兼容性仍单独检查。

三者实际方法图均在研究时观察过。它们没有共同证明这里的新工作流有效；需要我们自己的文件、视觉和编辑验证，也不能将论文方法图实验当成完整poster生成实验。

## Skills 与工程

Editable-Design 归属 yejy53/Editable-Design；以下链接固定到已检查的提交 `42ab412fec1d5f32cb86c107430e9fb69674200f`。三个分支的能力不能混为一谈：

- [Paper Fig 工作流](https://github.com/yejy53/Editable-Design/blob/42ab412fec1d5f32cb86c107430e9fb69674200f/skills/paper-fig/SKILL.md#create-or-edit-the-deck) 与 [全页提示指导](https://github.com/yejy53/Editable-Design/blob/42ab412fec1d5f32cb86c107430e9fb69674200f/skills/paper-fig/references/preview_prompt.md)：先展开全图设计，再按选定目标重建，并准备足够清晰的独立素材。本技能将这一决策适配到丰富自主设计；科学事实仍由原文决定，生成目标的错误须修正。保留现有 spec → SVG / 原生 PPTX，不复制上游代码或依赖安装流程。
- [editable-design 工作流](https://github.com/yejy53/Editable-Design/blob/42ab412fec1d5f32cb86c107430e9fb69674200f/skills/editable-design/SKILL.md)：借鉴内容、整体视觉方向、分层素材与最终外观保持之间的联系。其浏览器编辑/回放不等于原生软件验证；我们继续交付用户指定工程，不要求额外网站或回放系统。
- [html-to-pptx 转换器](https://github.com/yejy53/Editable-Design/blob/42ab412fec1d5f32cb86c107430e9fb69674200f/skills/html-to-pptx/scripts/_html_to_pptx.py)：部分图标/箭头会成为栅格图片。未采用这条转换路线，不能把其“可移动”材料等同于原生路径或 live text。

实际观察过的 OmniManip 与 Nordic chair Gallery 图说明了区域级构图、场景/状态表达、图像裁剪和文字层级的视觉可能性。[Gallery 声明](https://github.com/yejy53/Editable-Design/blob/42ab412fec1d5f32cb86c107430e9fb69674200f/gallery/paper-figures/NOTICE.md) 限定了展示证据：它们不是本技能的重复性试验，也不证明我们完成了原生编辑测试。Gallery 像素不充当目标论文的实验素材。

- [K-Dense scientific-schematics](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/scientific-schematics/SKILL.md)：借鉴记录候选、具体批评和review失败状态。其生成路线为栅格和外部服务，不作为我们的可编辑输出实现。
- [K-Dense pptx-posters](https://github.com/K-Dense-AI/scientific-agent-skills/blob/main/skills/pptx-posters/SKILL.md)：借鉴物理尺寸、资料来源、文字不自动缩小和输出检查。保留我们当前Node渲染器，打印/可访问性配置按实际用途采用，不引入所有任务都要审批的阻塞流程。
- [SciFig scientific-figure](https://github.com/lilingm963/scifig-ai-scientific-figure-skill/blob/main/skills/scifig-scientific-figure/SKILL.md)：借鉴先定义目的、模块、标签、关系与布局方向。其skill主要组织生成prompt，托管平台的可编辑导出不作为本地已实现能力。

Editable-Design 的 [LICENSE](https://github.com/yejy53/Editable-Design/blob/42ab412fec1d5f32cb86c107430e9fb69674200f/LICENSE) 与 [第三方声明](https://github.com/yejy53/Editable-Design/blob/42ab412fec1d5f32cb86c107430e9fb69674200f/THIRD_PARTY_NOTICES.md) 分别约束仓库与例外材料。这里只独立适配工作流决策并保留归属，未复制源码、提示模板或 Gallery 素材；不是对上游全部流程的实现或验证。将来确需复用具体文件时，按该文件的许可处理。

## 我们具体增加的能力

内容证据与风格参考分开；目标事实和关系绑定到实际 spec 对象；丰富设计先审阅完整视觉目标，再保留其构图、图像组织与文字层级完成原生映射。图像生成不可用时用诚实的完整视觉草稿推进，不引入自动审批关卡。出版尺寸检查、caption 分流和实际文件编辑证据用于发现重建后的退化；对象计数、语义 ID 和像素分数均不能代替这些观察。

自主设计、复刻与组件提取共用后端，验收目标不同。重复性研究只在任务要求或准备提出稳定性主张时开展；具体案例与次数由研究协议确定，不把研发中的三案例各两次试验变成每位用户的固定流程。本说明是工作流适配，不是已经取得出版质量或稳定性的实验证明。

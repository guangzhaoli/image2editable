# 参考驱动的风格适配与图文视觉 spec

用户给一张或多张参考，要求学习其风格、配色、布局、字体、图像媒介或光色，并据此优化已有图或生成新图时使用。沿用v4.2内容核查、完整视觉目标和统一spec重建，只增加本任务需要的参考学习记录。

## 判断本次要采用什么

实际查看用户参考与已有目标。先从用户要求确定范围；未限定时根据用途选有帮助的属性，并说明应用决定。可分别借某图的配色、另一图的标题/主视觉/信息分区，不把多张参考自动平均混成一个主题。整幅参考能说明总体节奏时可用整图；局部属性可加裁切。排除或只用文字时记录实际理由，不因泛化顾虑默认去掉所有图。

用具体观察说明目标动作：主色/背景色/强调色各用在哪里，字体的衬线/字重/字距与标题层级怎样适配，主视觉和辅助信息如何组织，线条/材质/光色如何协同。字体家族无法确定时记录视觉气质或候选，不假称从像素精确识别字库。照片色样可能受光照影响；取样RGB不是原作者矢量文件的真实填色。

参考只提供被选择的表达属性。原图内容、准确文字、科学关系、主体身份及用户明确保持的部分仍权威；不把参考标题、品牌、人物、实验结果或题材作为新内容。布局需要适配本图的信息量和实体关系；颜色有科学编码含义时保持或建立明确映射。

## 两条任务路线

- **优化已有图：**保留目标与副本，记录允许变化和保持项。已有SVG/PPTX/spec或原生工程时优先修改现有对象；图文spec辅助选择配色/字体/布局，不强制先生成整幅图。只有栅格目标或需要图像媒介变化时，查看目标后用内置ImageGen作edit-target，并附所用style参考。保持目标透明度，用户要求改变时才变。科学照片/观测优先保留真实素材，通过周边图形排版体现风格，不重绘观测当真数据。
- **依据参考生成新图：**从本次内容/brief建立事实和结构，按所选视觉属性形成完整目标。参考可以是纯风格来源，新主题按内容确定。丰富设计生成并看图，再沿用统一spec重建；简单原生图可直接绘制。

两条路线都对照原目标/内容、选定参考和实际新结果，看保持项、指定属性及局部完成度。局部问题只处理相应对象/区域；已接受方向沿用，不增加固定候选数量或审批。

## 图文混合记录

一次视觉研究保留以下互相对应的文件：

| 文件 | 作用 |
| --- | --- |
| `visual-spec.html` | 给人看的图文页面：原参考/目标、所选局部、布局框标注、实际色样和文字观察、目标应用决定。离线打开即可查看。 |
| `visual-spec.json` | 给程序的记录：图片相对路径/哈希、角色、观察、应用决定、色样来源和保持项。 |
| `images/` | 实际复制的原图及指定裁切。引用真实图片，保持来源与派生关系。 |
| `visual-spec-board.png` | 便于快速查看的诊断证据板。可简化展示，完整说明以HTML/JSON为准；它不是新成片。 |
| `visual-study.json` | 本次实际观察和测量的原输入，供复核和重新打包。 |

图文页面与机器记录是同一研究的两种表示；JSON引用图片文件，而非堆入不可追溯的base64。最终`figure-spec.json`仍是绘图参数的唯一输入，视觉记录里的bbox用于原参考的取样/裁切/布局标注，不冒充新图最终坐标。

## 构建

准备 `visual-study/v1`：mode为`generate`或`restyle`，intent说明学习与应用范围，preserve记录保持项。references沿用content/style/edit-target及attach/text-only/exclude；给实际查看说明和用途。每个参考可补原图像素坐标的crop或regions标注。observations为`{id,referenceId,aspect,finding,apply}`，aspect为palette/layout/typography/imagery/lighting/spacing。

palette支持`declared`设计选色，或从原图指定box按`median`/`mode`实际取样；取样忽略完全透明像素，记录像素数、RGB/HEX、位置、方法和源哈希。区域选择由实际视觉分析决定，脚本不自动识别整图布局、字体或科学内容。示例见 [visual-study.example.json](../assets/visual-study.example.json)。

```sh
python scripts/build_visual_spec.py visual-study.json --out work/visual-spec-01
node scripts/prepare_imagegen_input.mjs imagegen-input.json --out work/prepared-01
```

第一步需要Pillow，按workspace dependency发现可用Python；`--font /actual/font.ttf`可指定诊断板字体。输出目录必须尚不存在，避免覆盖已接受版本。脚本校验本地图片、哈希、取样/裁切/标注范围并打包，观察/借鉴是否合适仍需实际看图。像素裁切与证据板是参考准备，创意图像编辑使用内置ImageGen或现有矢量/原生对象。

带EXIF旋转的照片先做机械方向归一并保留原件与派生记录，再实际查看归一图、记录其哈希并在该图上测量。构建器拒绝未处理的旋转方向，避免HTML显示方向与取样/标注坐标不一致。当前取样不做ICC转换、alpha混合或半透明加权，相关像素统计边界会保存。

第二步的侧车指向真实`visualSpec` JSON。plan.sources登记对应sourceId与角色，沿用本任务claims/nodes/relations和exactText；restyle必须有附上的edit-target和保持项，并显式设置transparentBackground。侧车示例见 [style-imagegen-input.example.json](../assets/style-imagegen-input.example.json)。

上述合成例的四份输入（study、style-design-plan、style-imagegen-input、visual-study-reference.png）先复制到任务工作目录，再将builder输出到该目录的`viz/`；不要把工作输出写回安装目录。例图是诊断夹具，非成品审美模板。

生成器实际收到的是选定参考/目标图片及观察/适配说明，HTML/链接和查看板不自动附上。改透明度、参考内容或调用参数时记录差异，保存真实调用与结果；成功生成后检查指定文字、主体/关系保持、风格属性和剩余问题，不能据“prepared”宣称图像已经生成。

原生重建时将选定配色映射到现有palette token、字体映射到经软件验证的font候选，布局落实到对象bbox/分组与连接路线。图片内的色彩与字形不保证逐像素匹配；需要精确HEX和可编辑文字时在统一spec与目标软件中落实。跨任务复用时可沿用参考素材、色样与观察，按新内容重写apply、保持项和target，避免继承上次的题材、文字或编辑目标。

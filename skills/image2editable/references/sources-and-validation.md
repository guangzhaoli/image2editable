# 参考来源与验证边界

维护检查日期：2026-09-28。下面的项目用于研究工作流设计，本技能的说明与辅助工具独立编写；没有将它们整包安装或复制为依赖。

v2 增加有取样坐标的色板、裁剪素材、结构化 spec 和原图原位描绘路线。此前 Transformer 消融针对 v1；不能将旧结果视为 v2 的效果验证。v2 准备工具的运行验证与真实论文描绘质量分别报告。

PowerPoint 扩展继续使用 v2 策略，只增加应用分支和只读 PPTX 对象盘点脚本。原有三图 v2 消融的目标应用是 Affinity，不能据此声称 PowerPoint 已获得相同提升。PowerPoint 的本机功能验证单独记录，不修改已保存的 v2 基线。

v2.1 在冻结 PowerPoint v2 对照文件之后增加统一可执行 spec、校验器、SVG/PPTX 后端和原生分组。此前的 PowerPoint 对照也不能算作这版渲染器的消融。新增程序用独立合成案例验证输入重放与局部修改；仍需单独进行目标软件打开、编辑、重开和导出检查，不将包检查或 Artifact Tool 渲染当作 PowerPoint 原生实测。

## 设计借鉴

- [dashi-motion](https://github.com/chuspeeism/dashi-motion)：尊重目标应用，交付原生可编辑对象；按软件读取流程；把文件生成、原生渲染和实际对照分别验证。
- [remotion-clone-video](https://github.com/crafter-station/remotion-clone-video)：先拆参考、测量布局与颜色，再构建对象，用导出结果迭代。
- [reference-video-replica-qc](https://github.com/Pluviobyte/video-production-skills/tree/main/reference-video-replica-qc)：明确保真等级，区分重放与参数化重建，不用抽样/像素指标冒充其他层面的证明。
- [HyperFrames](https://github.com/heygen-com/hyperframes/tree/main/skills)：主入口与按需加载的专业流程分离；把预览、运行与交付验证区分。

迁移到论文图后，新增了数据来源、坐标轴、误差条、公式符号和科学图像保真的要求。没有沿用视频的帧率、音轨和时间轴规则。

## 维护时需要复核

具体官方依据见 [Affinity](affinity.md) 和 [Illustrator](illustrator.md)。应用版本、原生扩展名、连接器可用性、脚本 DOM 和导出选项会变；先检查当前环境。第三方 API 参考仅作为辅助，最终以可访问的官方文档、安装版本和实际观察为准。

辅助图像比较脚本只报告栅格差异；Illustrator 盘点脚本只记录对象信息。它们都不证明图中科学结论、数据来源或交付工程的所有对象都可编辑。

真实使用中验证过的应用版本和步骤应记在项目的验证记录中。不要把“文档支持”“静态检查通过”改写为“在用户当前应用运行成功”。

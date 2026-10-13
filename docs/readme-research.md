# README research and adaptation

Retrieved **2026-10-13** through the repositories' public READMEs and GitHub repository API. Stars are a dated discovery signal, not a claim of quality or endorsement.

| Repository | Stars at retrieval | What informed this README |
|---|---:|---|
| [obra/superpowers](https://github.com/obra/superpowers) | 298,460 | State the workflow clearly, make installation easy to find, and separate host-specific setup from the common idea. |
| [anthropics/skills](https://github.com/anthropics/skills) | 180,842 | Explain the skill package itself, show a concrete invocation, and make runtime and license boundaries visible. |
| [openai/skills](https://github.com/openai/skills) | 28,047 | Use a compact definition and a short installation path. The repository is deprecated, so its setup advice was not adopted blindly. |
| [yejy53/Editable-Design](https://github.com/yejy53/Editable-Design) | 1,174 | Put actual visual examples near the front, organize them by use case, and link each claim about outputs to the appropriate stage. This is a close domain reference rather than a comparably high-star repository. |

The public README uses its own wording, images, and identity. No source README text, badges claiming popularity, or upstream gallery assets were copied.

## Choices for Image2Editable

- **English default, Chinese companion:** both READMEs contain the same gallery, installation instructions, capabilities, and material limits.
- **Show actual work early:** four generated examples appear before the feature table. Captions state that they are visual targets rather than finished native files.
- **A short path to first use:** install one skill folder, attach inputs, and give a concrete prompt. The real clone URL is included for the selected GitHub repository; no owner placeholder is used.
- **Explain the distinctive workflow:** reference learning is recorded with images and text; scientific content, appearance, and editability receive separate checks.
- **Make helper use inspectable:** include an executable spec and generated SVG/library fixture with real commands.
- **Keep case evidence close:** prompts, source links, review observations, and the CLIP repair sequence are one click away.
- **Keep the front page focused:** detailed dependencies, case history, and launch copy live in supporting documents.

## Current installation source

The [official skill documentation](https://learn.chatgpt.com/docs/build-skills) documents local discovery from `~/.agents/skills` and support for symlinked skill folders. It also recommends plugins for wider distribution. This package documents local skill installation; it does not claim to be a published plugin or marketplace entry.

## 中文

本次借鉴的是信息组织：效果先行、定位明确、安装短、例子具体、能力与依赖说清楚。没有复制上游文案或视觉身份。Star 数只记录调研当天的规模，不作为本项目能力证明，也没有制作虚假的 Star／下载量／benchmark 徽章。中英文 README 采用相同的结构和事实，安装方式另按当前官方文档核查。

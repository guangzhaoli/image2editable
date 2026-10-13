# Contributing

Useful reports and changes make a concrete visual workflow easier to trust or use.

## Share a case

Include the input or a shareable substitute, the requested outcome, actual output, host/application versions, and the specific defect. Label whether it concerns scientific content, appearance, text, editability, or runtime behavior. State whether the image is a first draft or a repaired result. Avoid presenting different inputs or different review budgets as a controlled comparison.

Share only references and assets you can redistribute. Remove local account paths and unrelated source material from public reports.

## Change the skill or scripts

Keep changes general enough to improve the workflow beyond a single showcase. Preserve the distinction between content plans, visual reference specs, and executable figure specs. A renderer should consume the agreed geometry rather than silently redesign it.

For script changes, run the relevant existing tests from `skills/image2editable/scripts/`. These are deterministic helper tests; they do not establish aesthetic quality or native-application compatibility.

```bash
node skills/image2editable/scripts/test_spec_renderer.mjs
node skills/image2editable/scripts/test_library_core.mjs
node skills/image2editable/scripts/test_imagegen_input.mjs
python3 skills/image2editable/scripts/test_visual_spec_builder.py
```

Some interop checks require the optional host runtime. Record unavailable checks explicitly. For a native editability claim, include the actual application, representative object edits, save/reopen result, and any font or path limitations.

Keep the English and Chinese READMEs aligned when changing public capabilities or installation instructions.

## 中文

欢迎提交有输入、有输出、有具体问题的案例，也欢迎改进参考学习、统一渲染和软件兼容性。请区分科学含义、视觉效果、文字、可编辑性与运行时问题，说明是否经过修订。修改应对一类任务有帮助，避免针对展示图增加专属规则；调整公开能力或安装方法时，请同步维护中英文 README。

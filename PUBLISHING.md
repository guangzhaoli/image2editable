# Repository and publishing

Project repository: [guangzhaoli/image2editable](https://github.com/guangzhaoli/image2editable). The commands below document the publication workflow; running the skill does not publish repositories or social posts.

## Repository

Use **`image2editable`** as the repository name, **Image2Editable** as the display name, and **MIT** as the license. The root `LICENSE` is already present. The installable skill is `skills/image2editable/`; its own copy of the license travels with it.

From this directory, initialize a fresh Git repository if needed, inspect the staged content, then make the first commit:

```bash
git init -b main
git add .
git diff --cached --stat
git commit -m "Prepare Image2Editable v4.2.1"
```

To publish with GitHub CLI after signing in to the intended account:

```bash
gh repo create image2editable --public --source=. --remote=origin --push
```

Alternatively, create an empty repository through GitHub and follow its commands for pushing an existing local repository. Avoid creating a second README or license on GitHub when using this package.

## Presentation

- Use `README.md` as the default English landing page; its language switch links to `README.zh-CN.md`.
- Copy the About description and suggested topics from [launch-copy.md](docs/launch-copy.md).
- Check that the four gallery images render and the language links work on GitHub.
- Use https://github.com/guangzhaoli/image2editable in announcements. Both READMEs contain the real clone URL.
- If you add a release tag, `v4.2.1` identifies the preserved workflow baseline; describe this as its public packaging, not a new performance improvement.

## License and assets

The selected license is **MIT**. Third-party references and runtime dependencies are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The package contains selected generated images and public examples, not the private working directory or source-paper downloads.

## 中文

项目仓库为 [guangzhaoli/image2editable](https://github.com/guangzhaoli/image2editable)，协议为 MIT。上面的命令记录维护者发布步骤；运行 skill 不会自动创建仓库或发送宣发内容。中英文 README 已包含真实克隆地址，效果图和语言切换使用仓库相对链接。发布公告可使用 docs/launch-copy.md 中的草稿。

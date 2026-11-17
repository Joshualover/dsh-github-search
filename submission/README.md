# 提交到 awesome-dsh-plugin

这份目录是给 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的投稿材料，不是插件运行所需。

指南：https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md

## 第一步：把插件推上 GitHub

条目必须指向一个**公开、已存在的仓库**，CI 会去拉它的 `package.json` 读 `dsh.bundle`、检查仓库年龄、检查 `dsh-plugin` topic。所以在提 PR 之前，仓库得先存在。

### 1. 建仓库

在 GitHub 上建一个空的公开仓库 `dsh-github-search`（**不要**勾选自动生成 README / .gitignore / LICENSE，本地已经有了）。

### 2. 推送

在本插件目录（`dsh-github-search/`）执行：

```sh
git add -A
git commit -m "feat: GitHub 项目搜索插件"
git branch -M main
git remote add origin https://github.com/Joshualover/dsh-github-search.git
git push -u origin main
```

### 3. 给仓库加 topic

在仓库首页右侧 **About** → ⚙️ → Topics，加上：

```
dsh-plugin
```

建议同时加：`dsh` `deepseek-harness` `github` `github-search`

> 指南明确要求 `dsh-plugin` 这个 topic，CI 会检查。

### 4. 仓库年龄要求

指南要求仓库**创建满 1 天**。这是 CI 自动检查的，不是对人评价。所以刚建好当天提 PR 会被拦下——隔一天再提即可，重新提交不会有任何影响。

## 第二步：提交 PR

`submission/data/plugins/Joshualover__dsh-github-search.yml` 就是要提交的文件，内容是：

```yaml
url: https://github.com/Joshualover/dsh-github-search
name: Joshualover/dsh-github-search
category: ui
description:
  en: Search GitHub repositories from a left-sidebar panel and read the results as a list, ...
  zh: 在左栏面板里搜索 GitHub 仓库并以列表呈现结果，...
icon: https://raw.githubusercontent.com/Joshualover/dsh-github-search/main/assets/icon-180.png
```

### 操作步骤

```sh
# 1. fork 列表仓库，然后
git clone https://github.com/<你的账号>/awesome-dsh-plugin.git
cd awesome-dsh-plugin

# 2. 创建分支
git checkout -b add-dsh-github-search

# 3. 把条目文件放进去（只加这一个文件）
cp /path/to/submission/data/plugins/Joshualover__dsh-github-search.yml \
   data/plugins/Joshualover__dsh-github-search.yml

# 4. 提交并推送
git add data/plugins/Joshualover__dsh-github-search.yml
git commit -m "Add dsh-github-search"
git push origin add-dsh-github-search
```

然后在 GitHub 上开 PR。

**注意**：指南强调一个 PR 只加这一个文件，**不要手工编辑 README**（那两份 README 是脚本从 `data/plugins/*.yml` 生成的）。

## 关于分类的选择

选的是 `ui`。理由：这个插件区别于列表里已有的 GitHub 相关条目的地方，是它**带有图形搜索面板**——用户不用打开 github.com，直接在左栏看结果列表。列表里 `AngelosZou/dsh-github-router` 归在 `git` 类，那是给 agent 用的只读访问，没有浏览界面。

指南说分类选得不够准不会被打回，维护者会直接改，所以不必纠结。

## 关于图标

指南要求 `icon` 是 **GitHub 托管的位图**（png/jpg/jpeg/webp），**不接受 SVG**。插件原本只有 `icon.svg`（DSH 插件面板用），所以另外渲染了一份 `assets/icon-180.png` 专门给列表用。

推上去之后这个 URL 才会生效：
`https://raw.githubusercontent.com/Joshualover/dsh-github-search/main/assets/icon-180.png`

如果暂时不想用图标，把 `icon:` 那行删掉即可——列表会回退到你的 GitHub 头像。

## 没做的可选项

| 项 | 为什么没做 |
|---|---|
| `screenshots.json` + 真实截图 | 需要真实界面截图，当前拿不到（GUI 需鉴权）。用示意图冒充真实截图会误导用户，所以留空——指南说明不声明时市场会从 README 自动抽取。 |
| 发布 npm | 可选。发布后市场能显示下载量，但不影响收录。 |
| GitHub Release tarball | 可选。除非仓库无法从源码安装才必需；本插件是纯 JS、无构建步骤，源码可直接用。 |
| `repository` 字段 | 等仓库建好后可补进 `package.json`，让 npm 包与仓库关联（仅影响发布 npm 后的关联，收录不依赖）。 |

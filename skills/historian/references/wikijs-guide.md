# wiki.js 2.x 能力指南

> wiki.js 2.x 的写作表面、管理配置、API 陷阱。面向两类读者：(1) 史官工具使用者（"中文页面在哪看"）；(2) skill 开发者（API 陷阱→工具行为解释）。

## 中文页面在哪看

wiki.js 的多语言靠 **namespacing**（路径前缀）实现，不是浏览器翻译。

| 场景 | URL | 说明 |
|------|-----|------|
| 英文页 | `http://<your-wiki>:3000/ops/wiki` | 默认 locale 无路径前缀 |
| 中文页 | `http://<your-wiki>:3000/zh/ops/wiki` | 加 `zh/` 前缀 |
| 语言切换 | 页面右上角 language switcher | 仅在 Admin > Locales 开启了多 locale + namespacing 后才显示 |

**前置条件**（缺一不可）：
1. Admin > Locales > 勾选 Active Namespaces 包含 `zh`
2. Admin > Locales > 启用 namespacing
3. 该页面确实有 zh locale 的内容（工具自动创建孪生页时完成）

**目录 (TOC)**：wiki.js 的 TOC 不在页面内容里，而是由 Admin > Theme > TOC 配置自动从 H2/H3 生成。页面内不要手写目录。

---

## 写作表达件速查

wiki.js 使用 markdown-it 11.0.1 渲染。以下是可用的增强语法：

| 元素 | 语法 | 渲染效果 |
|------|------|----------|
| 提示块（信息） | `> 内容\n{.is-info}` | 蓝色信息提示框 |
| 提示块（警告） | `> 内容\n{.is-warning}` | 黄色警告框 |
| 提示块（危险） | `> 内容\n{.is-danger}` | 红色危险框 |
| 提示块（成功） | `> 内容\n{.is-success}` | 绿色成功框 |
| 紧凑表格 | 表格 markdown 后加 `{.dense}` | 减少行距 |
| 脚注 | `[^1]` 引用 + `[^1]: 脚注内容` 定义 | 底部脚注 |
| KaTeX 数学 | `$E=mc^2$`（行内）/ `$$...$$`（块） | 数学公式 |
| Mermaid 图 | ` ```mermaid ` 代码块 | 流程图/时序图 |
| 标签页 | `[Tab A](#tab-a)\n[Tab B](#tab-b)` + `## Tab A` | 切换标签 |
| 定义列表 | `Term\n: Definition` | 术语定义 |

## 禁止使用

| 语法 | 为什么不行 |
|------|-----------|
| `{{toc}}` | wiki.js 不处理 mustache 模板标签，原样输出为文本 |
| `:::` container | wiki.js 的 markdown-it 插件不识别 container 语法，破坏渲染 |
| YAML frontmatter (`---\ntitle: …\n---`) | wiki.js 的标题/描述由数据库字段管理，frontmatter 会被当作正文显示 |
| `[[path\|label]]` 链接 | wiki.js 用标准 markdown 链接 `[Label](/path)`，旧语法不解析 |

---

## API 陷阱（9 项）→ 工具行为解释

这些陷阱是工具设计决策的直接原因。遇到工具返回错误时可对照此表。

| # | 陷阱 | 工具如何应对 |
|---|------|-------------|
| 1 | `pages.update` 必须发送**全部字段**，只发变更字段会清空其余字段 | `historian_page_update` 内部先 read 全量再合并，写回完整字段集 |
| 2 | 创建页面后无法直接从响应取 id；必须按 (path, locale) 回查 | `historian_page_create` 自动完成回查，返回 `page_id` |
| 3 | `responseResult.succeeded===false` 时错误码在 payload 内，不在 HTTP 状态码 | 工具将 payload 错误解析为结构化错误返回 |
| 4 | 空 content 创建会被拒绝（`Page content cannot be empty`） | `historian_page_create` 不传 content 时返回本地骨架模板，不发写请求 |
| 5 | `pages.move` 是独立 mutation，不是 update 的 path 字段 | `historian_move` 专用 move mutation |
| 6 | GraphQL 单页查询必须用 `singleByPath` + 显式 locale；默认 locale 查询可能命中错误页 | `historian_read` 始终传 locale 参数 |
| 7 | 上传文件端点 `/u` 的字段名固定为 `mediaUpload`，文件名需净化 | `historian_page_create` 不涉及上传；资产上传为独立能力 |
| 8 | `isPublished: false` 的页面匿名访问 404，所有 URL-200 检查会静默失败 | `historian_page_create` 默认 `isPublished: true`，仅 `_sandbox/` 显式传 false |
| 9 | 路径首段匹配 locale 模式（`zh`/`en`/`a`）会被保留路径冲突，长度 1 也被拒 | `historian_page_create` 的路径校验拒 `zh/foo`、`home` 等保留路径 |

## 路径校验规则

合法路径：`lowercase-hyphen`，每段 ≥2 字符，不含 `.`、空格、`\`、`//`。
保留路径（首段禁）：`home`、`login`、`register`、`graphql`、`healthz`、`_assets`、`favicon`。
首段匹配 `^[A-Za-z]{2}(-[A-Za-z]{2})?$`（大小写不敏感）也被拒（防 locale 冲突）。

## 管理配置入口

| 功能 | 路径 |
|------|------|
| 多语言开关 | Admin > Locales > Active Namespaces + namespacing |
| API Token 管理 | Admin > API Access |
| Token 权限范围 | Admin > Groups > page-rules（path glob 匹配） |
| 主题与 TOC | Admin > Theme |
| 评论开关 | Admin > Comments |
| 用户管理 | Admin > Users |

## 来源

调研文件：`docs/research/wikijs-2x-report.md`（API 陷阱实测）、`docs/research/wikijs-2x-capabilities-digest.md`（能力摘要）。

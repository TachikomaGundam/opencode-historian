# opencode-historian

> OpenCode 插件：双语 wiki.js 知识库管理 / Bilingual wiki curator as an OpenCode plugin.

opencode-historian 把 wiki.js 的读写、翻译、页型规范、迁移工具打包成一个 OpenCode 插件，让 AI agent 能直接管理双语知识库。

功能一览:

* 10 个 `historian_*` 工具，覆盖创建、更新、追加、翻译、搜索、阅读、地图、迁移、删除、移动
* Skill v3 随插件自动注入（config hook），无需手动安装 skill 文件
* G1 至 G4 页型契约，每种页型对应专属骨架模板
* 双语孪生页面（en/zh）自动翻译，翻译引擎可配置
* 页面地图缓存与本地镜像
* 试点与评测均通过：pilot 7 页迁移 PASS，eval 7/7 场景首跑全过

## 仓库 / Repository

<https://github.com/TachikomaGundam/opencode-historian>

## 安装 / Installation

两种安装方式经过实测验证。

### 方式一：npm 包（推荐（发布后））

在 `opencode.json` 或 `opencode.jsonc` 的 `plugin` 数组中添加包名：

```jsonc
{
  "plugin": ["opencode-historian"]
}
```

发布准备状态：包已按 0.1.0 打包就绪（`npm pack` 验证通过），npm 发布需账号 2FA 一次性完成（`npm publish --access public --otp=<code>`）。在发布完成前，方式二 `file://` 为当前可用安装路径。

### 方式二：本地路径（开发用）

用绝对路径指向本地构建目录：

```jsonc
{
  "plugin": ["file:///home/<you>/workspace/opencode-historian"]
}
```

此方式已通过 `opencode run` 验证，10 个 historian 工具全部注册成功（`.qa/12.txt`）。

### 安装后验证

插件注入的 skill 会注册 `/historian` 命令。验证方法：

```bash
opencode run --command historian --message "historian_map show"
```

如果工具列表中出现 `historian_page_create` 等 10 个工具，安装成功。

> **升级提示**：如果你之前使用过 historian v2 的扁平 skill 文件（如 `~/.config/opencode/skills/historian.md`），需要先重命名为 `historian.md.v2-disabled` 或移到别处。插件通过 config hook 自动注入 v3 skill，两个同名 skill 不能共存。

## 配置 / Configuration

插件支持元组形式传入选项：

```jsonc
{
  "plugin": [
    ["opencode-historian", {
      "baseUrl": "http://your-wiki:3000",
      "apiKeyPath": "~/.wikijs-api-key",
      "translate": {
        "endpoint": "https://...",
        "model": "qwen3.7-plus",
        "apiKey": "<YOUR_KEY>"
      },
      "sections": ["ops", "perf-notes"],
      "locales": ["en", "zh"]
    }]
  ]
}
```

不传选项时等同 `["opencode-historian"]`，使用全部默认值。

### 选项全表

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `baseUrl` | string | `http://localhost:3000` | wiki.js GraphQL 端点 |
| `apiKeyPath` | string | `~/.wikijs-api-key` | wiki API key 文件路径（tilde 在读取时展开） |
| `translate.endpoint` | string | `https://gateway.example.net/apps/anthropic` | 翻译 API 端点 |
| `translate.model` | string | `qwen3.7-plus` | 翻译模型 |
| `translate.apiKey` | string | 见下方链 | 翻译 API 密钥 |
| `sections` | string[] | 见下方 | 插件可操作的 wiki 路径前缀白名单 |
| `locales` | string[] | `["en", "zh"]` | 启用的语言列表 |

`sections` 默认值：

```json
["ops", "inference-notes", "llm-server", "perf-notes",
 "opencode", "agent-eval", "troubleshooting", "scratch", "_sandbox"]
```

### API Key 获取优先级

**翻译 API key**（`translate.apiKey`），按优先级：

1. 配置对象中的 `translate.apiKey` 字段
2. 环境变量 `DASHSCOPE_API_KEY`
3. opencode jsonc 配置中 `provider["my-provider"].options.apiKey`
4. 均无则抛出 `ConfigError('missing-translation-key')`

**wiki.js API key**，按优先级：

1. `apiKeyPath` 指向的文件内容
2. 环境变量 `WIKIJS_API_KEY`
3. 均无则抛出 `ConfigError('missing-wiki-api-key')`

### 降级行为

Key 缺失时 `ConfigError` 记录一次日志，插件工具全部禁用，opencode 正常启动不受影响。翻译 key 缺失时双语孪生功能降级为 pending 状态，创建页面只写入请求 locale 的内容。

## wiki.js 前置检查 / Prerequisites

安装插件前，确认 wiki.js 实例已完成以下配置。本插件不自动执行任何管理端操作。

### 多语言

* **Admin > General > Multilingual**：启用 namespacing
* **Active Namespaces** 包含 `en` 和 `zh`
* zh 命名空间是语言切换器和 URL 路由的前提

### API Token

* **Admin > API Access** 创建 token
* 需要的 scope：`write:pages`、`delete:pages`、`manage:pages`、`manage:system`
* 将 token 写入 `apiKeyPath` 文件或设为 `WIKIJS_API_KEY` 环境变量

### 页面权限

* **Admin > Groups** 中对应组的 page rules 必须覆盖插件 `sections` 配置的路径前缀
* 路径不在 page rules 范围内会触发 `PermissionError`（评测场景 R-b 验证）

### 主题与显示

* wiki.js 自动生成目录（TOC），通过 Admin > Theme 配置位置，页面内容里**不要**写 `{{toc}}`
* 自定义 CSS/HTML 注入入口在 Admin > Theme
* 建议关闭评论功能，避免知识库页面被评论干扰

## 中文页面在哪看 / Viewing Chinese Pages

中文页面的 URL 格式：

```
http://<host>/zh/<path>
```

例如 `ops/gpu-setup` 的中文版在 `http://<host>/zh/ops/gpu-setup`。英文版不带 locale 前缀：`http://<host>/ops/gpu-setup`。

**语言切换器**出现在页面右上角的前提是 namespacing 已开启且 zh 在 Active Namespaces 里。看不到切换器时，检查 Admin > General > Multilingual 设置。

**工具返回值**：每个写入操作的结果都会同时回显 en 和 zh 的 URL，格式如：

```
en: http://<host>/ops/example
zh: http://<host>/zh/ops/example
```

**地图视图**：`historian_map show` 输出包含 Locale 和 Twin 列，展示每个路径的双语对应关系。本地镜像文件保存在 `~/.config/opencode/historian-map.json`（`getMap` 读取，带过期秒数）；`_meta/page-map` 是 wiki 端的缓存页，由 `historian_map` refresh 写入。

## 写作质量体系 / Quality System

### G1 至 G4 页型

插件根据内容形态把每页归入四种页型之一，每种有专属骨架模板：

| 页型 | 用途 | 骨架结构 |
|---|---|---|
| G1 事件复盘 | 故障、踩坑、事后分析 | 时间线 → 根因 → 影响 → 行动项 → 教训，附来源列 |
| G2 对比 | 技术选型、方案比较 | 来源声明 + 对比表格 + 结论 |
| G3 清单 | 操作步骤、检查项 | 可勾选的检查项列表 |
| G4 概念 | 架构说明、原理讲解 | 概念定义 → 图示 → 示例 |

### 10 项自检门

每页写入后过一遍自检清单（源码 `src/templates/genres.ts` `selfReviewChecklist()`，参考文件 `skills/historian/references/rules.md` + `genres.md`）。dry-run 阶段评 1–8，apply 后评 9–10。genre-specific 条目对不匹配的页型记 N/A=PASS：

1. **导言占比 10–15%**：导言 ≈ 正文的 10–15%，每个重要小节在导言至少占一句
2. **句长上限**：中文句 ≤20 字、英文句 ≤25 词
3. **表格判据**：≥3 字段的结构化枚举入表，成对数据用描述列表
4. **对比表来源列**（G2）：对比表/枚举表每行有来源列，行序固定、无合并单元格
5. **时间线来源列**（G1）：时间线每行有来源列，仅日志可证事实
6. **行动项五要素**（G1）：类型|负责人|期限|验证|状态 五列，措施是行内容
7. **无杂项筐**：除 参见/附录 之外没有 "其他/杂项" 类 catch-all 小节
8. **无溢美词**：领先/强大/灵活/高效 等 bare claim 改事实或删除
9. **双语 URL 已回报**（写后核销）：报告含 /en/ 与 /zh/ 两个可访问 URL
10. **孪生已建或 zh_status:pending 声明**（写后核销）：twin created OR zh_status pending recorded and declared in report

### SYN 20 规则

更细的 20 条写作规则散布在 `skills/historian/references/` 目录下各参考文件中，agent 加载 skill 时自动读取。

## wiki.js 用法与定制化 / Usage Guide

### Markdown 速查

| 元素 | 写法 | 说明 |
|---|---|---|
| 提示框 | `> 内容\n{.is-info}` | `.is-info` / `.is-warning` / `.is-danger` / `.is-success` |
| 紧凑表格 | 标准 markdown + `{.dense}` | 减小行距 |
| 脚注 | `[^n]` 正文 + `[^n]: 内容` 底部 | wiki.js 原生支持 |
| 定义列表 | `term\n: definition` | 术语表用 |
| 数学公式 | `$...$` 行内、`$$...$$` 块 | KaTeX 渲染，默认开启 |
| 流程图 | ` ```mermaid ` 代码块 | mermaid 渲染，默认开启 |
| 标签页 | `{tabset}` + `## Tab Name` | 多标签内容切换 |

**禁用项**：

* `{{toc}}`（目录由主题配置自动生成）
* `:::` 容器（wiki.js 不解析）
* YAML frontmatter（API 创建页面不经过 frontmatter 解析）

### API 陷阱与插件应对

wiki.js GraphQL API 有 9 个常见陷阱。插件在内部处理了每一个（详见 `skills/historian/references/wikijs-guide.md`，原始报告路径 `docs/research/wikijs-2x-report.md`）：

| 陷阱 | 插件应对 |
|---|---|
| `pages.update` 是整页替换，不是增量合并 | 工具内部做 read-modify-write |
| `pages.create` 返回值缺部分字段 | 创建后立即 readback 拿完整数据 |
| `responseResult` 嵌套结构，需取 `.id` | 解析层统一提取，上层拿到的是直接值 |
| 空 content 被拒绝 | 引擎 pre-check `ContentEmptyError`；不传 content 时走 template-only 模式，不发 GraphQL 写请求 |
| 移动页面不能用 update 改路径 | 用独立的 `pages.move` mutation |
| `singleByPath` 必须传 locale | 所有查询强制带 locale 参数 |
| 上传附件字段名必须是 `mediaUpload` | 内部固定字段名（`src/wiki/assets.ts`） |
| `isPublished: false` 的页面匿名访问报 404/403 | 创建草稿时在工具输出中标注 |
| 路径不能以 locale 前缀开头 | `validatePath` 拒绝 `zh/...` 形式的输入 |

## 从 historian v2 迁移 / Migrating from v2

旧版 historian v2 依赖 `/opt/wiki-ops/` 下的 Python 脚本（`wiki-ops.py`、`wiki-biling.py`）。插件完全替代了这些脚本。旧脚本保留在原位不动（标记 LEGACY），不需要删除。

### 命令映射表

| wiki-ops.py 子命令 | historian 工具 | 备注 |
|---|---|---|
| `list` | `historian_map` (show) | 地图缓存替代全量列表 |
| `read <id>` | `historian_read` (path) | 改用 path 定位，不再用数字 ID |
| `append <id> <file>` | `historian_page_append` | 直接传 section 内容，不用写临时文件 |
| `create "Title" "path" <file>` | `historian_page_create` | content 参数直接传，可省文件 |
| `rebuild-tree` | `historian_map` (refresh) | 从 wiki 重建地图缓存 |
| `search "keyword"` | `historian_search` (kind=title) | 标题搜索 |
| `search-content "keyword"` | `historian_search` (kind=content) | 全文搜索 |
| `fetch <id>` / `fetch-paths <path>` | `historian_read` | 按 path + locale 读取 |
| `cache-read` | `historian_map` (show) | 本地镜像 |
| `cache-refresh` | `historian_map` (refresh) | 重建缓存 |
| `delete <id> --confirm` | `historian_delete` | confirm 参数必须为 `"yes"` |

| wiki-biling.py 子命令 | historian 工具 | 备注 |
|---|---|---|
| `create-bilingual` | `historian_page_create` (twin=true) | twin 默认开启 |
| `append-bilingual` | `historian_page_append` + sectionZh | sectionZh 参数携带中文内容 |
| `translate-snippet` | `historian_translate_snippet` | 纯本地翻译，不写 wiki |
| `status` | `historian_map` (show) | 双语状态在地图中展示 |
| `checkpoint` | migrate store 文件 | 迁移进度持久化 |
| `run` / `run --path` | `historian_migrate` (apply=true) | 支持 dry-run（apply=false） |

### 升级步骤

1. 重命名旧 skill 文件：`mv ~/.config/opencode/skills/historian.md ~/.config/opencode/skills/historian.md.v2-disabled`
2. 在 `opencode.json[c]` 的 `plugin` 数组中添加 `opencode-historian`
3. 重启 opencode，`/historian` 命令可用即表示 v3 skill 已注入

## 运维 / Operations

### 迁移工具

`historian_migrate` 把现有页面重新格式化为对应页型骨架：

1. **先 dry-run**：`apply=false`（默认），查看骨架预览和自检评分
2. **再 apply**：`apply=true`，引擎在首次写入前自动生成 pre-image 备份
3. **回滚**：读备份 JSON，用 `historian_page_update` 推回原始内容

备份文件位于 `results/pilot-backup-*.json`。迁移进度存储在 `~/.config/opencode/historian-migrate.json`，支持断点续跑。

### 评测框架

harness repo（与本插件仓库同工作区）提供 7 个行为验收场景，覆盖创建、追加、重叠整合、整理、价值门控、G1 格式、zh URL 报告。v3 插件评测结果：7/7 PASS，51/58 适用分，G=1，零重试（`results/2026-09-02-v3-plugin.md`）。

## 开发 / Development

```bash
npm run build       # tsc 编译到 dist/
npm test            # vitest run（272 tests, 13 files）
npm pack --dry-run  # 检查打包文件列表
```

打包文件（`files` 字段）：`dist`、`skills`、`scripts`。加上 npm 自动包含的 `README.md` 和 `LICENSE`。

## 许可证

MIT

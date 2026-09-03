# opencode-historian

> OpenCode 插件：双语 wiki.js 知识库管理 / Bilingual wiki curator as an OpenCode plugin.

opencode-historian 把 wiki.js 的读写、翻译、页型规范、迁移工具打包成一个 OpenCode 插件，让 AI agent 能直接管理双语知识库。它为什么存在、文风从哪里来、怎么一句话开始用，见下文「史官宣言」。

功能一览:

* 10 个 `historian_*` 工具，覆盖创建、更新、追加、翻译、搜索、阅读、地图/时间轴、迁移、删除、移动
* Skill v5 随插件自动注入（config hook），无需手动安装 skill 文件
* G1 至 G5 页型契约，每种页型对应专属骨架模板
* 双语孪生页面（en/zh）自动翻译，翻译引擎可配置
* 页面地图缓存、本地镜像与时间轴聚合视图
* 开工前置查阅回路（reading loop，默认关，双信号启用）+ `/historian-capture` 会话留痕（默认关）
* 试点与评测均通过：pilot 7 页迁移 PASS，eval 7/7 场景首跑全过

## 史官宣言 / The Historian's Manifest

### 灵感 / Inspiration

这个插件的写作规则不是发明的，是从五种语言文化的 wiki 工程传统加一种运维文化里蒸馏出来的（调研全文见仓库内 `docs/research/cross-cultural-wiki-writing-digest.md`，每条主张附原文引用）：

| 文化 | 给史官的贡献 |
|---|---|
| 中文 | 序言不可侵犯（多数读者只读序言，要点前置）；可供查证（举证责任在添加内容的一方）；金字塔原理的结论先行；阮一峰式行文纪律（句 ≤40 字、一文一事）；企业事件复盘模板（摘要→背景→时间线→影响量化→根因→改进，改进措施是复盘最重要的部分，行动项必须带负责人、期限与验证方式） |
| 英文 | WP:LEAD 导言自足、篇幅按重要性分配；Good Article 六项质量门；Diátaxis 四象限（tutorial / how-to / reference / explanation，模式混杂是文档烂的根源，参考页要像地图一样镜像系统结构）；Google 技术写作"≥3 个相关字段就上表格"；SRE blameless postmortem |
| 德文 | 条目开头先定义、门外汉可懂、一文一概念反碎片化、禁止"杂项"小节；引证义务 Belegpflicht："宁要格式错的引注，不要没有引注"；评价必须归属到人，不带情绪（sine ira et studio） |
| 法文 | 中立、非个人化、清晰、精确、易懂、有教学性六种品质；溢美词强制转成事实（用排名、奖项、销量替代"最伟大的"这类断言）；耐久过滤：明天就会过时的内容不值得写 |
| 俄文 | ХС/ИС 条目门槛（导言普通读者可懂、术语最少、不少于 10 行）；二手权威来源优先于一手（АИ）；每种观点按影响力分配篇幅、禁止虚假平衡（ВЕС）；风格要求精确、简明、无歧义，同时保持内容饱和 |

SRE postmortem 文化单独值得点名：它把"事件"当一等文档对待，过程/原因/后果/改进四段式正是 `/historian-capture` 命令的输出协议（`src/index.ts` 的 capture 模板），而"改进项要有负责人和可验证终态"落在了 G1 行动项表格里。

把这些文化做成插件的直接动因，是一个机构记忆问题：这台机器由一个人加一群 AI agent 操作。会话结束，终端滚动条就没了；上下文压缩，细节就丢了。部署过什么、发生过什么事故、踩过什么坑、做过什么决定，三个月后人和 AI 都无从查起。史官要解决的，就是让这台机器的历史变得可检索。

### 目的 / Purpose

让"这台机器上部署过什么、发生过什么、踩过什么坑、做过什么决定"成为人和 AI 都可索引、可引用、可审计的一等知识：

* 知识落进结构化双语 wiki 页，而不是一次性的会话回复
* 每个写操作强制回报 en + zh 双 URL（`URL_MANDATE`，`src/tools/shared.ts:39`），引用链可回溯
* wiki 成为任何 agent 会话开工前先查的权威来源，而不是锁在某个会话里的私有记忆

### 作用 / What it does

五柱页型契约，加上读写两条自动化回路：

| 能力 | 机制 | 落点 |
|---|---|---|
| 五柱页型 | G1 事件复盘 / G2 对比选型 / G3 清单索引 / G4 概念原理 / G5 现状账本，写前声明页型，套固定骨架、过来源列检查 | `src/templates/genres.ts`，skill Phase 1.5 |
| 双视图 | 地图视图（en/zh 对应关系，Locale/Twin 列）+ 时间轴视图（ISO 周分组，支持 `days` 窗口与 `path` 前缀过滤，人读周表 + 机读 weeks JSON） | `historian_map` 的 `action:'show'` / `action:'timeline'` |
| 迁移与评分门禁 | 存量页按骨架重排：dry-run 评分在前，`apply=true` 自动 pre-image 备份；每页写入后过 10 项自检门 | `historian_migrate`，`selfReviewChecklist()` |
| 前置查阅回路 | 向每次请求的 system 提示注入"先查 wiki"指令（单块合并：追加到最后一个 system 块，绝不产生第二条 system 消息；双信号门控：选项与本机哨兵文件同时到位才注入）：动这台机器的部署/历史/坑/决定之前先 `historian_search`、查 timeline、核对 G5 卡的核实日期，引用查过的页面 URL | `readingLoop` 选项（默认 false，开启需配置+哨兵双确认）+ 哨兵文件 `~/.config/opencode/historian-reading-loop.json`，`src/index.ts` 的 `experimental.chat.system.transform` 钩子 |
| 主动留痕 | `/historian-capture` 命令把当前会话总结成 G1 事件页；开启 `capture.enabled` 后额外在会话空闲时弹一次提醒，仅提醒，绝不自动写页 | `src/index.ts` 的 `config` / `event` 钩子 |

G5 现状卡回答"现在跑着什么"，timeline 回答"最近两周变了什么"。比如问"`service-a` 现在监听哪个端口"，应当命中现状账本里的一行（形如 `example.com:8000`，带上次核实日期与验证命令），而不是某次会话的聊天记录。这两样合起来，wiki 才从文档堆变成可查询的运维账本。

### 使用方式 / Usage

端到端最短路径（适配你自己 wiki 的六步完整指南见 `skills/historian/references/adapting-your-own-wiki.md`）：

1. **安装**：`opencode.json[c]` 的 `plugin` 数组加 `"opencode-wiki-historian"`（npm 发布后）或 `"file:///home/<you>/workspace/opencode-historian"`（本地开发），细节见下文「安装」。
2. **配置**：最小三个选项；翻译腿可以不配，双语孪生会优雅降级为 pending：

   ```jsonc
   ["opencode-wiki-historian", {
     "baseUrl": "http://<your-wiki>:3000",
     "apiKeyPath": "~/.wiki-key",
     "sections": ["team-notes/"]
   }]
   ```

3. **口述写史**：对 opencode 说自然语言，史官完成分诊→放置→页型→骨架→自检→写入，并回报双语 URL：

   > `service-a` 今天 OOM 重启，根因是缓存没设上限，已加告警，记下来。

   → 分诊为事件复盘，声明 G1 → `historian_page_create`（`genre: "G1"`）→ 回报 `http://<your-wiki>:3000/team-notes/<slug>` 与它的 `/zh/` 孪生页。
4. **检索与整理**：`historian_search` 按主题查；`historian_map` 的 `show` 看双语地图、`timeline`（可选 `days` / `path`）看最近变动；存量页不合规用 `historian_migrate` 先 dry-run 再 apply。
5. **开关**：reading loop 默认 false，开启需配置+哨兵双确认，两步缺一不可：

   1. 插件二元组第二参数写 `"readingLoop": true`：`["opencode-wiki-historian", { "readingLoop": true }]`
   2. 人工写入本机哨兵文件（agent 不能自我启用）：

      ```bash
      cat > ~/.config/opencode/historian-reading-loop.json <<'EOF'
      {"version":1,"confirmed":true}
      EOF
      ```

   任一信号缺失即不注入；配置已开而哨兵缺失时，插件加载期会打一条提示（给出哨兵路径与内容），不会静默失灵。删除哨兵文件即刻回退，无需改配置。想要空闲留痕提醒就 `"capture": { "enabled": true }`，`/historian-capture` 命令本身与开关无关、始终注册。

### 解耦声明 / Decoupling

插件与任何一台机器的 wiki 内容零耦合：

* `sections` 默认空列表 = 不设路径前缀限制，实际写权限由 wiki.js token 的 page rules 决定；包内不携带任何真实主机、真实章节分类学或页面数据
* 翻译腿零内置地址：解析链只有 `translate.endpoint` 选项 → 环境变量 `HISTORIAN_TRANSLATE_ENDPOINT` → 未配置，未配置时孪生降级 pending，不发任何网络请求
* `tools/privacy-audit.mjs` 对 `npm pack` 清单里的每个随包文件跑隐私红线 regex（真实主机 / 本机路径 / 本机章节名 / 密钥形态 / 个人身份），任何命中即非零退出、拦住发布；已接入 `prepublishOnly`（build → test → audit）
* 随包文本里的示例全部占位符化：`http://<your-wiki>:3000`、`team-notes/`、`example.com`

## 仓库 / Repository

源代码仓库由维护者自管；本包的公开分发渠道是 npm registry（`opencode-wiki-historian`）。
Source repository is managed by the maintainer; the public distribution channel for this package is the npm registry (`opencode-wiki-historian`).

## 安装 / Installation

两种安装方式经过实测验证。

### 方式一：npm 包（推荐（发布后））

在 `opencode.json` 或 `opencode.jsonc` 的 `plugin` 数组中添加包名：

```jsonc
{
  "plugin": ["opencode-wiki-historian"]
}
```

> 注：npm 包名为 opencode-wiki-historian（opencode-historian 已被注册表上一无关同名包占用）；仓库与插件 id 仍为 opencode-historian。

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

> **升级提示**：如果你之前使用过 historian v2 的扁平 skill 文件（如 `~/.config/opencode/skills/historian.md`），需要先重命名为 `historian.md.v2-disabled` 或移到别处。插件通过 config hook 自动注入 v5 skill，两个同名 skill 不能共存。

## 配置 / Configuration

插件支持元组形式传入选项：

```jsonc
{
  "plugin": [
    ["opencode-wiki-historian", {
      "baseUrl": "http://your-wiki:3000",
      "apiKeyPath": "~/.wiki-key",
      "translate": {
        "endpoint": "https://<your-anthropic-compatible-gateway>/v1",
        "model": "qwen3.7-plus",
        "apiKey": "<YOUR_KEY>",
        "providerKey": "my-provider"
      },
      "sections": ["team-notes", "infra"],
      "locales": ["en", "zh"]
    }]
  ]
}
```

不传选项时等同 `["opencode-wiki-historian"]`，使用全部默认值。插件包内不携带任何特定机器的配置（章节分类学、翻译网关地址均已清空为通用默认）。

### 选项全表

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `baseUrl` | string | `http://localhost:3000` | wiki.js GraphQL 端点 |
| `apiKeyPath` | string | `~/.wikijs-api-key` | wiki API key 文件路径（tilde 在读取时展开） |
| `translate.endpoint` | string | 未配置（见下方链） | 翻译 API 端点 |
| `translate.model` | string | `qwen3.7-plus` | 翻译模型 |
| `translate.apiKey` | string | 见下方链 | 翻译 API 密钥 |
| `translate.providerKey` | string | 未配置 | jsonc 兜底腿读取的 provider 名；须显式设置才会启用该腿 |
| `sections` | string[] | `[]`（不限制） | 插件可操作的 wiki 路径前缀白名单 |
| `locales` | string[] | `["en", "zh"]` | 启用的语言列表 |
| `readingLoop` | boolean | `false` | 开工前置查阅 advisory，向每次请求注入"先查 wiki"提示；默认 false，true 需配置+哨兵双确认（见「使用方式」开关步骤）；单块合并追加到最后一个 system 块，绝不产生第二条 system 消息，vLLM 等拒绝多条 system 的严格后端同样安全 |
| `capture.enabled` | boolean | `false` | 开启后会话空闲时弹一次 `/historian-capture` 留痕提醒；仅提醒，不自动写页 |

`translate.endpoint` 解析链（优先级从高到低）：`translate.endpoint` 选项 → 环境变量 `HISTORIAN_TRANSLATE_ENDPOINT` → 未配置。包内**不**内置任何网关地址；未配置时翻译调用直接以 `translate.endpoint not configured` 失败（见降级行为）。

`sections` 默认为空列表 = 不限制路径前缀（任意合法路径可写，实际权限由 wiki.js token 的 page rules 决定）。按机器通过选项传入白名单，例如 `["team-notes", "infra", "ops"]`。

### API Key 获取优先级

**翻译 API key**（`translate.apiKey`），按优先级：

1. 配置对象中的 `translate.apiKey` 字段
2. 环境变量 `DASHSCOPE_API_KEY`
3. opencode jsonc 配置中 `provider["<translate.providerKey>"].options.apiKey`（仅当显式设置 `translate.providerKey` 时读取；包内不内置默认 provider 名）
4. 均无则抛出 `ConfigError('missing-translation-key')`

**wiki.js API key**，按优先级：

1. `apiKeyPath` 指向的文件内容
2. 环境变量 `WIKIJS_API_KEY`
3. 均无则抛出 `ConfigError('missing-wiki-api-key')`

### 降级行为

key 缺失时 `ConfigError` 记录一次日志，插件工具全部禁用，opencode 正常启动不受影响。`translate.endpoint` 未配置时双语孪生功能降级为 pending 状态（`twinReason: 'translate.endpoint not configured — ...'`），创建页面只写入请求 locale 的内容，不会发起任何翻译网络请求。

### 已知限制

| 现象 | 定性 | 说明 |
|---|---|---|
| 裸配置未传 `translate` 选项（三段 key 链 `translate.apiKey` → `DASHSCOPE_API_KEY` → `translate.providerKey` 全缺）时插件工具全部禁用 | by design | 翻译腿是写操作的前提，缺 key 时宁可整体禁用也不静默半成品；配置按上方选项全表补齐即恢复。缺配置时的部分降级（工具照常注册、仅翻译调用失败）在议 |

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

例如 `ops/deploy-checklist` 的中文版在 `http://<host>/zh/ops/deploy-checklist`。英文版不带 locale 前缀：`http://<host>/ops/deploy-checklist`。

**语言切换器**出现在页面右上角的前提是 namespacing 已开启且 zh 在 Active Namespaces 里。看不到切换器时，检查 Admin > General > Multilingual 设置。

**工具返回值**：每个写入操作的结果都会同时回显 en 和 zh 的 URL，格式如：

```
en: http://<host>/ops/example
zh: http://<host>/zh/ops/example
```

**地图视图**：`historian_map show` 输出包含 Locale 和 Twin 列，展示每个路径的双语对应关系。本地镜像文件保存在 `~/.config/opencode/historian-map.json`（`getMap` 读取，带过期秒数）；`_meta/page-map` 是 wiki 端的缓存页，由 `historian_map` refresh 写入。

**时间轴视图**：`historian_map action:'timeline'` 把镜像行按 ISO 周分组（可选 `days` 窗口与 `path` 前缀过滤），输出人读周表 + 机读 `weeks` JSON，回答"最近哪些页面变过"。

## 写作质量体系 / Quality System

### G1 至 G5 页型

插件根据内容形态把每页归入五种页型之一，每种有专属骨架模板：

| 页型 | 用途 | 骨架结构 |
|---|---|---|
| G1 事件复盘 | 故障、踩坑、事后分析 | 时间线 → 根因 → 影响 → 行动项 → 教训，附来源列 |
| G2 对比 | 技术选型、方案比较 | 来源声明 + 对比表格 + 结论 |
| G3 清单 | 操作步骤、检查项 | 可勾选的检查项列表 |
| G4 概念 | 架构说明、原理讲解 | 概念定义 → 图示 → 示例 |
| G5 现状账本 | 此刻的部署/运行态，回答"现在跑着什么" | 状态块 → 部署物清单（每行带「上次核实于」+ 验证命令）→ 失效策略，禁止叙事正文 |

### 10 项自检门

每页写入后过一遍自检清单（源码 `src/templates/genres.ts` `selfReviewChecklist()`，参考文件 `skills/historian/references/rules.md` + `genres.md`）。dry-run 阶段评 1–8，apply 后评 9–10。genre-specific 条目对不匹配的页型记 N/A=PASS；G5 页的第 4–6 项换成账本变体（`G5_CHECKLIST_VARIANTS`）：

1. **导言占比 10–15%**：导言 ≈ 正文的 10–15%，每个重要小节在导言至少占一句
2. **句长上限**：中文句 ≤20 字、英文句 ≤25 词
3. **表格判据**：≥3 字段的结构化枚举入表，成对数据用描述列表
4. **对比表来源列**（G2）：对比表/枚举表每行有来源列，行序固定、无合并单元格；G5 变体：部署物清单每行带「上次核实于」列
5. **时间线来源列**（G1）：时间线每行有来源列，仅日志可证事实；G5 变体：验证方法含可执行复核命令
6. **行动项五要素**（G1）：类型|负责人|期限|验证|状态 五列，措施是行内容；G5 变体：无叙事正文，只有状态块 + 表格
7. **无杂项筐**：除 参见/附录 之外没有 "其他/杂项" 类 catch-all 小节
8. **无溢美词**：领先/强大/灵活/高效 等 bare claim 改事实或删除
9. **双语 URL 已回报**（写后核销）：报告含 /en/ 与 /zh/ 两个可访问 URL
10. **孪生已建或 zh_status:pending 声明**（写后核销）：twin created OR zh_status pending recorded and declared in report

### SYN 20 规则

更细的 20 条写作规则散布在 `skills/historian/references/` 目录下各参考文件中，agent 加载 skill 时自动读取。

## 前台 / 后台 / 证据三层 / Three Content Tiers

wiki 内容按读者分三层，工具按层执行不同语义（`historian_page_create` 的 `tier` 参数）：

| 层 | 位置 | 职责 |
|---|---|---|
| 前台 (front) | 主题章节的 G1-G5 页 | 人写人读的知识页；双语孪生、进索引；只放提炼后的内容与链接 |
| 后台 (backstage) | `_meta/` 页 + 本地镜像文件 | 机器记账：page-map 缓存页、迁移 checkpoint、reading loop 哨兵文件；不参与人读正文 |
| 证据 (evidence) | `_evidence/` | 超 10 行原始件（日志、转写、大 diff）的归宿：单语 en、不发布（匿名访问 404 是 by design），人类页面只链接不复制 |

用法示例：

```jsonc
// 大段原始材料先落证据页，再在人读页附录里给链接
historian_page_create({ path: "_evidence/<topic>--<yyyymmdd>", tier: "evidence", content: "<原始件全文>" })
```

- **软提醒语义（soft advisory）**：写前台页时若内容含超过 30 行的围栏代码块，工具结果附一条 `advisory`，提示把原始件搬到 `_evidence/` 页、正文改放决定性摘录（每段 ≤10 行）+ 证据页链接 + 外部链接（commit/PR/告警）。提醒归提醒，写入永不阻断；证据层页自身不跑这项检查。
- **镜像与快照页分工**：本地镜像 `~/.config/opencode/historian-map.json` 是活查询的唯一来源（`historian_map show` 直接读它）；`_meta/page-map` wiki 页是审计账本，`historian_map refresh` 每次提交一个新修订，wiki 的页面历史即全库变更时间线。

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
2. 在 `opencode.json[c]` 的 `plugin` 数组中添加 `opencode-wiki-historian`
3. 重启 opencode，`/historian` 命令可用即表示 v5 skill 已注入

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
npm test            # vitest run（331 tests, 15 files）
npm pack --dry-run  # 检查打包文件列表
```

打包文件（`files` 字段）：`dist`、`skills`。加上 npm 自动包含的 `README.md` 和 `LICENSE`。`tools/`（pilot-run、finish-publish、install-skill）为仓库开发工具，不随包分发。

## 许可证

MIT

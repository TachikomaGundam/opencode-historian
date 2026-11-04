# DEVELOPMENT — 内部机制与开发手册

本页承接 [README.md](README.md) 的开发面内容：内部机制、质量门禁、wiki.js 陷阱、
v2 迁移对照、运维与发布。人面文档只讲「是什么、干什么、怎么用、限制」，
所有行号级与标识符级细节集中在这里。

## 内部机制

### Skill 注入
v5 skill 随插件经 config hook 自动注入，无需手动安装 skill 文件。
旧版扁平 skill（如 `~/.config/opencode/skills/historian.md`）必须改名停用，
否则两个同名 skill 冲突。

### 双语 URL 强制回报
常量 `URL_MANDATE`（`src/tools/shared.ts`）要求每个写操作结果回报 en 与 zh
两个可访问 URL，供引用链回溯。

### sections 写入白名单
- 五个写入工具（create/update/append/delete 与 move 的目标路径）先过
  `sectionGuard()`（`src/tools/shared.ts`）。
- 非空即强制生效：越界写入在请求发出前以 `ConfigError` 拒绝，不发写请求；
  报错点名越界首段并提示加入 `sections`。
- 匹配按首路径段、区分大小写：`doc` 授权 `doc` 与 `doc/x`，不授权 `docs/x`。
- 配置项首尾斜杠可省。
- 恒豁免清单：`home`、`wiki-index`、`_sandbox`、`_data`、`_meta`、`_evidence`
  （插件自记账与索引胶水所需）。

### 保留字路径与 home 解锁
- 路径校验拒绝保留字：`login`、`register`、`graphql`、`healthz`、`_assets`、
  `favicon`，以及以 locale 前缀（如 `zh/`）开头的路径（`validatePath`）。
- 顶层 `home` 落地页为精确豁免；嵌套 `home` 与其余保留字照旧拒绝。
- 路径段不得形如 locale 代码；页面操作按 path+locale 定位，不用数字 ID。

### 搜索与标签过滤
- `historian_search`：`tags` 1–5 个；`tagsMode` 默认 `all`（服务端 AND），
  `any` 为客户端逐标签 fan-out 求并集。
- 零命中回退链（0.6.2 起）：多词按空白拆词逐词查询、按命中词数合并
  （`strategy: token-split`）；仍零命中读本地地图镜像按标题/路径补
  （`strategy: map-mirror`）；再零给具名提示。直查命中路径字节不变（特征测试锁定）。

### 开工前置回路（readingLoop）
- 钩子：`experimental.chat.system.transform`（`src/index.ts`）。
- 注入「先查 wiki」advisory 四条：先读 `wiki-index` / `historian_map show`
  定位再 `historian_search`（index-first）；update 优先于 create；引用页面带
  URL 与日期；发现矛盾或过期在页内标注（supersede 或复核章）而非静默覆盖，
  G5 账本逐行核对「上次核实于」。
- 单块合并：追加到最后一个 system 块，绝不产生第二条 system 消息；
  vLLM 等拒绝多条 system 的严格后端同样安全。
- 双信号门控：配置项（默认 `false`，常量 `DEFAULT_READING_LOOP`，
  `src/config.ts`）与本机哨兵文件
  `~/.config/opencode/historian-reading-loop.json`（内容
  `{"version":1,"confirmed":true}`）同时到位才注入。
- 配置已开而哨兵缺失：加载期打印一条提示（给出哨兵路径与内容），不静默失灵；
  删除哨兵文件即刻回退，无需改配置。agent 不能自我启用。

### 会话留痕（capture）
- 常量 `CAPTURE_COMMAND_TEMPLATE`（`src/index.ts`）定义 `/historian-capture`
  正文契约：证据链→方法→修复手段→函数级实现，落成 G1 事件页。
- `capture.enabled`（默认 `false`，常量 `DEFAULT_CAPTURE_ENABLED`，
  `src/config.ts`）开启后会话空闲时提醒一次；仅提醒，绝不自动写页。
- `/historian-capture` 命令本身与开关无关，始终注册。

### 密钥解析链
翻译 key（`translate.apiKey`），按优先级：
1. 配置对象 `translate.apiKey` 字段；
2. 环境变量 `DASHSCOPE_API_KEY`；
3. opencode jsonc 中 `provider[<translate.providerKey>].options.apiKey`
   （仅当显式设置 `translate.providerKey` 才读取；包内不内置默认 provider 名）；
4. 全缺则 `ConfigError('missing-translation-key')`。

wiki.js key，按优先级：
1. `apiKeyPath` 指向的文件（tilde 读取时展开）；
2. 环境变量 `WIKIJS_API_KEY`；
3. 全缺则 `ConfigError('missing-wiki-api-key')`。

`translate.endpoint` 解析链：选项 → 环境变量 `HISTORIAN_TRANSLATE_ENDPOINT` →
未配置。`translate.model` 同理有 `HISTORIAN_TRANSLATE_MODEL` 兜底腿。
包内不内置任何网关地址与设备模型默认
（设备模型不随包，[owner-decision] 2026-10-01，内部代号 [policy-code]）。

### 降级行为
- wiki key 缺失：`ConfigError` 记录一次日志，插件工具全部禁用，
  opencode 正常启动不受影响。
- 翻译腿未配置：双语孪生降级 pending
  （`twinReason: 'translate.endpoint not configured — …'`），
  创建页只写请求 locale 的内容，不发起任何翻译网络请求。
- 缺配置时的部分降级（工具照常注册、仅翻译调用失败）在议。

### 地图与镜像
- 本地镜像 `~/.config/opencode/historian-map.json` 是活查询唯一来源，
  `historian_map show` 直接读它（带过期秒数）。
- `_meta/page-map` wiki 页是审计账本：`historian_map refresh` 每次提交一个新
  修订，wiki 页面历史即全库变更时间线。
- 时间线按 ISO 周分组，可选 `days` 窗口与 `path` 前缀过滤；
  输出人读周表加机读 `weeks` JSON。
- 维护报告 light 档只扫地图行加每 locale 一次 `pages.list`；
  `deep:true` 逐页读正文，补新鲜度标记与 Redirect 存根识别。

### 锚印封存
`historian_anchor`（seal/verify）：在引擎会话库中定位人类订单/批准消息，
哈希并落证据页回执（`_evidence/anchors/`），供事后对账（内部代号 [flow-code]）。

## 质量门禁

### 10 项自检门
每页写入后过一遍自检清单。dry-run 评 1–8，apply 后评 9–10。
清单源码：`src/templates/genres.ts` 的 `selfReviewChecklist()`；
参考文件 `skills/historian/references/rules.md` 与 `genres.md`。
genre-specific 条目对不匹配页型记 N/A=PASS；G5 页第 4–6 项换账本变体
（`G5_CHECKLIST_VARIANTS`），G6 页换手册变体（`G6_CHECKLIST_VARIANTS`）。

1. 导言占比 10–15%：每个重要小节在导言至少占一句。
2. 句长上限：中文句 ≤20 字、英文句 ≤25 词。
3. 表格判据：≥3 字段的结构化枚举入表，成对数据用描述列表。
4. 对比表来源列（G2）：每行有来源列，行序固定、无合并单元格。
   G5 变体：部署物清单每行带「上次核实于」列。
5. 时间线来源列（G1）：每行有来源列，仅日志可证事实。
   G5 变体：验证方法含可执行复核命令。
6. 行动项五要素（G1）：类型|负责人|期限|验证|状态 五列。
   G5 变体：无叙事正文，只有状态块加表格。
7. 无杂项筐：除参见/附录外无「其他/杂项」类小节。
8. 无溢美词：领先/强大/灵活/高效类空断言改事实或删除。
9. 双语 URL 已回报（写后核销）：报告含 en 与 zh 两个可访问 URL。
10. 孪生已建或 pending 声明（写后核销）：twin created，
    或 `zh_status: pending` 已在报告中声明。

手册变体三款：第 4 项要求标题是目标句式「How to X / 如何怎么做 X」；
第 5 项要求每条操作步骤三段（动作+预期结果+失败处置）；
第 6 项要求元数据表含「上次核实」与「复核周期」行。

### SYN 20 规则
20 条写作细则散布在 `skills/historian/references/` 各参考文件，
agent 加载 skill 时自动读取。

## wiki.js 注意事项

### Markdown 速查

| 元素 | 写法 | 说明 |
|---|---|---|
| 提示框 | `> 内容` 加 `{.is-info}` | 还有 warning/danger/success |
| 紧凑表格 | 标准表格加 `{.dense}` | 减小行距 |
| 脚注 | `[^n]` 与底部 `[^n]: 内容` | wiki.js 原生 |
| 定义列表 | `term` 换行 `: definition` | 术语表用 |
| 数学 | `$...$` 与 `$$...$$` | KaTeX，默认开 |
| 流程图 | mermaid 代码块 | 默认开 |
| 标签页 | `{tabset}` 加 `## Tab` | 内容切换 |

禁用：`{{toc}}`（目录由主题生成）；`:::` 容器（不解析）；
YAML frontmatter（API 建页不经过它）。

### API 陷阱与插件应对
原始报告：`docs/research/wikijs-2x-report.md`；
细则：`skills/historian/references/wikijs-guide.md`。

| 陷阱 | 插件应对 |
|---|---|
| `pages.update` 整页替换 | 工具内部 read-modify-write |
| `pages.create` 返回值缺字段 | 创建后立即 readback |
| `responseResult` 嵌套取 `.id` | 解析层统一提取 |
| 空 content 被拒 | `ContentEmptyError` 预检；不传 content 走 template-only |
| 移动不能用 update 改路径 | 独立 `pages.move` mutation |
| `singleByPath` 必须带 locale | 所有查询强制带 locale |
| 附件字段名须 `mediaUpload` | 内部固定（`src/wiki/assets.ts`） |
| 未发布页匿名 404/403 | 草稿在工具输出中标注 |
| 路径不能以 locale 前缀开头 | `validatePath` 拒绝 |

## 内容分层的机器面
- 证据层（tier: evidence）：超 10 行原始件的归宿；单语 en、不发布、
  匿名 404/403 按设计；人读页只链接不复制。
- 软提醒：人读页含超 30 行围栏代码块时，工具结果附 advisory，
  建议把原始件搬 `_evidence/` 页、正文留决定性摘录（每段 ≤10 行）加链接。
  永不阻断写入；证据层页自身不跑此检查。

## 从 historian v2 迁移

旧版依赖 `/opt/wiki-ops/` 下的 Python 脚本（`wiki-ops.py`、`wiki-biling.py`）。
插件完全替代；旧脚本原位保留（标记 LEGACY），无需删除。

升级步骤：
1. 重命名旧 skill：`mv ~/.config/opencode/skills/historian.md ~/.config/opencode/skills/historian.md.v2-disabled`
2. `opencode.json[c]` 的 `plugin` 数组加入 `opencode-wiki-historian`；
3. 重启 opencode，`/historian` 命令可用即 v5 skill 已注入。

命令对照（wiki-ops.py）：

| v2 子命令 | 插件工具 | 备注 |
|---|---|---|
| `list` | `historian_map`（show） | 地图缓存替代全量列表 |
| `read <id>` | `historian_read`（path） | 按 path 定位，不用数字 ID |
| `append <id> <file>` | `historian_page_append` | 直接传 section |
| `create` 三参 | `historian_page_create` | content 直接传 |
| `rebuild-tree` | `historian_map`（refresh） | 从 wiki 重建缓存 |
| `search` | `historian_search`（kind=title） | 标题搜索 |
| `search-content` | `historian_search`（kind=content） | 全文搜索 |
| `fetch` / `fetch-paths` | `historian_read` | path+locale |
| `cache-read` | `historian_map`（show） | 本地镜像 |
| `cache-refresh` | `historian_map`（refresh） | 重建缓存 |
| `delete <id> --confirm` | `historian_delete` | confirm 必须 `"yes"` |

命令对照（wiki-biling.py）：

| v2 子命令 | 插件工具 | 备注 |
|---|---|---|
| `create-bilingual` | `historian_page_create`（twin） | twin 默认开启 |
| `append-bilingual` | `historian_page_append` + sectionZh | sectionZh 带中文 |
| `translate-snippet` | `historian_translate_snippet` | 纯本地，不写 wiki |
| `status` | `historian_map`（show） | 双语状态在地图 |
| `checkpoint` | migrate store 文件 | 进度持久化 |
| `run` | `historian_migrate`（apply） | 支持 dry-run |

## 运维

### 迁移工具（historian_migrate）
1. 先 dry-run（`apply=false`）：看骨架预览与自检评分。
2. 再 apply（`apply=true`）：首次写入前自动生成 pre-image 备份。
3. 回滚：读备份 JSON，用 `historian_page_update` 推回原文。

备份写在运行侧 `results/pilot-backup-*.json`（迁移执行记录，不随包分发，
外部读者仓库里看不到属预期）。进度存 `~/.config/opencode/historian-migrate.json`，
支持断点续跑。

### 评测框架
评测 harness 是维护方私有仓库，与插件仓同工作区，不对外公开。
它提供 7 个行为验收场景：创建、追加、重叠整合、整理、价值门控、G1 格式、
zh URL 报告。试点迁移 7 页 PASS。v3 插件最近一轮内部评测：7/7 PASS、
51/58 适用分、G=1、零重试（`results/2026-09-02-v3-plugin.md`）。
此段为维护记录声明，外部读者无法在本仓库复算，请以此为界。

## 开发命令

```bash
npm run build       # tsc 编译到 dist/
npm test            # vitest run；4 条依赖本机 tools/redlines.local.json，缺则跳过
npm pack --dry-run  # 检查打包文件列表
node tools/privacy-audit.mjs            # 随包文件隐私红线扫描
node tools/portable-binding-audit.mjs   # 防设备绑定的便携面守卫
```

- 打包文件（`files` 字段）：`dist`、`skills`；npm 自动附加 README 与 LICENSE。
  本页（DEVELOPMENT.md）与 `tools/`、`results/`、`.qa/` 均不随包分发。
- 隐私红线覆盖：真实主机、本机路径、本机章节名、密钥形态、个人身份；
  任何命中即非零退出，拦住发布。已接入 `prepublishOnly`。
- 随包文本示例一律占位符化：`http://<your-wiki>:3000`、`team-notes/`、
  `example.com`。

## 发布
流程手册见 [RELEASE.md](RELEASE.md)（npm Trusted Publishing / OIDC，无长命
token）。v0.4.0 时代的人工 2FA 流程已被取代。当前已上架至 0.6.3。

## 内部标识对照
| 标识 | 位置 | 含义 |
|---|---|---|
| `URL_MANDATE` | `src/tools/shared.ts` | 写操作强制回报双语 URL |
| `sectionGuard()` | `src/tools/shared.ts` | sections 白名单预检 |
| `DEFAULT_READING_LOOP` | `src/config.ts` | readingLoop 默认 false |
| `DEFAULT_CAPTURE_ENABLED` | `src/config.ts` | capture 默认 false |
| `CAPTURE_COMMAND_TEMPLATE` | `src/index.ts` | 留痕命令正文契约 |
| `experimental.chat.system.transform` | `src/index.ts` | readingLoop 注入钩子 |
| `selfReviewChecklist()` | `src/templates/genres.ts` | 10 项自检实现 |
| `G5_CHECKLIST_VARIANTS` | `src/templates/genres.ts` | G5 账本变体 |
| `G6_CHECKLIST_VARIANTS` | `src/templates/genres.ts` | G6 手册变体 |
| `mediaUpload` | `src/wiki/assets.ts` | 附件上传固定字段名 |
| `validatePath` | 路径校验层 | 拒 locale 前缀与保留字 |
| [policy-code] | [owner-decision] 2026-10-01 | 包内不内置设备模型默认 |
| [flow-code] | 锚印机制代号 | `historian_anchor` seal/verify |

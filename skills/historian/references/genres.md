# 页型模板 G1-G6

> 六种页型覆盖 wiki 中所有知识形态。选定页型后用对应骨架写作。骨架实现见 `src/templates/skeletons.ts`，本文件是操作指南。

## Phase 1.5 页型分类

在开始写作前，必须声明页型。分类关键词：

| 页型 | 关键词信号 | 何时选 |
|------|-----------|--------|
| G1 事件复盘 | 故障/复盘/事故/incident/postmortem/outage | 记录已发生的事件：症状→根因→修复→预防 |
| G2 对比选型 | 对比/选型/vs/versus/compare/benchmark/alternatives | 比较两个或以上方案，给出选型建议 |
| G3 清单索引 | 清单/列表/inventory/checklist/catalog/命令速查 | 罗列同类对象（端口、模型、命令、配置项） |
| G4 概念原理 | 原理/为什么/how it works/概念/机制 | 解释一个概念或机制的工作原理 |
| G5 现状账本 | 端口/版本/已部署/当前状态/上次核实/last verified + 组件表 | 记录此刻部署/运行态，每行可复核、可追漂移 |
| G6 操作手册 | 如何/怎么/上手/指南/操作手册/操作步骤/how to/steps to/runbook | 读者带着目标来照做办事：前置条件→步骤→回退，每步可核对 |

声明格式：`页型: G<N> <类型名>`（如 `页型: G1 事件复盘`）

若关键词冲突，按页面核心目的选择；仍有歧义则选 G4。

---

## G1 事件复盘 (Incident Postmortem)

记录一次已发生的事件。

**固定节序**：

1. 摘要 (Summary) — 3-5 句概括事件全貌
2. 元数据 (Metadata) — 日期、影响范围、严重级别
3. 背景 (Background) — 事件前的系统状态
4. 时间线 (Timeline) — **三列表**：时间 | 事件 | 来源
5. 量化影响 (Impact) — 数字说话：持续时长、影响用户数、损失
6. 根因 (Root Cause) — 区分直接原因 vs 根本原因；5 Whys
7. 处置 (Remediation) — 止血 vs 根治
8. 行动项 (Action Items) — **六列（含五要素）**：措施(行内容) | 类型 | 负责人 | 期限 | 验证 | 状态
9. 教训 (Lessons Learned) — 做得好 / 做错 / 侥幸
10. 附录 (Appendix) — 决定性摘录（每段 ≤10 行）+ 证据页链接（`_evidence/...`）+ 外部链接（commit/PR/告警）
11. 相关页面 (Related Pages)

**状态块示例**：
```markdown
> **Status**: Active | **Updated**: 2026-09-01 | **Scope**: 2026-08-05 Solar Ray V2 ERC 电源网失明事件复盘
```

---

## G2 对比选型 (Comparison & Selection)

比较方案并给出选型建议。

**固定节序**：

1. 结论先行 (Bottom Line) — 首段给选型结论
2. 维度定义 (Dimension Definitions) — 明确比较维度及权重
3. 对象概览 (Object Overview) — 被比较对象的简要介绍
4. 对比表 (Comparison Table) — 含**来源列**，禁止合并单元格
5. 基准 (Methodology/Benchmark) — 测试方法、数据来源
6. 选型建议 (Recommendation) — 场景化推荐
7. 相关页面 (Related Pages)

**对比表格式**：

| 维度 | A | B | C | 来源 |
|------|---|---|---|------|
| 性能 | 120 tok/s | 85 tok/s | 95 tok/s | bench-2026-08 |

---

## G3 清单索引 (Inventory & Reference)

罗列同类对象，便于查阅。

**固定节序**：

1. 范围声明 (Scope Statement) — 本清单收录什么、不收录什么
2. 内容 (Contents) — 可选的目录概览
3. 条目表 (Entry Table) — 按主题分组的结构化表格
4. 维护说明 (Maintenance Note) — 如何添加/删除条目
5. 相关页面 (Related Pages)

**条目表示例**：

| 名称 | 端口 | 协议 | 状态 | 备注 |
|------|------|------|------|------|
| Wiki.js | 3000 | HTTP | Active | 知识库 |

---

## G4 概念原理 (Concept & Explanation)

解释一个概念、机制或原理。

**固定节序**：

1. 定义 + 收录理由 (Definition + Rationale) — 是什么、为什么值得记录
2. 重要性排序小节 (Aspects by Importance) — 按重要性从高到低展开各方面
3. 工作原理 (How It Works) — 机制详解，可含代码/图示
4. 归因 (Attribution) — 观点来源、不同立场
5. 相关页面 (Related Pages)

---

## G5 现状账本 (Current-State Ledger)

记录机器"此刻部署/运行着什么"的权威快照，供人和 agent 索引现状、追踪漂移。是状态卡，不是叙事页。

**固定节序**：

1. 状态块 — 机读单行取值：`Active` | `Superseded-by: <path>` | `Deprecated`
2. 部署物清单 (Component Table) — 每行必填：组件 | 版本 | 端口/路径 | 端点 | 依赖 | **上次核实于**
3. 依赖与集成 (Dependencies & Integration) — 外部依赖与被依赖方
4. 失效策略 (Invalidation Policy) — 什么事件作废本卡 + 复核周期
5. 验证方法 (Verification) — 每组件一条可执行命令，agent 可直接复跑核实
6. 变更记录 (Change Log) — 仅追加小表（日期 | 变更 | 依据）；完整历史写 G1 事件页并交叉引用
7. 相关页面 (Related Pages)

**部署物清单示例**（占位值，勿用真实部署）：

| 组件 | 版本 | 端口/路径 | 端点 | 依赖 | 上次核实于 |
|------|------|-----------|------|------|------------|
| example-svc | 1.2.3 | 8000 | http://example.com/api | postgres | 2026-09-01 |

**禁止**：叙事正文；行缺「上次核实于」；验证方法写成散文。**Supersede**：现状大改时新建卡，旧卡状态行改 `Superseded-by: <新卡路径>` 并保留，不删除。自检门第 4-6 项对 G5 换用账本变体判据（见 `src/migrate-score.ts` 的 `scoreG5Item*`）。

---

## G6 操作手册 (How-to Manual)

读者带着一个目标来，照编号步骤操作、每步当场可核对。原理写 G4、命令清单写 G3、事故经过写 G1，经「相关页面」链回本页。

**目标命名规则**：H1 标题 = 一个可执行目标，用目标句式「如何在 X 做 Y」/ "How to X"，且与页面 title 字段一致；禁止用名词短语命名（自检项 4，how-to 变体判据见 `src/templates/genres.ts` 的 `G6_CHECKLIST_VARIANTS`）。

**固定节序**：

1. 目标句式标题（H1）— 与 title 一致
2. 状态行 + 本页回答 — `**状态/Status**: Active · **日期/Date**: …`，一句话划清手册边界
3. 目标 (Goal) — 完成后的结果与可观察的成功判据
4. 前置条件 (Prerequisites) — **三列表**：条件 | 检查方法 | 预期结果，逐行可当场核对
5. 操作步骤 (Steps) — 编号；每步**三段**：动作 + 预期结果 + 失败处置（自检项 5）
6. 回退 (Rollback) — 如何恢复原状；不可逆操作必须事先警示
7. 元数据表 (Metadata) — 状态 | 上次核实 | 复核周期 | 被取代于 | 来源类型（自检项 6；字段契约见「新鲜度字段规范」节）
8. 相关页面 (Related Pages) — 链向 G3/G4/G1

**禁止**：步骤写成没有预期结果的连续段落；把 G4 讲解伪装成步骤；前置条件检查靠"感觉"而非可执行命令。

---

## 证据页协议 (Evidence Pages)

触发条件 (Trigger)：任何想贴进页面的原始件——日志、会话转写、大 diff——超过 10 行时不贴正文，转存证据页。
Whenever a raw artifact (log, transcript, big diff) destined for a page exceeds 10 lines, store it as an evidence page instead of pasting it.

- 命名 (Naming)：`_evidence/<主题>--<yyyymmdd>`（如 `_evidence/wiki-oom--20260805`）
- 建页 (Create)：`historian_page_create` 传 `tier: "evidence"`——证据页为机器层：单语 en、隐藏、不发布，不走 G1-G6 骨架、不占双语孪生与索引。
- 引用 (Cite)：人工页面（G1 附录、G5 变更记录「依据」列等）只放证据页 URL 加决定性摘录（每段 ≤10 行），永不内嵌原文转储。

---

## 四段式捕获契约 (/historian-capture)

`/historian-capture` 命令的正文契约（模板实现 `CAPTURE_COMMAND_TEMPLATE`，见 `src/index.ts`）：只有命中触发条件的素材才写页，正文按证据链顺序四段组织。

**捕获触发条件**（任一命中才动笔）：事故闭环（有根因）| 部署完成 | bug 修复合入 | 探针结论 | 被否决方案（须记录否决理由）。

**四段正文顺序**：

1. 证据链 / Evidence — 观察到什么，制品先行（链接证据页）
2. 方法 / Method — 怎么证明的
3. 修复手段 / Fix — 改了什么或定了什么
4. 函数级实现 / Implementation — file:symbol 级细节

**SRE 纪律元数据表行**：影响/impact | 负责人/owner | 后续动作/action items（每条含 owner + 优先级/priority + 可验证的完成态）| 来源类型/source kind。

**正文引用化**：四段素材的完整原文落 `tier: "evidence"` 证据页（命名规则见上节），主页正文只保留摘要式引用 + 证据页链接，永不内嵌原文转储。

**发布态流转**：新页以 `状态: draft` 建页 → 建页时十项自检打分 advisory（FAIL ≥3 条时提示 `自检 N/10 未通过: … (不阻断, 发布前请补齐)`）→ 用 `historian_page_update` 补齐失败项，通过后才改 `Active`。advisory 不拦截写入，但 capture 新建页必经此流转（rules.md SYN-23）。收尾回显 en/zh 双语孪生 URL。

---

## Redirect 存根规范

wiki.js 无原生 redirect（API 探针证实），bold-merge 弃用路径以**存根**落地——不删页。

**流程**：内容并集合入 canonical（双语）→ 被弃路径**用 `historian_page_update` 原地**改为存根正文——是 update 不是 create（该路径上的页还活着），更不是 delete；zh 孪生同步原地改为存根。

**存根正文模板**（正文仅此一行，行首起始，见 rules.md SYN-22）：

```markdown
> Redirect: <canonical 页 URL>
```

en 页指向 `/en/...` canonical，zh 页指向 `/zh/...` canonical。

**maintain 计数口径**（`src/maintain.ts`）：轻量模式不读正文、报告 Redirect 不可见（提示 rerun with deep）；`deep: true` 时逐页取首个非空行，命中 `/^>\s*Redirect:/i` 记作存根，`redirects.count` 与逐条 `path (locale) → target` 列入 "Redirect stubs" 节。存根是中转指针，**豁免新鲜度巡检**（不计入缺核实/超期复核）；孪生缺口按路径 locale 计数，**要求双语都建存根**正是为使存根路径两locale齐备、不误入 twin-gap 报告——只改单语的存根会被点名缺孪生。

---

## 新鲜度字段规范

G5/G6 的新鲜度元数据统一落进页面 markdown **元数据表**（wiki.js 无 frontmatter），供 `historian_map action:"maintain"` 深扫机读。字段契约（表格首列标签 | 取值）：

| 行标签 | 取值 | 作用 |
|--------|------|------|
| 状态 | draft / Active / Superseded-by: <路径> / Deprecated | 发布态流转（SYN-23）与退役指针 |
| 上次核实 | YYYY-MM-DD（+在什么环境按本页什么步骤重跑过） | 证明页面当天被核实过 |
| 复核周期 | 下一个复核期限日期 YYYY-MM-DD（可括注节奏，如「每 90 天，至 2026-12-01」） | 日期到期即进超期报告 |
| 被取代于 | 新页路径，无则填 — | 退役后的去向 |
| 来源类型 | human / agent / imported | 溯源分类 |

**maintain 判定语义**（以 `src/maintain.ts` 代码为准，巡检范围=分类为 G5/G6 的页面）：

- **上次核实**：正文匹配 `/上次核实|last verified/i` 即视为有戳，否则计入 `missingLastVerified`。G5 以部署物清单每行「上次核实于」列满足；G6 以元数据表「上次核实」行满足。
- **复核到期**：只认元数据表中首列标签命中 `/^(复核周期|复核期限|复核日期|review[-_ ]?by|review[-_ ]?due)$/i` 的**表行**，从取值列提取第一个 `YYYY-MM-DD` 解析；早于今天 → `review overdue: <路径> (<locale>) since <日期> (<N>d)`。取值只有「每 90 天」而无具体日期时机器无法判到期——所以复核周期取值**必须写成下一个复核期限日期**。
- Redirect 存根行豁免本节两项检查（见上节）。

---

## 通用元素（所有页型共享）

### 状态块（H1 后紧跟）

```markdown
> **Status**: Active | **Updated**: 2026-09-01 | **Scope**: 一句话回答本页解决什么问题
```

状态取值：`Active`（当前事实）| `Historical`（保留上下文，已非当前）| `Superseded`（被取代，附 banner + 链接）

中文页：`> **状态**: 活跃 | **更新**: … | **范围**: …`

### 表达件速查

| 元素 | 语法 | 用途 |
|------|------|------|
| 提示块 | `> 内容\n{.is-info}` | 重要提示（可选 `is-warning` / `is-danger` / `is-success`） |
| 紧凑表 | 表格后 `{.dense}` | 减少表格行距 |
| 脚注 | `[^1]` 定义 `[^1]: 内容` | 补充说明 |
| 标签页 | `[Tab A](#tab-a)` + `## Tab A` | 多选项展示 |

### 禁止使用

- ❌ `{{toc}}` — wiki.js 不处理，会原样输出
- ❌ `:::` container — wiki.js 不识别，会破坏渲染
- ❌ YAML frontmatter (`---\ntitle: ...\n---`) — wiki.js 会把它当正文显示
- ❌ `[[path|label]]` 旧链接语法 — 用 `[Label](/path)`

## 来源

骨架实现：`src/templates/skeletons.ts`（G1_ZH/G1_EN/G2_ZH/G2_EN/G3_ZH/G3_EN/G4_ZH/G4_EN/G5_ZH/G5_EN/G6_ZH/G6_EN）。
分类规则：`src/templates/genres.ts`（`classifyGenre` 函数）；G5 门控判据：`src/migrate-score.ts`（`scoreG5Item4/5/6`）；G6 门控判据：`src/templates/genres.ts`（`G6_CHECKLIST_VARIANTS`）。
新鲜度与 Redirect 计数：`src/maintain.ts`；捕获契约模板：`src/index.ts`（`CAPTURE_COMMAND_TEMPLATE`）；撞车 advisory：`src/tools/shared.ts`（`collisionAdvisory`）。
调研依据：`docs/research/cross-cultural-wiki-writing.md` Genre templates 节。

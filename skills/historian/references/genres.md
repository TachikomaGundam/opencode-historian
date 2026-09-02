# 页型模板 G1-G5

> 五种页型覆盖 wiki 中所有知识形态。选定页型后用对应骨架写作。骨架实现见 `src/templates/skeletons.ts`，本文件是操作指南。

## Phase 1.5 页型分类

在开始写作前，必须声明页型。分类关键词：

| 页型 | 关键词信号 | 何时选 |
|------|-----------|--------|
| G1 事件复盘 | 故障/复盘/事故/incident/postmortem/outage | 记录已发生的事件：症状→根因→修复→预防 |
| G2 对比选型 | 对比/选型/vs/versus/compare/benchmark/alternatives | 比较两个或以上方案，给出选型建议 |
| G3 清单索引 | 清单/列表/inventory/checklist/catalog/命令速查 | 罗列同类对象（端口、模型、命令、配置项） |
| G4 概念原理 | 原理/为什么/how it works/概念/机制 | 解释一个概念或机制的工作原理 |
| G5 现状账本 | 端口/版本/已部署/当前状态/上次核实/last verified + 组件表 | 记录此刻部署/运行态，每行可复核、可追漂移 |

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
10. 附录 (Appendix) — 原始日志片段、截图
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

骨架实现：`src/templates/skeletons.ts`（G1_ZH/G1_EN/G2_ZH/G2_EN/G3_ZH/G3_EN/G4_ZH/G4_EN/G5_ZH/G5_EN）。
分类规则：`src/templates/genres.ts`（`classifyGenre` 函数）；G5 门控判据：`src/migrate-score.ts`（`scoreG5Item4/5/6`）。
调研依据：`docs/research/cross-cultural-wiki-writing.md` Genre templates 节。

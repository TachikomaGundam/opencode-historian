/**
 * Bilingual G1–G4 page skeletons (template data).
 *
 * Provenance: `.omo/research/cross-cultural-wiki-writing-digest.md` (Genre
 * templates + SYN-1..20) and `.omo/research/wikijs-2x-capabilities-digest.md`
 * (expression syntax), vendored at `docs/research/*`.
 *
 * Contract of every skeleton constant:
 *  - Rubric dimension C anatomy: H1 placeholder → status line
 *    `**状态/Status**: Active <!-- or Historical/Superseded --> · **日期/Date**: YYYY-MM-DD`
 *    → one-line scope (`This page answers:` / `本页回答：`) → tail
 *    `Related Pages`/`相关页面` section with a real-link hint (SYN-9 fixed tail).
 *  - wiki.js 2.x expression pieces only: blockquote admonitions
 *    (`> …` + `{.is-info}`), `{.dense}` tables, `[^1]` footnotes.
 *  - FORBIDDEN: `{{toc}}`, `:::` containers, YAML frontmatter (`---` at pos 0) —
 *    wiki.js does not support them (they render as body text or v-pre escapes).
 *  - Language-native: zh skeletons use 中文节标题 and zh author guidance,
 *    en skeletons English; the bilingual pairs correspond section-for-section.
 *  - Inline `<!-- … -->` comments carry author guidance per section (what to
 *    write, length caps); placeholders are marked 占位/placeholder and must be
 *    replaced by the author before publishing.
 *
 * // allow: SIZE_OK — pure template data, one constant per (genre, lang);
 *     split across files would buy nothing (each pair is a single narrative).
 */

/** G1 — 事件/复盘页 (incident postmortem), zh. */
export const G1_ZH: string = `# 页面标题（占位：写完后替换为实际标题，须与页面 title 一致）

**状态/Status**: Active <!-- or Historical/Superseded --> · **日期/Date**: YYYY-MM-DD

**本页回答：** 一句话范围句（占位：本页记录哪次故障/事件的起因、影响与处置）

> **提示**
> 导言按金字塔结构结论先行，3–5 句：发生了什么 → 影响多大 → 根因是什么 → 已采取什么处置 → 教训。导言不得包含正文没有的事实。
{.is-info}

## 摘要

<!-- 3–5 句金字塔导言：事件、影响、根因、处置、教训各一句；导言中的每个要点在正文都有展开。 -->

## 元数据表

| 元数据 | 值 |
| --- | --- |
| 影响范围 | <!-- 哪些服务/用户/区域受影响 --> |
| 持续时间 | <!-- 起止时间，如 2026-09-01 14:02–15:47 (UTC+8) --> |
| 严重度 | <!-- P0/P1/P2（或 S1–S4），并写明判定依据 --> |

## 背景

<!-- 前置上下文 2–5 句：系统本应如何工作，为何这次故障成为可能。 -->

## 时间线

<!-- 只记可查证事实：以日志/告警为准，不以口述为准；相邻事件 ≠ 因果关系。每行必须填来源列。 -->

| 时间 | 事件 | 来源 |
| --- | --- | --- |
| YYYY-MM-DD HH:MM | <!-- 发生了什么 --> | <!-- 告警/日志/commit 链接 --> |

## 量化影响

<!-- 用可验证数字说话：影响时长、受影响请求数/用户数/成本、SLO/SLA 偏离；小数不超过两位。 -->

## 根因分析

**直接原因**：<!-- 触发故障的具体动作或条件 -->

**根本原因**：<!-- 让直接原因能够发生的设计/流程/依赖缺陷 -->

<!-- 5 Whys：从直接原因逐层追问，每层回答"Why"后追问下一层，最后收敛到根本原因。 -->
1. Why: <!-- 第 1 层：为什么直接原因会发生 -->
2. Why: <!-- 第 2 层 -->
3. Why: <!-- 第 3 层 -->
4. Why: <!-- 第 4 层 -->
5. Why: <!-- 第 5 层：收敛到根本原因 -->

## 处置

| 类别 | 措施 | 完成时间 |
| --- | --- | --- |
| 止血 | <!-- 立即恢复服务的动作 --> | <!-- YYYY-MM-DD HH:MM --> |
| 根治 | <!-- 防止再次发生的结构性修复 --> | <!-- 完成或计划时间 --> |

## 行动项

| 措施 | 类型 | 负责人 | 期限 | 验证 | 状态 |
| --- | --- | --- | --- | --- | --- |
| <!-- 做什么 --> | <!-- prevent/mitigate/process --> | <!-- 负责人 --> | YYYY-MM-DD | <!-- 如何证明已完成 --> | <!-- 待办/进行中/已完成 --> |

<!-- 每个根因主题至少一个 prevent 行动项；验证列必须可检查，否则行动项不算完成。 -->

## 教训

### 做得好

<!-- 诚实记录有效做法；出过事不等于一切都不对。 -->

### 做错

<!-- 写成可复用的反模式，禁止人身归因（无指责复盘）。 -->

### 侥幸

<!-- 哪些环节差点更糟；哪些伏笔这次没爆、下次可能爆。 -->

## 附录

<!-- 原始证据：告警截图、日志片段、commit/PR 链接。脚注示例： -->
见脚注[^1]。

[^1]: 来源链接（替换为真实出处）

## 相关页面

<!-- 列出与本页互链的真实页面路径，例如：[服务架构](./architecture)。 -->`;

/** G1 — incident postmortem, en (section-for-section twin of G1_ZH). */
export const G1_EN: string = `# Page Title (placeholder: replace with the real title, must match the page title)

**状态/Status**: Active <!-- or Historical/Superseded --> · **日期/Date**: YYYY-MM-DD

**This page answers:** one-line scope sentence (placeholder: which incident this page records, its impact and handling)

> **Tip**
> Lead follows an inverted pyramid, 3–5 sentences: what happened → how big the impact → root cause → remediation → lesson. No fact in the lead that is not in the body.
{.is-info}

## Summary

<!-- 3–5 sentence pyramid lead: one sentence each for event, impact, root cause, remediation, lesson. -->

## Metadata

| Field | Value |
| --- | --- |
| Blast radius | <!-- services/users/regions affected --> |
| Duration | <!-- start–end, e.g. 2026-09-01 14:02–15:47 (UTC+8) --> |
| Severity | <!-- P0/P1/P2 (or S1–S4) with the basis for the rating --> |

## Background

<!-- 2–5 sentences of context: how the system was supposed to work, and what made the incident possible. -->

## Timeline

<!-- Verifiable facts only: log/alert-based, not memory-based; adjacent events ≠ causation. Every row needs its source column filled. -->

| Time | Event | Source |
| --- | --- | --- |
| YYYY-MM-DD HH:MM | <!-- what happened --> | <!-- alert/log/commit link --> |

## Quantified Impact

<!-- Numbers: duration, affected requests/users, cost, SLO/SLA deviation; no float beyond two decimal places. -->

## Root Cause

**Direct cause**: <!-- the concrete trigger -->

**Root cause**: <!-- the design/process/dependency flaw that let the trigger happen -->

<!-- 5 Whys: five consecutive why-layers from the trigger to the root, each layer answered before the next question is asked. -->
1. Why: <!-- layer 1: why did the direct cause happen -->
2. Why: <!-- layer 2 -->
3. Why: <!-- layer 3 -->
4. Why: <!-- layer 4 -->
5. Why: <!-- layer 5: converges on the root cause -->

## Remediation

| Kind | Action | Done |
| --- | --- | --- |
| Stop-the-bleed | <!-- immediate restore action --> | <!-- YYYY-MM-DD HH:MM --> |
| Fix-the-root | <!-- structural fix preventing recurrence --> | <!-- completed or planned date --> |

## Action Items

| Action | Type | Owner | Due | Verification | Status |
| --- | --- | --- | --- | --- | --- |
| <!-- what to do --> | <!-- prevent/mitigate/process --> | <!-- owner --> | YYYY-MM-DD | <!-- how to prove it is done --> | <!-- todo/in progress/done --> |

<!-- At least one prevent item per root-cause theme; an action item without a checkable verification is not done. -->

## Lessons

### What Went Well

<!-- Honest: an incident does not invalidate everything that worked. -->

### What Went Wrong

<!-- Reusable anti-patterns; never blame people (blameless postmortem). -->

### Lucky Breaks

<!-- What almost made it worse? Which lurking risk will bite next time? -->

## Appendix

<!-- Raw evidence: alert screenshots, log excerpts, commit/PR links. Footnote example: -->
See footnote[^1].

[^1]: Source link (replace with the real source)

## Related Pages

<!-- List real page paths that link here and back, e.g.: [Service architecture](./architecture). -->`;

/** G2 — 对比/选型页 (comparison / selection), zh. */
export const G2_ZH: string = `# 页面标题（占位：写完后替换为实际标题，须与页面 title 一致）

**状态/Status**: Active <!-- or Historical/Superseded --> · **日期/Date**: YYYY-MM-DD

**本页回答：** 一句话范围句（占位：本页在哪些对象之间、按什么维度对比，结论是什么）

## 结论先行

<!-- 第一段直接给答案：选哪个对象、为什么；导言不得包含正文没有的事实。 -->

> **选型建议**
> 选择 对象 A：一句话理由。若 前提 X 不成立，见「选型建议」小节的条件式清单。
{.is-info}

## 维度定义

| 维度 | 为什么重要 | 数据来源 |
| --- | --- | --- |
| <!-- 如：p99 延迟 --> | <!-- 该维度如何影响决策 --> | <!-- 官方文档/基准/实测 --> |

<!-- 每个维度一句"为什么重要"，读者才能判断该维度是否适用于自己的场景。 -->

## 对象概览

<!-- 每个对象一个小节或描述列表：一句话定位 + 关键特性；被推荐对象放在最前。 -->

## 对比

<!-- 行 = 维度，列 = 对象与来源列；行序固定；禁止合并单元格。 -->

| 维度 | 对象 A | 对象 B | 对象 C | 来源 |
| --- | --- | --- | --- | --- |
| <!-- 维度 --> | <!-- 值 --> | <!-- 值 --> | <!-- 值 --> | <!-- 出处链接 --> |
{.dense}

## 基准与方法

<!-- 测试环境、版本号、负载、采样时长——方法透明，别人才能复现或质疑。 -->

## 选型建议

<!-- 条件式建议：不同前提 → 不同选择，每行一条。 -->
- 如果 前提（如团队规模/流量/预算），选择 对象 A，因为 一句话理由
- 如果 前提，选择 对象 B，因为 一句话理由
- 如果 前提，选择 对象 C，因为 一句话理由

## 相关页面

<!-- 列出与本页互链的真实页面路径。 -->`;

/** G2 — comparison / selection, en (section-for-section twin of G2_ZH). */
export const G2_EN: string = `# Page Title (placeholder: replace with the real title, must match the page title)

**状态/Status**: Active <!-- or Historical/Superseded --> · **日期/Date**: YYYY-MM-DD

**This page answers:** one-line scope sentence (placeholder: what is compared, on which dimensions, and the pick)

## Bottom Line

<!-- The first paragraph IS the answer: which option and why; no fact in the lead that is not in the body. -->

> **Recommendation**
> Choose Option A: one-line reason. If premise X does not hold, see the conditional list in "Recommendation".
{.is-info}

## Dimension Definitions

| Dimension | Why it matters | Data source |
| --- | --- | --- |
| <!-- e.g. p99 latency --> | <!-- how it affects the decision --> | <!-- docs/benchmark/measurement --> |

<!-- One "why it matters" sentence per dimension so readers can judge fit for their own case. -->

## Object Overview

<!-- One short subsection or description list per object: one-line positioning + key traits; recommended object first. -->

## Comparison

<!-- Rows = dimensions; columns = options plus a source column; fixed row order; no merged cells. -->

| Dimension | Option A | Option B | Option C | Source |
| --- | --- | --- | --- | --- |
| <!-- dimension --> | <!-- value --> | <!-- value --> | <!-- value --> | <!-- citation link --> |
{.dense}

## Methodology

<!-- Environment, versions, load, sample window — a transparent method that others can reproduce or contest. -->

## Recommendation

<!-- Conditional advice: different premises → different picks, one line each. -->
- If premise (team size / traffic / budget), choose Option A, because one-line reason
- If premise, choose Option B, because one-line reason
- If premise, choose Option C, because one-line reason

## Related Pages

<!-- List real page paths that link here and back. -->`;

/** G3 — 清单/参考页 (inventory / reference), zh. */
export const G3_ZH: string = `# 页面标题（占位：写完后替换为实际标题，须与页面 title 一致）

**状态/Status**: Active <!-- or Historical/Superseded --> · **日期/Date**: YYYY-MM-DD

**本页回答：** 一句话范围句（占位：本页收录哪类条目、覆盖到哪里、不覆盖什么）

## 范围声明

<!-- 明确收录/不收录边界：覆盖 X、不覆盖 Y，入选标准一句话；没有范围声明的清单，读者无法判断"没出现 = 不存在"还是"没收录"。 -->

> **提示**
> 清单页导言必须先声明范围，再给条目。
{.is-info}

## 目录（结构镜像）

<!-- 小节顺序镜像被测系统/命令树的真实结构（map principle）：读者按目录即可找到条目。 -->

## 条目表

| 条目 | 说明 | 用法/命令 | 相关链接 |
| --- | --- | --- | --- |
| <!-- 名称 --> | <!-- 一句话说明 --> | <!-- 平行句式的用法 --> | <!-- 已存在的页面 --> |
{.dense}

<!-- 平行句式：每个单元格用同一语法结构；日期一律写绝对日期（YYYY-MM-DD），不写"最近"；只链接已存在页面。 -->

## 维护说明

<!-- 更新频率、谁维护、新增条目的检查项（与同类条目同构、有来源、链接存在）。 -->

## 相关页面

<!-- 列出与本页互链的真实页面路径。 -->`;

/** G3 — inventory / reference, en (section-for-section twin of G3_ZH). */
export const G3_EN: string = `# Page Title (placeholder: replace with the real title, must match the page title)

**状态/Status**: Active <!-- or Historical/Superseded --> · **日期/Date**: YYYY-MM-DD

**This page answers:** one-line scope sentence (placeholder: which entries are covered, up to what boundary)

## Scope Statement

<!-- State the inclusion/exclusion boundary explicitly: covers X, not Y, and the one-line admission bar; without it readers cannot tell "absent" from "not collected". -->

> **Tip**
> A reference page must state its scope before listing entries.
{.is-info}

## Contents (Structure Mirror)

<!-- Order the sections to mirror the real structure of the system/command tree (map principle): readers find entries by following the table of contents. -->

## Entry Table

| Entry | Description | Usage / Command | Related link |
| --- | --- | --- | --- |
| <!-- name --> | <!-- one-line description --> | <!-- parallel-syntax usage --> | <!-- existing page --> |
{.dense}

<!-- Parallel syntax: every cell uses the same grammatical shape; dates are always absolute (YYYY-MM-DD), never "recently"; link only pages that already exist. -->

## Maintenance Note

<!-- Update cadence, who maintains it, the checklist for new entries (same shape as siblings, sourced, links resolve). -->

## Related Pages

<!-- List real page paths that link here and back. -->`;

/** G4 — 概念/原理解析页 (concept / explanation), zh. */
export const G4_ZH: string = `# 页面标题（占位：写完后替换为实际标题，须与页面 title 一致）

**状态/Status**: Active <!-- or Historical/Superseded --> · **日期/Date**: YYYY-MM-DD

**本页回答：** 一句话范围句（占位：本页解释哪个概念，读者看完能理解什么）

## 定义与收录理由

<!-- 定义先行且门外汉可懂，不依赖行话；收录理由 = 这个概念为何值得单独成页。 -->

> **提示**
> 定义必须让没有背景的读者也能读懂；正文中第一个出现的不常见术语当场解释。
{.is-info}

## 方面一（占位：最重要的方面，改成描述性标题）

<!-- H2 小节按重要性降序排列；每个小节先总结后展开；每层小节总结下一层内容。 -->

## 方面二（占位：次重要的方面）

<!-- 若只有一个方面，删掉多余小节；禁止"其他/杂项"类 catch-all 小节。 -->

## 机制说明

<!-- 概念如何运作：输入 → 过程 → 输出，配必要示例；≥3 字段的结构化数据入表。 -->

## 归因与观点

<!-- 明确标注：哪些是社区共识（附来源），哪些是作者观点（写明"本文作者认为…"）；评价性表述必须归属，不得代 wiki 自行评断。 -->

## 参见

<!-- 可选：与此概念最直接相关的页面；无直接相关页面时可并入「相关页面」。 -->

## 相关页面

<!-- 列出与本页互链的真实页面路径。 -->`;

/** G4 — concept / explanation, en (section-for-section twin of G4_ZH). */
export const G4_EN: string = `# Page Title (placeholder: replace with the real title, must match the page title)

**状态/Status**: Active <!-- or Historical/Superseded --> · **日期/Date**: YYYY-MM-DD

**This page answers:** one-line scope sentence (placeholder: which concept is explained and what the reader will understand)

## Definition and Rationale

<!-- Define first, readable without background, no jargon assumptions; the rationale = why this concept deserves its own page. -->

> **Tip**
> The definition must be understandable without background; explain the first uncommon term it uses right there.
{.is-info}

## Aspect 1 (placeholder: most important aspect; rename to a descriptive heading)

<!-- H2 sections sorted by importance, most important first; each section summarizes before expanding; each layer summarizes the layer below it. -->

## Aspect 2 (placeholder: the second-most important aspect)

<!-- Delete surplus sections when there is only one aspect; no "other/miscellaneous" catch-all sections. -->

## How It Works

<!-- How the concept operates: input → process → output, with a working example; structured data with ≥3 fields goes into a table. -->

## Attribution and Opinion

<!-- Mark explicitly what is community consensus (with sources) and what is the author's view (state "the author believes…"); evaluative language must be attributed, never the wiki's own judgment. -->

## See Also

<!-- Optional: the pages most directly related to this concept; fold into "Related Pages" when there are none. -->

## Related Pages

<!-- List real page paths that link here and back. -->`;

/** G5 — 现状卡/部署现状账本页 (current-state ledger), zh. Status + tables only:
 *  one authoritative snapshot of what is deployed/running NOW, per-row
 *  last-verified dates, agent-executable re-check commands. Narrative history
 *  belongs to G1 event pages, linked from 变更记录. */
export const G5_ZH: string = `# 页面标题（占位：写完后替换为实际标题，须与页面 title 一致）

**状态/Status**: Active <!-- or Superseded-by: <path> / Deprecated --> · **日期/Date**: YYYY-MM-DD

**本页回答：** 当前部署状态（占位：写明范围）

> **提示**
> 现状卡只存事实快照：一行一个部署物。
> 叙述性历史写进 G1 事件页，从变更记录链过去。
{.is-info}

## 部署物清单

| 组件 | 版本 | 端口/路径 | 端点 | 依赖 | 上次核实于 |
| --- | --- | --- | --- | --- | --- |
| example-api | 1.2.3 | 8000 | http://example.com:8000/health | postgres | YYYY-MM-DD |

<!-- 每行须能被验证方法当场复核。核实日期不得留空。 -->

## 依赖与集成

| 集成对象 | 方向 | 用途 | 失效影响 |
| --- | --- | --- | --- |

<!-- 只列正在生效的集成。已解除的记入变更记录。 -->

## 失效策略

<!-- 写明使本卡过期的事件。例：版本变更、端口调整、依赖下线。 -->
<!-- 复查节奏：默认每 30 天逐行重跑验证命令。 -->

## 验证方法

| 组件 | 复核命令 | 预期结果 |
| --- | --- | --- |
| example-api | \`curl -s http://example.com:8000/health\` | HTTP 200 |

<!-- 命令须 agent 可直接执行。禁止登录机器看看式模糊描述。 -->

## 变更记录

| 日期 | 变更 | 依据 |
| --- | --- | --- |
| YYYY-MM-DD | 初版快照 | — |

<!-- 追加式小表：只记影响清单行的变更。完整历史写 G1 事件页并互链。 -->

## 相关页面

<!-- 列出互链的真实页面路径。事故史放 G1 页并在依据列引用。 -->`;

/** G5 — current-state ledger, en (section-for-section twin of G5_ZH). */
export const G5_EN: string = `# Page Title (placeholder: replace with the real title, must match the page title)

**状态/Status**: Active <!-- or Superseded-by: <path> / Deprecated --> · **日期/Date**: YYYY-MM-DD

**This page answers:** what is deployed and running right now (placeholder: name the system and scope)

> **Tip**
> A ledger stores fact snapshots, not prose: one deployed component per row.
> Narrative history belongs in G1 event pages, linked from the change log.
{.is-info}

## Deployed Components

| Component | Version | Port/Path | Endpoint | Depends on | Last verified |
| --- | --- | --- | --- | --- | --- |
| example-api | 1.2.3 | 8000 | http://example.com:8000/health | postgres | YYYY-MM-DD |

<!-- Every row must be re-checkable by a command in Verification. Never leave the date blank. -->

## Dependencies and Integration

| Counterpart | Direction | Purpose | Impact if gone |
| --- | --- | --- | --- |

<!-- List only integrations in force. Record removed ones in the change log. -->

## Invalidation Policy

<!-- Name the events that stale this card: version bumps, port moves, dependency retirements. -->
<!-- Review cadence: re-run every verification command every 30 days by default. -->

## Verification

| Component | Re-check command | Expected result |
| --- | --- | --- |
| example-api | \`curl -s http://example.com:8000/health\` | HTTP 200 |

<!-- Commands must be agent-executable as written. Vague steps like log in and look are forbidden. -->

## Change Log

| Date | Change | Evidence |
| --- | --- | --- |
| YYYY-MM-DD | initial snapshot | — |

<!-- Append-only mini table for list-affecting changes. Full history lives in G1 event pages. -->

## Related Pages

<!-- List the real page paths that link here and back. Event histories go in G1 pages, cited in Evidence. -->`;
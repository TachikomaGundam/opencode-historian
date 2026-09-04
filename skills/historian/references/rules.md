# 写作规则 23 条 (SYN-1..23)

> 跨文化 wiki 写作的通用合成规则。SYN-1..20 每条可在 `docs/research/cross-cultural-wiki-writing.md` 找到原始调研证据；SYN-21..23 为 v4 策展闭环新增，依据 `src/` 已合入实现。

| # | 规则 | 要点 |
|---|------|------|
| SYN-1 | **结论先行** | 首段给出结论或行动建议，不要让读者猜。技术文档不是悬疑小说。 |
| SYN-2 | **一页一问** | 一个页面回答一个问题。回答了两个就拆；两个页面答同一个就合并或 supersede。 |
| SYN-3 | **导言密度** | 导言占全文 10-15%，概括全文核心结论。超出则裁剪，不足则补全。 |
| SYN-4 | **句长约束** | 中文句 ≤20 字，英文句 ≤25 词。超过就拆句。 |
| SYN-5 | **表格判据** | ≥3 个字段的结构化数据用表格；≤2 字段用描述列表或行内文本。 |
| SYN-6 | **来源列** | 对比表与时间线表必须含「来源」列。无来源的断言不可信。 |
| SYN-7 | **时间线三列** | 事件时间线表固定三列：时间 | 事件 | 来源。缺来源列=不合格。 |
| SYN-8 | **行动项五要素** | 行动项表六列（含五要素）：措施(行内容) | 类型 | 负责人 | 期限 | 验证 | 状态。五要素=类型、负责人、期限、验证、状态。 |
| SYN-9 | **固定尾部** | 每页尾部必须有 `## Related Pages` / `## 相关页面` 节，挂至少一个真实链接到现存页面。 |
| SYN-10 | **状态块** | H1 后紧跟状态块：`> **Status**: Active | **Updated**: YYYY-MM-DD | **Scope**: 一行回答本页回答什么问题`。状态取值 `Active` / `Historical` / `Superseded`。中文页用 `状态`/`更新`/`范围`。 |
| SYN-11 | **无杂项筐** | 禁止「其他」「杂项」「Miscellaneous」节。归不进去的内容放别的页面或不放。 |
| SYN-12 | **无溢美词** | 禁止「robust」「streamline」「leverage」「utilize」「world-class」「cutting-edge」及其等价中文（「强大的」「领先的」「赋能」）。用事实和数据说话。 |
| SYN-13 | **无占位债** | 禁止 TODO、TBD、待补充。不知道就不写那个节。 |
| SYN-14 | **原始数据精度** | 数字按需保留精度。`65.38461538461539/100` 写 `65.4/100`，除非精度本身是要点。 |
| SYN-15 | **禁止空节** | `### 优点` 下写 `（无）`→ 删掉整个节。空节占空间不传递信息。 |
| SYN-16 | **禁止原始转储** | shell 输出、聊天日志、超过 5-10 行的堆栈跟踪不直接入页。提取发现，只引用决定性行。确需保全原文时转存证据页：`_evidence/<主题>--<yyyymmdd>`（`historian_page_create` 传 `tier: "evidence"`），页面里只放链接。 |
| SYN-17 | **时间 vs 主题** | 参考页按主题组织，不按天记日记。时间线结构只用于事件/事故页(G1)。 |
| SYN-18 | **链接规范** | 内部链接用 `[Label](/path)` 格式。禁止 `[[path|label]]` 旧语法。每条链接必须指向 cache map 中现存的路径。 |
| SYN-19 | **双语孪生** | 每个 en 页有 zh 孪生页，路径相同、语言不同。孪生标题各用本语言（如 `Architecture` / `建筑`）。正文节对节镜像。 |
| SYN-20 | **Supersede 协议** | 新页取代旧页时：(1) 新页达标准 (2) 旧页状态块改 `Superseded` + 链接新页 (3) 更新 wiki-index (4) 不允许两页同时声称是某主题的权威。 |
| SYN-21 | **撞车 advisory 必须响应** | `historian_page_create` 返回 `path exists — … prefer historian_page_update to amend it` 或 `疑似重复: … 先读再写` advisory（`src/tools/shared.ts` 的 `collisionAdvisory`）时，必须 `historian_read` 既有页后改用 `historian_page_update` 续写，禁止无视 advisory 直接重复建页。advisory 本身不拦截写入，拦截靠执行者响应——这是 GATE 环的设计（机器提示、人/agent 裁决）。 |
| SYN-22 | **Redirect 存根正文** | 存根正文只允许 `> Redirect: <canonical URL>` 一行，行首起始（`/^>\s*Redirect:/i` 判定），不携带其他正文。双语孪生各改一份（en→`/en/...`、zh→`/zh/...` canonical）。流程与 maintain 计数口径见 `references/genres.md` Redirect 存根规范。 |
| SYN-23 | **发布态流转** | capture 新建页必经 `状态: draft` → 十项自检通过 → `Active`。建页时自检 FAIL ≥3 条出 advisory `自检 N/10 未通过: … (不阻断, 发布前请补齐)`；FAIL 项用 `historian_page_update` 补齐后才可标 Active。禁止跳过自检直接把 draft 页改口成 Active。 |

## 来源

SYN-1..20 提炼自 `docs/research/cross-cultural-wiki-writing.md` 综合规则集，结合 5 文化维度（EN/ZH/DE/FR/RU）的交叉验证。SYN-21..23 依据 v4 已合入实现新增：`src/tools/shared.ts`（`collisionAdvisory` / `checklistAdvisory`）、`src/maintain.ts`（Redirect 计数）、`src/index.ts`（`CAPTURE_COMMAND_TEMPLATE` 的 draft→Active 流转）。

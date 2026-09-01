<!-- source: /home/user/workspace/harness/historian/.omo/research/cross-cultural-wiki-writing-digest.md sha256:3a59b5e937cf7f986e646cbf765700329130d3eee1bd48cdaa57b4141a33b0ff -->

# Cross-Cultural Wiki Writing — Planning Digest (persisted 2026-09-01)

> Condensed from the librarian synthesis. **Full ~100-rule report (EN-1…SYN-20, cited)**:
> `/tmp/opencode/librarian/cross-cultural-wiki-writing-report.md` — VOLATILE (tmpfs).
> Executor TODO #1 must vendor it into the plugin repo (`docs/research/`) before it disappears.
> Method note: wikipedia.org/Google domains were network-blocked in the research sandbox;
> content verified via search-index extracts of canonical URLs (source index in report §8).

## Per-culture anchors (representative quotes)

- **EN / WP:LEAD**: lead stands on its own — identify topic, establish context, why notable,
  summarize most important points incl. controversies; lead emphasis ≈ material importance;
  no lead-only facts; featured-article leads ~250–400 words.
- **EN / Good Article criteria**: six gates; challengeable content cited by paragraph end;
  focused, no unnecessary detail.
- **EN / Diátaxis**: tutorial/how-to/reference/explanation (action×cognition, acquisition×application);
  blurred mode boundaries are the root of most doc problems; reference mirrors system structure ("like a map").
- **EN / Google style**: tables when ≥3 related fields per item, lists for simpler data; cells ≤2 sentences.
- **EN / SRE postmortem**: postmortem = record of incident, impact, mitigation, root cause(s), follow-ups;
  blameless; action items need owner + tracker + priority + verifiable end state.
- **ZH / 序言章节**: 序言是最多人阅读的唯一部分，多数读者只读序言；≤4段；不逗弄读者；无序言专有信息.
- **ZH / 可供查证**: 可供查证是内容门槛；举证责任在添加者；非同寻常的断言需要高质量的来源.
- **ZH / 金字塔原理**: 结论先行；先重要后次要、先总结后具体、先框架后细节、先结论后原因、先结果后过程、先论点后论据；SCQA 开场.
- **ZH / 阮一峰**: 句子 ≤40 字硬上限；单线结构——一篇文章只讲透一件事.
- **ZH / 复盘模板 (阿里/华为云等)**: 摘要→背景→时间线→影响(量化)→根因(5 Whys, 直接vs根本)→应急→改进→经验→附录；
  改进措施是复盘最重要的部分；每条 AI = 做什么/负责人/期限/验证；时间线以日志为准不以口述为准；相邻≠因果.
- **DE / Wie schreibe ich gute Artikel**: 百科全书非 Fachbuch，必须对门外汉可懂；定义先行
  („Ludwig II. war ein bayerischer König" 而非事件句开头)；一文一概念、反碎片化；
  散文优先于列表 („in ganzen Sätzen")；禁 "Interessantes"/"Allgemeines" 杂项标题；
  风格 „weder einschläfernd noch anbiedernd".
- **DE / Belegpflicht**: 所有非平凡论断必须给可信来源；写作前先收集文献级来源；脚注含完整书目+页码；
  „宁要格式错的引注，不要没有引注".
- **DE / NPOV**: sine ira et studio；单词测试 („versäumt" vs „nicht informiert")；评价必须归属 („Wikipedia-Autoren sollen niemals selbst urteilen").
- **FR / Style encyclopédique**: 六种品质 — neutre, impersonnel, clair, précis, compréhensible, didactique；
  „Wikipédia apporte une compréhension, pas un jugement"；Mozart/Hitler 规则（禁止隐式褒贬）；
  溢美→事实转换（用排名/奖项/销量替代"最伟大的"）；用词内涵审计 (homme d'État/politicien/homme politique).
- **FR / Conventions de style**: „ne comporte ni introduction, ni conclusion"（序言无标题、结尾不发表观点）；列表只用于无法展开的点.
- **FR / Vérifiabilité**: 收录测试是"可归属于可查证出版物"而非真假；multiplier, diversifier et croiser les sources；常识豁免.
- **FR / Admissibilité**: 高质量、以主题为中心、独立于主题、持续约 2 年的二手来源.
- **FR / Ce que Wikipédia n'est pas**: 按来源赋予的相对权重做中性摘要；耐久过滤——丢弃明天就过时的内容. „Non nova, sed nove."
- **RU / КИС/ХС**: 主题必须充分展开；导言须普通读者可懂、专门术语最少，≥10 行/约 1000 字符；无导言专有信息；
  尺寸带 ХС ≥8000 字符、ИС ≥20000、>~100000 必须拆分；重要论断与数字必须有注，长文献给页码/章节.
- **RU / АИ**: 文章基于已发表权威来源；二手来源优先于一次 („перепроверен, корректно использован и структурирован")；Википедия не является авторитетным источником.
- **RU / ВЕС**: 每种观点的篇幅按流行度加权；禁止虚假平衡；权重同样适用于图片/链接/分类.
- **RU / Энциклопедический стиль**: „точности, сжатости, однозначности, нейтральности при сохранении насыщенности содержания" — 紧凑且饱和.

## Universal synthesis rules (SYN-1…SYN-20)

1. SYN-1 结论先行的加权导言，不含正文没有的事实
2. SYN-2 一页一主题（拆分而非膨胀）
3. SYN-3 逐段行内引证，举证责任在添加者；异常断言→更强来源
4. SYN-4 解读性内容二手来源优先
5. SYN-5 二级以上标题按重要性顺序、描述性命名，禁杂项筐
6. SYN-6 篇幅与重要性成比例 (due weight / ВЕС / Gewichtung)
7. SYN-7 中立归因文风 + 用词内涵审计
8. SYN-8 ≥3 字段结构化数据用表；论点用散文；扁平集合用列表
9. SYN-9 固定尾部小节顺序 (notes→bibliography→links)，格式统一
10. SYN-10 导航跟随内容（先写页面再挂链接）
11. SYN-11 事件页 = 摘要→时间线→影响→原因→处置→预防→教训 弧线
12. SYN-12 覆盖面广但以显著性为界
13. SYN-13 导言≈实质内容 10–15%，每个重要小节在导言至少占一句
14. SYN-14 必留: 定义/收录理由/可挑战论断+来源/量化影响/根因+带主行动项/加权争议
15. SYN-15 必删: 杂项筐/溢美腔/跑题/明日即废/边缘观点/重复解释(改链接)/不言自明的链接/单句小节
16. SYN-16 密度手段: 一句一主题、SVO 骨架、中文句 ≤20 字、引注下沉脚注、结构化数据入表
17. SYN-17 表/文判据: ≥3字段→表；成对→描述列表；单项→弹列；论证→散文；步骤→编号祈使句
18. SYN-18 小节超重即拆分、原位留摘要
19. SYN-19 格式统一本身是质量门（sentence case、禁裸 URL、模板化引注）
20. SYN-20 可读性底线: 门外汉定义义务、禁行话腔、主动语态

## Genre templates

- **G1 事件/复盘页**: 摘要(一行: 起因/影响/根因) → 元数据 → 背景 → 时间线表(时间|事件|来源, 仅日志可证事实)
  → 量化影响 → 根因(一句话总结; 直接 vs 根本; ≥5 Whys; 传播路径) → 处置(止血 vs 根治)
  → 行动项表(措施|类型|负责人|期限|验证|状态; 每主题 prevent+mitigate) → 教训(做得好/做错/侥幸) → 附录(commit/告警/日志/截图).
- **G2 对比/选型页**: 结论先行导言 → 维度定义 → 各对象概览 → 分维度对比表(行序固定、无合并单元格、来源列) → 基准数据 → 选型建议.
- **G3 清单/参考页**: 范围声明导言 → 结构镜像被测系统(map principle) → 描述列表/表格、平行句式、绝对日期 → 只链接已存在页面.
- **G4 概念/原理解析页**: 定义+收录理由导言 → 按重要性排序的小节(每层总结下一层) → 观点归因、二手来源解读 → 门外汉义务、结尾不发表个人结论.

## Unknowns / caveats from research

1. FR "L'esprit d'encyclopédie" 确切页名未找到；功能等价 = Principes fondateurs + Ce que Wikipédia n'est pas.
2. ZH 格式手册/序言章节 部分为 essay 地位（英译）；可供查证/列明来源 为采纳方针.
3. RU ХС 标准经 wikireality.ru 镜像佐证；官方 КИС 页直取.
4. SRE 示例模板字段为示意；规范性文字以 SRE Book ch.15 / Workbook ch.10 为准.

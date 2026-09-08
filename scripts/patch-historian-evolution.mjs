/** Surgical integration into infra/historian (both locales):
 *  1) remove the stamp line my fix-stamps pass misplaced INSIDE a bash fence
 *  2) refresh stale component/file-location rows (flat skill file -> npm plugin @0.5.1; plugin key path)
 *  3) prepend proper H1 + status block + machine-verified stamp
 *  4) weave the self-evolution section in before Related Pages
 * All-or-nothing per locale; writes go through the 0.5.x gated update tool. */
import { readFileSync } from 'node:fs';
import { liveOptions } from './live-options.mjs';
import { createClient } from '../dist/wiki/client.js';
import { readPage } from '../dist/wiki/pages.read.js';
import { buildTools } from '../dist/tools.js';

const opts = liveOptions();
const client = createClient(opts);
const tools = buildTools(opts);
const out = (r) => JSON.parse(typeof r === 'string' ? r : String(r.output));

const SPEC = {
  zh: {
    h1: '# 史官智能体\n\n**状态/Status**: Active · **日期/Date**: 2026-09-08\n> **上次核实**: 2026-09-08 · Last verified via: 本机实测（npm registry latest=0.5.1；jsonc 钉 @0.5.1；0.5.1 复扫 duplicates=2、空标签 0、断链 0）\n\n',
    sectionAnchor: '## 相关页面',
    sectionFile: '/tmp/evo-zh.md',
    del: ['> **上次核实**: 2026-09-08 · Last verified via: opencode-wiki-historian 0.5.0 已发布并在会话内生效\n\n'],
    rep: [
      ['| 技能定义 | `/home/lab/.config/opencode/skills/historian.md` | 由 OpenCode 加载；定义筛选、放置、内容质量标准、变更操作手册及检索模式 |',
       '| 插件包 | `opencode-wiki-historian@0.5.1`（npm；源码 `/home/lab/workspace/opencode-historian`） | 史官插件本体：historian_* 工具集 + SKILL.md 行为契约；由 `~/.config/opencode/opencode.jsonc` 的 plugin 项加载（旧版平面技能文件已停用） |'],
      ['| API 密钥 | `~/.wikijs-api-key` | RS256 JWT，仅限 root 使用，有效期至 2027-06-30 |',
       '| API 密钥 | 插件：`~/.config/opencode/historian-wiki-api.key`；旧 wiki-ops.py：`~/.wikijs-api-key` | 同一 RS256 JWT，仅限 root 使用，有效期至 2027-06-30 |'],
      ['- **技能文件：** `/home/lab/.config/opencode/skills/historian.md`',
       '- **插件仓库：** `/home/lab/workspace/opencode-historian`（发布为 npm `opencode-wiki-historian`，本机钉 0.5.1）\n- **插件密钥：** `~/.config/opencode/historian-wiki-api.key`'],
    ],
  },
  en: {
    h1: '# Historian (史官) Agent\n\n**状态/Status**: Active · **日期/Date**: 2026-09-08\n> **上次核实 / Last verified**: 2026-09-08 · via: machine checks (npm registry latest=0.5.1; jsonc pin @0.5.1; 0.5.1 re-scan duplicates=2, empty tags=0, broken links=0)\n\n',
    sectionAnchor: '## Related Pages',
    sectionFile: '/tmp/evo-en.md',
    del: ['> **上次核实**: 2026-09-08 · Last verified via: opencode-wiki-historian 0.5.0 live on npm + session\n\n'],
    rep: [
      ['| Skill definition | `/home/lab/.config/opencode/skills/historian.md` | Loaded by OpenCode; defines triage, placement, content-quality bar, mutation playbook, and retrieval patterns |',
       '| Plugin package | `opencode-wiki-historian@0.5.1` (npm; source `/home/lab/workspace/opencode-historian`) | The historian itself: historian_* toolset + SKILL.md behavior contract; loaded via the plugin entry in `~/.config/opencode/opencode.jsonc` (legacy flat skill file retired) |'],
      ['| API key | `~/.wikijs-api-key` | RS256 JWT, root-only, expires 2027-06-30 |',
       '| API key | plugin: `~/.config/opencode/historian-wiki-api.key`; legacy wiki-ops.py: `~/.wikijs-api-key` | same RS256 JWT, root-only, expires 2027-06-30 |'],
      ['- **Skill file:** `/home/lab/.config/opencode/skills/historian.md`',
       '- **Plugin repo:** `/home/lab/workspace/opencode-historian` (published as npm `opencode-wiki-historian`, pinned 0.5.1 here)\n- **Plugin key:** `~/.config/opencode/historian-wiki-api.key`'],
    ],
  },
};

for (const [locale, s] of Object.entries(SPEC)) {
  const page = await readPage(client, 'infra/historian', locale);
  if (page === null) { console.log(`FAIL ${locale}: page missing`); continue; }
  let body = page.content ?? '';
  if (!body.startsWith('# ')) body = s.h1 + body; // idempotency guard
  let bad = false;
  for (const d of s.del) if (body.includes(d)) body = body.replace(d, '');
  for (const [from, to] of s.rep) {
    if (!body.includes(from)) { console.log(`FAIL ${locale}: anchor missing -> ${from.slice(0, 60)}…`); bad = true; }
  }
  if (body.includes(s.sectionFile === '/tmp/evo-zh.md' ? '版本自进化记录' : 'Self-Evolution Log')) { console.log(`${locale}: evolution section already present, skipping`); continue; }
  if (bad) continue;
  const anchorIdx = body.indexOf(s.sectionAnchor);
  body = body.slice(0, anchorIdx) + readFileSync(s.sectionFile, 'utf8').trimEnd() + '\n\n' + body.slice(anchorIdx);
  const r = await out(await tools.historian_page_update.execute({ path: 'infra/historian', locale, content: body }, {}));
  console.log(r.ok === false ? `REFUSED ${locale}: ${r.errorKind} ${r.message ?? ''}` : `OK ${locale} id=${r.pageId} -> ${r.urls?.[locale === 'zh' ? 'zh' : 'en']}`);
}

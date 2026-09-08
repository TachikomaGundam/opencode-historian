/**
 * Approved 2026-09-08: bold-merge 9 live/live near-duplicate pairs.
 * canonical = deeper section path (llm/inference/*, llm-eval/deepseek/*) per
 * the reorg-map direction; legacy leg becomes a clickable redirect stub.
 * Freeze protocol honored: preimage first (rule 4); inbound rewrite is
 * URL-mechanical only (rule 5); PageNotFound stops that item, never blind-retry (rule 2).
 * Completeness guard: if a legacy body is >25% LARGER than canonical, merging
 * would LOSE knowledge — that pair is reported for manual integration instead
 * of auto-stubbed (a stub must never swallow the richer text).
 *
 * Run: node scripts/merge-pairs.mjs [--apply]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { liveOptions } from './live-options.mjs';
import { createClient } from '../dist/wiki/client.js';
import { readPage } from '../dist/wiki/pages.read.js';
import { getMap } from '../dist/map.js';
import { buildTools } from '../dist/tools.js';

const APPLY = process.argv.includes('--apply');
const BASE = liveOptions().baseUrl.replace(/\/$/, '');
const client = createClient(liveOptions());
const tools = buildTools(liveOptions());
const out = (r) => JSON.parse(typeof r === 'string' ? r : String(r.output));
const run = async (name, args) => out(await tools[name].execute(args, {}));

const PAIRS = [
  ['llm/deepseek-v4-flash-vllm', 'llm/inference/deepseek-v4-flash-vllm'],
  ['llm/ggml-rpc-cuda-double-alloc-oom', 'llm/inference/ggml-rpc-cuda-double-alloc-oom'],
  ['llm/gpu-reset-required-170hx', 'llm/inference/gpu-reset-required-170hx'],
  ['llm/llm-monitor', 'llm/inference/llm-monitor'],
  ['llm/ple-offload-stall-chain', 'llm/inference/ple-offload-stall-chain'],
  ['llm/rocm-7-13-kernel-binary-issue', 'llm/inference/rocm-7-13-kernel-binary-issue'],
  ['llm/rocm-7-2-1-rollback-validation', 'llm/inference/rocm-7-2-1-rollback-validation'],
  ['llm/vllm-qwen3-unclosed-thinking-dead-turn', 'llm/inference/vllm-qwen3-unclosed-thinking-dead-turn'],
  ['llm-eval/deepseek-v4-pro-0813-comparison', 'llm-eval/deepseek/deepseek-v4-pro-0813-comparison'],
];

mkdirSync('/tmp/merge-preimage-2026-09-08', { recursive: true });
let stubbed = 0, skipped = 0, manual = 0, refused = 0;

for (const [legacy, canon] of PAIRS) {
  for (const locale of ['zh', 'en']) {
    const cp = await readPage(client, canon, locale);
    if (cp === null) { console.log(`SKIP ${locale} ${legacy} — canonical ${canon} MISSING (rule 2)`); skipped++; continue; }
    const lp = await readPage(client, legacy, locale);
    if (lp === null) { skipped++; continue; } // legacy leg absent = already consolidated
    if (/^>\s*Redirect:/im.test(lp.content ?? '')) {
      // body already a proper stub; normalize title to the D10 alias convention
      if (/[（(]\s*(?:重定向|redirect)\s*[）)]\s*$/i.test(lp.title ?? '')) { console.log(`OK ${locale} ${legacy} — stub, titled`); continue; }
      const zh2 = locale === 'zh';
      const fixedTitle = (cp.title.replace(/[（(]\s*(?:重定向|redirect)\s*[）)]\s*$/i, '')) + (zh2 ? '（重定向）' : ' (redirect)');
      if (!APPLY) { console.log(`DRY ${locale} ${legacy} — title -> "${fixedTitle}"`); continue; }
      const rt = await run('historian_page_update', { path: legacy, locale, title: fixedTitle });
      if (rt.ok === false) { refused++; console.log(`REFUSED title ${locale} ${legacy}: ${rt.errorKind}`); }
      else console.log(`TITLE OK ${locale} ${legacy} -> ${fixedTitle}`);
      continue;
    }
    const L = (lp.content ?? '').length, C = (cp.content ?? '').length;
    if (L > C * 1.25) { console.log(`MANUAL ${locale} ${legacy} — legacy ${L}B > canonical ${C}B×1.25, needs content integration first`); manual++; continue; }
    writeFileSync(`/tmp/merge-preimage-2026-09-08/${locale}-${legacy.replace(/\//g, '_')}.md`, lp.content ?? '');
    const zh = locale === 'zh';
    const suffix = zh ? '（重定向）' : ' (redirect)';
    const title = cp.title.replace(/[（(]\s*(?:重定向|redirect)\s*[）)]\s*$/i, '') + suffix;
    const line = zh
      ? `本页已于 2026-09-08 并入规范页（bold-merge，历史别名）：[${cp.title}](${BASE}/zh/${canon})。`
      : `Merged into the canonical page on 2026-09-08 (bold-merge, historical alias): [${cp.title}](${BASE}/en/${canon}).`;
    const body = `# ${title}\n\n> Redirect: \`${canon}\`\n\n${line}\n`;
    if (!APPLY) { console.log(`DRY ${locale} ${legacy} -> stub (${L}B into canonical ${C}B)`); stubbed++; continue; }
    const r = await run('historian_page_update', { path: legacy, locale, title, content: body });
    if (r.ok === false) { refused++; console.log(`REFUSED ${locale} ${legacy}: ${r.errorKind} ${r.message ?? ''}`); }
    else { stubbed++; console.log(`STUB OK ${locale} ${legacy} -> ${canon}`); }
  }
}
console.log(`[merge] stubbed=${stubbed} skipped=${skipped} manual=${manual} refused=${refused}`);

// --- inbound rewrite: URL-mechanical only (freeze rule 5). Reads every front-page
// body once; substring prefilter keeps the GraphQL writes proportional to real hits.
if (APPLY && !manual) {
  const legacySet = new Map(PAIRS.map(([l, c]) => [l, c]));
  const map = await getMap({ client, options: liveOptions() });
  let rewrote = 0;
  for (const row of map.rows) {
    if (row.path.startsWith('_') || legacySet.has(row.path)) continue;
    const page = await readPage(client, row.path, row.locale);
    const body = page?.content ?? '';
    if (![...legacySet.keys()].some((l) => body.includes(l))) continue;
    let next = body;
    for (const [l, c] of legacySet) {
      // markdown links + hrefs in three URL shapes: abs-with-locale, root-relative-with-locale, root-relative-bare
      for (const pat of [
        new RegExp(`(\\]\\(${BASE}/(?:en|zh)/)${l}(?=[)#"'])`, 'g'),
        new RegExp(`(\\]\\(/(?:en|zh)/)${l}(?=[)#"'])`, 'g'),
        new RegExp(`(\\]\\(/)${l}(?=[)#"'])`, 'g'),
        new RegExp(`(href="(?:${BASE})?/(?:en|zh)/)${l}(?=")`, 'g'),
      ]) next = next.replace(pat, `$1${c}`);
    }
    if (next === body) continue;
    const r = await run('historian_page_update', { path: row.path, locale: row.locale, content: next });
    if (r.ok === false) { refused++; console.log(`REFUSED inbound ${row.locale} ${row.path}: ${r.errorKind}`); }
    else { rewrote++; console.log(`INBOUND ${row.locale} ${row.path}`); }
  }
  console.log(`[inbound] rewrote=${rewrote} refused=${refused}`);
  const m = await run('historian_map', { action: 'refresh' });
  console.log('[refresh]', m.ok !== false ? 'map refreshed' : JSON.stringify(m).slice(0, 200));
}

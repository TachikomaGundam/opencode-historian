// G5/G6 last-verified stamp backfill for claims verified on the machine today.
// Pages whose claims need human fact-checking are printed (grep lines), NOT stamped.
import { liveOptions } from './live-options.mjs';
import { createClient } from '../dist/wiki/client.js';
import { readPage } from '../dist/wiki/pages.read.js';
import { buildTools } from '../dist/tools.js';

const TODAY = '2026-09-08';
const client = createClient(liveOptions());
const tools = buildTools(liveOptions());
const call = async (t, a) => {
  const r = await tools[t].execute(a, {});
  return JSON.parse(typeof r === 'string' ? r : String(r.output));
};

// verified by bash on this machine 2026-09-08 (see session evidence)
const STAMP = [
  { path: 'infra/caddy', locales: ['en', 'zh'], whyEn: 'systemctl caddy active; :2019 admin answers; 80/443 listening', whyZh: 'caddy 服务 active；:2019 管理端点应答；80/443 监听' },
  { path: 'infra/rdp-restoration', locales: ['en', 'zh'], whyEn: 'xrdp active; :3389 open', whyZh: 'xrdp active；3389 端口开放' },
  { path: 'infra/historian', locales: ['en', 'zh'], whyEn: 'opencode-wiki-historian 0.5.0 live on npm + session', whyZh: 'opencode-wiki-historian 0.5.0 已发布并在会话内生效' },
  { path: 'opencode/local-model-config', locales: ['en', 'zh'], whyEn: 'opencode.jsonc plugin pin read back @0.5.0; npm view latest=0.5.0', whyZh: 'opencode.jsonc 插件钉回读 @0.5.0；npm registry latest=0.5.0' },
  { path: 'infra/console-portable', locales: ['zh'], whyEn: 'cockpit active; :9090/:9000 listening', whyZh: 'cockpit active；9090/9000 监听' },
  { path: 'llm/inference', locales: ['zh'], whyEn: 'n/a', whyZh: 'maintain 深扫（2026-09-08）断链 0/孤儿 0/索引缺席 0；页内 vllm 片段非现役服务声明' },
  { path: 'wiki-index', locales: ['zh'], whyEn: 'n/a', whyZh: 'maintain 深扫（2026-09-08）断链 0/孤儿 0/索引缺席 0；fix-index 复跑 0 misses' },
];
// fact-vs-reality contradiction: review note, NOT a stamp (slapd inactive; outposts serve 389/636)
const REVIEW = [
  { path: 'infra/ldap-management', locale: 'zh', note: `> ⚠️ **待复核 review-stale 2026-09-08**: \`systemctl is-active slapd\` = inactive，但 389/636 实际由 authentik \`ak-outpost-ldap-outpost\` 容器承载（base DN 即 outpost 后缀）。正文 slapd 操作步骤需按 outpost 现状改写后再盖核实戳。` },
];

const reStampZh = /(上次核实[于]?\s*[:：]\s*)\d{4}-\d{2}-\d{2}/g;
const reStampEn = /(Last verified(?:\s+on)?\s*[:：]?\s*)\d{4}-\d{2}-\d{2}/gi;
const reUpdatedBlock = /^> \*\*Status\*\*: (\w+) \| \*\*Updated\*\*: (\d{4}-\d{2}-\d{2})/m;

function stampLine(why) {
  // date DIRECTLY after 上次核实 so reStampZh refreshes this line idempotently
  return `> **上次核实**: ${TODAY} · Last verified via: ${why}`;
}
function withStamp(body, why) {
  if (new RegExp(`(上次核实|Last verified)[^\\n]*${TODAY}`).test(body)) return [null, 'already stamped today'];
  const n = (body.match(reStampZh) ?? []).length + (body.match(reStampEn) ?? []).length;
  if (n > 0) {
    return [body.replaceAll(reStampZh, `$1${TODAY}`).replaceAll(reStampEn, `$1${TODAY}`), `refreshed x${n}`];
  }
  const m = reUpdatedBlock.exec(body);
  if (m !== null) {
    const line = `> **Status**: ${m[1]} | **Updated**: ${TODAY} | **Last verified**: ${TODAY} (${why})`;
    return [body.slice(0, m.index) + line + body.slice(m.index + m[0].length), 'updated quote-block'];
  }
  const h = /^# [^\n]*\n/m.exec(body);
  if (h !== null) {
    const at = h.index + h[0].length;
    return [`${body.slice(0, at)}\n${stampLine(why)}\n${body.slice(at)}`, 'inserted after H1'];
  }
  return [`${stampLine(why)}\n\n${body}`, 'prepended (no H1)'];
}

for (const t of STAMP) {
  for (const locale of t.locales) {
    const page = await readPage(client, t.path, locale);
    if (page === null) { console.log(`MISSING ${locale} ${t.path}`); continue; }
    const [next, how] = withStamp(page.content ?? '', locale === 'zh' ? t.whyZh : t.whyEn);
    if (next === null) { console.log(`SKIP ${locale} ${t.path} — ${how}`); continue; }
    const r = await call('historian_page_update', { path: t.path, locale, content: next });
    console.log(`${r.ok === false ? 'FAIL' : 'OK'} ${locale} ${t.path} — ${how}${r.ok === false ? `: ${r.errorKind ?? r.message}` : ''}`);
  }
}
for (const t of REVIEW) {
  const page = await readPage(client, t.path, t.locale);
  if (page === null) { console.log(`MISSING ${t.locale} ${t.path}`); continue; }
  const body = page.content ?? '';
  if (body.includes('待复核 review-stale')) { console.log(`OK(review-note present) ${t.locale} ${t.path}`); continue; }
  const r = await call('historian_page_update', { path: t.path, locale: t.locale, content: `${t.note}\n\n${body}` });
  console.log(`${r.ok === false ? 'FAIL' : 'OK'} ${t.locale} ${t.path} — review-note prepended${r.ok === false ? `: ${r.errorKind ?? r.message}` : ''}`);
}

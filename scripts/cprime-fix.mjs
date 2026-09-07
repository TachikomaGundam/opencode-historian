/**
 * Batch C′ executor: fixes the LIVE wiki pages THROUGH the 0.5.0 gated tool
 * surface (buildTools → historian_page_update/create). The gate is part of
 * the fix proof: if a repaired page would still violate R1/R2, the write is
 * refused and reported instead of silently shipped.
 *
 * Run: npm run build && node scripts/cprime-fix.mjs <sub> [args]
 * Sub: stubs | downgrade | landing | refresh
 */

import { readFileSync } from 'node:fs';
import { liveOptions } from './live-options.mjs';
import { createClient } from '../dist/wiki/client.js';
import { readPage, listPages } from '../dist/wiki/pages.read.js';
import { getMap } from '../dist/map.js';
import { buildTools } from '../dist/tools.js';
import { lintBody } from '../dist/lint.js';

const INPUT = JSON.parse(readFileSync('/tmp/cprime-input.json', 'utf8'));
const options = liveOptions();
const client = createClient(options);
const tools = buildTools(options);
const BASE = options.baseUrl.replace(/\/$/, '');

const out = (r) => JSON.parse(typeof r === 'string' ? r : String(r.output));
const run = async (name, args) => out(await tools[name].execute(args, {}));

/** Gated write helper: refuses (prints, counts) when the 0.5.0 gate says no. */
let refused = 0;
async function gatedUpdate(path, locale, content, why) {
  const r = await run('historian_page_update', { path, locale, content });
  if (r.ok === false) {
    refused += 1;
    console.log(`  REFUSED ${path} (${locale}): ${r.errorKind} — ${r.message ?? ''} [${why}]`);
    return false;
  }
  return true;
}

const REDIRECT_LINE = /^>\s*Redirect:\s*`?([^`\s)]+)`?.*$/im;

async function fixStubs() {
  let fixed = 0, already = 0, gone = 0;
  for (const s of INPUT.stubs) {
    const page = await readPage(client, s.path, s.locale);
    if (!page) { gone += 1; continue; }
    const lint = lintBody(page.content, { locale: s.locale, baseUrl: BASE });
    if (lint.stubHasLink) { already += 1; continue; }
    const m = page.content.match(REDIRECT_LINE);
    if (!m) { console.log(`  NO-REDIRECT-LINE ${s.path} (${s.locale})`); gone += 1; continue; }
    const target = m[1].replace(/^\/(en|zh)\//, '/').replace(BASE, '').replace(/^\//, '');
    const tp = await readPage(client, target, s.locale);
    const targetTitle = tp?.title ?? target;
    const exit = s.locale === 'zh'
      ? `本页面是重定向存根，规范页：**[${targetTitle}](${BASE}/${s.locale === 'zh' ? 'zh/' : ''}${target})**。`
      : `This page is a redirect stub; the canonical page is: **[${targetTitle}](${BASE}/en/${target})**.`;
    // Insert the clickable exit right after the Redirect marker line; keep the rest untouched.
    const content = page.content.replace(REDIRECT_LINE, (line) => `${line}\n\n${exit}`);
    if (await gatedUpdate(s.path, s.locale, content, 'stub-exit')) {
      fixed += 1;
      console.log(`  stub ok ${s.path} (${s.locale}) → ${target}`);
    }
  }
  console.log(`[stubs] fixed=${fixed} already=${already} gone=${gone} refused=${refused}`);
}

async function downgrade() {
  let changed = 0, skipped = 0;
  const seen = new Set();
  for (const u of INPUT.unfinished) {
    if (!u.active) continue;
    const key = `${u.path}\0${u.locale}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const page = await readPage(client, u.path, u.locale);
    if (!page) { skipped += 1; continue; }
    // Honest state machine: unfinished skeletons may not claim Active.
    const next = page.content.replace(
      /((?:\*\*)?(?:状态\s*\/\s*Status|状态|Status)(?:\*\*)?\s*[:：]\s*)Active/,
      (_all, prefix) => `${prefix}draft <!-- 2026-09-07 deep 扫描判定未完工；补全并通过十项自检后升 Active -->`,
    );
    if (next === page.content) { skipped += 1; continue; }
    if (await gatedUpdate(u.path, u.locale, next, 'draft-downgrade')) {
      changed += 1;
      console.log(`  draft ${u.path} (${u.locale})`);
    }
  }
  console.log(`[downgrade] toDraft=${changed} skipped=${skipped} refused=${refused}`);
}

const LANDINGS = {
  infra: {
    zh: { title: 'Infra 基础设施总览', intro: '本页汇总 Infra 章节的全部知识页：服务器拓扑、网络与认证、自托管服务运维与踩坑复盘。新人上手或故障定位先来这里找入口，再进具体页；当前部署状态一律以 infra/services 现状卡为准。' },
    en: { title: 'Infra Section Overview', intro: 'Index of the Infra chapter: server topology, network and auth, self-hosted service runbooks and incident recaps. Start here when onboarding or triaging; live deployment state always defers to the infra/services ledger.' },
  },
  llm: {
    zh: { title: 'LLM 推理部署总览', intro: '本页汇总 LLM 章节的全部知识页：vLLM/SGLang 部署与调优、显存与缓存机制、硬件级踩坑复盘与推理运维手册。优化前先查 pitfall 与 benchmark 系列，避免重蹈 GPU 侧已定性的坑。' },
    en: { title: 'LLM Inference Overview', intro: 'Index of the LLM chapter: vLLM/SGLang deployment and tuning, VRAM and cache mechanics, hardware-level incident recaps and ops runbooks. Check the pitfall and benchmark series before optimizing; the GPU-side traps are already characterized.' },
  },
  'llm-eval': {
    zh: { title: 'LLM-Eval 模型评测总览', intro: '本页汇总 LLM-Eval 章节的全部知识页：评测方法论 v2、题库与判据、各供应商编码计划的横评结论。标着（重定向）的页面只是历史别名，正文以规范页为准。' },
    en: { title: 'LLM-Eval Overview', intro: 'Index of the LLM-Eval chapter: evaluation methodology v2, question banks and gates, cross-vendor coding-plan comparisons. Pages marked (redirect) are historical aliases; the canonical page owns the content.' },
  },
  opencode: {
    zh: { title: 'OpenCode 会话复盘总览', intro: '本页汇总 OpenCode 章节的全部知识页：编码代理（oh-my-openagent 舰队）在本机踩坑与修复的事件复盘，含插件配置、模型接线与批量任务失败分析。每条都有可复现的命令与判据。' },
    en: { title: 'OpenCode Recap Overview', intro: 'Index of the OpenCode chapter: incident recaps where coding agents (the oh-my-openagent fleet) hit and fixed machine-local traps — plugin config, model wiring, batch-run failures. Every entry has reproducible commands and criteria.' },
  },
};

async function landing() {
  const snapshot = await getMap({ client, options });
  const stubPaths = new Set(INPUT.stubs.map((s) => `${s.path}\0${s.locale}`));
  for (const [dir, meta] of Object.entries(LANDINGS)) {
    for (const locale of ['zh', 'en']) {
      const rows = snapshot.rows
        .filter((r) => r.locale === locale && (r.path === dir || r.path.startsWith(`${dir}/`)))
        .filter((r) => !stubPaths.has(`${r.path}\0${r.locale}`))
        .filter((r) => r.path !== dir) // the landing page itself once created
        .sort((a, b) => a.path.localeCompare(b.path));
      const groups = new Map();
      for (const r of rows) {
        const rest = r.path.slice(dir.length + 1);
        const sub = rest.includes('/') ? rest.split('/')[0] : '';
        if (!groups.has(sub)) groups.set(sub, []);
        groups.get(sub).push(r);
      }
      const H = locale === 'zh' ? ['页面', '标题', '最近更新'] : ['Page', 'Title', 'Updated'];
      const sec = locale === 'zh' ? '## 页面清单' : '## Page Inventory';
      const grpZh = (sub) => (sub === '' ? (locale === 'zh' ? '章节根页面' : 'Section root') : `\`${dir}/${sub}/\``);
      const body = [
        `# ${meta[locale].title}`,
        '',
        `**状态/Status**: Active · **日期/Date**: 2026-09-07`,
        '',
        meta[locale].intro,
        '',
        sec,
        '',
        ...[...groups.entries()].flatMap(([sub, rs]) => [
          `### ${grpZh(sub)}`,
          '',
          `| ${H[0]} | ${H[1]} | ${H[2]} |`,
          '| --- | --- | --- |',
          ...rs.map((r) => `| [${r.path}](${BASE}/${locale}/${r.path}) | ${r.title} | ${r.updatedAt.slice(0, 10)} |`),
          '',
        ]),
        locale === 'zh'
          ? '## 维护约定\n\n本页由史官 deep 扫描自动对齐清单；新增页面须在同次运行内登记于此（索引可达契约）。历史别名不列出，仅保留在存根清单。\n'
          : '## Maintenance\n\nKept in sync by the historian deep scan; every new page must be registered here within the same run (index-reachability contract). Redirect aliases are intentionally omitted.\n',
        '',
        locale === 'zh'
          ? '## 相关页面\n\n- [Wiki 总索引](/zh/wiki-index)\n- [首页](/zh/home)\n'
          : '## Related Pages\n\n- [Wiki index](/en/wiki-index)\n- [Home](/en/home)\n',
      ].join('\n');
      const r = await run('historian_page_create', {
        path: dir, locale, title: meta[locale].title, content: body, genre: 'G3', twin: false,
      });
      if (r.ok === false) {
        if (String(r.message ?? '').includes('already exists')) { console.log(`  exists ${dir} (${locale}) — updating`); await gatedUpdate(dir, locale, body, 'landing-refresh'); }
        else { refused += 1; console.log(`  REFUSED create ${dir} (${locale}): ${r.errorKind} ${r.message}`); }
      } else console.log(`  landing ok ${dir} (${locale}) pages=${rows.length}`);
    }
  }
  console.log(`[landing] refused=${refused}`);
}

async function refresh() {
  const r = await run('historian_map', { action: 'refresh' });
  console.log('[refresh]', r.ok !== false ? 'map refreshed' : JSON.stringify(r).slice(0, 300));
}

const sub = process.argv[2];
if (sub === 'stubs') await fixStubs();
else if (sub === 'downgrade') await downgrade();
else if (sub === 'landing') await landing();
else if (sub === 'refresh') await refresh();
else console.log('usage: cprime-fix.mjs <stubs|downgrade|landing|refresh>');

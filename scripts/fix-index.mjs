/**
 * wiki-index surgical integration (batch C′): section landings + console-portable
 * into Untyped cells, froggeric into llm/G2, new ops row, deepseek V4 Pro
 * three-anchor stack converged to one, date bump. All inserted paths asserted
 * against the live inventory; writes go through the 0.5.0 publish gate.
 */

import { resolveOptions } from '../dist/config.js';
import { createClient } from '../dist/wiki/client.js';
import { listPages, readPage } from '../dist/wiki/pages.read.js';
import { buildTools } from '../dist/tools.js';

const options = resolveOptions({ translate: { providerKey: 'bailian-token-plan' } });
const client = createClient(options);
const tools = buildTools(options);

const titles = new Map();
for (const locale of ['en', 'zh']) {
  for (const p of await listPages(client, { locale })) titles.set(`${p.path}|${locale}`, p.title);
}
const has = (path, locale) => titles.has(`${path}|${locale}`);
const L = (path, locale) => `[${titles.get(`${path}|${locale}`) ?? path}](/${path})`;

// grid column layout: | topic | G1 | G2 | G3 | G4 | G5 | G6 | Untyped |
const COL = { G2: 3, UNTYPED: -2 };

function appendCell(cells, at, linkText) {
  const i = at < 0 ? cells.length + at : at;
  const cur = cells[i] ?? '';
  if (cur.includes(`](${linkText.match(/\]\(([^)]+)\)/)[1]})`)) return false;
  cells[i] = cur.trim() === '—' || cur.trim() === '-' ? ` ${linkText} ` : `${cur.replace(/\s+$/, '')}<br>${linkText} `;
  return true;
}

function patch(body, locale) {
  const log = [];
  const lines = body.split('\n');
  const APPENDS = {
    infra: [has('infra/console-portable', locale) ? 'infra/console-portable' : null, 'infra'],
    llm: ['llm'],
    'llm-eval': ['llm-eval'],
    opencode: ['opencode'],
  };
  const frog = 'llm/inference/froggeric-qwen-template-fixes-assessment';

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\| \*\*(infra|llm|llm-eval|opencode|eda)\*\* \|/);
    if (m === null) continue;
    const section = m[1];
    const cells = lines[i].split('|');
    for (const p of APPENDS[section] ?? []) {
      if (p === null || !has(p, locale)) continue;
      if (appendCell(cells, COL.UNTYPED, L(p, locale))) log.push(`append ${p}`);
    }
    if (section === 'llm' && has(frog, locale) && appendCell(cells, COL.G2, L(frog, locale))) log.push(`append ${frog}`);
    lines[i] = cells.join('|');

    if (section === 'eda' && has('ops/dev-env-pitfalls', locale) && !body.includes('**ops**')) {
      const cells8 = ['', ' **ops** ', ' — ', ' — ', ' — ', ` ${L('ops/dev-env-pitfalls', locale)} `, ' — ', ' — ', ' — ', ''];
      lines.splice(i + 1, 0, cells8.join('|'));
      log.push('insert ops row (G4)');
    }
  }

  let b = lines.join('\n');
  // date bump + intro section list
  b = b.replace(locale === 'zh' ? '**更新**: 2026-09-04' : '**Updated**: 2026-09-04',
    locale === 'zh' ? '**更新**: 2026-09-07' : '**Updated**: 2026-09-07');
  b = b.replace(locale === 'zh' ? '`opencode/`、`eda/`' : '`opencode/`, `eda/`',
    locale === 'zh' ? '`opencode/`、`eda/`、`ops/`' : '`opencode/`, `eda/`, `ops/`');
  // V4 Pro triple-anchor stack → one labeled link to the merged canonical page
  const canon = '/llm-eval/bailian-token-plan/deepseek-v4-pro';
  const stackRe = new RegExp(`(\\[[^\\]]+\\]\\(${canon}\\)(<br>)?){2,}`);
  if (stackRe.test(b)) {
    b = b.replace(stackRe, `[${locale === 'zh' ? 'DeepSeek V4 Pro（preview 与 0813 汇总）' : 'DeepSeek V4 Pro (preview & 0813 merged)'}](${canon})`);
    log.push('converge V4 Pro stack');
  }
  return { body: b, log };
}

for (const locale of ['zh', 'en']) {
  const page = await readPage(client, 'wiki-index', locale);
  const { body, log } = patch(page.content, locale);
  if (body === page.content) { console.log(`[${locale}] NO CHANGE`); continue; }
  const r = await tools.historian_page_update.execute({ path: 'wiki-index', locale, content: body }, {});
  const out = JSON.parse(typeof r === 'string' ? r : String(r.output));
  console.log(`[${locale}] ${out.ok === false ? 'REFUSED: ' + out.message : 'updated'}`);
  for (const l of log) console.log('   ', l);
}

/**
 * Re-translate the laggard twin leg for structurally divergent pages
 * (maintain/surface twinParity rows). Leader leg = richer structure wins;
 * translated body goes back through the publish gate.
 */

import { createClient } from '../dist/wiki/client.js';
import { readPage } from '../dist/wiki/pages.read.js';
import { buildTools } from '../dist/tools.js';
import { makeTranslator } from '../dist/translate.js';
import { lintBody } from '../dist/lint.js';
import { liveOptions } from './live-options.mjs';

const PATHS = process.argv.slice(2);
const options = liveOptions();
const client = createClient(options);
const tools = buildTools(options);
const translate = makeTranslator(options);
const BASE = options.baseUrl.replace(/\/$/, '');

const struct = (body, locale) => {
  const l = lintBody(body, { locale, baseUrl: BASE });
  return { h2: l.headings.filter((h) => h.level >= 2).length, len: body.length };
};

for (const path of PATHS) {
  const en = await readPage(client, path, 'en');
  const zh = await readPage(client, path, 'zh');
  if (en === null || zh === null) { console.log(`skip ${path} (missing leg)`); continue; }
  const [se, sz] = [struct(en.content, 'en'), struct(zh.content, 'zh')];
  const zhLags = sz.h2 < se.h2 || (sz.h2 === se.h2 && sz.len < se.len * 0.6);
  const enLags = se.h2 < sz.h2 || (se.h2 === sz.h2 && se.len < sz.len * 0.6);
  if (!zhLags && !enLags) { console.log(`skip ${path} (parity ok en ${se.h2}/${en.content.length} zh ${sz.h2}/${zh.content.length})`); continue; }
  const [from, to, leader] = zhLags ? ['en', 'zh', en] : ['zh', 'en', zh];
  try {
    const body = await translate(leader.content, from, to);
    const r = await tools.historian_page_update.execute({ path, locale: to, content: body }, {});
    const out = JSON.parse(typeof r === 'string' ? r : String(r.output));
    const after = struct(body, to);
    console.log(`${out.ok === false ? 'REFUSED' : 'retrans'} ${path} (${to}) leader=${from} h2 ${after.h2} len ${after.len} ${out.ok === false ? out.message : ''}`);
  } catch (e) {
    console.log(`ERROR ${path}: ${String(e).slice(0, 160)}`);
  }
}

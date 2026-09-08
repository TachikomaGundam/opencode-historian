// Batch tag backfill: zh legs copy en-twin tags; en legs get section vocab.
// Runs through the real update tool path (preserves other fields; tags-only
// update never trips the content publish gate).
import { liveOptions } from './live-options.mjs';
import { createClient } from '../dist/wiki/client.js';
import { listPages } from '../dist/wiki/pages.read.js';
import { buildTools } from '../dist/tools.js';

const APPLY = process.argv.includes('--apply');
const client = createClient(liveOptions());
const tools = buildTools(liveOptions());
const call = async (t, a) => {
  const r = await tools[t].execute(a, {});
  return JSON.parse(typeof r === 'string' ? r : String(r.output));
};

// section → base tags for the en leg when it has none itself
const SECTION = {
  home: ['navigation', 'index'],
  'wiki-index': ['navigation', 'index'],
  infra: ['infra'],
  llm: ['llm'],
  'llm-eval': ['model-evaluation'],
  opencode: ['opencode'],
  ops: ['runbook'],
  scratch: ['scratch'],
};

const rows = [];
for (const locale of ['en', 'zh']) {
  for (const p of await listPages(client, { locale })) {
    if (p.isPublished) rows.push({ path: p.path, locale: p.locale, tags: p.tags });
  }
}
const byKey = new Map(rows.map((x) => [`${x.locale}\0${x.path}`, x]));
const plan = [];
for (const x of rows) {
  if (x.tags && x.tags.length) continue;
  const seg = x.path.split('/')[0];
  if (['_meta', '_evidence', '_sandbox', '_data'].includes(seg)) continue; // machine zones untouched
  let tags = null;
  const twin = byKey.get(`${x.locale === 'zh' ? 'en' : 'zh'}\0${x.path}`);
  if (x.locale === 'zh' && twin?.tags?.length) tags = twin.tags;
  else if (x.locale === 'en') {
    const base = SECTION[seg];
    if (base) tags = [...base];
    else continue; // unknown section — skip rather than invent
  }
  if (tags) plan.push({ path: x.path, locale: x.locale, from: x.tags ?? [], to: tags });
}
console.log(`${APPLY ? 'APPLYING' : 'DRY-RUN'}: ${plan.length} tag backfills`);
let done = 0;
for (const p of plan) {
  if (APPLY) {
    const r = await call('historian_page_update', { path: p.path, locale: p.locale, tags: p.to });
    if (r.ok === false) { console.log(`FAIL ${p.locale} ${p.path}: ${r.errorKind ?? r.message}`); continue; }
    done++;
  } else {
    console.log(`${p.locale} ${p.path} -> [${p.to.join(', ')}]`);
  }
}
console.log(`done=${done}/${plan.length}`);

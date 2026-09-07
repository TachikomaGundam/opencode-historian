// Batch A / Issue #1: replace dynamic-mirror nav with a curated STATIC tree.
// Read-only until --apply. Verifies via re-query after apply.
import { liveOptions } from './live-options.mjs';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const APPLY = process.argv.includes('--apply');
const o = liveOptions();
const key = readFileSync(process.env.HOME + '/.wikijs-api-key', 'utf8').trim();
const gql = async (query, variables = {}) =>
  (await fetch(o.baseUrl + '/graphql', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })).json();

const item = (label, icon, target, targetType, id) => ({
  id: id ?? randomUUID(),
  kind: 'link',
  label,
  icon,
  targetType,
  target,
  visibilityMode: 'all',
});

// Existing en Home keeps its id (no churn); everything else is fresh.
// Namespacing mode lesson (verified in live DOM): 'page'/'home' targets render
// LITERAL hrefs without locale prefix — clicking them from a zh page 301s into
// /en/... . So the zh tree hardcodes /zh/ prefixes (targetType 'url' = literal
// href) and each tree carries a cross-language entry = the anonymous-reader
// language switcher (wiki.js 2.x ships none for visitors).
const trees = [
  {
    locale: 'en',
    items: [
      item('Home', 'mdi-home', '/', 'home', '0ffcc77a-4aff-482d-bdc2-c6b85be3f18c'),
      item('中文', 'mdi-translate', '/zh/home', 'url'),
      item('Wiki Index', 'mdi-book-open-outline', '/wiki-index', 'page'),
      item('Infrastructure', 'mdi-server', '/infra', 'page'),
      item('LLM Inference', 'mdi-brain', '/llm', 'page'),
      item('Model Evaluation', 'mdi-scale-balance', '/llm-eval', 'page'),
      item('OpenCode Recaps', 'mdi-robot', '/opencode', 'page'),
    ],
  },
  {
    locale: 'zh',
    items: [
      item('首页', 'mdi-home', '/zh/home', 'url'),
      item('English', 'mdi-translate', '/en/home', 'url'),
      item('全库索引', 'mdi-book-open-outline', '/zh/wiki-index', 'url'),
      item('基础设施', 'mdi-server', '/zh/infra', 'url'),
      item('LLM 推理', 'mdi-brain', '/zh/llm', 'url'),
      item('模型评测', 'mdi-scale-balance', '/zh/llm-eval', 'url'),
      item('OpenCode 复盘', 'mdi-robot', '/zh/opencode', 'url'),
    ],
  },
];

const before = await gql('{ navigation { config { mode } tree { locale items { id label targetType target } } } }');
console.log('BEFORE mode =', before.data?.navigation?.config?.mode);
for (const t of before.data?.navigation?.tree ?? []) console.log(` [${t.locale}]`, t.items.map((i) => i.label).join(', ') || '(empty)');

if (!APPLY) {
  console.log('\nDRY RUN — pass --apply to write.');
  console.log('PLANNED:');
  for (const t of trees) console.log(` [${t.locale}]`, t.items.map((i) => `${i.label}→${i.target}`).join(', '));
  process.exit(0);
}

// DefaultResponse is { responseResult { succeeded errorCode slug message } } — probed live.
const RESP = 'responseResult { succeeded errorCode message }';
const up = await gql(
  `mutation($tree: [NavigationTreeInput]!) { navigation { updateTree(tree: $tree) { ${RESP} } } }`,
  { tree: trees },
);
console.log('updateTree:', JSON.stringify(up.data?.navigation?.updateTree ?? up.errors).slice(0, 300));

const cfg = await gql(`mutation($mode: NavigationMode!) { navigation { updateConfig(mode: $mode) { ${RESP} } } }`, { mode: 'STATIC' });
console.log('updateConfig STATIC:', JSON.stringify(cfg.data?.navigation?.updateConfig ?? cfg.errors).slice(0, 300));

const after = await gql('{ navigation { config { mode } tree { locale items { label targetType target visibilityMode } } } }');
console.log('AFTER mode =', after.data?.navigation?.config?.mode);
for (const t of after.data?.navigation?.tree ?? []) console.log(` [${t.locale}]`, t.items.map((i) => `${i.label}→${i.target}`).join(', ') || '(empty)');

// Batch A / Issues #2+#3: enable namespacing + download zh i18n bundle.
// Root cause chain (proven against live server source):
//   core/localization.js refreshNamespaces() only loads bundles for
//   WIKI.config.lang.namespaces when namespacing=true -> zh bundle never
//   entered the engine -> every UI translation request for zh threw
//   'Invalid locale or namespace' (console errors, raw key leaks like
//   sidebar.mainMenu / notfound.* on zh pages).
// Secondary: locales.strings for zh was NULL in DB (installed flag without content).
// Mutation shapes (probed from /wiki/server/graph/schemas/localization.graphql):
//   updateLocale(locale: String!, autoUpdate: Boolean!, namespacing: Boolean!, namespaces: [String]!)
//   translations(locale: String!, namespace: String!)
// updateLocale internally calls refreshNamespaces() after saving config;
// downloadLocale runs jobs/fetch-graph-locale.js (pulls from WIKI.config.graphEndpoint).
import { liveOptions } from './live-options.mjs';
import { readFileSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const o = liveOptions();
const key = readFileSync(process.env.HOME + '/.wikijs-api-key', 'utf8').trim();
const gql = async (query, variables = {}) =>
  (await fetch(o.baseUrl + '/graphql', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })).json();

const RESP = 'responseResult { succeeded errorCode message }';

async function probe(label) {
  const cfg = (await gql('{ localization { config { locale autoUpdate namespacing namespaces } } }')).data?.localization?.config;
  console.log(`[${label}] config:`, JSON.stringify(cfg));
  for (const [loc, ns] of [['en', 'common'], ['zh', 'common']]) {
    const r = await gql(`{ localization { translations(locale: "${loc}", namespace: "${ns}") { key value } } }`);
    console.log(`[${label}] translations(${loc}/${ns}):`, r.errors ? 'ERR ' + r.errors[0].message.slice(0, 60) : `OK ${r.data.localization.translations.length} keys`);
  }
}

await probe('before');
if (!APPLY) {
  console.log('\nDRY RUN — --apply: updateLocale(namespacing:true, namespaces:["zh"]) then downloadLocale(zh), then re-probe.');
  process.exit(0);
}

const upd = await gql(
  `mutation($locale: String!, $autoUpdate: Boolean!, $namespacing: Boolean!, $namespaces: [String]!) {
     localization { updateLocale(locale: $locale, autoUpdate: $autoUpdate, namespacing: $namespacing, namespaces: $namespaces) { ${RESP} } }
   }`,
  { locale: 'en', autoUpdate: true, namespacing: true, namespaces: ['zh'] },
);
console.log('updateLocale:', JSON.stringify(upd.data?.localization?.updateLocale ?? upd.errors).slice(0, 240));

const dl = await gql(`mutation { localization { downloadLocale(locale: "zh") { ${RESP} } } }`);
console.log('downloadLocale(zh):', JSON.stringify(dl.data?.localization?.downloadLocale ?? dl.errors).slice(0, 240));

await probe('after');

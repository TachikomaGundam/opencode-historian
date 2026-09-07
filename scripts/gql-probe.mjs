import { readFileSync } from 'node:fs';
import { liveOptions } from './live-options.mjs';

const o = liveOptions();
const key = readFileSync(process.env.HOME + '/.wikijs-api-key', 'utf8').trim();

export const gql = async (query, variables = {}) => {
  const r = await fetch(o.baseUrl + '/graphql', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  return r.json();
};

const fmt = (t) => t?.name ?? (t?.ofType ? fmt(t.ofType) : t?.kind);
const root = await gql('{ q: __type(name: "Query") { fields { name type { name kind ofType { name } } } } m: __type(name: "Mutation") { fields { name type { name kind ofType { name } } } } }');
const pick = (list) => list.filter((f) => /nav|local/i.test(f.name)).map((f) => f.name + ' -> ' + (f.type.name ?? f.type.ofType?.name ?? f.type.kind));
console.log('Query:', pick(root.data.q.fields).join(' | '));
console.log('Mutation:', pick(root.data.m.fields).join(' | '));
const tn = process.argv[2];
if (tn) {
  const r = await gql('{ __type(name: "' + tn + '") { fields { name args { name type } type { name kind ofType { name } } } } }');
  const fields = r.data?.__type?.fields ?? [];
  console.log(tn + ':', fields.length === 0 ? 'null' : '');
  for (const f of fields) {
    console.log('  ', f.name, '(' + (f.args ?? []).map((a) => a.name + ': ' + fmt(a.type)).join(', ') + ') ->', fmt(f.type));
  }
}

/**
 * Gated single-page writer: content from a markdown file, straight through
 * the 0.5.0 publish gate. Usage:
 *   node scripts/gated-write.mjs update <path> <locale> <file.md>
 *   node scripts/gated-write.mjs create <path> <locale> <title> <genre> <file.md>
 */

import { readFileSync } from 'node:fs';
import { liveOptions } from './live-options.mjs';
import { buildTools } from '../dist/tools.js';

const options = liveOptions();
const tools = buildTools(options);
const [mode, path, locale, a4, a5, a6] = process.argv.slice(2);
const file = mode === 'update' ? a4 : a6;
const content = readFileSync(file, 'utf8');

const call = async (name, args) => {
  const r = await tools[name].execute(args, {});
  return JSON.parse(typeof r === 'string' ? r : String(r.output));
};

let out;
if (mode === 'update') {
  out = await call('historian_page_update', { path, locale, content });
} else {
  out = await call('historian_page_create', { path, locale, title: a4, genre: a5, content, twin: false });
}
if (out.ok === false) {
  console.log(`REFUSED ${path} (${locale}): ${out.errorKind} — ${out.message}`);
  process.exitCode = 1;
} else {
  console.log(`OK ${mode} ${path} (${locale}) urls=${JSON.stringify(out.urls ?? out.url ?? '')}`);
}

#!/usr/bin/env node
// L-MACHINE-LOCAL mechanical gate (owner ruling 2026-10-01; born from the
// 2026-10-02 incident where a vendor model id sat in config+README for six
// releases). Portable surfaces — src/** and README* — must not pin
// device-side inference model identifiers. Test fixtures are exempt.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
const VENDOR_MODEL_RE = /\b(?:qwen|deepseek|kimi|ernie|doubao|hunyuan|glm|spark)[-.\d][\w.-]*\b/i;
const files = [];
const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); const st = statSync(p); if (st.isDirectory()) walk(p); else files.push(p); } };
walk('src'); files.push(...readdirSync('.').filter((f) => /^README(\..*)?\.md$/.test(f)).map((f) => join('.', f)));
let bad = 0;
for (const f of files) {
  if (/\.test\.|fixtures?/.test(f)) continue;
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((l, i) => { const m = l.match(VENDOR_MODEL_RE); if (m) { console.log(`BINDING ${f}:${i + 1}: ${m[0]} — portable surface pins a device model (L-MACHINE-LOCAL); drop it or route via config/env`); bad++; } });
}
if (bad > 0) { console.log(`portable-binding-audit: ${bad} finding(s) — FAIL`); process.exit(1); }
console.log('portable-binding-audit: clean (0 device bindings on portable surfaces)');

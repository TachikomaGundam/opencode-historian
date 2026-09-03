// LIVE probe for todo 10 — read-only double-fetch consistency check against
// the real wiki at localhost:3000.
//
// Two INDEPENDENT sequential buildPageMap passes (each is its own full
// pages.list pull per locale). Assertions:
//   * both passes report stats.rows >= 200
//   * both passes produce DEEP-EQUAL row arrays (same-run equality rule: the
//     wiki is not expected to change between two immediate reads — any
//     difference is drift, not a legit edit)
// The difference vs the ~204-published baseline is RECORDED, never asserted.
//
// Deliberately does NOT refresh `_meta/page-map` and does NOT write the local
// mirror — todo 15 (pilot) and todo 11 (wiring) own the write path; this probe
// is pure read. Deferral reasoning is recorded in .qa/10.txt.
//
// Run: npm run build && node test/live/map10.mjs   (imports from dist/)

import { homedir } from 'node:os';
import { resolveOptions } from '../../dist/config.js';
import { createClient } from '../../dist/wiki/client.js';
import { buildPageMap, renderMapMarkdown } from '../../dist/map.js';

const line = (s) => console.log(s);

try {
  const options = resolveOptions({});
  const deps = { client: createClient(options, { homeDir: homedir() }), options };

  const passA = await buildPageMap(deps);
  const passB = await buildPageMap(deps);

  const sa = passA.stats;
  const sb = passB.stats;
  line(`pass A rows=${sa.rows} paths=${sa.paths} perLocale=${JSON.stringify(sa.perLocale)} missingTwin=${sa.missingTwinPaths.length}`);
  line(`pass B rows=${sb.rows} paths=${sb.paths} perLocale=${JSON.stringify(sb.perLocale)} missingTwin=${sb.missingTwinPaths.length}`);

  let failed = false;
  if (sa.rows < 200 || sb.rows < 200) {
    failed = true;
    line(`FAIL rows<200: pass A=${sa.rows} pass B=${sb.rows}`);
  }
  const ca = JSON.stringify(passA.rows);
  const cb = JSON.stringify(passB.rows);
  if (ca !== cb) {
    failed = true;
    line(`FAIL passes differ: A=${sa.rows} rows vs B=${sb.rows} rows (first diff index ${firstDiffIndex(ca, cb)})`);
  }
  if (failed) {
    line('MAP10 FAIL');
    process.exitCode = 1;
  } else {
    line(
      `MAP10 OK rows=${sa.rows} paths=${sa.paths} perLocale=${JSON.stringify(sa.perLocale)} missingTwin=${sa.missingTwinPaths.length}`,
    );
    // Evidence for .qa/10.txt: header verbatim + first 10 rows
    line('--- first 10 rows ---');
    const md = renderMapMarkdown(passA.rows, new Date().toISOString()).trim().split('\n');
    for (const l of md.slice(0, 12)) line(l);
  }
} catch (err) {
  line(`MAP10 FAIL ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}

function firstDiffIndex(a, b) {
  let i = 0;
  const n = Math.min(a.length, b.length);
  while (i < n && a[i] === b[i]) i++;
  return i;
}
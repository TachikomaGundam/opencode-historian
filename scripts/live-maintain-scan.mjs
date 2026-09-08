/**
 * Live acceptance scan: run the BUILT deep maintain + surface report against
 * the real wiki (read-only — no writes, no map refresh) and persist the full
 * markdown. This is the "修好的史官必须自己发现这些问题" proof run.
 *
 * Run: npm run build && node scripts/live-maintain-scan.mjs [> /tmp/live-maintain.md]
 */

import { writeFileSync } from 'node:fs';
import { liveOptions } from './live-options.mjs';
import { createClient } from '../dist/wiki/client.js';
import { listPages, readPage } from '../dist/wiki/pages.read.js';
import { normalizeLocale, PathValidationError } from '../dist/wiki/locale.js';
import { getMap } from '../dist/map.js';
import { buildMaintainReport, renderMaintainMarkdown } from '../dist/maintain.js';
import { buildSurfaceReport, renderSurfaceMarkdown } from '../dist/surface.js';
import { readPrimaryNav } from '../dist/wiki/nav.js';

const OUT = process.argv[2] ?? '/tmp/live-maintain.md';

// Mirror the live plugin registration in ~/.config/opencode/opencode.jsonc:
// resolveOptions eagerly requires a translation key, but this scan is pure
// read-only and never calls translate — the jsonc provider leg satisfies the
// resolver without embedding any secret here.
const options = liveOptions();
const client = createClient(options);
const snapshot = await getMap({ client, options });

const tagIndex = new Map();
const liveInventory = [];
const locales = [...new Set(options.locales.map(normalizeLocale))].sort();
for (const locale of locales) {
  for (const item of await listPages(client, { locale })) {
    tagIndex.set(`${item.locale}\u0000${item.path}`, item.tags);
    liveInventory.push({ path: item.path, locale: item.locale, isPublished: item.isPublished });
  }
}
const rows = snapshot.rows.map((r) => ({ ...r, tags: tagIndex.get(`${r.locale}\u0000${r.path}`) ?? [] }));

const bodyCache = new Map();
const readBody = (path, locale) => {
  const key = `${locale}\u0000${path}`;
  const hit = bodyCache.get(key);
  if (hit !== undefined) return hit;
  const pending = (async () => {
    try {
      return (await readPage(client, path, locale))?.content ?? null;
    } catch (err) {
      if (err instanceof PathValidationError) return null;
      throw err;
    }
  })();
  bodyCache.set(key, pending);
  return pending;
};

const report = await buildMaintainReport(
  { rows, mapGeneratedAt: snapshot.generatedAt, mapStaleSeconds: snapshot.staleSeconds },
  { deep: true, readBody },
);
const surface = await buildSurfaceReport({
  rows,
  generatedAt: report.generatedAt,
  baseUrl: options.baseUrl,
  liveInventory,
  nav: await readPrimaryNav(client),
  deep: true,
  readBody,
});

const markdown = `${renderMaintainMarkdown(report)}\n\n${renderSurfaceMarkdown(surface)}\n`;
writeFileSync(OUT, markdown);

const s = surface.deepReport;
console.error(`[scan] mapRows=${rows.length} liveRows=${liveInventory.length} bodyReads=${bodyCache.size}`);
console.error(`[scan] coverage missingFromMap=${surface.coverage?.missingFromMap.length}`);
console.error(`[scan] nav mode=${surface.nav.mode} exposed=${surface.nav.filesystemExposed} machineLinks=${surface.nav.machineLinks.length} landingMissing=${surface.nav.sectionLandingMissing.length}`);
console.error(`[scan] maintain dupes=${report.duplicates.clusters.length} staleness=${report.staleness.oldest.length}`);
console.error(`[scan] deep unfinished=${s?.unfinished.length} stubs=${s?.stubs.length} (dead=${s?.stubs.filter((x) => !x.clickable || !x.targetLive).length}) brokenLinks=${s?.links.broken.length} toStubs=${s?.links.toStubs.length} stacks=${s?.links.sameTargetStacks.length} orphans=${s?.links.orphanPages.length} indexMissing=${s?.links.indexMissing.length}`);
console.error(`[scan] roleDivergence=${s?.roleDivergence.length} twinDivergent=${s?.twinParity.filter((t) => t.divergent).length} zhEnglishDominant=${s?.zhEnglishDominant.length} ledgerClaims=${s?.ledgerClaims.length}`);
console.error(`[scan] wrote ${OUT}`);

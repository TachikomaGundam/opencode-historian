/**
 * Maintain curation report (plan todo-7, D3 CURATE / D12): deterministic
 * metric sweeps over already-fetched map rows (tier-1 light) plus optional
 * injected page-body reads (deep). The chronology.ts precedent holds here —
 * no client, no fs, no wiki logic: pure functions over MapRow-shaped input and
 * a readBody dependency; the tool layer (tools/local.ts) supplies both.
 *
 * Output is dual-form: a human markdown report (renderMaintainMarkdown) and a
 * machine-readable JSON tail with stable top-level keys (schema
 * 'historian.maintain.v1') so later todos can parse it without re-deriving.
 *
 * allow: SIZE_OK — the plan pins this commit to src/maintain.ts +
 * tools/local.ts + test/maintain.test.ts only, so the metric builder and its
 * markdown renderer ship as one module instead of a third file.
 */

import type { MapRow } from './map.js';
import type { Locale } from './wiki/pages.read.js';
import { classifyGenre } from './templates/genres.js';
import { isInternalPath } from './tools/shared.js';
import { normalize } from './migrate-score.js';

// --- Types ------------------------------------------------------------------

/** A map row optionally enriched with tags (the tool layer joins these from a
 *  read-only pages.list pass; the mirror's MapRow carries none). */
export interface MaintainRow extends MapRow {
  readonly tags?: readonly string[];
}

export interface MaintainInput {
  readonly rows: readonly MaintainRow[];
  readonly mapGeneratedAt?: string | null;
  readonly mapStaleSeconds?: number | null;
}

export type ReadBodyFn = (path: string, locale: Locale) => Promise<string | null>;

export interface MaintainOptions {
  readonly now?: Date;
  readonly topN?: number;
  readonly deep?: boolean;
  readonly readBody?: ReadBodyFn;
}

export interface DupCluster {
  readonly paths: readonly string[];
  readonly titles: readonly string[];
}

export interface StaleEntry {
  readonly path: string;
  readonly updatedAt: string;
  readonly daysOld: number;
  readonly locales: readonly string[];
}

export interface RedirectStub {
  readonly path: string;
  readonly locale: Locale;
  readonly target: string;
}

export interface MissingStamp {
  readonly path: string;
  readonly locale: Locale;
  readonly genre: string;
}

export interface ExpiredReview {
  readonly path: string;
  readonly locale: Locale;
  readonly reviewBy: string;
  readonly daysExpired: number;
}

export interface FreshnessScan {
  readonly scanned: number;
  readonly unreadable: number;
  readonly missingLastVerified: readonly MissingStamp[];
  readonly expiredReviewBy: readonly ExpiredReview[];
}

export interface MaintainReport {
  readonly schema: typeof MAINTAIN_SCHEMA;
  readonly generatedAt: string;
  readonly rowCount: number;
  readonly mapGeneratedAt: string | null;
  readonly mapStaleSeconds: number | null;
  readonly deep: boolean;
  readonly pages: {
    readonly rows: number;
    readonly paths: number;
    readonly perLocale: Readonly<Record<string, number>>;
    readonly missingTwinPaths: readonly string[];
  };
  readonly duplicates: { readonly threshold: number; readonly clusters: readonly DupCluster[] };
  readonly staleness: { readonly topN: number; readonly oldest: readonly StaleEntry[] };
  readonly diffusion: { readonly singleChildDirs: readonly { dir: string; childPath: string }[] };
  readonly rootOrphans: readonly { section: string; paths: readonly string[] }[];
  readonly tags: { available: boolean; vocabulary: readonly { tag: string; count: number }[] };
  readonly redirects: { available: boolean; count: number; stubs: readonly RedirectStub[] };
  readonly sections: readonly { section: string; paths: number; rows: number }[];
  readonly freshness: FreshnessScan | null;
}

// --- Constants --------------------------------------------------------------

export const MAINTAIN_SCHEMA = 'historian.maintain.v1';
/** Trigram-Jaccard bar for calling two (different-path) titles near-duplicates. */
export const DUP_TITLE_THRESHOLD = 0.75;
const DAY_MS = 86_400_000;
const DEFAULT_TOP_N = 10;
/** Genres whose pages must carry the D4 last-verified stamp (G6 how-to joins
 *  this set when todo-2 lands it — string membership, no type coupling). */
// D4 freshness applies to knowledge-fact pages: G5 today; 'G6' is listed
// pre-emptively so the deep sweep lights up when the genre lane lands.
const FRESHNESS_GENRES: readonly string[] = ['G5', 'G6'];
const STAMP_RE = /上次核实|last verified/i;
const REVIEW_LABEL_RE = /^(复核周期|复核期限|复核日期|review[-_ ]?by|review[-_ ]?due)$/i;
const ISO_DATE_RE = /\d{4}-\d{2}-\d{2}/;
const REDIRECT_RE = /^>\s*Redirect:/i;

// --- Title similarity (trigram core copied from migrate-score.ts:289, where it
// --- is private with a 0.95 roundtrip bar; maintain needs its own threshold) ---

function titleGrams(s: string): Set<string> {
  const out = new Set<string>();
  if (s.length < 3) {
    if (s.length > 0) out.add(s);
    return out;
  }
  for (let i = 0; i <= s.length - 3; i++) out.add(s.slice(i, i + 3));
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const g of a) if (b.has(g)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

// --- Metric builders ----------------------------------------------------------

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function findDuplicates(rows: readonly MaintainRow[]): DupCluster[] {
  const units = rows.map((r) => ({
    path: r.path,
    title: r.title,
    grams: titleGrams(normalize(r.title).toLowerCase()),
  }));
  const parent = units.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      // twins share a path by design — never a duplicate; cross-locale title
      // similarity is low enough that same-path exclusion is the only guard needed
      if (units[i].path === units[j].path) continue;
      if (jaccard(units[i].grams, units[j].grams) >= DUP_TITLE_THRESHOLD) parent[find(i)] = find(j);
    }
  }
  const clusters = new Map<number, { paths: Set<string>; titles: Set<string> }>();
  units.forEach((u, i) => {
    const root = find(i);
    const bucket = clusters.get(root) ?? { paths: new Set<string>(), titles: new Set<string>() };
    bucket.paths.add(u.path);
    bucket.titles.add(u.title);
    clusters.set(root, bucket);
  });
  const out = [...clusters.values()]
    .filter((c) => c.paths.size >= 2)
    .map((c) => ({ paths: [...c.paths].sort(cmpStr), titles: [...c.titles].sort(cmpStr) }));
  out.sort((a, b) => b.paths.length - a.paths.length || cmpStr(a.paths[0], b.paths[0]));
  return out;
}

function staleness(rows: readonly MaintainRow[], now: Date, topN: number): StaleEntry[] {
  const byPath = new Map<string, { t: number; updatedAt: string; locales: Set<string> }>();
  for (const r of rows) {
    const t = Date.parse(r.updatedAt);
    if (Number.isNaN(t)) continue;
    const cur = byPath.get(r.path);
    if (cur === undefined) byPath.set(r.path, { t, updatedAt: r.updatedAt, locales: new Set([r.locale]) });
    else {
      cur.locales.add(r.locale);
      if (t > cur.t) {
        cur.t = t;
        cur.updatedAt = r.updatedAt;
      }
    }
  }
  const round1 = (x: number): number => Math.round(x * 10) / 10;
  return [...byPath.entries()]
    .map(([path, v]) => ({
      path,
      updatedAt: v.updatedAt,
      daysOld: round1((now.getTime() - v.t) / DAY_MS),
      locales: [...v.locales].sort(cmpStr),
    }))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || cmpStr(a.path, b.path))
    .slice(0, topN);
}

function singleChildDirs(paths: readonly string[]): { dir: string; childPath: string }[] {
  const subtree = new Map<string, Set<string>>();
  for (const path of paths) {
    const segs = path.split('/');
    for (let i = 1; i < segs.length; i++) {
      const dir = segs.slice(0, i).join('/');
      const bucket = subtree.get(dir) ?? new Set<string>();
      bucket.add(path);
      subtree.set(dir, bucket);
    }
  }
  const single = new Set([...subtree.entries()].filter(([, v]) => v.size === 1).map(([d]) => d));
  const out: { dir: string; childPath: string }[] = [];
  for (const dir of [...single].sort(cmpStr)) {
    const cut = dir.lastIndexOf('/');
    if (cut > 0 && single.has(dir.slice(0, cut))) continue; // report the shallowest of a chain
    const children = subtree.get(dir);
    if (children !== undefined) out.push({ dir, childPath: [...children][0] });
  }
  return out;
}

function rootOrphans(paths: readonly string[]): { section: string; paths: string[] }[] {
  const bySection = new Map<string, string[]>();
  for (const path of paths) {
    if (path.split('/').length !== 2) continue;
    const section = path.split('/')[0];
    const bucket = bySection.get(section) ?? [];
    bucket.push(path);
    bySection.set(section, bucket);
  }
  return [...bySection.entries()]
    .map(([section, ps]) => ({ section, paths: ps.sort(cmpStr) }))
    .sort((a, b) => cmpStr(a.section, b.section));
}

function tagVocab(rows: readonly MaintainRow[]): { available: boolean; vocabulary: { tag: string; count: number }[] } {
  const available = rows.some((r) => r.tags !== undefined);
  if (!available) return { available: false, vocabulary: [] };
  const counts = new Map<string, number>();
  for (const r of rows) for (const tag of r.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const vocabulary = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || cmpStr(a.tag, b.tag));
  return { available: true, vocabulary };
}

function sectionDist(rows: readonly MaintainRow[]): { section: string; paths: number; rows: number }[] {
  const bySection = new Map<string, { paths: Set<string>; rows: number }>();
  for (const r of rows) {
    const section = r.path.split('/')[0];
    const bucket = bySection.get(section) ?? { paths: new Set<string>(), rows: 0 };
    bucket.paths.add(r.path);
    bucket.rows += 1;
    bySection.set(section, bucket);
  }
  return [...bySection.entries()]
    .map(([section, v]) => ({ section, paths: v.paths.size, rows: v.rows }))
    .sort((a, b) => b.paths - a.paths || cmpStr(a.section, b.section));
}

/** D4 review-by row inside a 元数据 markdown table (wiki.js has no front matter). */
function reviewByOf(body: string): string | null {
  for (const line of body.split('\n')) {
    if (!line.trimStart().startsWith('|')) continue;
    const cells = line.split('|').map((c) => c.trim());
    if (cells.length < 3 || !REVIEW_LABEL_RE.test(cells[1])) continue;
    const m = cells.slice(2).join(' ').match(ISO_DATE_RE);
    if (m !== null) return m[0];
  }
  return null;
}

// --- buildMaintainReport --------------------------------------------------------

export async function buildMaintainReport(input: MaintainInput, opts: MaintainOptions = {}): Promise<MaintainReport> {
  const now = opts.now ?? new Date();
  const topN = opts.topN ?? DEFAULT_TOP_N;
  const deep = opts.deep ?? false;
  if (deep && opts.readBody === undefined) {
    throw new TypeError('buildMaintainReport: deep:true requires a readBody dependency');
  }
  const kept = input.rows.filter((r) => !isInternalPath(r.path));
  const paths = [...new Set(kept.map((r) => r.path))].sort(cmpStr);

  const perLocale: Record<string, number> = {};
  for (const r of kept) perLocale[r.locale] = (perLocale[r.locale] ?? 0) + 1;
  const localeCount = new Map<string, number>();
  for (const r of kept) localeCount.set(r.path, (localeCount.get(r.path) ?? 0) + 1);

  let redirects: MaintainReport['redirects'] = { available: false, count: 0, stubs: [] };
  let freshness: FreshnessScan | null = null;
  if (deep && opts.readBody !== undefined) {
    const readBody = opts.readBody;
    const stubs: RedirectStub[] = [];
    const missing: MissingStamp[] = [];
    const expired: ExpiredReview[] = [];
    let scanned = 0;
    let unreadable = 0;
    for (const r of kept) {
      const body = await readBody(r.path, r.locale);
      if (body === null) {
        unreadable += 1;
        continue;
      }
      scanned += 1;
      const firstLine = body.split('\n').find((l) => l.trim() !== '');
      if (firstLine !== undefined && REDIRECT_RE.test(firstLine.trim())) {
        stubs.push({ path: r.path, locale: r.locale, target: firstLine.trim().replace(REDIRECT_RE, '').trim() });
        continue; // stubs are pointers — exempt from the freshness-stamp rule
      }
      const genre = classifyGenre({ title: r.title, body }).genre;
      if (!FRESHNESS_GENRES.includes(genre)) continue;
      if (!STAMP_RE.test(body)) missing.push({ path: r.path, locale: r.locale, genre });
      const reviewBy = reviewByOf(body);
      if (reviewBy !== null) {
        const t = Date.parse(reviewBy);
        if (!Number.isNaN(t) && t < now.getTime()) {
          expired.push({ path: r.path, locale: r.locale, reviewBy, daysExpired: Math.floor((now.getTime() - t) / DAY_MS) });
        }
      }
    }
    redirects = { available: true, count: stubs.length, stubs };
    freshness = { scanned, unreadable, missingLastVerified: missing, expiredReviewBy: expired };
  }

  return {
    schema: MAINTAIN_SCHEMA,
    generatedAt: now.toISOString(),
    rowCount: input.rows.length,
    mapGeneratedAt: input.mapGeneratedAt ?? null,
    mapStaleSeconds: input.mapStaleSeconds ?? null,
    deep,
    pages: {
      rows: kept.length,
      paths: paths.length,
      perLocale,
      missingTwinPaths: paths.filter((p) => localeCount.get(p) === 1),
    },
    duplicates: { threshold: DUP_TITLE_THRESHOLD, clusters: findDuplicates(kept) },
    staleness: { topN, oldest: staleness(kept, now, topN) },
    diffusion: { singleChildDirs: singleChildDirs(paths) },
    rootOrphans: rootOrphans(paths),
    tags: tagVocab(kept),
    redirects,
    sections: sectionDist(kept),
    freshness,
  };
}

// --- renderMaintainMarkdown -----------------------------------------------------

const fmt = (n: number): string => String(n);

/** Human report + (always) a fenced machine-readable JSON block at the END —
 *  the same MaintainReport object the tool envelope carries. */
export function renderMaintainMarkdown(r: MaintainReport): string {
  const L: string[] = [];
  L.push(`# Maintain Report (${r.deep ? 'deep' : 'light'})`, '');
  L.push(
    `> Generated ${r.generatedAt} · ${fmt(r.rowCount)} map rows · ` +
      `map snapshot ${r.mapGeneratedAt ?? 'live build'}` +
      `${r.mapStaleSeconds === null ? '' : ` · stale ${fmt(r.mapStaleSeconds)}s`}`,
    '',
  );

  L.push('## Pages & twins', '');
  L.push(
    `- ${fmt(r.pages.rows)} kept rows / ${fmt(r.pages.paths)} paths (${Object.entries(r.pages.perLocale)
      .map(([l, n]) => `${l}:${fmt(n)}`)
      .join(' ')})`,
  );
  L.push(`- twin gap — paths missing one locale (${fmt(r.pages.missingTwinPaths.length)}):`);
  for (const p of r.pages.missingTwinPaths) L.push(`  - \`${p}\``);

  L.push('', `## Near-duplicate title clusters (threshold ${r.duplicates.threshold})`, '');
  if (r.duplicates.clusters.length === 0) L.push('- none');
  r.duplicates.clusters.forEach((c, i) => {
    L.push(`${i + 1}. ${c.titles.map((t) => `"${t}"`).join(' ≡ ')}`);
    for (const p of c.paths) L.push(`   - \`${p}\``);
  });

  L.push('', `## Staleness — oldest ${fmt(r.staleness.topN)} paths`, '');
  L.push('| Path | Updated | Days old | Locales |', '| --- | --- | --- | --- |');
  for (const s of r.staleness.oldest) {
    L.push(`| \`${s.path}\` | ${s.updatedAt.slice(0, 10)} | ${fmt(s.daysOld)} | ${s.locales.join(',')} |`);
  }

  L.push('', '## Diffusion candidates', '');
  L.push('- single-child dirs (upmerge candidates):');
  if (r.diffusion.singleChildDirs.length === 0) L.push('  - none');
  for (const d of r.diffusion.singleChildDirs) L.push(`  - \`${d.dir}/\` holds only \`${d.childPath}\``);
  L.push('- root-level orphans (depth-2 pages, no sub-shelf):');
  if (r.rootOrphans.length === 0) L.push('  - none');
  for (const o of r.rootOrphans) L.push(`  - \`${o.section}/\` (${fmt(o.paths.length)}): ${o.paths.map((p) => `\`${p}\``).join(', ')}`);

  L.push('', '## Tag vocabulary', '');
  if (!r.tags.available) L.push('- no tag data: rows carry no tags (light mode over a tagless mirror) — refresh or pass list-joined rows');
  else {
    L.push('| Tag | Count |', '| --- | --- |');
    for (const t of r.tags.vocabulary) L.push(`| ${t.tag} | ${fmt(t.count)} |`);
  }

  L.push('', '## Redirect stubs', '');
  if (!r.redirects.available) L.push('- not visible from map rows (bodies unread) — rerun with `deep:true` to count `> Redirect:` stubs');
  else {
    L.push(`- ${fmt(r.redirects.count)} stub(s)`);
    for (const s of r.redirects.stubs) L.push(`  - \`${s.path}\` (${s.locale}) → ${s.target}`);
  }

  L.push('', '## Section distribution', '');
  L.push('| Section | Paths | Rows |', '| --- | --- | --- |');
  for (const s of r.sections) L.push(`| ${s.section} | ${fmt(s.paths)} | ${fmt(s.rows)} |`);

  if (r.freshness !== null) {
    L.push('', '## Freshness (deep)', '');
    L.push(
      `- scanned ${fmt(r.freshness.scanned)} bodies (${fmt(r.freshness.unreadable)} unreadable) · ` +
        `missing 上次核实 stamp: ${fmt(r.freshness.missingLastVerified.length)} · expired review-by: ${fmt(r.freshness.expiredReviewBy.length)}`,
    );
    for (const m of r.freshness.missingLastVerified) L.push(`  - stamp missing: \`${m.path}\` (${m.locale}, ${m.genre})`);
    for (const e of r.freshness.expiredReviewBy) L.push(`  - review overdue: \`${e.path}\` (${e.locale}) since ${e.reviewBy} (${fmt(e.daysExpired)}d)`);
  }

  L.push('', '## Machine-readable JSON', '', '```json', JSON.stringify(r, null, 2), '```', '');
  return L.join('\n');
}

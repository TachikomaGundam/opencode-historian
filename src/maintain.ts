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

/** One cadence-due page (advisory queue — maintain NEVER auto-writes the stamp). */
export interface DueForReviewRow {
  readonly path: string;
  readonly locale: Locale;
  /** Whole days from the newest honest stamp date to now (floored; confessional-only
   *  stamps stamp their own date but never reset the clock — see dueForReviewOf). */
  readonly stampAge: number;
  /** Days: metadata 复核周期/Review cadence row when parseable, else genre default. */
  readonly cadence: number;
  /** Re-check commands parsed from the ledger's command column (empty when none). */
  readonly verifyCommands: readonly string[];
}

/** One open action item past its due date (G1 action tables rot silently —
 *  corpus law: "an action item that ages out without completion is a red
 *  flag"). Advisory queue like dueForReview; twins dedupe by path. */
export interface OverdueAction {
  readonly path: string;
  readonly locale: Locale;
  /** First table cell (the 措施/action text), flattened to one line, ≤80 chars. */
  readonly action: string;
  /** The ISO date found in the 期限/due column, verbatim. */
  readonly due: string;
  /** Whole days from due date to now (floored). */
  readonly daysOverdue: number;
  /** Status cell text, verbatim (matched open). */
  readonly status: string;
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
  readonly flatRootPages: readonly { section: string; paths: readonly string[] }[];
  readonly tags: { available: boolean; vocabulary: readonly { tag: string; count: number }[] };
  readonly redirects: { available: boolean; count: number; stubs: readonly RedirectStub[] };
  readonly sections: readonly { section: string; paths: number; rows: number }[];
  readonly freshness: FreshnessScan | null;
  /** Deep-only advisory queue (null in light, like freshness). */
  readonly dueForReview: readonly DueForReviewRow[] | null;
  /** Deep-only advisory queue of open action items past due (null in light). */
  readonly overdueActions: readonly OverdueAction[] | null;
}

// --- Constants --------------------------------------------------------------

export const MAINTAIN_SCHEMA = 'historian.maintain.v3';
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
/** Stamp label incl. the 上次验证 variant (the set lint.ts STAMP_RE tests) — one
 *  line-level source of truth for the honesty rule shared by surface + freshness. */
export const STAMP_LINE_RE = /上次核实|上次验证|last verified/i;
/** A stamp that confesses the review never executed (swarm-A P2 "stamp honesty"):
 *  it must not exempt the claim ledger (surface) nor reset the cadence clock
 *  (dueForReview). Matched per stamp line, never page-wide — "baseline" is a
 *  common GPU-benchmark noun outside a stamp. */
export const CONFESSIONAL_STAMP_RE = /(not re-run|未复跑|未复核|baseline)/i;
const REVIEW_LABEL_RE = /^(复核周期|复核期限|复核日期|review[-_ ]?by|review[-_ ]?due)$/i;
const ISO_DATE_RE = /\d{4}-\d{2}-\d{2}/;
const REDIRECT_RE = /^>\s*Redirect:/i;
/** Table column headers that carry the per-row last-verified date (G5 ledger card). */
const STAMP_COL_RE = /^(?:上次核实于?|上次验证于?|last verified)$/i;
/** Metadata row naming the review cadence — its value is a DURATION, unlike the
 *  ISO-date 复核期限/review-by row REVIEW_LABEL_RE owns. */
const CADENCE_LABEL_RE = /^(?:复核周期|复核节奏|review[-_ ]?cadence|cadence)$/i;
/** Ledger command-column headers: zh 复核命令/验证命令/命令/用法\/命令,
 *  en Re-check command / Verify command(s) / Command(s) / Usage \/ Command. */
const COMMAND_COL_RE = /^(?:命令|用法\s*\/\s*命令|复核命令|验证命令|commands?|usage\s*\/\s*commands?|re[-_ ]?check[-_ ]?commands?|verify[-_ ]?commands?)$/i;
const DASH_CELL_RE = /^:?-{2,}:?$/;
const NULLISH_CELL_RE = /^(?:—|–|-|n\/?a|待补充|todo|\?)$/i;
/** Action-item table column labels (header-anchored; the table is identified
 *  by carrying all three of these columns — see overdueActionsOf). */
const ACTION_COL_RE = /^(?:\*\*)?(?:措施|action)(?:\*\*)?$/i;
const DUE_COL_RE = /^(?:\*\*)?(?:期限|due|deadline)(?:\*\*)?$/i;
const STATUS_COL_RE = /^(?:\*\*)?(?:状态|status)(?:\*\*)?$/i;
/** Closed first (fail-quiet on neutral cells like 未完成), then open. */
const CLOSED_STATUS_RE = /已完成|^完成$|已取消|不做|done|closed|resolved|cancelled|wont.?fix/i;
const OPEN_STATUS_RE = /待办|进行中|todo|pending|in.?progress|open/i;
/** Cadence floors when a stamped page carries no parseable metadata row:
 *  G5 machine-state ledgers 7d (weekly re-run — the round-1 plan supersedes the
 *  older 30d skeleton hint), G4 concepts and G6 how-tos 90d (the G6 skeleton's
 *  own 复核周期 example "如每 90 天"); G1 postmortems 30d — their action items
 *  carry due dates and rot inside a quarter; G2/G3 have no cadence guidance, so
 *  the conservative quarterly 90d default applies. */
const GENRE_CADENCE_DAYS: Readonly<Record<string, number>> = { G1: 30, G5: 7, G4: 90, G6: 90 };
const DEFAULT_CADENCE_DAYS = 90;

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

// bold-merge deliberately leaves (重定向)/(redirect)-suffixed stubs beside their
// live twins; clustering those pairs reports non-defects and buries true near-dupes.
const STUB_TITLE_RE = /[（(]\s*(?:重定向|redirect)\s*[）)]\s*$/i;

function findDuplicates(rows: readonly MaintainRow[]): DupCluster[] {
  const units = rows.filter((r) => !STUB_TITLE_RE.test(r.title)).map((r) => ({
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

function flatRootPages(paths: readonly string[]): { section: string; paths: string[] }[] {
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

// --- dueForReview (cadence × stamp join; advisory only) --------------------------

function tableCells(line: string): string[] | null {
  const t = line.trim();
  return t.startsWith('|') ? t.split('|').map((c) => c.trim()) : null;
}

const isSeparatorRow = (cells: readonly string[]): boolean =>
  cells.some((c) => c !== '' && DASH_CELL_RE.test(c));

interface StampEntry {
  readonly ms: number;
  readonly confessional: boolean;
}

/** Every (date, confesses-non-execution) attestation in a body, two real shapes:
 *  a stamp LABEL line carrying its ISO date (metadata rows, quote stamps, struck
 *  history — the cockpit / 09-08-sweep forms) and each date under a
 *  上次核实于/Last verified table column (the G5 card's per-row ledger dates). */
function stampEntriesOf(body: string): StampEntry[] {
  const out: StampEntry[] = [];
  let dateCol = -1;
  for (const line of body.split('\n')) {
    const lineDate = STAMP_LINE_RE.test(line) ? line.match(ISO_DATE_RE) : null;
    if (lineDate !== null) out.push({ ms: Date.parse(lineDate[0]), confessional: CONFESSIONAL_STAMP_RE.test(line) });
    const cells = tableCells(line);
    if (cells === null) {
      dateCol = -1;
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    // A `| 上次核实 | 2026-01-01 |` label row carries its own date (line rule above
    // owns it) — only a date-less header row arms the column extraction, else the
    // next value row (any label!) would be mis-read as a ledger date.
    const h = ISO_DATE_RE.test(line) ? -1 : cells.findIndex((c) => STAMP_COL_RE.test(c));
    if (h >= 0) {
      dateCol = h;
      continue;
    }
    const cell = dateCol >= 0 ? cells[dateCol] : undefined;
    if (cell !== undefined) {
      const m = cell.match(ISO_DATE_RE);
      if (m !== null) out.push({ ms: Date.parse(m[0]), confessional: CONFESSIONAL_STAMP_RE.test(cell) });
    }
  }
  return out.filter((e) => !Number.isNaN(e.ms));
}

/** '30天' / '每 30 天' / 'every 30 days' / '7d' / '2 weeks' / bare '14' → days.
 *  Dates, TODOs and prose return null — no cadence is ever fabricated. */
function parseDays(text: string): number | null {
  const t = text.trim();
  const w = t.match(/(\d{1,3})\s*(?:weeks?|wks?|w\b|周)/i);
  if (w !== null) return Number(w[1]) * 7;
  const d = t.match(/(\d{1,4})\s*(?:days?|d\b|天|日)/i);
  if (d !== null) return Number(d[1]);
  return /^\d{1,3}$/.test(t) ? Number(t) : null;
}

function cadenceDaysOf(body: string): number | null {
  for (const line of body.split('\n')) {
    const cells = tableCells(line);
    if (cells === null || cells.length < 3 || !CADENCE_LABEL_RE.test(cells[1] ?? '')) continue;
    for (const cell of cells.slice(2)) {
      const days = parseDays(cell);
      if (days !== null) return days;
    }
  }
  return null;
}

/** Re-check commands from ledger verification tables (see COMMAND_COL_RE):
 *  backticks stripped, empty/nullish cells skipped, order kept, duplicates dropped. */
function verifyCommandsOf(body: string): string[] {
  const out: string[] = [];
  let cmdCol = -1;
  for (const line of body.split('\n')) {
    const cells = tableCells(line);
    if (cells === null) {
      cmdCol = -1;
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    const h = cells.findIndex((c) => COMMAND_COL_RE.test(c));
    if (h >= 0) {
      cmdCol = h;
      continue;
    }
    const cell = cmdCol >= 0 ? cells[cmdCol] : undefined;
    if (cell === undefined) continue;
    const cmd = cell.replace(/^`([\s\S]*)`$/, '$1').trim();
    if (cmd !== '' && !NULLISH_CELL_RE.test(cmd) && !out.includes(cmd)) out.push(cmd);
  }
  return out;
}

interface DueForReview {
  readonly stampAge: number;
  readonly cadence: number;
  readonly verifyCommands: readonly string[];
}

/** The join (swarm-B P-dueForReview, stamp honesty as its immune system): due
 *  when the newest HONEST stamp is at or past the cadence (a weekly card is due
 *  again on day 7), or when every stamp confesses non-execution — a confession
 *  records intent, not verification, so it never exempts the page. A struck old
 *  confessional stamp beside a fresh honest one (supersede-keeping-struck-old)
 *  runs on the honest clock. */
function dueForReviewOf(body: string, genre: string, now: Date): DueForReview | null {
  const entries = stampEntriesOf(body);
  if (entries.length === 0) return null;
  const honest = entries.filter((e) => !e.confessional);
  const clock = honest.length > 0 ? honest : entries;
  const stampAge = Math.floor((now.getTime() - Math.max(...clock.map((e) => e.ms))) / DAY_MS);
  const cadence = cadenceDaysOf(body) ?? GENRE_CADENCE_DAYS[genre] ?? DEFAULT_CADENCE_DAYS;
  if (honest.length > 0 && stampAge < cadence) return null;
  return { stampAge, cadence, verifyCommands: verifyCommandsOf(body) };
}

/** Flattens a markdown cell to one ≤80-char line for report display. */
function flattenCell(cell: string): string {
  const flat = cell.replace(/[*_`]|<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}…` : flat;
}

/** Finds open action items past due in any G1-shaped action table (header must
 *  carry 措施/期限/状态 columns). Undated (TBD) rows are skipped here — they are
 *  a different defect owned by the authoring gate, not the ageing sweep. */
export function overdueActionsOf(body: string, now: Date): Omit<OverdueAction, 'path' | 'locale'>[] {
  const hits: Omit<OverdueAction, 'path' | 'locale'>[] = [];
  const lines = body.split('\n');
  let colAction = -1, colDue = -1, colStatus = -1, inTable = false;
  for (const line of lines) {
    const cells = tableCells(line);
    if (cells === null) {
      inTable = false;
      colAction = colDue = colStatus = -1;
      continue;
    }
    if (cells.every((c) => DASH_CELL_RE.test(c.trim()))) continue;
    const a = cells.findIndex((c) => ACTION_COL_RE.test(c.trim()));
    const d = cells.findIndex((c) => DUE_COL_RE.test(c.trim()));
    const s = cells.findIndex((c) => STATUS_COL_RE.test(c.trim()));
    if (a !== -1 && d !== -1 && s !== -1) {
      colAction = a; colDue = d; colStatus = s; inTable = true;
      continue;
    }
    if (!inTable || colAction < 0 || cells.length <= Math.max(colDue, colStatus)) continue;
    const status = cells[colStatus].trim();
    if (CLOSED_STATUS_RE.test(status) || !OPEN_STATUS_RE.test(status)) continue;
    const dueMatch = cells[colDue].match(ISO_DATE_RE);
    if (dueMatch === null) continue;
    const t = Date.parse(dueMatch[0]);
    if (Number.isNaN(t) || t >= now.getTime()) continue;
    hits.push({
      action: flattenCell(cells[colAction]),
      due: dueMatch[0],
      daysOverdue: Math.floor((now.getTime() - t) / DAY_MS),
      status,
    });
  }
  return hits;
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
  let dueForReview: DueForReviewRow[] | null = null;
  let overdueActions: OverdueAction[] | null = null;
  if (deep && opts.readBody !== undefined) {
    const readBody = opts.readBody;
    const stubs: RedirectStub[] = [];
    const missing: MissingStamp[] = [];
    const expired: ExpiredReview[] = [];
    const due: DueForReviewRow[] = [];
    const overdue: OverdueAction[] = [];
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
      const dfr = dueForReviewOf(body, genre, now);
      if (dfr !== null) due.push({ path: r.path, locale: r.locale, ...dfr });
      for (const oa of overdueActionsOf(body, now)) overdue.push({ path: r.path, locale: r.locale, ...oa });
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
    dueForReview = due.sort((a, b) => b.stampAge - a.stampAge || cmpStr(a.path, b.path) || cmpStr(a.locale, b.locale));
    const repByPath = new Map<string, string>();
    const overdueSorted = overdue.sort((a, b) => cmpStr(a.path, b.path) || cmpStr(a.locale, b.locale));
    for (const o of overdueSorted) if (!repByPath.has(o.path)) repByPath.set(o.path, o.locale);
    overdueActions = overdueSorted
      .filter((o) => o.locale === repByPath.get(o.path))
      .sort((a, b) => b.daysOverdue - a.daysOverdue || cmpStr(a.path, b.path));
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
    flatRootPages: flatRootPages(paths),
    tags: tagVocab(kept),
    redirects,
    sections: sectionDist(kept),
    freshness,
    dueForReview,
    overdueActions,
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
  L.push('- flat root pages per section (depth-2 listing, shelving hint — NOT inbound analysis; true orphans = surface deep links.orphanPages):');
  if (r.flatRootPages.length === 0) L.push('  - none');
  for (const o of r.flatRootPages) L.push(`  - \`${o.section}/\` (${fmt(o.paths.length)}): ${o.paths.map((p) => `\`${p}\``).join(', ')}`);

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

  if (r.dueForReview !== null) {
    L.push('', `## 到期复核 Due for review（deep，advisory）`, '');
    L.push(`- ${fmt(r.dueForReview.length)} 条 —仅提示，机器不代写；复核由人或复核协议执行`);
    for (const d of r.dueForReview) {
      const why = d.stampAge >= d.cadence
        ? `戳龄 ${fmt(d.stampAge)}d ≥ 周期 ${fmt(d.cadence)}d`
        : `confessional stamp（自称未复跑），周期 ${fmt(d.cadence)}d 未到亦列`;
      const cmds = d.verifyCommands.length > 0 ? ` · ${d.verifyCommands.map((c) => '`' + c + '`').join(' ')}` : '';
      L.push(`  - \`${d.locale}/${d.path}\` — ${why}${cmds}`);
    }
  }

  if (r.overdueActions !== null) {
    L.push('', '## 逾期行动项 Overdue action items（deep，advisory）', '');
    L.push(`- ${fmt(r.overdueActions.length)} 条开着的行动项已过期限（孪生页按路径去重，en 优先）—仅提示，处置由人或复核协议执行`);
    for (const o of r.overdueActions) {
      L.push(`  - \`${o.locale}/${o.path}\` — "${o.action}" 期限 ${o.due}（逾期 ${fmt(o.daysOverdue)}d，状态：${o.status}）`);
    }
  }

  L.push('', '## Machine-readable JSON', '', '```json', JSON.stringify(r, null, 2), '```', '');
  return L.join('\n');
}

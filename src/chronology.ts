/**
 * Chronology aggregation over the page-map rows (todo: timeline action) —
 * ISO-week grouping of already-fetched MapRow values, dual human/JSON form.
 * Kept out of map.ts to hold both modules under the 250 pure-LOC ceiling.
 */

import type { MapRow } from './map.js';
import type { Locale } from './wiki/pages.read.js';
import { classifyGenre } from './templates/genres.js';

// --- Chronology types + build ---

export interface ChronologyOptions {
  readonly days?: number;
  /** Reference time for the `days` window (tests inject a fixed clock). */
  readonly now?: Date;
}

export interface ChronologyItem {
  readonly path: string;
  readonly locale: Locale;
  readonly title: string;
  readonly updatedAt: string;
}

export interface ChronologyWeek {
  /** ISO week key `YYYY-Www` (Monday-start, correct ISO week-year). */
  readonly week: string;
  readonly items: readonly ChronologyItem[];
}

export interface Chronology {
  readonly markdown: string;
  readonly weeks: readonly ChronologyWeek[];
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** ISO-8601 week key: the Thursday inside the row's Monday-start week fixes
 *  both the week number and the ISO week-year (late Dec may land in W01 of
 *  the next year, early Jan in W52/53 of the previous one). */
function isoWeekKey(d: Date): string {
  const dayIso = ((d.getUTCDay() + 6) % 7) + 1;
  const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + (4 - dayIso) * DAY_MS;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(year, 0, 1)) / WEEK_MS) + 1;
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Title-only genre tag for the human table; '—' when no keyword fires
 *  (an empty body gives zero signals, so untagged rows stay untagged). */
function genreTag(title: string): string {
  const c = classifyGenre({ title, body: '' });
  return c.signals.length > 0 ? c.genre : '—';
}

export function renderChronologyMarkdown(weeks: readonly ChronologyWeek[]): string {
  if (weeks.length === 0) return '';
  const blocks = weeks.map((w) =>
    [
      `## ${w.week}`,
      '',
      '| 日期 | 章节 | 路径 | 标题 | 页型 |',
      '| --- | --- | --- | --- | --- |',
      ...w.items.map(
        (it) =>
          `| ${it.updatedAt.slice(0, 10)} | ${it.path.split('/')[0]} | ${it.path.replaceAll('|', '\\|')} | ${it.title.replaceAll('|', '\\|')} | ${genreTag(it.title)} |`,
      ),
    ].join('\n'),
  );
  return `${blocks.join('\n\n')}\n`;
}

/** Chronology aggregation over already-fetched map rows: group by ISO week of
 *  updatedAt (weeks and items newest-first), zh+en rows kept distinct. Dual
 *  output — human markdown table + machine-readable `weeks` JSON. Unparseable
 *  timestamps are dropped; `days` (relative to `now`) bounds the window. */
export function buildChronology(rows: readonly MapRow[], opts?: ChronologyOptions): Chronology {
  const cutoff =
    opts?.days === undefined
      ? Number.NEGATIVE_INFINITY
      : (opts.now ?? new Date()).getTime() - opts.days * DAY_MS;
  const kept = rows
    .map((r) => ({ r, t: Date.parse(r.updatedAt) }))
    .filter((x) => !Number.isNaN(x.t) && x.t >= cutoff)
    .sort(
      (a, b) =>
        b.t - a.t ||
        (a.r.path < b.r.path ? -1 : a.r.path > b.r.path ? 1 : a.r.locale < b.r.locale ? -1 : 1),
    );

  const byWeek = new Map<string, ChronologyItem[]>();
  for (const { r } of kept) {
    const key = isoWeekKey(new Date(r.updatedAt));
    const bucket = byWeek.get(key);
    const item: ChronologyItem = { path: r.path, locale: r.locale, title: r.title, updatedAt: r.updatedAt };
    if (bucket === undefined) byWeek.set(key, [item]);
    else bucket.push(item);
  }

  const weeks: ChronologyWeek[] = [...byWeek.entries()].map(([week, items]) => ({ week, items }));
  return { weeks, markdown: renderChronologyMarkdown(weeks) };
}

/** Section-aware path filter for timeline: a prefix matches the whole path, a
 *  path subtree, or a first-segment section (`ops` → `ops/foo`). */
export function filterRowsByPath(rows: readonly MapRow[], prefix: string): readonly MapRow[] {
  return rows.filter((r) => r.path === prefix || r.path.startsWith(`${prefix}/`) || r.path.split('/')[0] === prefix);
}

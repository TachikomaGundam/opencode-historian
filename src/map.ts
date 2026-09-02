/**
 * Locale-aware page map (todo 10): full cross-locale inventory with en/zh twin
 * pairing, rendered as the markdown `_meta/page-map` cache page + local mirror.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { HistorianOptions } from './config.js';
import { isRecord } from './jsonc.js';
import type { GqlClient } from './wiki/client.js';
import { assertLocalePair, localeUrl, normalizeLocale, PathValidationError, twinOf, type LocalePair } from './wiki/locale.js';
import { createPage, readPage, updatePage } from './wiki/pages.js';
import { listPages, type Locale, type PageListItem } from './wiki/pages.read.js';

// --- Types ------------------------------------------------------------------

export interface MapDeps {
  readonly client: GqlClient;
  readonly options: HistorianOptions;
}

export interface MapRow {
  readonly id: number;
  readonly locale: Locale;
  readonly path: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly url: string;
  readonly twinUrl: string | null;
  readonly twinId: number | null;
}

export interface MapStats {
  readonly rows: number;
  readonly paths: number;
  readonly perLocale: Readonly<Record<string, number>>;
  readonly missingTwinPaths: readonly string[];
}

export interface PageMap {
  readonly rows: readonly MapRow[];
  readonly stats: MapStats;
}

export interface MapSnapshot extends PageMap {
  readonly generatedAt: string | null;
  readonly staleSeconds: number | null;
}

interface MirrorFile {
  readonly generatedAt: string;
  readonly rows: readonly MapRow[];
  readonly stats: MapStats;
}

// --- Constants --------------------------------------------------------------

export const CACHE_PATH = '_meta/page-map';
const CACHE_TITLE = 'Page Map Cache';
export const HEADER_ROW = '| ID | Locale | Path | Title | View URL | Twin | Updated At |';

export function mirrorPath(home: string): string {
  return join(home, '.config', 'opencode', 'historian-map.json');
}

// --- buildPageMap -----------------------------------------------------------

/** URLs for a server-reported path. assertLocalePair validates paths — but
 *  that guard protects MUTATIONS; a live page can legally sit on a reserved
 *  path (the instance hosts a page at 'home'). For inventory reads the raw
 *  join is the fallback, not a failure. */
function urlsOf(path: string, baseUrl: string, locale: Locale): LocalePair {
  try {
    return assertLocalePair(path, locale, baseUrl);
  } catch (err) {
    if (!(err instanceof PathValidationError)) throw err;
    const twinLocale = twinOf(locale);
    return {
      path,
      locale,
      url: `${baseUrl.replace(/\/+$/, '')}/${locale}/${path}`,
      twinLocale,
      twinUrl: `${baseUrl.replace(/\/+$/, '')}/${twinLocale}/${path}`,
    };
  }
}

/** Full inventory: every page of every configured locale (only private-
 *  namespace pages are excluded — they are not anonymously reachable), twins
 *  paired by exact path, rows sorted by path then locale. */
export async function buildPageMap(deps: MapDeps): Promise<PageMap> {
  const locales = [...new Set(deps.options.locales.map(normalizeLocale))].sort();
  const lists = await Promise.all(locales.map((locale) => listPages(deps.client, { locale })));

  const byPath = new Map<string, Map<Locale, PageListItem>>();
  for (let i = 0; i < locales.length; i++) {
    for (const item of lists[i]) {
      if (item.privateNS !== null) continue;
      let perLocale = byPath.get(item.path);
      if (perLocale === undefined) {
        perLocale = new Map();
        byPath.set(item.path, perLocale);
      }
      perLocale.set(item.locale, item);
    }
  }

  const rows: MapRow[] = [];
  const missingTwinPaths: string[] = [];
  const sortedPaths = [...byPath.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [path, perLocale] of sortedPaths) {
    if (perLocale.size === 1) missingTwinPaths.push(path);
    for (const locale of locales) {
      const item = perLocale.get(locale);
      if (item === undefined) continue;
      const pair = urlsOf(path, deps.options.baseUrl, locale);
      const twin = perLocale.get(twinOf(locale));
      rows.push({
        id: item.id,
        locale,
        path,
        title: item.title,
        updatedAt: item.updatedAt,
        url: pair.url,
        twinUrl: twin === undefined ? null : pair.twinUrl,
        twinId: twin === undefined ? null : twin.id,
      });
    }
  }

  const perLocaleCounts: Record<string, number> = {};
  for (const locale of locales) perLocaleCounts[locale] = 0;
  for (const row of rows) perLocaleCounts[row.locale] += 1;
  return { rows, stats: { rows: rows.length, paths: sortedPaths.length, perLocale: perLocaleCounts, missingTwinPaths } };
}

// --- renderMapMarkdown ------------------------------------------------------

export function renderMapMarkdown(rows: readonly MapRow[]): string {
  const lines = rows.map(
    (r) =>
      `| ${r.id} | ${r.locale} | ${r.path} | ${r.title.replaceAll('|', '\\|')} | ${r.url} | ${r.twinUrl ?? '—'} | ${r.updatedAt} |`,
  );
  return [HEADER_ROW, '| --- | --- | --- | --- | --- | --- | --- |', ...lines, ''].join('\n');
}

// --- Local mirror -----------------------------------------------------------

function writeMirror(home: string, mirror: MirrorFile): void {
  const file = mirrorPath(home);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(mirror, null, 2)}\n`);
}

function isMapRow(v: unknown): v is MapRow {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'number' &&
    (v.locale === 'en' || v.locale === 'zh') &&
    typeof v.path === 'string' &&
    typeof v.title === 'string' &&
    typeof v.updatedAt === 'string' &&
    typeof v.url === 'string' &&
    (v.twinUrl === null || typeof v.twinUrl === 'string') &&
    (v.twinId === null || typeof v.twinId === 'number')
  );
}

function parseStats(v: Record<string, unknown>): MapStats | null {
  if (typeof v.rows !== 'number' || typeof v.paths !== 'number' || !isRecord(v.perLocale) || !Array.isArray(v.missingTwinPaths)) {
    return null;
  }
  const perLocale: Record<string, number> = {};
  for (const [key, value] of Object.entries(v.perLocale)) {
    if (typeof value !== 'number') return null;
    perLocale[key] = value;
  }
  const missingTwinPaths = v.missingTwinPaths.filter((p): p is string => typeof p === 'string');
  if (missingTwinPaths.length !== v.missingTwinPaths.length) return null;
  return { rows: v.rows, paths: v.paths, perLocale, missingTwinPaths };
}

/** Missing or malformed mirror → null: the mirror is a regenerable cache, not
 *  a trustworthy boundary — a damaged file falls back to a live build. */
function readMirror(home: string): MirrorFile | null {
  const file = mirrorPath(home);
  if (!existsSync(file)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!isRecord(raw) || typeof raw.generatedAt !== 'string') return null;
  if (!Array.isArray(raw.rows) || !isRecord(raw.stats)) return null;
  const rows = raw.rows.filter(isMapRow);
  if (rows.length !== raw.rows.length) return null;
  const stats = parseStats(raw.stats);
  if (stats === null) return null;
  return { generatedAt: raw.generatedAt, rows, stats };
}

// --- refreshMapCache --------------------------------------------------------

export interface RefreshOptions { readonly now?: Date; readonly homeDir?: string; }

export interface RefreshResult { readonly stats: MapStats; readonly cacheUrl: string; }

/** Rebuild + write cycle: fresh map → local mirror → `_meta/page-map` upsert.
 *  An existing cache page is patched content-only — updatePage is a full RMW,
 *  so the machine-fact isPrivate/isPublished/tags survive (pitfall #1). */
export async function refreshMapCache(deps: MapDeps, opts?: RefreshOptions): Promise<RefreshResult> {
  const now = opts?.now ?? new Date();
  const home = opts?.homeDir ?? homedir();
  const { rows, stats } = await buildPageMap(deps);
  writeMirror(home, { generatedAt: now.toISOString(), rows, stats });
  const markdown = renderMapMarkdown(rows);
  const existing = await readPage(deps.client, CACHE_PATH, 'en');
  if (existing === null) {
    await createPage(deps, {
      path: CACHE_PATH,
      locale: 'en',
      title: CACHE_TITLE,
      content: markdown,
      tags: ['meta'],
      isPublished: false,
      isPrivate: true,
      twin: false,
    });
  } else {
    await updatePage(deps, existing.id, { content: markdown });
  }
  return { stats, cacheUrl: localeUrl(deps.options.baseUrl, 'en', CACHE_PATH) };
}

// --- getMap -----------------------------------------------------------------

/** Read the local mirror with staleness in whole seconds; absent or damaged
 *  mirror → a live build (read-only — no cache page write, no mirror write). */
export async function getMap(deps: MapDeps, homeDir?: string): Promise<MapSnapshot> {
  const home = homeDir ?? homedir();
  const mirror = readMirror(home);
  if (mirror === null) {
    const { rows, stats } = await buildPageMap(deps);
    return { rows, stats, generatedAt: null, staleSeconds: null };
  }
  const parsed = Date.parse(mirror.generatedAt);
  const staleSeconds = Number.isNaN(parsed)
    ? null
    : Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  return { rows: mirror.rows, stats: mirror.stats, generatedAt: mirror.generatedAt, staleSeconds };
}


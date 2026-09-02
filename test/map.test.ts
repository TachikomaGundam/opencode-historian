/**
 * Unit tests for src/map.ts — the locale-aware page map (todo 10).
 *
 * Coverage: twin pairing by exact path, private-namespace exclusion, path
 * sorting, per-locale list fan-out, markdown rendering (pipe escaping, '—' for
 * missing twins, Updated At passthrough), the `_meta/page-map` cache upsert
 * (full-RMW keeps the existing isPrivate/isPublished/tags), the local mirror
 * write, and getMap's staleness + missing/corrupt-mirror fallback. buildChronology
 * (src/chronology.ts) is covered with pure in-memory rows: ISO week
 * grouping/order, Monday-start + week-year boundaries, days window, prefix filter.
 * Requests
 * are mocked and dispatched by query fragment ('list(', 'singleByPath(',
 * 'single(', 'update(', 'create(') — an unknown shape throws so the suite
 * fails loudly instead of asserting on garbage.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPageMap, getMap, mirrorPath, refreshMapCache, renderMapMarkdown } from '../src/map.js';
import { buildChronology, filterRowsByPath } from '../src/chronology.js';
import type { MapRow } from '../src/map.js';
import { makeClient, jsonResponse, OPTS } from './client-fixtures.js';

const CACHE_PATH = '_meta/page-map';
const RESP_OK = { responseResult: { succeeded: true, errorCode: 0, slug: '', message: '' } };
const HEADER = '| ID | Locale | Path | Title | View URL | Twin | Updated At |';

/** Live-shaped pages.list item (introspection-verified fields). */
function rawListItem(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 10,
    path: '_sandbox/map/alpha',
    locale: 'en',
    title: 'Alpha',
    description: 'd',
    contentType: 'markdown',
    isPublished: true,
    isPrivate: false,
    privateNS: null,
    createdAt: '2026-09-01T06:00:00.000Z',
    updatedAt: '2026-09-01T06:00:00.000Z',
    tags: [],
    ...over,
  };
}

const EN_ROWS = [
  rawListItem({ id: 10, path: '_sandbox/map/alpha', title: 'Alpha' }),
  rawListItem({ id: 11, path: '_sandbox/map/beta', title: 'Beta' }),
];
const ZH_ROWS = [
  rawListItem({ id: 20, path: '_sandbox/map/alpha', locale: 'zh', title: '阿尔法' }),
  rawListItem({ id: 21, path: '_sandbox/map/beta', locale: 'zh', title: '贝塔' }),
];

/** Live-shaped cache page (probe-verified: id 51, private + unpublished). */
function cacheState(): Record<string, unknown> {
  return {
    id: 51,
    path: CACHE_PATH,
    locale: 'en',
    title: 'Page Map Cache',
    description: '',
    content: 'old cached markdown',
    isPublished: false,
    isPrivate: true,
    contentType: 'markdown',
    tags: [{ tag: 'page-map' }, { tag: 'meta' }, { tag: 'cache' }],
    publishStartDate: '',
    publishEndDate: '',
    scriptCss: '',
    scriptJs: '',
    editor: 'markdown',
    createdAt: '2026-09-01T06:06:21.088Z',
    updatedAt: '2026-09-01T06:06:21.088Z',
  };
}

interface Captured {
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

/** Dispatch each gql request to the handler whose fragment appears in the
 *  query text; record every request body; count fetches. */
function makeResponder(
  handlers: Record<string, (vars: Record<string, unknown>, query: string) => unknown>,
): { fetchImpl: typeof fetch; captured: Captured[]; fetchCount: () => number } {
  const captured: Captured[] = [];
  let count = 0;
  const fetchImpl = (async (input: unknown, init?: unknown): Promise<Response> => {
    count++;
    const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    captured.push(body);
    const fragment = Object.keys(handlers).find((f) => body.query.includes(f));
    if (fragment === undefined) throw new Error(`map.test: unhandled query ${body.query}`);
    return jsonResponse(handlers[fragment](body.variables ?? {}, body.query));
  }) as typeof fetch;
  return { fetchImpl, captured, fetchCount: () => count };
}

function varsOf(captured: Captured[], fragment: string): Record<string, unknown>[] {
  return captured.filter((c) => c.query.includes(fragment)).map((c) => c.variables);
}

function listResponder(en: unknown[], zh: unknown[]): Record<string, (vars: Record<string, unknown>) => unknown> {
  return {
    'list(': (vars) => ({ data: { pages: { list: vars.locale === 'zh' ? zh : en } } }),
  };
}

/** Refresh harness: live-shaped cache page state + full RMW responder set. */
function refreshHarness(exists: boolean) {
  const state = cacheState();
  let existsNow = exists;
  const cacheRow = rawListItem({
    id: 51,
    path: CACHE_PATH,
    title: 'Page Map Cache',
    isPublished: false,
    isPrivate: true,
    updatedAt: '2026-09-01T06:06:21.088Z',
  });
  const { fetchImpl, captured, fetchCount } = makeResponder({
    'list(': (vars) => ({
      data: { pages: { list: vars.locale === 'zh' ? ZH_ROWS : [...EN_ROWS, cacheRow] } },
    }),
    'singleByPath(': () =>
      existsNow ? { data: { pages: { singleByPath: state } } } : { errors: [{ message: 'This page does not exist.' }] },
    'single(': () => ({ data: { pages: { single: state } } }),
    'update(': (vars) => {
      Object.assign(state, {
        title: vars.title,
        content: vars.content,
        description: vars.description,
        isPublished: vars.isPublished,
        isPrivate: vars.isPrivate,
        tags: (vars.tags as string[]).map((t) => ({ tag: t })),
      });
      return { data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } } };
    },
    'create(': (vars) => {
      existsNow = true;
      Object.assign(state, {
        path: vars.path,
        locale: vars.locale,
        title: vars.title,
        content: vars.content,
        description: vars.description,
        isPublished: vars.isPublished,
        isPrivate: vars.isPrivate,
        tags: (vars.tags as string[]).map((t) => ({ tag: t })),
      });
      return { data: { pages: { create: { ...RESP_OK, page: { id: 51, path: vars.path, locale: vars.locale } } } } };
    },
  });
  return { state, fetchImpl, captured, fetchCount };
}

// --- tmp homes ---------------------------------------------------------------

const homes: string[] = [];
function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'historian-map-'));
  homes.push(home);
  return home;
}
afterAll(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

function mirrorRows(): MapRow[] {
  return [
    {
      id: 10,
      locale: 'en',
      path: '_sandbox/map/alpha',
      title: 'Alpha',
      updatedAt: '2026-09-01T06:00:00.000Z',
      url: 'http://localhost:3000/en/_sandbox/map/alpha',
      twinUrl: 'http://localhost:3000/zh/_sandbox/map/alpha',
      twinId: 20,
    },
    {
      id: 20,
      locale: 'zh',
      path: '_sandbox/map/alpha',
      title: '阿尔法',
      updatedAt: '2026-09-01T06:00:00.000Z',
      url: 'http://localhost:3000/zh/_sandbox/map/alpha',
      twinUrl: 'http://localhost:3000/en/_sandbox/map/alpha',
      twinId: 10,
    },
  ];
}

function writeMirror(home: string, generatedAt: string): void {
  mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
  writeFileSync(
    mirrorPath(home),
    JSON.stringify({
      generatedAt,
      rows: mirrorRows(),
      stats: { rows: 2, paths: 1, perLocale: { en: 1, zh: 1 }, missingTwinPaths: [] },
    }),
  );
}

// --- buildPageMap ------------------------------------------------------------

describe('buildPageMap', () => {
  it('pairs twins by exact path — twinUrl + twinId point at the other locale', async () => {
    // Given: en + zh pages on the same two paths
    const { fetchImpl } = makeResponder(listResponder(EN_ROWS, ZH_ROWS));
    const { client } = makeClient(fetchImpl);

    // When: building the map over the default locales
    const { rows, stats } = await buildPageMap({ client, options: OPTS });

    // Then: four rows, each twin pointing at the other locale with its id
    expect(rows).toHaveLength(4);
    const alphaEn = rows.find((r) => r.path === '_sandbox/map/alpha' && r.locale === 'en') as MapRow;
    expect(alphaEn.url).toBe('http://localhost:3000/en/_sandbox/map/alpha');
    expect(alphaEn.twinUrl).toBe('http://localhost:3000/zh/_sandbox/map/alpha');
    expect(alphaEn.twinId).toBe(20);
    expect(alphaEn.updatedAt).toBe('2026-09-01T06:00:00.000Z');
    const alphaZh = rows.find((r) => r.path === '_sandbox/map/alpha' && r.locale === 'zh') as MapRow;
    expect(alphaZh.twinId).toBe(10);
    expect(stats.rows).toBe(4);
  });

  it('leaves twin fields null when one locale is missing and records the path', async () => {
    // Given: only an en page on that path (no zh twin anywhere)
    const enOnly = [
      rawListItem({ id: 10, path: '_sandbox/map/alpha', updatedAt: '2026-09-01T07:00:00.000Z' }),
    ];
    const { fetchImpl } = makeResponder(listResponder(enOnly, []));
    const { client } = makeClient(fetchImpl);

    // When: building the map
    const { rows, stats } = await buildPageMap({ client, options: OPTS });

    // Then: the row survives with null twin fields and the path is flagged
    expect(rows).toHaveLength(1);
    expect(rows[0].twinUrl).toBeNull();
    expect(rows[0].twinId).toBeNull();
    expect(stats.missingTwinPaths).toEqual(['_sandbox/map/alpha']);
  });

  it('keeps paths with dots verbatim — no segment splitting on "."', async () => {
    // Given: pages on a dotted path
    const dotted = rawListItem({ id: 30, path: 'release/v1.2-beta/notes', title: 'Notes' });
    const dottedZh = rawListItem({ id: 31, path: 'release/v1.2-beta/notes', locale: 'zh', title: '笔记' });
    const { fetchImpl } = makeResponder(listResponder([dotted], [dottedZh]));
    const { client } = makeClient(fetchImpl);

    // When: building the map
    const { rows } = await buildPageMap({ client, options: OPTS });

    // Then: the path survives character-for-character in rows, sort and URLs
    expect(rows.map((r) => r.path)).toEqual(['release/v1.2-beta/notes', 'release/v1.2-beta/notes']);
    expect(rows[0].url).toBe('http://localhost:3000/en/release/v1.2-beta/notes');
    expect(rows[0].twinUrl).toBe('http://localhost:3000/zh/release/v1.2-beta/notes');
  });

  it('fetches one unbounded list per configured locale, tagged with that locale', async () => {
    // Given: a responder serving en/zh lists
    const { fetchImpl, captured } = makeResponder(listResponder(EN_ROWS, ZH_ROWS));
    const { client } = makeClient(fetchImpl);

    // When: building the map over the default locales
    await buildPageMap({ client, options: OPTS });

    // Then: exactly two pages.list calls, each carrying its locale; no other
    // query shape was sent (the unknown-shape guard would have thrown)
    const lists = varsOf(captured, 'list(');
    expect(lists).toHaveLength(2);
    expect(lists.map((v) => v.locale).sort()).toEqual(['en', 'zh']);
    expect(lists.every((v) => v.tags === null)).toBe(true);
    expect(captured.every((c) => c.query.includes('list('))).toBe(true);
  });

  it('sorts rows by path, then locale (en before zh)', async () => {
    // Given: the server returns rows in scrambled order
    const betaZh = rawListItem({ id: 21, path: '_sandbox/map/beta', locale: 'zh', title: '贝塔' });
    const betaEn = rawListItem({ id: 11, path: '_sandbox/map/beta', title: 'Beta' });
    const alphaEn = rawListItem({ id: 10, path: '_sandbox/map/alpha', title: 'Alpha' });
    const alphaZh = rawListItem({ id: 20, path: '_sandbox/map/alpha', locale: 'zh', title: '阿尔法' });
    const { fetchImpl } = makeResponder(listResponder([betaEn, alphaEn], [betaZh, alphaZh]));
    const { client } = makeClient(fetchImpl);

    // When: building the map
    const { rows } = await buildPageMap({ client, options: OPTS });

    // Then: path-first, locale-second ordering regardless of server order
    expect(rows.map((r) => `${r.path}@${r.locale}`)).toEqual([
      '_sandbox/map/alpha@en',
      '_sandbox/map/alpha@zh',
      '_sandbox/map/beta@en',
      '_sandbox/map/beta@zh',
    ]);
  });

  it('excludes private-namespace pages from rows and stats', async () => {
    // Given: a page inside a private namespace (privateNS set) next to normal pages
    const priv = rawListItem({ id: 99, path: '_private/ledger', title: 'Ledger', privateNS: '_private' });
    const { fetchImpl } = makeResponder(listResponder([...EN_ROWS, priv], ZH_ROWS));
    const { client } = makeClient(fetchImpl);

    // When: building the map
    const { rows, stats } = await buildPageMap({ client, options: OPTS });

    // Then: the private-namespace row is absent and no stats slot counts it
    expect(rows.some((r) => r.path === '_private/ledger')).toBe(false);
    expect(stats.rows).toBe(4);
    expect(stats.paths).toBe(2);
    expect(stats.perLocale).toEqual({ en: 2, zh: 2 });
  });

  it('reports rows/paths/perLocale/missingTwinPaths stats', async () => {
    // Given: two paths fully paired
    const { fetchImpl } = makeResponder(listResponder(EN_ROWS, ZH_ROWS));
    const { client } = makeClient(fetchImpl);

    // When: building the map
    const { stats } = await buildPageMap({ client, options: OPTS });

    // Then: exact stats object
    expect(stats).toEqual({ rows: 4, paths: 2, perLocale: { en: 2, zh: 2 }, missingTwinPaths: [] });
  });

  it('builds only over options.locales (zh-only options → one fetch, all zh flagged)', async () => {
    // Given: options restricted to zh
    const { fetchImpl, fetchCount } = makeResponder(listResponder(EN_ROWS, ZH_ROWS));
    const { client } = makeClient(fetchImpl);

    // When: building the map over ['zh']
    const { rows, stats } = await buildPageMap({ client, options: { ...OPTS, locales: ['zh'] } });

    // Then: one fetch; every row zh; both paths reported as twin-missing
    expect(fetchCount()).toBe(1);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.locale === 'zh')).toBe(true);
    expect(stats.missingTwinPaths).toEqual(['_sandbox/map/alpha', '_sandbox/map/beta']);
  });

  it('includes pages on reserved-word paths (a real page named home) with raw URLs', async () => {
    // Given: the live instance hosts published pages literally at 'home'
    const homeEn = rawListItem({ id: 2, path: 'home', title: 'Home' });
    const homeZh = rawListItem({ id: 84, path: 'home', locale: 'zh', title: '首页' });
    const { fetchImpl } = makeResponder(listResponder([homeEn], [homeZh]));
    const { client } = makeClient(fetchImpl);

    // When: building the map over a path the mutation guards reserve
    const { rows, stats } = await buildPageMap({ client, options: OPTS });

    // Then: the rows survive — validation gates mutations, not inventory reads
    expect(rows.map((r) => r.path)).toEqual(['home', 'home']);
    expect(rows[0].url).toBe('http://localhost:3000/en/home');
    expect(rows[0].twinUrl).toBe('http://localhost:3000/zh/home');
    expect(stats.rows).toBe(2);
    expect(stats.missingTwinPaths).toEqual([]);
  });
});

// --- renderMapMarkdown -------------------------------------------------------

describe('renderMapMarkdown', () => {
  it('emits the 7-column header and one row per map row with absolute URLs', async () => {
    // Given: a fully paired map
    const { fetchImpl } = makeResponder(listResponder(EN_ROWS, ZH_ROWS));
    const { client } = makeClient(fetchImpl);
    const { rows } = await buildPageMap({ client, options: OPTS });

    // When: rendering the markdown table
    const md = renderMapMarkdown(rows);

    // Then: header verbatim, separator, and a row carrying URL + twin URL
    const lines = md.trim().split('\n');
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe('| --- | --- | --- | --- | --- | --- | --- |');
    expect(lines).toHaveLength(6); // header + separator + 4 rows
    expect(lines[2]).toBe(
      '| 10 | en | _sandbox/map/alpha | Alpha | http://localhost:3000/en/_sandbox/map/alpha | http://localhost:3000/zh/_sandbox/map/alpha | 2026-09-01T06:00:00.000Z |',
    );
  });

  it('escapes pipes in titles', async () => {
    // Given: a title containing a table pipe
    const tricky = rawListItem({ id: 40, path: '_sandbox/map/tricky', title: 'Read | Write' });
    const { fetchImpl } = makeResponder(listResponder([tricky], []));
    const { client } = makeClient(fetchImpl);
    const { rows } = await buildPageMap({ client, options: OPTS });

    // When: rendering
    const md = renderMapMarkdown(rows);

    // Then: the pipe is escaped — the table keeps exactly six columns
    expect(md).toContain('| Read \\| Write |');
    expect(md).not.toContain('| Read | Write |');
  });

  it('renders — for a missing twin and passes updatedAt through verbatim', async () => {
    // Given: an unpaired page with a distinctive updatedAt
    const solo = rawListItem({
      id: 40,
      path: '_sandbox/map/solo',
      title: 'Solo',
      updatedAt: '2026-09-01T07:07:07.777Z',
    });
    const { fetchImpl } = makeResponder(listResponder([solo], []));
    const { client } = makeClient(fetchImpl);
    const { rows } = await buildPageMap({ client, options: OPTS });

    // When: rendering
    const md = renderMapMarkdown(rows);

    // Then: em-dash in the Twin column; the raw ISO stamp in the last column
    expect(md).toContain('| — | 2026-09-01T07:07:07.777Z |');
  });
});

// --- refreshMapCache ---------------------------------------------------------

describe('refreshMapCache', () => {
  it('refreshes an existing cache page content-only — full-RMW keeps private/published/tags', async () => {
    // Given: the live cache page (private + unpublished) in state
    const home = makeHome();
    const now = new Date('2026-09-02T00:00:00.000Z');
    const { fetchImpl, captured, fetchCount, state } = refreshHarness(true);
    const { client } = makeClient(fetchImpl);

    // When: refreshing the cache
    const result = await refreshMapCache({ client, options: OPTS }, { homeDir: home, now });

    // Then: one update whose payload is the rendered table ONLY — every other
    // field echoed from the read (pitfalls #1+#2: never wiped)
    expect(fetchCount()).toBe(6); // 2 lists + cache read + state read + update + re-read
    const vars = varsOf(captured, 'update(')[0];
    expect(vars.content.startsWith(HEADER)).toBe(true);
    expect(vars.content).toContain('| 51 | en | _meta/page-map |');
    expect(vars.isPrivate).toBe(true);
    expect(vars.isPublished).toBe(false);
    expect(vars.title).toBe('Page Map Cache');
    expect(vars.tags).toEqual(['page-map', 'meta', 'cache']);
    expect(result.cacheUrl).toBe('http://localhost:3000/en/_meta/page-map');
    expect(result.stats.rows).toBe(5); // 4 sandbox rows + the cache page itself
    expect(state.content).toContain(HEADER);
  });

  it('creates the cache page when absent — private, unpublished, tags [meta], no twin', async () => {
    // Given: no cache page on the instance (read answers "does not exist")
    const home = makeHome();
    const { fetchImpl, captured, fetchCount } = refreshHarness(false);
    const { client } = makeClient(fetchImpl);

    // When: refreshing the cache with the page absent
    await refreshMapCache({ client, options: OPTS }, { homeDir: home, now: new Date('2026-09-02T00:00:00.000Z') });

    // Then: exactly one create with the machine-fact flags; twin disabled
    const creates = varsOf(captured, 'create(');
    expect(creates).toHaveLength(1);
    expect(creates[0]).toMatchObject({
      path: CACHE_PATH,
      locale: 'en',
      title: 'Page Map Cache',
      isPublished: false,
      isPrivate: true,
      tags: ['meta'],
      editor: 'markdown',
    });
    expect(creates[0].content).toContain(HEADER);
    expect(fetchCount()).toBe(5); // 2 lists + missing read + create + authoritative lookup
  });

  it('writes the local mirror {generatedAt, rows, stats} with the injected clock', async () => {
    // Given: a tmp home and a fixed clock
    const home = makeHome();
    const now = new Date('2026-09-02T00:00:00.000Z');
    const { fetchImpl } = refreshHarness(true);
    const { client } = makeClient(fetchImpl);

    // When: refreshing
    const result = await refreshMapCache({ client, options: OPTS }, { homeDir: home, now });

    // Then: mirror JSON carries the ISO stamp and the very stats returned
    const raw = JSON.parse(readFileSync(mirrorPath(home), 'utf8')) as Record<string, unknown>;
    expect(raw.generatedAt).toBe('2026-09-02T00:00:00.000Z');
    expect((raw.stats as { rows: number }).rows).toBe(result.stats.rows);
    expect(Array.isArray(raw.rows)).toBe(true);
    expect((raw.rows as unknown[])).toHaveLength(result.stats.rows);
  });
});

// --- getMap ------------------------------------------------------------------

describe('getMap', () => {
  it('serves a fresh mirror with zero network and near-zero staleness', async () => {
    // Given: a just-written mirror; a client whose fetch throws if called
    const home = makeHome();
    writeMirror(home, new Date().toISOString());
    const { client } = makeClient(
      (async () => {
        throw new Error('getMap must not fetch when the mirror exists');
      }) as typeof fetch,
    );

    // When: reading the map
    const snap = await getMap({ client, options: OPTS }, home);

    // Then: rows/stats served from disk; staleness is sub-second
    expect(snap.rows).toHaveLength(2);
    expect(snap.stats.rows).toBe(2);
    expect(snap.generatedAt).not.toBeNull();
    expect(snap.staleSeconds).not.toBeNull();
    expect(snap.staleSeconds as number).toBeLessThanOrEqual(5);
  });

  it('reports staleness in whole seconds for an old mirror', async () => {
    // Given: a mirror written 2 hours ago
    const home = makeHome();
    writeMirror(home, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());
    const { client } = makeClient(
      (async () => {
        throw new Error('getMap must not fetch when the mirror exists');
      }) as typeof fetch,
    );

    // When: reading the map
    const snap = await getMap({ client, options: OPTS }, home);

    // Then: staleness ≈ 7200s, rows still served from the mirror
    expect(snap.staleSeconds).toBeGreaterThanOrEqual(7200);
    expect(snap.rows).toHaveLength(2);
  });

  it('falls back to a live build when the mirror is missing — no write, null stamps', async () => {
    // Given: an empty tmp home; a live list responder
    const home = makeHome();
    const { fetchImpl, fetchCount } = makeResponder(listResponder(EN_ROWS, ZH_ROWS));
    const { client } = makeClient(fetchImpl);

    // When: reading the map without a mirror
    const snap = await getMap({ client, options: OPTS }, home);

    // Then: live data, null timestamps, and NO mirror file materialized
    expect(fetchCount()).toBe(2);
    expect(snap.generatedAt).toBeNull();
    expect(snap.staleSeconds).toBeNull();
    expect(snap.stats.rows).toBe(4);
    expect(existsSync(mirrorPath(home))).toBe(false);
  });

  it('treats a corrupt mirror as missing and rebuilds live', async () => {
    // Given: a mirror file that is not valid JSON
    const home = makeHome();
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    writeFileSync(mirrorPath(home), '{ not json');
    const { fetchImpl } = makeResponder(listResponder(EN_ROWS, ZH_ROWS));
    const { client } = makeClient(fetchImpl);

    // When: reading the map
    const snap = await getMap({ client, options: OPTS }, home);

    // Then: live fallback with null stamps — the corrupt file is not trusted
    expect(snap.generatedAt).toBeNull();
    expect(snap.staleSeconds).toBeNull();
    expect(snap.stats.rows).toBe(4);
  });
});

// --- buildChronology ----------------------------------------------------------

function crow(path: string, locale: MapRow['locale'], updatedAt: string, title = 'Note', id = 1): MapRow {
  return { id, locale, path, title, updatedAt, url: `http://example.com/en/${path}`, twinUrl: null, twinId: null };
}

describe('buildChronology', () => {
  it('groups rows by ISO week, weeks and items newest-first, zh+en kept distinct', () => {
    const rows = [
      crow('_sandbox/b', 'zh', '2026-08-30T23:00:00.000Z', '贝塔'),
      crow('_sandbox/a', 'en', '2026-08-31T02:00:00.000Z', 'Alpha'),
      crow('_sandbox/a', 'zh', '2026-09-01T09:00:00.000Z', '阿尔法'),
      crow('_sandbox/c', 'en', '2026-08-28T10:00:00.000Z', 'Gamma'),
    ];
    const { weeks } = buildChronology(rows);
    expect(weeks.map((w) => w.week)).toEqual(['2026-W36', '2026-W35']);
    expect(weeks[0]!.items.map((i) => [i.path, i.locale])).toEqual([['_sandbox/a', 'zh'], ['_sandbox/a', 'en']]);
    expect(weeks[1]!.items.map((i) => i.updatedAt)).toEqual([
      '2026-08-30T23:00:00.000Z',
      '2026-08-28T10:00:00.000Z',
    ]);
  });

  it('Monday-start weeks: Sunday and Monday land in different ISO weeks', () => {
    const { weeks } = buildChronology([
      crow('x/mon', 'en', '2026-08-31T00:00:01.000Z'),
      crow('x/sun', 'en', '2026-08-30T23:59:59.000Z'),
    ]);
    expect(weeks.map((w) => w.week)).toEqual(['2026-W36', '2026-W35']);
    expect(weeks[0]!.items[0]!.path).toBe('x/mon');
    expect(weeks[1]!.items[0]!.path).toBe('x/sun');
  });

  it('ISO week-year edges: 2025-12-29 → 2026-W01, 2027-01-01 → 2026-W53', () => {
    const { weeks } = buildChronology([
      crow('x/newyear', 'en', '2027-01-01T12:00:00.000Z'),
      crow('x/late-dec', 'en', '2025-12-29T12:00:00.000Z'),
    ]);
    expect(weeks.map((w) => w.week)).toEqual(['2026-W53', '2026-W01']);
  });

  it('days window bounds the set relative to opts.now', () => {
    const rows = [
      crow('x/fresh', 'en', '2026-09-01T00:00:00.000Z'),
      crow('x/stale', 'en', '2026-08-20T00:00:00.000Z'),
    ];
    const now = new Date('2026-09-02T00:00:00.000Z');
    const scoped = buildChronology(rows, { days: 7, now });
    expect(scoped.weeks.flatMap((w) => w.items.map((i) => i.path))).toEqual(['x/fresh']);
    expect(buildChronology(rows, { now }).weeks.flatMap((w) => w.items).length).toBe(2);
  });

  it('empty rows → no weeks, empty markdown', () => {
    const { weeks, markdown } = buildChronology([]);
    expect(weeks).toEqual([]);
    expect(markdown).toBe('');
  });

  it('unparseable timestamps are dropped', () => {
    const { weeks } = buildChronology([
      crow('x/good', 'en', '2026-09-01T00:00:00.000Z'),
      crow('x/bad', 'en', 'not-a-date'),
    ]);
    expect(weeks.flatMap((w) => w.items).map((i) => i.path)).toEqual(['x/good']);
  });

  it('markdown carries date|section|path|title|genre rows mirroring the JSON', () => {
    const rows = [
      crow('ops/502', 'zh', '2026-08-31T02:00:00.000Z', '搜索 502 故障复盘'),
      crow('notes/|pipe|', 'en', '2026-08-31T01:00:00.000Z', 'Plain note'),
    ];
    const { weeks, markdown } = buildChronology(rows);
    expect(markdown).toContain('## 2026-W36');
    expect(markdown).toContain('| 日期 | 章节 | 路径 | 标题 | 页型 |');
    expect(markdown).toContain('| 2026-08-31 | ops | ops/502 | 搜索 502 故障复盘 | G1 |');
    expect(markdown).toContain('| 2026-08-31 | notes | notes/\\|pipe\\| | Plain note | — |');
    const dataRows = markdown.split('\n').filter((l) => /^\| 20/.test(l));
    expect(dataRows.length).toBe(weeks.flatMap((w) => w.items).length);
  });
});

describe('filterRowsByPath', () => {
  const rows = [
    crow('ops', 'en', '2026-09-01T00:00:00.000Z'),
    crow('ops/db', 'en', '2026-09-01T00:00:00.000Z'),
    crow('ops/db/deep', 'zh', '2026-09-01T00:00:00.000Z'),
    crow('ops2/x', 'en', '2026-09-01T00:00:00.000Z'),
    crow('other/y', 'en', '2026-09-01T00:00:00.000Z'),
  ];

  it('matches the section itself, its subtree, and nested paths — not lookalikes', () => {
    expect(filterRowsByPath(rows, 'ops').map((r) => r.path)).toEqual([
      'ops',
      'ops/db',
      'ops/db/deep',
    ]);
  });

  it('matches an exact deep path and yields nothing for absent prefixes', () => {
    expect(filterRowsByPath(rows, 'ops/db/deep').map((r) => r.path)).toEqual(['ops/db/deep']);
    expect(filterRowsByPath(rows, 'absent')).toEqual([]);
  });
});
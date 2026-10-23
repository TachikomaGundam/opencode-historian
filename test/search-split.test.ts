/**
 * historian_search zero-hit fallback chain (todo-6a, 2026-10-23).
 *
 * Pins the contract:
 *   - direct hits > 0      → EXACTLY one search request, legacy envelope,
 *                            zero strategy/fallback fields (characterization)
 *   - multi-word zero-hit  → per-token fan-out, merged by (path, locale),
 *                            ranked by distinct token hits, strategy=token-split
 *   - a failed split leg   → dropped + named in splitFailed; all legs failed →
 *                            standard error envelope (no new error class)
 *   - still zero           → pure-local map-mirror scan (title/path), then
 *                            honest hint; a mirror-less home never fans out
 *
 * Fully mocked fetch + temp-home mirror; zero live wiki. Harness idiom is the
 * one proven in search-tags.test.ts (fragment-dispatch fake fetch).
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolDefinition } from '@opencode-ai/plugin';
import { OPTS, makeKeyHome, jsonResponse } from './client-fixtures.js';
import { buildTools } from '../src/tools.js';

interface Captured {
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

function makeWired(
  handlers: Record<string, (vars: Record<string, unknown>) => unknown>,
  homeDir?: string,
): { tools: Record<string, ToolDefinition>; captured: Captured[]; fetchCount: () => number } {
  const captured: Captured[] = [];
  let count = 0;
  const fetchImpl = (async (input: unknown, init?: unknown): Promise<Response> => {
    count++;
    const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as Captured;
    captured.push(body);
    const fragment = Object.keys(handlers).find((f) => body.query.includes(f));
    if (fragment === undefined) throw new Error(`search-split.test: unhandled query ${body.query}`);
    return jsonResponse(handlers[fragment](body.variables ?? {}));
  }) as typeof fetch;
  const tools = buildTools(OPTS, { fetchImpl, homeDir: homeDir ?? makeKeyHome() });
  return { tools, captured, fetchCount: () => count };
}

async function run(toolDef: ToolDefinition, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = await toolDef.execute(args as never, {} as never);
  const text = typeof out === 'string' ? out : String((out as { output: string }).output);
  return JSON.parse(text) as Record<string, unknown>;
}

function searchBody(results: readonly Record<string, unknown>[]): unknown {
  return { data: { pages: { search: { results, suggestions: [], totalHits: results.length } } } };
}

function searchRow(over: Record<string, unknown>): Record<string, unknown> {
  return { id: '1', title: 'T', description: 'd', path: 'p/x', locale: 'en', ...over };
}

function listBody(rows: readonly Record<string, unknown>[]): unknown {
  return { data: { pages: { list: rows } } };
}

function listRow(over: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 1, path: 'ops/runbook', locale: 'en', title: 'Runbook', description: 'd',
    contentType: 'markdown', isPublished: true, isPrivate: false, privateNS: '',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    tags: ['runbook'], ...over,
  };
}

/** Home carrying BOTH the api key and a valid page-map mirror. */
function makeMirrorHome(rows: readonly Record<string, unknown>[]): string {
  const home = makeKeyHome();
  const dir = join(home, '.config', 'opencode');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'historian-map.json'),
    JSON.stringify({
      generatedAt: '2026-10-23T00:00:00.000Z',
      rows,
      stats: { rows: rows.length, paths: rows.length, perLocale: { en: rows.length }, missingTwinPaths: [] },
    }),
    'utf8',
  );
  return home;
}

const MIRROR_ROW = {
  id: 77, locale: 'en', path: 'gpu/warm-pool', title: 'GPU Warm Pool Dossier',
  updatedAt: '2026-10-23T00:00:00.000Z', url: 'http://localhost:3000/en/gpu/warm-pool',
  twinUrl: null, twinId: null,
};

const searchQueries = (captured: readonly Captured[]): unknown[] =>
  captured.filter((c) => c.query.includes('search(')).map((c) => c.variables.query);

describe('historian_search zero-hit fallback', () => {
  it('direct hit: exactly one search call, legacy envelope fields exactly', async () => {
    const { tools, captured, fetchCount } = makeWired({
      'search(': () => searchBody([searchRow({ path: 'hit/page' })]),
    });
    const out = await run(tools.historian_search, { query: 'alpha beta' });
    expect(fetchCount()).toBe(1);
    expect(searchQueries(captured)).toEqual(['alpha beta']);
    expect(out.ok).toBe(true);
    expect(out.totalHits).toBe(1);
    expect(out).not.toHaveProperty('strategy');
    expect(out).not.toHaveProperty('hint');
    expect(out).not.toHaveProperty('tokens');
  });

  it('multi-word zero-hit: token fan-out merged, hits-ranked, strategy token-split', async () => {
    const { tools, captured, fetchCount } = makeWired({
      'search(': (vars) => {
        const q = String(vars.query);
        if (q === 'alpha beta') return searchBody([]);
        if (q === 'alpha') return searchBody([searchRow({ id: '1', path: 'a/page' }), searchRow({ id: '2', path: 'b/page' })]);
        if (q === 'beta') return searchBody([searchRow({ id: '2', path: 'b/page' }), searchRow({ id: '3', path: 'c/page' })]);
        throw new Error(`unexpected query ${q}`);
      },
    });
    const out = await run(tools.historian_search, { query: 'alpha beta' });
    expect(fetchCount()).toBe(3);
    expect(searchQueries(captured)).toEqual(['alpha beta', 'alpha', 'beta']);
    expect(out.strategy).toBe('token-split');
    expect(out.tokens).toEqual(['alpha', 'beta']);
    expect(out.totalHits).toBe(3);
    const paths = (out.results as Record<string, unknown>[]).map((r) => r.path);
    expect(paths[0]).toBe('b/page');
    expect(out).not.toHaveProperty('splitFailed');
  });

  it('one split leg fails: rows from surviving legs, failed token named', async () => {
    const { tools } = makeWired({
      'search(': (vars) => {
        const q = String(vars.query);
        if (q === 'alpha boom') return searchBody([]);
        if (q === 'alpha') return searchBody([searchRow({ path: 'a/page' })]);
        throw new Error('leg exploded');
      },
    });
    const out = await run(tools.historian_search, { query: 'alpha boom' });
    expect(out.ok).toBe(true);
    expect(out.strategy).toBe('token-split');
    expect(out.splitFailed).toEqual(['boom']);
    expect((out.results as unknown[]).length).toBe(1);
  });

  it('all split legs fail: standard error envelope, no fabricated zero', async () => {
    const { tools } = makeWired({
      'search(': (vars) => {
        if (String(vars.query) === 'alpha beta') return searchBody([]);
        throw new Error('backend down');
      },
    });
    const out = await run(tools.historian_search, { query: 'alpha beta' });
    expect(out.ok).toBe(false);
    expect(out.message).toContain('backend down');
  });

  it('zero-hit with mirror: title/path substring rows surface as map-mirror', async () => {
    const home = makeMirrorHome([MIRROR_ROW]);
    const { tools } = makeWired({ 'search(': () => searchBody([]) }, home);
    const out = await run(tools.historian_search, { query: 'warm pool' });
    expect(out.strategy).toBe('map-mirror');
    expect(out.mapGeneratedAt).toBe('2026-10-23T00:00:00.000Z');
    const rows = out.results as Record<string, unknown>[];
    expect(rows[0].path).toBe('gpu/warm-pool');
    expect(rows[0].url).toContain('/en/gpu/warm-pool');
  });

  it('split hits outrank mirror: mirror stays silent when tokens hit', async () => {
    const home = makeMirrorHome([MIRROR_ROW]);
    const { tools } = makeWired({
      'search(': (vars) =>
        String(vars.query) === 'warm pool' ? searchBody([]) : searchBody([searchRow({ path: 'a/page' })]),
    }, home);
    const out = await run(tools.historian_search, { query: 'warm pool' });
    expect(out.strategy).toBe('token-split');
  });

  it('single token zero-hit without mirror: honest hint, zero rows', async () => {
    const { tools, fetchCount } = makeWired({ 'search(': () => searchBody([]) });
    const out = await run(tools.historian_search, { query: 'zzz-unique' });
    expect(fetchCount()).toBe(1);
    expect(out.totalHits).toBe(0);
    expect(String(out.hint)).toContain('historian_read');
  });

  it('tags + multi-word zero-hit: split keys feed the tag intersection', async () => {
    const { tools } = makeWired({
      'search(': (vars) =>
        String(vars.query) === 'alpha beta' ? searchBody([]) : searchBody([searchRow({ path: 'ops/runbook' })]),
      'list(': () =>
        listBody([listRow({ path: 'ops/runbook', tags: ['alpha-tag'] })]),
    });
    const out = await run(tools.historian_search, { query: 'alpha beta', tags: ['alpha-tag'], tagsMode: 'all' });
    expect(out.strategy).toBe('token-split');
    expect(out.totalHits).toBe(1);
    const rows = out.results as Record<string, unknown>[];
    expect(rows[0].path).toBe('ops/runbook');
    expect(rows[0].tags).toEqual(['alpha-tag']);
  });
});

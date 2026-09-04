/**
 * historian_search tag filtering (v4 todo-6).
 *
 * Pins the tags/tagsMode contract:
 *   - no tags          → byte-identical legacy behavior (characterization)
 *   - tagsMode 'all'   → ONE list call, tags passed straight to the server's
 *                        $tags mechanism (AND-only, measured live: runbook→11,
 *                        runbooks→7, both→0)
 *   - tagsMode 'any'   → client-side fan-out, one list call PER tag, UNION
 *                        deduped by (path, locale), intersected with the text
 *                        result set; a failed leg is dropped (tagsFailed),
 *                        never a new error class while ≥1 leg survives
 *
 * Separate file from tools.test.ts (parallel-lane ownership); the responder
 * harness is duplicated here on purpose. Fully mocked fetch — zero live wiki.
 */

import { describe, it, expect } from 'vitest';
import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { OPTS, makeKeyHome, jsonResponse } from './client-fixtures.js';
import { buildTools } from '../src/tools.js';

const BASE = 'http://localhost:3000';

// --- harness (same idiom as tools.test.ts: fragment-dispatch fake fetch) ----

interface Captured {
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

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
    if (fragment === undefined) throw new Error(`search-tags.test: unhandled query ${body.query}`);
    return jsonResponse(handlers[fragment](body.variables ?? {}, body.query));
  }) as typeof fetch;
  return { fetchImpl, captured, fetchCount: () => count };
}

function makeWired(
  handlers: Record<string, (vars: Record<string, unknown>, query: string) => unknown>,
): { tools: Record<string, ToolDefinition>; captured: Captured[]; fetchCount: () => number } {
  const r = makeResponder(handlers);
  const tools = buildTools(OPTS, { fetchImpl: r.fetchImpl, homeDir: makeKeyHome() });
  return { tools, captured: r.captured, fetchCount: r.fetchCount };
}

function varsOf(captured: Captured[], fragment: string): Record<string, unknown>[] {
  return captured.filter((c) => c.query.includes(fragment)).map((c) => c.variables);
}

async function run(toolDef: ToolDefinition, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = await toolDef.execute(args as never, {} as never);
  const text = typeof out === 'string' ? out : String((out as { output: string }).output);
  return JSON.parse(text) as Record<string, unknown>;
}

// --- fixtures ----------------------------------------------------------------

/** pages.search response. */
function searchBody(results: readonly Record<string, unknown>[], totalHits = results.length): unknown {
  return { data: { pages: { search: { results, suggestions: ['alpha'], totalHits } } } };
}

/** pages.list response. */
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

function searchRow(over: Record<string, unknown>): Record<string, unknown> {
  return { id: '1', title: 'Runbook', description: 'd', path: 'ops/runbook', locale: 'en', ...over };
}

// A = ops/runbook(en)   B = audit/log(en)   C = notext-match/en (list-only)
const ROW_A = listRow({ id: 10, path: 'ops/runbook', locale: 'en', title: 'Runbook', tags: ['runbook', 'ops'] });
const ROW_A_ZH = listRow({ id: 11, path: 'ops/runbook', locale: 'zh', title: '运维手册', tags: ['runbook', 'ops'] });
const ROW_B = listRow({ id: 20, path: 'audit/log', locale: 'en', title: 'Audit Log', tags: ['audit'] });
const ROW_C = listRow({ id: 30, path: 'untouched/page', locale: 'en', title: 'No Text Hit', tags: ['runbook'] });

// --- characterization: legacy no-tags path (written BEFORE the feature) -----

describe('historian_search tags — characterization (legacy, no tags given)', () => {
  it('no-tags request shape and envelope are pinned exactly (zero list calls)', async () => {
    // Given: only a search handler — any list(' call would throw "unhandled query"
    const { tools, captured, fetchCount } = makeWired({
      'search(': () => searchBody([searchRow({ id: '1', title: 'Hit', path: '_sandbox/x', locale: 'en' })]),
    });

    // When: searching without tags
    const out = await run(tools.historian_search, { query: 'hit' });

    // Then: exactly one request, legacy variables, legacy envelope — toEqual
    // fails if the tags path ever leaks keys (tags/tagsMode/tagsFailed) here
    expect(captured.length).toBe(1);
    expect(varsOf(captured, 'search(')[0]).toEqual({ query: 'hit', path: null, locale: null });
    expect(fetchCount()).toBe(1);
    expect(out).toEqual({
      ok: true,
      query: 'hit',
      kind: 'content',
      totalHits: 1,
      suggestions: ['alpha'],
      results: [{
        id: '1', title: 'Hit', description: 'd', path: '_sandbox/x', locale: 'en',
        url: `${BASE}/en/_sandbox/x`,
      }],
    });
  });

  it('no tags + explicit tagsMode:"any" still takes the legacy path (tags absent wins)', async () => {
    // Given: tagsMode set but tags omitted — the filter only engages with tags
    const { tools, captured } = makeWired({
      'search(': () => searchBody([searchRow({ path: '_sandbox/x', locale: 'en' })]),
    });

    // When: running with tagsMode but no tags
    const out = await run(tools.historian_search, { query: 'hit', tagsMode: 'any' });

    // Then: zero list calls, legacy envelope
    expect(varsOf(captured, 'list(').length).toBe(0);
    expect(out.tags).toBeUndefined();
    expect(out.tagsFailed).toBeUndefined();
  });
});

// --- tagsMode 'all': server passthrough (AND semantics) -----------------------

describe('historian_search tags — mode "all" (default)', () => {
  it('passes ALL tags in ONE list call and intersects with the text result set', async () => {
    // Given: text query hits A+B; the $tags filter (server-side AND) would
    // return A, B and C — C must drop out via intersection.
    // Live measurement grounding: tags ["runbook"]→11, ["runbooks"]→7,
    // ["runbook","runbooks"]→0 ⇒ the $tags mechanism is AND-only, so a single
    // request carrying every tag IS the "all" semantic — no fan-out needed.
    const { tools, captured } = makeWired({
      'search(': () => searchBody([
        searchRow({ id: '10', path: 'ops/runbook', locale: 'en' }),
        searchRow({ id: '20', path: 'audit/log', locale: 'en' }),
      ]),
      'list(': () => listBody([ROW_A, ROW_B, ROW_C]),
    });

    // When: filtering with both tags, explicit all
    const out = await run(tools.historian_search, { query: 'doc', tags: ['runbook', 'audit'], tagsMode: 'all' });

    // Then: exactly ONE list request carrying the whole tag array untouched
    const listVars = varsOf(captured, 'list(');
    expect(listVars).toEqual([{ locale: null, tags: ['runbook', 'audit'] }]);
    // Then: C (tagged but not text-matching) is excluded; rows carry tags vocabulary
    expect(out.totalHits).toBe(2);
    expect(out.tags).toEqual(['runbook', 'audit']);
    expect(out.tagsMode).toBe('all');
    expect(out.tagsFailed).toEqual([]);
    const results = out.results as Record<string, unknown>[];
    expect(results.map((r) => r.path)).toEqual(['ops/runbook', 'audit/log']);
    expect(results[0].tags).toEqual(['runbook', 'ops']);
    expect(results[0].url).toBe(`${BASE}/en/ops/runbook`);
    expect(results[0].locale).toBe('en');
    expect(results[0].id).toBe(10);
  });

  it('tagsMode omitted → default "all" (single passthrough call, envelope echoes "all")', async () => {
    // Given: the same wiring
    const { tools, captured } = makeWired({
      'search(': () => searchBody([searchRow({ id: '10', path: 'ops/runbook', locale: 'en' })]),
      'list(': () => listBody([ROW_A]),
    });

    // When: tags given, tagsMode omitted
    const out = await run(tools.historian_search, { query: 'doc', tags: ['runbook'] });

    // Then: one call with the tag array; mode echoed as "all"
    expect(varsOf(captured, 'list(')).toEqual([{ locale: null, tags: ['runbook'] }]);
    expect(out.tagsMode).toBe('all');
    expect((out.results as Record<string, unknown>[])[0].tags).toEqual(['runbook', 'ops']);
  });

  it('duplicate tags are deduped and trimmed before the request', async () => {
    // Given: sloppy input — ' audit ' and a repeat of 'runbook'
    const { tools, captured } = makeWired({
      'search(': () => searchBody([searchRow({ id: '20', path: 'audit/log', locale: 'en' })]),
      'list(': () => listBody([ROW_B]),
    });

    // When: filtering
    const out = await run(tools.historian_search, { query: 'x', tags: ['runbook', ' audit ', 'runbook'] });

    // Then: normalized set reaches the server; envelope echoes the normalized list
    expect(varsOf(captured, 'list(')).toEqual([{ locale: null, tags: ['runbook', 'audit'] }]);
    expect(out.tags).toEqual(['runbook', 'audit']);
  });

  it('all-mode list failure propagates as the standard error envelope (no silent empty)', async () => {
    // Given: the server rejects the $tags query
    const { tools } = makeWired({
      'search(': () => searchBody([searchRow({})]),
      'list(': () => { return { errors: [{ message: 'tags exploded' }] }; },
    });

    // When: filtering all-mode
    const out = await run(tools.historian_search, { query: 'x', tags: ['runbook'] });

    // Then: ok:false GraphQLError envelope (same class the search leg would surface)
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('GraphQLError');
  });
});

// --- tagsMode 'any': client-side union ----------------------------------------

describe('historian_search tags — mode "any"', () => {
  /** Routes each per-tag list call; runbook leg also returns ROW_C (tagged but
   *  outside the text result set) so union-then-intersect is observable. */
  const anyList = (vars: Record<string, unknown>): unknown => {
    const tags = vars.tags as string[];
    if (tags.includes('runbook')) return listBody([ROW_A, ROW_A_ZH, ROW_C]);
    if (tags.includes('audit')) return listBody([ROW_A, ROW_B]); // ROW_A repeats → dedupe
    return listBody([]);
  };

  it('fans out one list call per tag, unions + dedupes by (path, locale), intersects with query', async () => {
    // Given: text query matches A(en) + A(zh) + B; C is tagged but has no text hit
    const { tools, captured } = makeWired({
      'search(': () => searchBody([
        searchRow({ id: '10', path: 'ops/runbook', locale: 'en' }),
        searchRow({ id: '11', path: 'ops/runbook', locale: 'zh' }),
        searchRow({ id: '20', path: 'audit/log', locale: 'en' }),
      ]),
      'list(': anyList,
    });

    // When: any-mode filter
    const out = await run(tools.historian_search, { query: 'doc', tags: ['runbook', 'audit'], tagsMode: 'any' });

    // Then: two per-tag calls, each a singleton array — never a combined $tags
    expect(varsOf(captured, 'list(')).toEqual([
      { locale: null, tags: ['runbook'] },
      { locale: null, tags: ['audit'] },
    ]);
    // Then: union {A-en, A-zh, C, B} minus C (no text hit); A-en from BOTH legs
    // appears exactly once; zh twin stays distinct from en
    const results = out.results as Record<string, unknown>[];
    expect(out.totalHits).toBe(3);
    expect(results.map((r) => `${r.locale}:${r.path}`)).toEqual(['en:ops/runbook', 'zh:ops/runbook', 'en:audit/log']);
    expect(out.tagsFailed).toEqual([]);
    expect(out.tagsMode).toBe('any');
  });

  it('drops a failed leg but keeps the survivors (ok:true, tagsFailed lists it)', async () => {
    // Given: the audit leg explodes at the GraphQL layer; runbook leg is fine
    const { tools } = makeWired({
      'search(': () => searchBody([
        searchRow({ id: '10', path: 'ops/runbook', locale: 'en' }),
        searchRow({ id: '20', path: 'audit/log', locale: 'en' }),
      ]),
      'list(': (vars) => {
        const tags = vars.tags as string[];
        if (tags.includes('audit')) return { errors: [{ message: 'audit leg down' }] };
        return listBody([ROW_A]);
      },
    });

    // When: any-mode filter
    const out = await run(tools.historian_search, { query: 'doc', tags: ['runbook', 'audit'], tagsMode: 'any' });

    // Then: success envelope (no new error class), failed tag surfaced honestly,
    // and B — only reachable via the dead audit leg — is absent
    expect(out.ok).toBe(true);
    expect(out.tagsFailed).toEqual(['audit']);
    const results = out.results as Record<string, unknown>[];
    expect(results.map((r) => r.path)).toEqual(['ops/runbook']);
  });

  it('ALL legs failing → standard error envelope (no partial lie)', async () => {
    // Given: both legs explode
    const { tools } = makeWired({
      'search(': () => searchBody([searchRow({})]),
      'list(': () => { return { errors: [{ message: 'both legs down' }] }; },
    });

    // When: any-mode filter
    const out = await run(tools.historian_search, { query: 'doc', tags: ['runbook', 'audit'], tagsMode: 'any' });

    // Then: ok:false, original GraphQLError class re-thrown
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('GraphQLError');
  });

  it('search rows with an unnormalizable locale never match a tag row', async () => {
    // Given: text result on locale 'de' (normalizeLocale throws), list has the
    // same path+en row
    const { tools } = makeWired({
      'search(': () => searchBody([searchRow({ id: '10', path: 'ops/runbook', locale: 'de' })]),
      'list(': () => listBody([ROW_A]),
    });

    // When: any-mode filter
    const out = await run(tools.historian_search, { query: 'x', tags: ['runbook'], tagsMode: 'any' });

    // Then: empty intersection, still a clean ok envelope
    expect(out.ok).toBe(true);
    expect(out.totalHits).toBe(0);
    expect(out.results).toEqual([]);
  });
});

// --- schema validation ---------------------------------------------------------

describe('historian_search tags — schema validation', () => {
  const s = tool.schema;
  const schema = () => s.object(buildTools(OPTS, { homeDir: makeKeyHome() }).historian_search.args);

  it('rejects >5 tags and the empty array', () => {
    // Given/When/Then: cardinality bounds fail at the boundary (input length,
    // checked BEFORE trim/dedupe normalization)
    expect(schema().safeParse({ query: 'x', tags: ['a', 'b', 'c', 'd', 'e', 'f'] }).success).toBe(false);
    expect(schema().safeParse({ query: 'x', tags: [] }).success).toBe(false);
  });

  it('rejects blank tags; a very long tag passes through untouched', () => {
    // Choice: '' fails (element min 1), whitespace-only fails (refine), but
    // 'a'.repeat(200) is NOT length-capped — it is forwarded verbatim and the
    // server simply matches nothing. Graceful for size, strict for blanks.
    expect(schema().safeParse({ query: 'x', tags: [''] }).success).toBe(false);
    expect(schema().safeParse({ query: 'x', tags: ['  '] }).success).toBe(false);
    expect(schema().safeParse({ query: 'x', tags: ['a'.repeat(200)] }).success).toBe(true);
  });

  it('tagsMode is enum {any, all}, optional, defaulting to "all"', () => {
    // Given/When: omitted vs bogus vs valid
    const omitted = schema().safeParse({ query: 'x', tags: ['a'] });
    // Then: default materializes; bogus rejected
    expect(omitted.success && omitted.data.tagsMode).toBe('all');
    expect(schema().safeParse({ query: 'x', tagsMode: 'bogus' }).success).toBe(false);
    expect(schema().safeParse({ query: 'x', tagsMode: 'any' }).success).toBe(true);
  });

  it('no tags given still parses (tags optional)', () => {
    // Then: legacy invocation shape unchanged
    expect(schema().safeParse({ query: 'x' }).success).toBe(true);
  });
});

/**
 * historian_* tool surface (todo 11): buildTools() contract tests.
 *
 * Every case is fully mocked (fragment-dispatch fake fetch, tmp home dirs,
 * mock translator) — zero live network, zero real wiki writes. Two wiring
 * modes are exercised:
 *   - deps.fetchImpl + deps.translate  → lazily-created client + mock translator
 *   - deps.client (no fetchImpl)      → injected client, translator NOT wired
 *
 * Written FIRST (failfirst): this file pins the output envelope contract the
 * implementation in src/tools.ts must satisfy.
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { OPTS, makeClient, makeKeyHome, jsonResponse } from './client-fixtures.js';
import type { GqlClient } from '../src/wiki/client.js';
import { TranslateError } from '../src/translate.js';
import { classifyGenre, genreSkeleton, type Genre } from '../src/templates/genres.js';
import { buildTools } from '../src/tools.js';

const PATH = 'docs/index';
const EN_URL = `http://localhost:3000/en/${PATH}`;
const ZH_URL = `http://localhost:3000/zh/${PATH}`;
const RESP_OK = { responseResult: { succeeded: true, errorCode: 0, slug: '', message: '' } };
const MADE_UP = 'MUST NOT BE CALLED';
const TWIN_TEXT = (t: string): string => `译:${t}`;

function rawPage(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 76,
    path: PATH,
    locale: 'en',
    title: 'Alpha',
    description: 'desc',
    content: '# Alpha\nbody',
    isPublished: true,
    isPrivate: false,
    contentType: 'markdown',
    tags: [{ tag: 't1' }],
    publishStartDate: '',
    publishEndDate: '',
    scriptCss: '',
    scriptJs: '',
    editor: 'markdown',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

/** zh twin view of the same page (id 998) — only reachable via explicit overrides. */
const zhPage = (): Record<string, unknown> => rawPage({ id: 998, locale: 'zh', title: '阿尔法' });

interface Captured {
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

/** Fragment-dispatch responder (same harness as pages.test.ts): every gql
 *  request is routed to the handler whose fragment appears in the query text;
 *  an unhandled query throws — so zero-fetch assertions get a hard fail. */
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
    if (fragment === undefined) throw new Error(`tools.test: unhandled query ${body.query}`);
    return jsonResponse(handlers[fragment](body.variables ?? {}, body.query));
  }) as typeof fetch;
  return { fetchImpl, captured, fetchCount: () => count };
}

function varsOf(captured: Captured[], fragment: string): Record<string, unknown>[] {
  return captured.filter((c) => c.query.includes(fragment)).map((c) => c.variables);
}

function parseOut(out: string | { output: string }): Record<string, unknown> {
  const text = typeof out === 'string' ? out : String(out.output);
  return JSON.parse(text) as Record<string, unknown>;
}

type ToolArgs = Record<string, unknown>;
type Tools = Record<string, ToolDefinition>;

function makeTools(over: {
  fetchImpl?: typeof fetch;
  translate?: (text: string, from: string, to: string) => Promise<string>;
  client?: GqlClient;
  homeDir?: string;
} = {}): { tools: Tools; fetchCount: () => number; captured: Captured[] } {
  const fetchImpl = over.fetchImpl ?? (async () => { throw new Error(MADE_UP); }) as typeof fetch;
  const tools = buildTools(OPTS, {
    fetchImpl,
    homeDir: over.homeDir ?? makeKeyHome(),
    translate: over.translate,
    client: over.client,
  });
  return { tools, fetchCount: () => 0, captured: [] };
}

/** Wired variant: mocked fetch (+ optional mock translator) drives the client. */
function makeWired(
  handlers: Record<string, (vars: Record<string, unknown>, query: string) => unknown>,
  translate?: (text: string, from: string, to: string) => Promise<string>,
  homeDir?: string,
): { tools: Tools; captured: Captured[]; fetchCount: () => number } {
  const r = makeResponder(handlers);
  const home = homeDir ?? makeKeyHome();
  const tools = buildTools(OPTS, { fetchImpl: r.fetchImpl, homeDir: home, translate });
  return { tools, captured: r.captured, fetchCount: r.fetchCount };
}

/** Client-injected variant: translator NOT wired (no fetchImpl passed to
 *  buildTools — the mock fetch rides on the injected client instead). */
function makeClientInjected(
  fetchImpl: typeof fetch,
  fetchCount: () => number,
): { tools: Tools; fetchCount: () => number; captured: Captured[] } {
  const { client } = makeClient(fetchImpl);
  const home = makeKeyHome();
  const tools = buildTools(OPTS, { client, homeDir: home });
  return { tools, fetchCount, captured: [] };
}

async function run(toolDef: ToolDefinition, args: ToolArgs): Promise<Record<string, unknown>> {
  const out = await toolDef.execute(args as never, {} as never);
  return parseOut(out as never);
}

const TOOL_KEYS = [
  'historian_page_create',
  'historian_page_update',
  'historian_page_append',
  'historian_translate_snippet',
  'historian_search',
  'historian_read',
  'historian_map',
  'historian_migrate',
  'historian_delete',
  'historian_move',
] as const;

// --- Surface + schema -------------------------------------------------------

describe('tool surface (buildTools)', () => {
  it('exports exactly the 10 historian_* tool keys', () => {
    // Given: a default build
    const { tools } = makeTools();
    // When: inspecting the returned record
    const keys = Object.keys(tools).sort();
    // Then: the surface matches the plan verbatim
    expect(keys).toEqual([...TOOL_KEYS].sort());
  });

  it('validates every tool schema: valid args pass, invalid shapes fail', () => {
    // Given: all tools with their (valid, invalid) argument samples
    const { tools } = makeTools();
    const s = tool.schema;
    const cases: Array<{ name: string; valid: ToolArgs; invalid: ToolArgs }> = [
      { name: 'historian_page_create', valid: { path: 'a/b', title: 'T' }, invalid: { path: 'a/b' } },
      { name: 'historian_page_update', valid: { path: PATH }, invalid: {} },
      { name: 'historian_page_append', valid: { path: PATH, section: 's' }, invalid: { path: PATH } },
      { name: 'historian_translate_snippet', valid: { text: 'hi' }, invalid: {} },
      { name: 'historian_search', valid: { query: 'x' }, invalid: {} },
      { name: 'historian_read', valid: { path: PATH }, invalid: {} },
      { name: 'historian_map', valid: {}, invalid: { action: 'bogus' } },
      { name: 'historian_migrate', valid: { path: PATH }, invalid: {} },
      { name: 'historian_delete', valid: { path: PATH }, invalid: {} },
      { name: 'historian_move', valid: { path: PATH, newPath: 'b/c' }, invalid: { path: PATH } },
    ];
    // When: parsing each schema with both samples
    for (const c of cases) {
      const schema = s.object(tools[c.name].args);
      expect(schema.safeParse(c.valid).success, `${c.name} valid`).toBe(true);
      expect(schema.safeParse(c.invalid).success, `${c.name} invalid`).toBe(false);
    }
  });

  it('materializes the create defaults: isPublished true, tags [], twin true, locale en', () => {
    // Given: the create tool's schema
    const { tools } = makeTools();
    const s = tool.schema;
    // When: parsing args that only carry path+title
    const parsed = s.object(tools.historian_page_create.args).safeParse({ path: 'a/b', title: 'T' });
    // Then: defaults are baked in (zod v4 via tool.schema)
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.isPublished).toBe(true);
      expect(parsed.data.tags).toEqual([]);
      expect(parsed.data.twin).toBe(true);
      expect(parsed.data.locale).toBe('en');
    }
  });

  it('rejects out-of-enum locale/genre/kind at the schema boundary', () => {
    // Given: create/update/search schemas
    const { tools } = makeTools();
    const s = tool.schema;
    const createSchema = s.object(tools.historian_page_create.args);
    // When: parsing invalid enums
    // Then: all fail before any execute runs
    expect(createSchema.safeParse({ path: 'a/b', title: 'T', locale: 'fr' }).success).toBe(false);
    expect(createSchema.safeParse({ path: 'a/b', title: 'T', genre: 'G9' }).success).toBe(false);
    const searchSchema = s.object(tools.historian_search.args);
    expect(searchSchema.safeParse({ query: 'x', kind: 'bogus' }).success).toBe(false);
  });
});

// --- historian_page_create ---------------------------------------------------

describe('historian_page_create', () => {
  it('creates a page with twin (translate wired) and reports both URLs', async () => {
    // Given: a wiki where the en create and the zh twin create both succeed
    const translates: string[][] = [];
    const translate = async (text: string, from: string, to: string): Promise<string> => {
      translates.push([text, from, to]);
      return TWIN_TEXT(text);
    };
    const { tools, captured, fetchCount } = makeWired(
      {
        'create(': (vars) => ({
          data: { pages: { create: { ...RESP_OK, page: { id: vars.locale === 'zh' ? 998 : 999, path: vars.path, locale: vars.locale } } } },
        }),
        'singleByPath(': (vars) => ({
          data: { pages: { singleByPath: vars.locale === 'zh' ? rawPage({ id: 998, locale: 'zh', title: '阿尔法' }) : rawPage() } },
        }),
      },
      translate,
    );

    // When: creating with explicit content
    const out = await run(tools.historian_page_create, {
      path: PATH,
      title: 'Alpha',
      content: '# Alpha\nbody',
      tags: ['t1'],
    });

    // Then: the twin was translated en→zh and created; both URLs are in the result
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('create');
    expect(out.pageId).toBe(76);
    expect(out.twinStatus).toBe('created');
    expect(out.twinId).toBe(998);
    expect(out.urls).toEqual({ en: EN_URL, zh: ZH_URL });
    expect(translates).toEqual([[ 'Alpha', 'en', 'zh' ], ['# Alpha\nbody', 'en', 'zh']]);
    const creates = varsOf(captured, 'create(');
    expect(creates[0].locale).toBe('en');
    expect(creates[0].isPublished).toBe(true);
    expect(creates[1].locale).toBe('zh');
    expect(creates[1].title).toBe('译:Alpha');
    expect(fetchCount()).toBe(4);
  });

  it('twin:false skips the twin and sends exactly one create', async () => {
    // Given: a wiki that would answer any write
    const { tools, captured, fetchCount } = makeWired({
      'create(': (vars) => ({
        data: { pages: { create: { ...RESP_OK, page: { id: 999, path: vars.path, locale: vars.locale } } } },
      }),
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage() } } }),
    });

    // When: creating with twin:false
    const out = await run(tools.historian_page_create, { path: PATH, title: 'Alpha', content: 'c', twin: false });

    // Then: twinStatus skipped, one create, still both URLs (from the LocalePair)
    expect(out.twinStatus).toBe('skipped');
    expect(varsOf(captured, 'create(').length).toBe(1);
    expect(out.urls).toEqual({ en: EN_URL, zh: ZH_URL });
    expect(fetchCount()).toBe(2);
  });

  it('template mode (no content): returns a local genre skeleton with ZERO fetches', async () => {
    // Given: a fetch spy that fails loudly if the tool touches the network
    const { tools, fetchCount } = makeWired({});
    const input = { path: PATH, title: 'Alpha' };

    // When: creating without content
    const out = await run(tools.historian_page_create, input);

    // Then: pure-local template mode — classified genre, skeleton, nothing written
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('template');
    const expected = classifyGenre({ title: 'Alpha', body: '' });
    expect(out.genre).toBe(expected.genre);
    expect(out.skeleton).toBe(genreSkeleton(expected.genre, 'en'));
    expect(typeof out.note).toBe('string');
    expect(fetchCount()).toBe(0);
  });

  it('template mode honours an explicit genre over classification', async () => {
    // Given: fetch spy that fails loudly
    const { tools, fetchCount } = makeWired({});

    // When: creating without content but with genre G3
    const out = await run(tools.historian_page_create, { path: PATH, title: 'Alpha', genre: 'G3' });

    // Then: the explicit genre wins and the skeleton matches it
    expect(out.mode).toBe('template');
    expect(out.genre).toBe('G3');
    expect(out.skeleton).toBe(genreSkeleton('G3', 'en'));
    expect(fetchCount()).toBe(0);
  });

  it('locale zh renders the zh skeleton in template mode', async () => {
    // Given: fetch spy that fails loudly
    const { tools } = makeWired({});

    // When: creating without content at locale zh
    const out = await run(tools.historian_page_create, { path: PATH, title: 'Alpha', locale: 'zh' });

    // Then: zh skeleton, zh locale echoed
    expect(out.mode).toBe('template');
    expect(out.locale).toBe('zh');
    expect(out.skeleton).toBe(genreSkeleton(out.genre as Genre, 'zh'));
  });

  it('rejects an invalid path before any fetch (PathValidationError envelope)', async () => {
    // Given: fetch spy that fails loudly
    const { tools, fetchCount } = makeWired({});

    // When: creating with a locale-shaped first path segment
    const out = await run(tools.historian_page_create, { path: 'zh/evil', title: 'T', content: 'c' });

    // Then: structured envelope, zero network
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('PathValidationError');
    expect(typeof out.actionableHint).toBe('string');
    expect(out.actionableHint.length).toBeGreaterThan(0);
    expect(fetchCount()).toBe(0);
  });

  it('maps an engine WikiError to the failure envelope, never a raw stack', async () => {
    // Given: the wiki rejects the create with a non-zero errorCode
    const { tools } = makeWired({
      'create(': () => ({
        data: {
          pages: { create: { responseResult: { succeeded: false, errorCode: 4301, slug: PATH, message: 'invalid path' } } },
        },
      }),
    });

    // When: creating
    const out = await run(tools.historian_page_create, { path: PATH, title: 'T', content: 'c', twin: false });

    // Then: ok:false with errorKind + hint; no stack text in the output
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('WikiError');
    expect(String(out.message)).toContain('invalid path');
    expect(typeof out.actionableHint).toBe('string');
    expect(JSON.stringify(out)).not.toContain('at ');
  });
});

// --- historian_page_update ---------------------------------------------------

describe('historian_page_update', () => {
  it('partial patch: undefined fields are kept (full RMW payload still sent)', async () => {
    // Given: a mutable wiki state; only the title changes
    let state = rawPage();
    const { tools, captured, fetchCount } = makeWired({
      'singleByPath(': () => ({ data: { pages: { singleByPath: { ...state } } } }),
      'single(': () => ({ data: { pages: { single: { ...state } } } }),
      'update(': (vars) => {
        state = { ...state, title: vars.title as string, tags: (vars.tags as string[]).map((t) => ({ tag: t })) };
        return { data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } } };
      },
    });

    // When: updating with only title (content/tags absent = keep)
    const out = await run(tools.historian_page_update, { path: PATH, title: 'New Title' });

    // Then: RMW echoed every mutable field; absent patch fields preserved
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('update');
    expect(out.urls).toEqual({ en: EN_URL, zh: ZH_URL });
    const updates = varsOf(captured, 'update(');
    expect(updates.length).toBe(1);
    expect(updates[0].title).toBe('New Title');
    expect(updates[0].content).toBe('# Alpha\nbody');
    expect(updates[0].tags).toEqual(['t1']);
    expect(updates[0].isPublished).toBe(true);
    expect(updates[0].id).toBe(76);
    expect((out.page as Record<string, unknown>).title).toBe('New Title');
    expect(fetchCount()).toBe(4);
  });

  it('returns a PageNotFoundError envelope when the page is missing', async () => {
    // Given: the page does not exist server-side
    const { tools, fetchCount } = makeWired({
      'singleByPath(': () => ({ errors: [{ message: 'This page does not exist.' }] }),
    });

    // When: updating a nonexistent page
    const out = await run(tools.historian_page_update, { path: PATH, title: 'New' });

    // Then: structured not-found envelope (read-then-write, no mutation attempted)
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('PageNotFoundError');
    expect(typeof out.actionableHint).toBe('string');
    expect(fetchCount()).toBe(1);
  });
});

// --- historian_page_append ---------------------------------------------------

describe('historian_page_append', () => {
  it('appends to the en page; existing zh twin is left untouched without sectionZh', async () => {
    // Given: both locales exist
    const { tools, captured, fetchCount } = makeWired({
      'singleByPath(': (vars) => ({
        data: { pages: { singleByPath: vars.locale === 'zh' ? zhPage() : rawPage() } },
      }),
      'single(': () => ({ data: { pages: { single: rawPage() } } }),
      'update(': (vars) => ({
        data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } },
      }),
    });

    // When: appending a section to en without sectionZh
    const out = await run(tools.historian_page_append, { path: PATH, section: '## New' });

    // Then: only the en page was updated; zh twin reported as exists (untouched)
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('append');
    expect(out.zhStatus).toBe('exists');
    expect(typeof out.zhNote).toBe('string');
    expect(out.urls).toEqual({ en: EN_URL, zh: ZH_URL });
    expect(varsOf(captured, 'update(').length).toBe(1);
    expect(fetchCount()).toBe(5);
  });

  it('appends to both locales when sectionZh is provided and the twin exists', async () => {
    // Given: both locales exist
    const { tools, captured, fetchCount } = makeWired({
      'singleByPath(': (vars) => ({
        data: { pages: { singleByPath: vars.locale === 'zh' ? zhPage() : rawPage() } },
      }),
      'single(': (vars) => ({
        data: { pages: { single: vars.id === 998 ? zhPage() : rawPage() } },
      }),
      'update(': (vars) => ({
        data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } },
      }),
    });

    // When: appending with an explicit zh section
    const out = await run(tools.historian_page_append, {
      path: PATH,
      section: '## New',
      sectionZh: '## 新',
    });

    // Then: both updates happened; zh content carries the provided section
    expect(out.zhStatus).toBe('appended');
    const updates = varsOf(captured, 'update(');
    expect(updates.length).toBe(2);
    const zhUpdate = updates.find((u) => u.locale === 'zh');
    expect(String(zhUpdate?.content)).toContain('## 新');
    expect(fetchCount()).toBe(9);
  });

  it('auto-creates the missing zh twin from sectionZh (createPage, twin:false)', async () => {
    // Given: zh twin missing at first, then appearing after its create
    let zhCreated = false;
    const { tools, captured, fetchCount } = makeWired({
      'singleByPath(': (vars) => {
        if (vars.locale !== 'zh') return { data: { pages: { singleByPath: rawPage() } } };
        return { data: { pages: { singleByPath: zhCreated ? zhPage() : null } } };
      },
      'single(': () => ({ data: { pages: { single: rawPage() } } }),
      'update(': (vars) => ({
        data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } },
      }),
      'create(': (vars) => {
        if (vars.locale === 'zh') zhCreated = true;
        return { data: { pages: { create: { ...RESP_OK, page: { id: 998, path: vars.path, locale: vars.locale } } } } };
      },
    });

    // When: appending en with sectionZh while the zh twin is missing
    const out = await run(tools.historian_page_append, { path: PATH, section: '## New', sectionZh: '## 新' });

    // Then: the zh twin was created from the provided section
    expect(out.zhStatus).toBe('created');
    expect(out.ok).toBe(true);
    const zhCreate = varsOf(captured, 'create(')[0];
    expect(zhCreate.locale).toBe('zh');
    expect(zhCreate.content).toBe('## 新');
    expect(zhCreate.tags).toEqual(['t1']);
    expect(zhCreate.isPublished).toBe(true);
    expect(fetchCount()).toBe(7);
  });

  it('missing zh twin + no sectionZh + translator wired: creates it from a translation', async () => {
    // Given: zh missing, translator wired
    let zhCreated = false;
    const translate = async (text: string): Promise<string> => TWIN_TEXT(text);
    const { tools, captured } = makeWired(
      {
        'singleByPath(': (vars) => {
          if (vars.locale !== 'zh') return { data: { pages: { singleByPath: rawPage() } } };
          return { data: { pages: { singleByPath: zhCreated ? zhPage() : null } } };
        },
        'single(': () => ({ data: { pages: { single: rawPage() } } }),
        'update(': (vars) => ({
          data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } },
        }),
        'create(': (vars) => {
          if (vars.locale === 'zh') zhCreated = true;
          return { data: { pages: { create: { ...RESP_OK, page: { id: 998, path: vars.path, locale: vars.locale } } } } };
        },
      },
      translate,
    );

    // When: appending en with no sectionZh
    const out = await run(tools.historian_page_append, { path: PATH, section: '## New' });

    // Then: title + section were translated for the auto-created twin
    expect(out.zhStatus).toBe('created');
    const zhCreate = varsOf(captured, 'create(')[0];
    expect(zhCreate.title).toBe('译:Alpha');
    expect(zhCreate.content).toBe('译:## New');
  });

  it('missing zh twin + no sectionZh + translator NOT wired: reports zhStatus missing', async () => {
    // Given: zh missing and no translator (client injected, no fetchImpl)
    const r = makeResponder({
      'singleByPath(': (vars) => {
        if (vars.locale !== 'zh') return { data: { pages: { singleByPath: rawPage() } } };
        return { data: { pages: { singleByPath: null } } };
      },
      'single(': () => ({ data: { pages: { single: rawPage() } } }),
      'update(': (vars) => ({
        data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } },
      }),
    });
    const { tools, fetchCount } = makeClientInjected(r.fetchImpl, r.fetchCount);

    // When: appending en with no sectionZh
    const out = await run(tools.historian_page_append, { path: PATH, section: '## New' });

    // Then: primary append succeeded; zh reported missing with a hint
    expect(out.ok).toBe(true);
    expect(out.zhStatus).toBe('missing');
    expect(typeof out.zhNote).toBe('string');
    expect(varsOf(r.captured, 'create(').length).toBe(0);
    expect(fetchCount()).toBe(5);
  });

  it('translator failure during twin bootstrap degrades zh to pending, primary still ok', async () => {
    // Given: zh missing, translator rejects
    let zhCreated = false;
    const translate = async (): Promise<string> => {
      throw new TranslateError('network', 'econnrefused');
    };
    const { tools, captured } = makeWired(
      {
        'singleByPath(': (vars) => {
          if (vars.locale !== 'zh') return { data: { pages: { singleByPath: rawPage() } } };
          return { data: { pages: { singleByPath: zhCreated ? zhPage() : null } } };
        },
        'single(': () => ({ data: { pages: { single: rawPage() } } }),
        'update(': (vars) => ({
          data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } },
        }),
        'create(': (vars) => {
          if (vars.locale === 'zh') zhCreated = true;
          return { data: { pages: { create: { ...RESP_OK, page: { id: 998, path: vars.path, locale: vars.locale } } } } };
        },
      },
      translate,
    );

    // When: appending en with no sectionZh (twin bootstrap triggers a translation)
    const out = await run(tools.historian_page_append, { path: PATH, section: '## New' });

    // Then: the en append stands; zh degrades to pending, never fails the tool
    expect(out.ok).toBe(true);
    expect(out.zhStatus).toBe('pending');
    expect(typeof out.zhNote).toBe('string');
    expect(varsOf(captured, 'create(').length).toBe(0);
  });

  it('zh-locale append updates only the zh page', async () => {
    // Given: zh page exists
    const { tools, captured, fetchCount } = makeWired({
      'singleByPath(': (vars) => ({
        data: { pages: { singleByPath: vars.locale === 'zh' ? zhPage() : rawPage() } },
      }),
      'single(': (vars) => ({
        data: { pages: { single: vars.id === 998 ? zhPage() : rawPage() } },
      }),
      'update(': (vars) => ({
        data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } },
      }),
    });

    // When: appending directly to zh
    const out = await run(tools.historian_page_append, { path: PATH, locale: 'zh', section: '## 新' });

    // Then: exactly one zh update; no en calls
    expect(out.ok).toBe(true);
    expect(out.zhStatus).toBe('appended');
    expect(varsOf(captured, 'update(').length).toBe(1);
    expect(varsOf(captured, 'update(')[0].locale).toBe('zh');
    expect(fetchCount()).toBe(4);
  });
});

// --- historian_translate_snippet ---------------------------------------------

describe('historian_translate_snippet', () => {
  it('returns the translation with from/to echoed (never touches the wiki)', async () => {
    // Given: a mock translator, and a client that fails loudly if called
    const translate = async (text: string): Promise<string> => `译:${text}`;
    const { tools } = makeWired({}, translate);

    // When: translating a snippet
    const out = await run(tools.historian_translate_snippet, { text: 'Hello', from: 'en', to: 'zh' });

    // Then: plain success envelope with the translated text
    expect(out.ok).toBe(true);
    expect(out.translated).toBe('译:Hello');
    expect(out.from).toBe('en');
    expect(out.to).toBe('zh');
  });

  it('maps a TranslateError to a structured {ok:false, error, detail} instead of throwing', async () => {
    // Given: a translator that fails with a TranslateError
    const translate = async (): Promise<string> => {
      throw new TranslateError('truncated', 'output hit max tokens');
    };
    const { tools } = makeWired({}, translate);

    // When: translating (execute must RESOLVE, not reject)
    const out = await run(tools.historian_translate_snippet, { text: 'long text' });

    // Then: the cause + detail are the structured error payload
    expect(out.ok).toBe(false);
    expect(out.error).toBe('truncated');
    expect(out.detail).toBe('output hit max tokens');
    expect(typeof out.actionableHint).toBe('string');
  });

  it('reports not-wired when no translator and no fetchImpl are configured', async () => {
    // Given: client-injected build (translator never wired)
    const r = makeResponder({});
    const { tools } = makeClientInjected(r.fetchImpl, r.fetchCount);

    // When: translating
    const out = await run(tools.historian_translate_snippet, { text: 'Hello' });

    // Then: explicit not-wired envelope, still ok:false (not a throw)
    expect(out.ok).toBe(false);
    expect(out.error).toBe('not-wired');
    expect(typeof out.detail).toBe('string');
  });
});

// --- historian_search --------------------------------------------------------

describe('historian_search', () => {
  it('returns hits with per-result URLs and null-scoped vars', async () => {
    // Given: a wiki with one en hit
    const { tools, captured, fetchCount } = makeWired({
      'search(': () => ({
        data: {
          pages: {
            search: {
              results: [{ id: '1', title: 'Hit', description: 'd', path: '_sandbox/x', locale: 'en' }],
              suggestions: ['alpha'],
              totalHits: 1,
            },
          },
        },
      }),
    });

    // When: searching with default kind
    const out = await run(tools.historian_search, { query: 'hit' });

    // Then: result carries the composed en URL; kind echoed; scope null
    expect(out.ok).toBe(true);
    expect(out.totalHits).toBe(1);
    expect(out.kind).toBe('content');
    expect((out.results as Array<Record<string, unknown>>)[0].url).toBe('http://localhost:3000/en/_sandbox/x');
    expect(out.suggestions).toEqual(['alpha']);
    expect(varsOf(captured, 'search(')[0]).toEqual({ query: 'hit', path: null, locale: null });
    expect(fetchCount()).toBe(1);
  });
});

// --- historian_read ----------------------------------------------------------

describe('historian_read', () => {
  it('returns the full page with content and the locale pair URLs', async () => {
    // Given: an existing page
    const { tools } = makeWired({
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage() } } }),
    });

    // When: reading it
    const out = await run(tools.historian_read, { path: PATH, locale: 'en' });

    // Then: content present, found:true, both URLs
    expect(out.ok).toBe(true);
    expect(out.found).toBe(true);
    expect(out.content).toBe('# Alpha\nbody');
    expect((out.page as Record<string, unknown>).id).toBe(76);
    expect(out.urls).toEqual({ en: EN_URL, zh: ZH_URL });
  });

  it('missing page: ok:true, found:false, with a twinHint', async () => {
    // Given: the page does not exist
    const { tools } = makeWired({
      'singleByPath(': () => ({ errors: [{ message: 'This page does not exist.' }] }),
    });

    // When: reading it
    const out = await run(tools.historian_read, { path: PATH, locale: 'en' });

    // Then: a graceful not-found envelope with a hint mentioning the twin
    expect(out.ok).toBe(true);
    expect(out.found).toBe(false);
    expect(out.path).toBe(PATH);
    expect(out.locale).toBe('en');
    expect(typeof out.twinHint).toBe('string');
    expect(String(out.twinHint)).toContain('zh');
  });
});

// --- historian_map -----------------------------------------------------------

describe('historian_map', () => {
  it('show reads the local mirror with zero fetches', async () => {
    // Given: a hand-written mirror in the fake home dir, fetch fails loudly
    const home = makeKeyHome();
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    const generatedAt = new Date().toISOString();
    writeFileSync(
      join(home, '.config', 'opencode', 'historian-map.json'),
      `${JSON.stringify({
        generatedAt,
        rows: [{ id: 76, locale: 'en', path: PATH, title: 'Alpha', updatedAt: generatedAt, url: EN_URL, twinUrl: ZH_URL, twinId: 998 }],
        stats: { rows: 1, paths: 1, perLocale: { en: 1, zh: 0 }, missingTwinPaths: [PATH] },
      })}\n`,
      'utf8',
    );
    const { tools } = makeWired({}, undefined, home);

    // When: showing the map from the mirror
    const out = await run(tools.historian_map, { action: 'show' });

    // Then: mirror contents surface; no network was touched
    expect(out.ok).toBe(true);
    expect(out.action).toBe('show');
    expect(out.generatedAt).toBe(generatedAt);
    expect(out.staleSeconds).toBe(0);
    expect((out.stats as Record<string, unknown>).rows).toBe(1);
    expect((out.rows as Array<Record<string, unknown>>)[0].url).toBe(EN_URL);
  });

  it('refresh rebuilds the map and upserts the _meta/page-map cache page', async () => {
    // Given: a wiki listing both locales; cache page absent at first
    let cacheCreated = false;
    const { tools, captured } = makeWired({
      'list(': (vars) => ({
        data: {
          pages: {
            list: [
              {
                id: 5,
                path: PATH,
                locale: vars.locale,
                title: 'Alpha',
                description: 'd',
                contentType: 'markdown',
                isPublished: true,
                isPrivate: false,
                privateNS: null,
                createdAt: '2026-09-01T00:00:00.000Z',
                updatedAt: '2026-09-01T00:00:00.000Z',
                tags: [{ tag: 't1' }],
              },
            ],
          },
        },
      }),
      'singleByPath(': () => ({
        data: { pages: { singleByPath: cacheCreated ? rawPage({ path: '_meta/page-map' }) : null } },
      }),
      'create(': (vars) => {
        if (vars.path === '_meta/page-map') cacheCreated = true;
        return { data: { pages: { create: { ...RESP_OK, page: { id: 9, path: vars.path, locale: vars.locale } } } } };
      },
    });

    // When: refreshing the map
    const out = await run(tools.historian_map, { action: 'refresh' });

    // Then: fresh stats + the cache URL; the cache page was created
    expect(out.ok).toBe(true);
    expect(out.action).toBe('refresh');
    expect((out.stats as Record<string, unknown>).paths).toBe(1);
    expect(out.cacheUrl).toBe('http://localhost:3000/en/_meta/page-map');
    expect(varsOf(captured, 'create(')[0].path).toBe('_meta/page-map');
  });
});

// --- historian_delete --------------------------------------------------------

describe('historian_delete', () => {
  it('refuses without confirm:"yes" BEFORE any fetch', async () => {
    // Given: fetch spy that fails loudly
    const { tools, fetchCount } = makeWired({});

    // When: deleting without confirm
    const out = await run(tools.historian_delete, { path: PATH, locale: 'en' });

    // Then: structured refusal, zero network
    expect(out.ok).toBe(false);
    expect(out.error).toBe('confirm-required');
    expect(out.errorKind).toBe('ConfirmRequiredError');
    expect(typeof out.actionableHint).toBe('string');
    expect(fetchCount()).toBe(0);
  });

  it('deletes with confirm:"yes" and reports the page URLs', async () => {
    // Given: an existing page
    const { tools, captured, fetchCount } = makeWired({
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage() } } }),
      'delete(': () => ({ data: { pages: { delete: RESP_OK } } }),
    });

    // When: deleting with confirmation
    const out = await run(tools.historian_delete, { path: PATH, locale: 'en', confirm: 'yes' });

    // Then: delete executed with the resolved id; URLs still reported
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('delete');
    expect(out.pageId).toBe(76);
    expect(out.urls).toEqual({ en: EN_URL, zh: ZH_URL });
    expect(varsOf(captured, 'delete(')[0]).toEqual({ id: 76 });
    expect(fetchCount()).toBe(2);
  });
});

// --- historian_move ----------------------------------------------------------

describe('historian_move', () => {
  it('refuses without confirm:"yes" BEFORE any fetch', async () => {
    // Given: fetch spy that fails loudly
    const { tools, fetchCount } = makeWired({});

    // When: moving without confirm
    const out = await run(tools.historian_move, { path: PATH, locale: 'en', newPath: 'docs/moved' });

    // Then: structured refusal, zero network
    expect(out.ok).toBe(false);
    expect(out.error).toBe('confirm-required');
    expect(fetchCount()).toBe(0);
  });

  it('moves to the destination path/locale and reports the NEW URLs', async () => {
    // Given: an existing page
    const { tools, captured, fetchCount } = makeWired({
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage() } } }),
      'move(': () => ({ data: { pages: { move: RESP_OK } } }),
    });

    // When: moving to docs/moved at locale zh, confirmed
    const out = await run(tools.historian_move, {
      path: PATH,
      locale: 'en',
      newPath: 'docs/moved',
      newLocale: 'zh',
      confirm: 'yes',
    });

    // Then: the move carried the destination; URLs are the NEW pair (zh primary)
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('move');
    expect(out.path).toBe('docs/moved');
    expect(out.locale).toBe('zh');
    expect((out.from as Record<string, unknown>).path).toBe(PATH);
    expect(varsOf(captured, 'move(')[0]).toEqual({ id: 76, destinationPath: 'docs/moved', destinationLocale: 'zh' });
    expect(out.urls).toEqual({
      en: 'http://localhost:3000/en/docs/moved',
      zh: 'http://localhost:3000/zh/docs/moved',
    });
    expect(fetchCount()).toBe(2);
  });
});

// --- historian_migrate -------------------------------------------------------

describe('historian_migrate', () => {
  it('apply=true is refused as not-implemented BEFORE any fetch (todo 14 owns apply)', async () => {
    // Given: fetch spy that fails loudly
    const { tools, fetchCount } = makeWired({});

    // When: requesting an apply
    const out = await run(tools.historian_migrate, { path: PATH, apply: true });

    // Then: structured not-implemented envelope; zero network
    expect(out.ok).toBe(false);
    expect(out.error).toBe('not-implemented');
    expect(out.errorKind).toBe('NotImplementedError');
    expect(out.note).toBe('todo 14 owns apply');
    expect(fetchCount()).toBe(0);
  });

  it('dry-run (no apply): echoes content, suggests an explicit genre, previews the checklist', async () => {
    // Given: an existing legacy page
    const { tools, fetchCount } = makeWired({
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage() } } }),
    });

    // When: running the dry-run with an explicit genre
    const out = await run(tools.historian_migrate, { path: PATH, genre: 'G4' });

    // Then: nothing is written; the preview carries genre + full content echo
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('dry-run');
    expect(out.suggestedGenre).toBe('G4');
    expect(out.confidence).toBe('explicit');
    expect(out.content).toBe('# Alpha\nbody');
    expect((out.checklist as unknown[]).length).toBe(10);
    expect(out.urls).toEqual({ en: EN_URL, zh: ZH_URL });
    expect(fetchCount()).toBe(1);
  });

  it('dry-run without a genre classifies the page via the engine', async () => {
    // Given: an existing legacy page
    const { tools } = makeWired({
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage() } } }),
    });

    // When: running the dry-run with no explicit genre
    const out = await run(tools.historian_migrate, { path: PATH });

    // Then: the genre matches the engine classifier on the same input
    const expected = classifyGenre({ title: 'Alpha', body: '# Alpha\nbody' });
    expect(out.suggestedGenre).toBe(expected.genre);
    expect(out.signals).toEqual(expected.signals);
  });

  it('dry-run on a missing page returns a PageNotFoundError envelope', async () => {
    // Given: page does not exist in en or zh
    const { tools, fetchCount } = makeWired({
      'singleByPath(': () => ({ errors: [{ message: 'This page does not exist.' }] }),
    });

    // When: running the dry-run
    const out = await run(tools.historian_migrate, { path: PATH });

    // Then: structured not-found envelope; exactly one probe per locale (en, then zh)
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('PageNotFoundError');
    expect(fetchCount()).toBe(2);
  });
});
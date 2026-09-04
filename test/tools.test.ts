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
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { OPTS, makeClient, makeKeyHome, jsonResponse } from './client-fixtures.js';
import { HttpError, type GqlClient } from '../src/wiki/client.js';
import { TranslateError } from '../src/translate.js';
import { classifyGenre, genreSkeleton, type Genre } from '../src/templates/genres.js';
import { buildTools } from '../src/tools.js';
import { makeAppendTool } from '../src/tools/write.js';
import { makeTranslateSnippetTool } from '../src/tools/local.js';
import type { ToolDeps } from '../src/tools/shared.js';

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

/** Migrate variant: the tool also hits the LLM messages endpoint, so the fake
 *  fetch routes gql fragments AND llm bodies (dual mode). */
function makeMigrateWired(
  handlers: Record<string, (vars: Record<string, unknown>, query: string) => unknown>,
  llmText: string,
  translate?: (text: string, from: string, to: string) => Promise<string>,
  homeDir?: string,
  resultsDir?: string,
): { tools: Tools; captured: Captured[]; fetchCount: () => number } {
  const captured: Captured[] = [];
  let count = 0;
  const fetchImpl = (async (input: unknown, init?: unknown): Promise<Response> => {
    count++;
    const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as Record<string, unknown>;
    if (typeof body.query === 'string') {
      const query = body.query as string;
      captured.push({ query, variables: (body.variables ?? {}) as Record<string, unknown> });
      const fragment = Object.keys(handlers).find((f) => query.includes(f));
      if (fragment === undefined) throw new Error(`tools.test: unhandled query ${query}`);
      return jsonResponse(handlers[fragment]((body.variables ?? {}) as Record<string, unknown>, query));
    }
    if (typeof body.model === 'string' && Array.isArray(body.messages)) {
      return jsonResponse({ content: [{ type: 'text', text: llmText }] });
    }
    throw new Error('tools.test: unknown fetch body shape');
  }) as typeof fetch;
  const tools = buildTools(OPTS, { fetchImpl, homeDir: homeDir ?? makeKeyHome(), translate, resultsDir });
  return { tools, captured, fetchCount: () => count };
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
    // (stateful: both pages are absent until their create lands)
    const translates: string[][] = [];
    const translate = async (text: string, from: string, to: string): Promise<string> => {
      translates.push([text, from, to]);
      return TWIN_TEXT(text);
    };
    let createdEn = false;
    let createdZh = false;
    const { tools, captured, fetchCount } = makeWired(
      {
        'list(': () => ({ data: { pages: { list: [] } } }),
        'create(': (vars) => {
          if (vars.locale === 'zh') createdZh = true;
          else createdEn = true;
          return {
            data: { pages: { create: { ...RESP_OK, page: { id: vars.locale === 'zh' ? 998 : 999, path: vars.path, locale: vars.locale } } } },
          };
        },
        'singleByPath(': (vars) => ({
          data: { pages: { singleByPath: vars.locale === 'zh'
            ? createdZh ? rawPage({ id: 998, locale: 'zh', title: '阿尔法' }) : null
            : createdEn ? rawPage() : null } },
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
    expect('advisory' in out).toBe(false);
    expect(translates).toEqual([[ 'Alpha', 'en', 'zh' ], ['# Alpha\nbody', 'en', 'zh']]);
    const creates = varsOf(captured, 'create(');
    expect(creates[0].locale).toBe('en');
    expect(creates[0].isPublished).toBe(true);
    expect(creates[1].locale).toBe('zh');
    expect(creates[1].title).toBe('译:Alpha');
    expect(fetchCount()).toBe(6);
  });

  it('no-deps buildTools feeds a live translator into createPage — twinStatus created, not pending (THE GAP)', async () => {
    // Given: the exact production wiring — buildTools(OPTS, {}) with ZERO
    // injected deps — and ONE global fetch stub dispatching both GraphQL and
    // Anthropic-messages shapes (engine path is real, network is mocked)
    const original = globalThis.fetch;
    const captured: Captured[] = [];
    globalThis.fetch = (async (input: unknown, init?: unknown): Promise<Response> => {
      const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as Record<string, unknown>;
      if (typeof body.query === 'string') {
        const vars = (body.variables ?? {}) as Record<string, unknown>;
        captured.push({ query: body.query, variables: vars });
        if (body.query.includes('create(')) {
          return jsonResponse({
            data: { pages: { create: { ...RESP_OK, page: { id: vars.locale === 'zh' ? 998 : 999, path: vars.path, locale: vars.locale } } } },
          });
        }
        if (body.query.includes('singleByPath(')) {
          return jsonResponse({ data: { pages: { singleByPath: vars.locale === 'zh' ? zhPage() : rawPage() } } });
        }
        throw new Error(`tools.test: unhandled gql query ${body.query}`);
      }
      if (typeof body.model === 'string' && Array.isArray(body.messages)) {
        const userText = (body.messages[0] as { content: string }).content;
        return jsonResponse({ content: [{ type: 'text', text: `译:${userText}` }] });
      }
      throw new Error('tools.test: unknown fetch body shape');
    }) as typeof fetch;
    try {
      const tools = buildTools(OPTS, {});
      // When: creating with twin:true (default) entirely on the no-deps build
      const out = await run(tools.historian_page_create, { path: PATH, title: 'Alpha', content: '# Alpha\nbody', tags: ['t1'] });
      // Then: the twin was ENGINE-translated and created — never the
      // translator-not-wired pending degradation from the old deps.fetchImpl gate
      expect(out.ok).toBe(true);
      expect(out.twinStatus).toBe('created');
      expect(out.twinId).toBe(998);
      expect(out.urls).toEqual({ en: EN_URL, zh: ZH_URL });
      const creates = varsOf(captured, 'create(');
      expect(creates.map((c) => c.locale)).toEqual(['en', 'zh']);
      expect(creates[1].title).toBe('译:Alpha');
      expect(creates[1].content).toBe('译:# Alpha\nbody');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('twin:false skips the twin and sends exactly one create', async () => {
    // Given: a wiki that would answer any write
    const { tools, captured, fetchCount } = makeWired(createWiki());

    // When: creating with twin:false
    const out = await run(tools.historian_page_create, { path: PATH, title: 'Alpha', content: 'c', twin: false });

    // Then: twinStatus skipped, one create, still both URLs (from the LocalePair)
    expect(out.twinStatus).toBe('skipped');
    expect(varsOf(captured, 'create(').length).toBe(1);
    expect(out.urls).toEqual({ en: EN_URL, zh: ZH_URL });
    expect(fetchCount()).toBe(4);
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

// --- create collision advisory (v4 todo 3) -----------------------------------

import { collisionAdvisory } from '../src/tools/shared.js';
import type { PageListItem } from '../src/wiki/pages.read.js';

/** PageListItem factory — collisionAdvisory unit inputs. */
function listItem(path: string, locale: string, title: string): PageListItem {
  return {
    id: 1,
    path,
    locale: locale as PageListItem['locale'],
    title,
    description: '',
    contentType: 'markdown',
    isPublished: true,
    isPrivate: false,
    privateNS: null,
    createdAt: '',
    updatedAt: '',
    tags: [],
  };
}

const COLLISION_BASE = {
  tier: 'front' as const,
  path: PATH,
  locale: 'en' as const,
  title: 'Alpha',
  baseUrl: 'http://localhost:3000',
  exists: false,
  inventory: [] as readonly PageListItem[],
};

/** Stateful create wiki: (path, locale) reads null until a create lands —
 *  models a genuinely NEW page so the collision pre-read sees absence while
 *  createPage's authoritative post-read sees the page. `existing` pre-seeds
 *  live pages; `list` is the listPages inventory payload. */
function createWiki(over: {
  existing?: ReadonlyArray<readonly [string, string]>;
  list?: readonly Record<string, unknown>[];
} = {}): Record<string, (vars: Record<string, unknown>) => unknown> {
  const live = new Set<string>((over.existing ?? []).map(([p, l]) => `${p}|${l}`));
  const key = (vars: Record<string, unknown>): string => `${String(vars.path)}|${String(vars.locale)}`;
  const echo = (vars: Record<string, unknown>, id: number, title: string): Record<string, unknown> =>
    rawPage({ id, path: String(vars.path), locale: String(vars.locale), title });
  return {
    'list(': () => ({ data: { pages: { list: over.list ?? [] } } }),
    'create(': (vars) => {
      live.add(key(vars));
      return {
        data: {
          pages: { create: { ...RESP_OK, page: { id: vars.locale === 'zh' ? 998 : 999, path: vars.path, locale: vars.locale } } },
        },
      };
    },
    'singleByPath(': (vars) => ({
      data: {
        pages: {
          singleByPath: live.has(key(vars))
            ? vars.locale === 'zh'
              ? echo(vars, 998, '阿尔法')
              : echo(vars, 76, 'Alpha')
            : null,
        },
      },
    }),
  };
}

describe('collisionAdvisory (pure)', () => {
  it('target (path, locale) exists → update-preference advisory carrying the page URL', () => {
    // Given: the exact target already lives on the wiki
    const out = collisionAdvisory({ ...COLLISION_BASE, exists: true });
    // Then: actionable wording — prefer update, URL present
    expect(out).not.toBeNull();
    expect(out).toContain('path exists');
    expect(out).toContain('prefer historian_page_update');
    expect(out).toContain(EN_URL);
  });

  it('clean target and clean inventory → null (no advisory noise)', () => {
    expect(collisionAdvisory(COLLISION_BASE)).toBeNull();
    expect(collisionAdvisory({ ...COLLISION_BASE, inventory: [listItem('llm/other', 'en', 'Beta')] })).toBeNull();
  });

  it('same normalized title on a different path → 疑似重复 + 先读再写 + path + URL', () => {
    // Given: a different-path page sharing the exact title
    const out = collisionAdvisory({ ...COLLISION_BASE, inventory: [listItem('llm/alpha', 'en', 'Alpha')] });
    expect(out).not.toBeNull();
    expect(out).toContain('疑似重复');
    expect(out).toContain('先读再写');
    expect(out).toContain('llm/alpha');
    expect(out).toContain('http://localhost:3000/en/llm/alpha');
  });

  it('title matching normalizes case + internal whitespace and spans locales', () => {
    // Given: a zh row whose title differs only in case/whitespace
    const out = collisionAdvisory({
      ...COLLISION_BASE,
      title: '  LLM   Eval ',
      inventory: [listItem('docs/eval', 'zh', 'llm\neval')],
    });
    // Then: normalized equality fires the advisory, zh URL reported
    expect(out).not.toBeNull();
    expect(out).toContain('疑似重复');
    expect(out).toContain('http://localhost:3000/zh/docs/eval');
  });

  it('a same-path other-locale twin sharing the title is NOT a duplicate', () => {
    // Given: the (path, locale) twin rows of the very page being created
    const out = collisionAdvisory({
      ...COLLISION_BASE,
      inventory: [listItem(PATH, 'zh', 'Alpha')],
    });
    expect(out).toBeNull();
  });

  it('evidence tier skips the title-duplicate advice but still flags path existence', () => {
    // Given: an evidence create whose title collides with a human page
    const dup = collisionAdvisory({
      ...COLLISION_BASE,
      tier: 'evidence',
      path: '_evidence/run-1',
      inventory: [listItem('llm/alpha', 'en', 'Alpha')],
    });
    expect(dup).toBeNull();
    // But: an exact existing evidence path is still worth the update pointer
    const exists = collisionAdvisory({ ...COLLISION_BASE, tier: 'evidence', path: '_evidence/run-1', exists: true });
    expect(exists).not.toBeNull();
    expect(exists).toContain('prefer historian_page_update');
    expect(exists).toContain('http://localhost:3000/en/_evidence/run-1');
  });

  it('machine-namespace inventory rows never trigger the duplicate advice', () => {
    const out = collisionAdvisory({
      ...COLLISION_BASE,
      inventory: [listItem('_meta/page-map', 'en', 'Alpha'), listItem('_evidence/raw-1', 'en', 'Alpha')],
    });
    expect(out).toBeNull();
  });

  it('blank/whitespace title yields no duplicate advice', () => {
    const out = collisionAdvisory({
      ...COLLISION_BASE,
      title: '   ',
      inventory: [listItem('llm/blank', 'en', '   ')],
    });
    expect(out).toBeNull();
  });

  it('many duplicate paths: first 3 reported, overflow counted', () => {
    const inv = [1, 2, 3, 4, 5].map((n) => listItem(`llm/dup-${n}`, 'en', 'Alpha'));
    const out = collisionAdvisory({ ...COLLISION_BASE, inventory: inv });
    expect(out).toContain('llm/dup-1');
    expect(out).toContain('llm/dup-3');
    expect(out).not.toContain('llm/dup-4');
    expect(out).toContain('+2');
  });
});

describe('historian_page_create collision advisory (envelope)', () => {
  it('path exists: the write still lands, advisory names update + the URL', async () => {
    // Given: the target page already lives there (pre-read sees it, create still runs)
    const { tools, captured, fetchCount } = makeWired(createWiki({ existing: [[PATH, 'en']] }));
    // When: creating on top of it anyway
    const out = await run(tools.historian_page_create, { path: PATH, title: 'Alpha', content: '# Alpha\nbody', twin: false });
    // Then: NEVER blocked — ok true, the create mutation ran, advisory present
    expect(out.ok).toBe(true);
    expect(out.pageId).toBe(76);
    expect(varsOf(captured, 'create(').length).toBe(1);
    expect(String(out.advisory)).toContain('path exists');
    expect(String(out.advisory)).toContain(EN_URL);
    expect(fetchCount()).toBe(4); // pre-read + list + create + authoritative post-read
  });

  it('title duplicate on another path: advisory carries 疑似重复 + the other URL', async () => {
    const { tools } = makeWired(createWiki({ list: [{ id: 5, path: 'llm/alpha', locale: 'en', title: 'Alpha' }] }));
    const out = await run(tools.historian_page_create, { path: PATH, title: 'Alpha', content: 'c', twin: false });
    expect(out.ok).toBe(true);
    expect(String(out.advisory)).toContain('疑似重复');
    expect(String(out.advisory)).toContain('先读再写');
    expect(String(out.advisory)).toContain('http://localhost:3000/en/llm/alpha');
  });

  it('clean create: no advisory key, envelope byte-for-byte unchanged', async () => {
    const { tools, fetchCount } = makeWired(createWiki());
    const out = await run(tools.historian_page_create, { path: PATH, title: 'Alpha', content: '# Alpha\nbody', twin: false });
    expect(out).toEqual({
      ok: true,
      mode: 'create',
      path: PATH,
      locale: 'en',
      pageId: 76,
      twinStatus: 'skipped',
      urls: { en: EN_URL, zh: ZH_URL },
    });
    expect(fetchCount()).toBe(4);
  });

  it('listPages read failure: create succeeds, advisory silently absent, never throws', async () => {
    // Given: no 'list(' handler — the fake fetch THROWS on the inventory query
    let exists = false;
    const { tools } = makeWired({
      'create(': (vars) => {
        exists = true;
        return { data: { pages: { create: { ...RESP_OK, page: { id: 777, path: vars.path, locale: vars.locale } } } } };
      },
      'singleByPath(': () => ({ data: { pages: { singleByPath: exists ? rawPage({ id: 777 }) : null } } }),
    });
    const out = await run(tools.historian_page_create, { path: PATH, title: 'Alpha', content: 'c', twin: false });
    expect(out.ok).toBe(true);
    expect(out.pageId).toBe(777);
    expect('advisory' in out).toBe(false);
  });

  it('pre-read failure: create succeeds with the advisory silently absent', async () => {
    // Given: the FIRST singleByPath (the collision pre-read) fails, later
    // engine reads succeed
    let calls = 0;
    let exists = false;
    const { tools, captured } = makeWired({
      'list(': () => ({ data: { pages: { list: [] } } }),
      'create(': (vars) => {
        exists = true;
        return { data: { pages: { create: { ...RESP_OK, page: { id: 778, path: vars.path, locale: vars.locale } } } } };
      },
      'singleByPath(': () => {
        calls++;
        if (calls === 1) throw new Error('transient read outage');
        return { data: { pages: { singleByPath: exists ? rawPage({ id: 778 }) : null } } };
      },
    });
    const out = await run(tools.historian_page_create, { path: PATH, title: 'Alpha', content: 'c', twin: false });
    expect(out.ok).toBe(true);
    expect(out.pageId).toBe(778);
    expect('advisory' in out).toBe(false);
    expect(varsOf(captured, 'create(').length).toBe(1);
  });

  it('template branch is untouched: zero fetches, no advisory', async () => {
    const { tools, fetchCount } = makeWired(createWiki({ existing: [[PATH, 'en']] }));
    const out = await run(tools.historian_page_create, { path: PATH, title: 'Alpha' });
    expect(out.mode).toBe('template');
    expect('advisory' in out).toBe(false);
    expect(fetchCount()).toBe(0);
  });

  it('collision + raw-dump advisories merge into the single advisory key', async () => {
    const { tools } = makeWired(createWiki({ existing: [[PATH, 'en']], list: [{ id: 5, path: 'llm/alpha', locale: 'en', title: 'Alpha' }] }));
    const content = `preamble\n${fenceBlock(31)}\ntrailer`;
    const out = await run(tools.historian_page_create, { path: PATH, title: 'Alpha', content, twin: false });
    expect(out.ok).toBe(true);
    const advisory = String(out.advisory);
    expect(advisory).toContain('path exists');
    expect(advisory).toContain('疑似重复');
    expect(advisory).toContain(dumpAdvisory(31));
  });
});

// --- historian_page_update ---------------------------------------------------

// --- create pre-write checklist gate (v4 todo 4) ------------------------------

import { checklistAdvisory } from '../src/tools/shared.js';
import { scoreChecklist } from '../src/migrate-score.js';

const THIN_DRAFT = '# Alpha\nbody';

describe('checklistAdvisory (pure)', () => {
  it('≥3 failing items → 自检 N/10 advisory naming them, marked 不阻断', () => {
    // Given: a G1 (事件页) draft failing items 1,3,5,6 (measured: 4 fails)
    const out = checklistAdvisory('G1', THIN_DRAFT);
    // Then: count + item names + non-blocking wording, all present
    expect(out).not.toBeNull();
    expect(out).toContain('自检 4/10 未通过');
    expect(out).toContain('#1 导言占比 10–15%');
    expect(out).toContain('#3 表格判据');
    expect(out).toContain('(不阻断, 发布前请补齐)');
  });

  it('≤2 failing items → null (the gate stays quiet below the trigger)', () => {
    expect(checklistAdvisory('G4', THIN_DRAFT)).toBeNull();
    expect(checklistAdvisory('G3', THIN_DRAFT)).toBeNull();
  });

  it('post-write items 9-10 are deferred by contract and NEVER counted as fail', () => {
    for (const genre of ['G1', 'G2', 'G3', 'G4', 'G5'] as const) {
      const failedIds = scoreChecklist(genre, THIN_DRAFT)
        .filter((v) => v.verdict === 'fail')
        .map((v) => v.id);
      expect(failedIds).not.toContain(9);
      expect(failedIds).not.toContain(10);
    }
    const out = checklistAdvisory('G1', THIN_DRAFT);
    expect(out).not.toContain('#9');
    expect(out).not.toContain('#10');
  });

  it('degenerate drafts never throw', () => {
    for (const draft of ['', '#', '   ', '|a|b|\n|---|---|\n|1|2|', '中文内容。'.repeat(30)]) {
      const out = checklistAdvisory('G2', draft);
      expect(out === null || typeof out === 'string').toBe(true);
    }
  });
});

describe('historian_page_create checklist gate (envelope)', () => {
  it('thin draft with genre G1: advisory rides the success envelope, write still performed', async () => {
    // Given: an empty wiki
    const { tools, captured, fetchCount } = makeWired(createWiki());

    // When: creating a thin G3 draft (4 gate fails ≥ trigger 3)
    const out = await run(tools.historian_page_create, {
      path: PATH,
      title: 'Alpha',
      content: THIN_DRAFT,
      genre: 'G1',
      twin: false,
    });

    // Then: the page WAS created and the envelope carries the advisory
    expect(out.ok).toBe(true);
    expect(out.pageId).toBe(76);
    expect(String(out.advisory)).toContain('自检 4/10 未通过');
    expect(varsOf(captured, 'create(').length).toBe(1);
    expect(fetchCount()).toBe(4);
  });

  it('default classification (no genre arg) leaves the thin draft under the trigger: no advisory key', async () => {
    // Given / When: same thin draft, genre inferred (G4 → 2 fails ≤ 2 trigger)
    const { tools } = makeWired(createWiki());
    const out = await run(tools.historian_page_create, {
      path: PATH,
      title: 'Alpha',
      content: THIN_DRAFT,
      twin: false,
    });

    // Then: the key is omitted entirely
    expect(out.ok).toBe(true);
    expect('advisory' in out).toBe(false);
  });

  it('evidence tier is exempt: a failing draft stays silent (raw material is not a genre page)', async () => {
    // Given / When: G1 thin draft forced onto the evidence tier
    const { tools } = makeWired(createWiki());
    const out = await run(tools.historian_page_create, {
      path: '_evidence/run-9',
      title: 'Gate',
      content: THIN_DRAFT,
      genre: 'G1',
      tier: 'evidence',
    });

    // Then: machine-tier note present, checklist advisory absent
    expect(out.ok).toBe(true);
    expect(out.note).toBe(MACHINE_NOTE);
    expect('advisory' in out).toBe(false);
  });

  it('template mode never scores: zero writes, no advisory key', async () => {
    // Given / When: no content, genre G3 — the lifted genre resolution feeds the
    // skeleton, the checklist gate does not run on a skeleton with no draft
    const { tools, fetchCount } = makeWired(createWiki());
    const out = await run(tools.historian_page_create, { path: PATH, title: 'Alpha', genre: 'G3' });

    // Then: pure-local template envelope, unchanged
    expect(out.mode).toBe('template');
    expect(out.genre).toBe('G3');
    expect('advisory' in out).toBe(false);
    expect(fetchCount()).toBe(0);
  });

  it('collision + dump + checklist advisories merge into ONE advisory string', async () => {
    // Given: path already exists, a foreign page shares the title, and the
    // draft both over-fences and fails the gate (G3)
    const fence = '```text\n' + Array.from({ length: 31 }, (_, i) => `line ${i + 1}`).join('\n') + '\n```';
    const { tools } = makeWired(
      createWiki({
        existing: [[PATH, 'en']],
        list: [{ id: 5, path: 'llm/alpha', locale: 'en', title: 'Alpha' }],
      }),
    );
    const out = await run(tools.historian_page_create, {
      path: PATH,
      title: 'Alpha',
      content: `# Alpha\n${fence}`,
      genre: 'G1',
      twin: false,
    });

    // Then: ok stays true and all three hints share one key
    expect(out.ok).toBe(true);
    expect(String(out.advisory)).toContain('path exists');
    expect(String(out.advisory)).toContain('疑似重复');
    expect(String(out.advisory)).toContain('fenced block');
    expect(String(out.advisory)).toContain('自检');
  });
});

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

  it('hand-built ToolDeps without translate: append reports zhStatus missing (engine no-translate branch)', async () => {
    // Given: zh missing and a translate-less ToolDeps built by hand (no longer
    // a buildTools mode since the no-deps fix — buildTools always wires one)
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
    const { client } = makeClient(r.fetchImpl);
    const bareDeps: ToolDeps = { getClient: () => client, options: OPTS, homeDir: makeKeyHome() };
    const tools = { historian_page_append: makeAppendTool(bareDeps) };

    // When: appending en with no sectionZh
    const out = await run(tools.historian_page_append, { path: PATH, section: '## New' });

    // Then: primary append succeeded; zh reported missing with a hint
    expect(out.ok).toBe(true);
    expect(out.zhStatus).toBe('missing');
    expect(typeof out.zhNote).toBe('string');
    expect(varsOf(r.captured, 'create(').length).toBe(0);
    expect(r.fetchCount()).toBe(5);
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

  it('no-deps buildTools wires a live translator through globalThis.fetch (the production plugin path)', async () => {
    // Given: buildTools with ZERO injected deps (exactly what the plugin entry
    // does at runtime) and a stub global fetch answering the Anthropic
    // messages endpoint
    const original = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = (async (input: unknown): Promise<Response> => {
      requested.push(String(input));
      return jsonResponse({ content: [{ type: 'text', text: '译:Hello' }] });
    }) as typeof fetch;
    try {
      const tools = buildTools(OPTS, {});
      // When: translating without any dep injection
      const out = await run(tools.historian_translate_snippet, { text: 'Hello' });
      // Then: a real engine call produced the text — never the not-wired envelope
      expect(out.ok).toBe(true);
      expect(out.translated).toBe('译:Hello');
      expect(requested.length).toBe(1);
      expect(requested[0]).toContain('/v1/messages');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('defensive: hand-built ToolDeps without translate still yields the not-wired envelope', async () => {
    // Given: a ToolDeps assembled with no translator (only reachable by direct
    // construction — buildTools now always wires one)
    const bareDeps: ToolDeps = {
      getClient: () => {
        throw new Error('unexpected client');
      },
      options: OPTS,
      homeDir: makeKeyHome(),
    };
    const snippet = makeTranslateSnippetTool(bareDeps);
    // When: translating
    const out = await run(snippet, { text: 'Hello' });

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

  it('timeline aggregates mirror rows by ISO week with days window, prefix filter and url footer', async () => {
    // Given: a mirror with a fresh en+zh twin pair, a stale row and an
    // out-of-section row; fetch fails loudly, so only the mirror is read.
    const home = makeKeyHome();
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    const now = Date.now();
    const row = (id: number, locale: string, path: string, agoDays: number): Record<string, unknown> => ({
      id,
      locale,
      path,
      title: '502 故障复盘',
      updatedAt: new Date(now - agoDays * 86_400_000).toISOString(),
      url: `http://localhost:3000/en/${path}`,
      twinUrl: null,
      twinId: null,
    });
    writeFileSync(
      join(home, '.config', 'opencode', 'historian-map.json'),
      `${JSON.stringify({
        generatedAt: new Date(now).toISOString(),
        rows: [
          row(76, 'en', PATH, 0.1),
          row(77, 'zh', PATH, 0.2),
          row(78, 'en', 'ops/stale', 40),
          row(79, 'en', 'other/zone', 0.3),
        ],
        stats: { rows: 4, paths: 4, perLocale: { en: 3, zh: 1 }, missingTwinPaths: [] },
      })}\n`,
      'utf8',
    );
    const { tools, fetchCount } = makeWired({}, undefined, home);

    // When: asking for the last day of updates in the docs section
    const out = await run(tools.historian_map, { action: 'timeline', days: 1, path: 'docs' });

    // Then: only the fresh in-section twins remain, zh+en distinct, dual form,
    // bilingual cache urls echoed, zero network touched.
    expect(out.ok).toBe(true);
    expect(out.action).toBe('timeline');
    expect(out.rows).toBe(2);
    const weeks = out.weeks as Array<{ week: string; items: Array<Record<string, unknown>> }>;
    expect(weeks.flatMap((w) => w.items.map((i) => i.locale))).toEqual(['en', 'zh']);
    expect((out.markdown as string)).toContain('| 日期 | 章节 | 路径 | 标题 | 页型 |');
    expect((out.markdown as string)).toContain('G1');
    expect(out.urls).toEqual({
      en: 'http://localhost:3000/en/_meta/page-map',
      zh: 'http://localhost:3000/zh/_meta/page-map',
    });
    expect(fetchCount()).toBe(0);
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
  const DRAFT = '## Final\n\ndrafted.';

  it('apply=true runs the full engine: reformat + backup + per-locale upsert + checkpoint', async () => {
    // Given: existing en+zh pages, mock translator, writable tmp home + results dir
    const home = makeKeyHome();
    const resultsDir = mkdtempSync(join(tmpdir(), 'tools-migrate-'));
    const { tools, captured, fetchCount } = makeMigrateWired(
      {
        'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? zhPage() : rawPage() } } }),
        'single(': (vars) => ({ data: { pages: { single: vars.id === 998 ? zhPage() : rawPage() } } }),
        'update(': () => ({ data: { pages: { update: RESP_OK } } }),
      },
      DRAFT,
      async (t: string) => TWIN_TEXT(t),
      home,
      resultsDir,
    );

    // When: applying
    const out = await run(tools.historian_migrate, { path: PATH, apply: true });

    // Then: applied entries, backup + checkpoint persisted, URL mandate honored
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('apply');
    expect(out.applied).toHaveLength(2);
    expect(out.applied[0]).toMatchObject({ locale: 'en', action: 'updated' });
    expect(out.applied[0].urls).toEqual({ en: EN_URL, zh: ZH_URL });
    expect(out.backupPath).toContain('pilot-backup-docs-');
    const updates = captured.filter((c) => c.query.includes('update('));
    expect(updates).toHaveLength(2);
    expect(updates.map((c) => c.variables.content)).toEqual([DRAFT, TWIN_TEXT(DRAFT)]);
    const cp = JSON.parse(readFileSync(join(home, '.config', 'opencode', 'historian-migrate.json'), 'utf8')) as {
      paths: Record<string, unknown>;
    };
    expect(cp.paths[PATH]).toBeDefined();
    expect(fetchCount()).toBeGreaterThan(2);
  });

  it('dry-run (no apply): echoes content, suggests an explicit genre, previews the checklist on the draft', async () => {
    // Given: an existing legacy page without a zh twin
    const { tools, fetchCount } = makeMigrateWired({
      'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? null : rawPage() } } }),
    }, DRAFT);

    // When: running the dry-run with an explicit genre
    const out = await run(tools.historian_migrate, { path: PATH, genre: 'G4' });

    // Then: nothing is written; the preview carries genre, full content echo and the LLM draft
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('dry-run');
    expect(out.suggestedGenre).toBe('G4');
    expect(out.confidence).toBe('explicit');
    expect(out.content).toBe('# Alpha\nbody');
    expect(out.draft).toBe(DRAFT);
    expect(out.alreadyConforms).toBe(false);
    expect(out.missingTwin).toBe(true);
    expect((out.checklist as unknown[]).length).toBe(10);
    expect((out.checklistResults as unknown[]).length).toBe(10);
    expect(out.urls).toEqual({ en: EN_URL, zh: ZH_URL });
    expect(fetchCount()).toBe(3);
  });

  it('dry-run without a genre classifies the page via the engine', async () => {
    // Given: an existing legacy page (with its zh twin)
    const { tools } = makeMigrateWired({
      'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? zhPage() : rawPage() } } }),
    }, DRAFT);

    // When: running the dry-run with no explicit genre
    const out = await run(tools.historian_migrate, { path: PATH });

    // Then: the genre matches the engine classifier on the same input
    const expected = classifyGenre({ title: 'Alpha', body: '# Alpha\nbody' });
    expect(out.suggestedGenre).toBe(expected.genre);
    expect(out.signals).toEqual(expected.signals);
    expect(out.missingTwin).toBe(false);
  });

  it('dry-run on a missing page returns a PageNotFoundError envelope', async () => {
    // Given: page does not exist in en or zh
    const { tools, fetchCount } = makeMigrateWired({
      'singleByPath(': () => ({ errors: [{ message: 'This page does not exist.' }] }),
    }, DRAFT);

    // When: running the dry-run
    const out = await run(tools.historian_migrate, { path: PATH });

    // Then: structured not-found envelope; exactly one probe per locale (en, then zh); no LLM call
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('PageNotFoundError');
    expect(fetchCount()).toBe(2);
  });

  it('wraps a PathValidationError from the engine in the uniform error envelope (no raw throw)', async () => {
    // Given: a migrate-wired toolset (engine reachable)
    const { tools } = makeMigrateWired({}, DRAFT);

    // When: migrating a reserved-path page (zh/ prefix)
    const raw = await tools.historian_migrate.execute({ path: 'zh/evil' } as never, {} as never);
    const text = typeof raw === 'string' ? raw : String((raw as { output: string }).output);
    const out = JSON.parse(text) as Record<string, unknown>;

    // Then: structured envelope, not a thrown error
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('PathValidationError');
    expect(typeof out.actionableHint).toBe('string');
    expect(text).not.toMatch(/\n\s*at /);
  });

  it('wraps an HttpError from the transport in the uniform error envelope (no raw throw)', async () => {
    // Given: a fetchImpl that always rejects with HttpError
    const fetchImpl = (async () => {
      throw new HttpError('network down', 0, '', 'http://localhost:3000/api');
    }) as typeof fetch;
    const tools = buildTools(OPTS, { fetchImpl, homeDir: makeKeyHome() });

    // When: running migrate (any valid path)
    const raw = await tools.historian_migrate.execute({ path: PATH } as never, {} as never);
    const text = typeof raw === 'string' ? raw : String((raw as { output: string }).output);
    const out = JSON.parse(text) as Record<string, unknown>;

    // Then: structured envelope with HttpError kind, no stack trace
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('HttpError');
    expect(typeof out.actionableHint).toBe('string');
    expect(text).not.toMatch(/\n\s*at /);
  });
});

// --- evidence tier + internal namespace guards (v3 todo 4) -------------------

const MACHINE_NOTE = 'machine-tier page; anonymous visits 404 by design';

describe('evidence tier + internal namespace guards', () => {
  it('front regression: default-tier create payload and envelope are byte-for-byte 0.2.0', async () => {
    // Given: a wiki that answers the en create + its authoritative lookup
    const { tools, captured, fetchCount } = makeWired(createWiki());

    // When: creating on the front tier with NO tier argument (today's call shape)
    const out = await run(tools.historian_page_create, {
      path: PATH,
      title: 'Alpha',
      content: '# Alpha\nbody',
      tags: ['t1'],
      twin: false,
    });

    // Then: the create client payload is EXACTLY the 0.2.0 shape — no extra
    // fields, no note key, isPrivate still false — and the envelope matches
    // today's key set verbatim (this is the characterization baseline:
    // captured against current code, must stay green after the tier change).
    expect(out).toEqual({
      ok: true,
      mode: 'create',
      path: PATH,
      locale: 'en',
      pageId: 76,
      twinStatus: 'skipped',
      urls: { en: EN_URL, zh: ZH_URL },
    });
    expect(varsOf(captured, 'create(')).toEqual([
      {
        path: PATH,
        locale: 'en',
        title: 'Alpha',
        content: '# Alpha\nbody',
        description: '',
        editor: 'markdown',
        isPublished: true,
        isPrivate: false,
        tags: ['t1'],
      },
    ]);
    expect(fetchCount()).toBe(4);
  });

  it('rejects tier evidence + front path docs/foo before any fetch', async () => {
    // Given: fetch spy that fails loudly
    const { tools, fetchCount } = makeWired({});

    // When: creating with an explicit evidence tier on a normal path
    const out = await run(tools.historian_page_create, {
      path: 'docs/foo',
      title: 'T',
      content: 'c',
      tier: 'evidence',
    });

    // Then: structured mismatch envelope, zero network
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('TierPathMismatchError');
    expect(String(out.message)).toContain('docs/foo');
    expect(typeof out.actionableHint).toBe('string');
    expect(fetchCount()).toBe(0);
  });

  it('rejects tier evidence + front path results/bar on append before any fetch', async () => {
    // Given: fetch spy that fails loudly
    const { tools, fetchCount } = makeWired({});

    // When: appending with an explicit evidence tier on a normal path
    const out = await run(tools.historian_page_append, {
      path: 'results/bar',
      section: '## x',
      tier: 'evidence',
    });

    // Then: mismatch envelope, zero network
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('TierPathMismatchError');
    expect(String(out.message)).toContain('results/bar');
    expect(fetchCount()).toBe(0);
  });

  it('rejects tier front + internal path _meta/page-map before any fetch', async () => {
    // Given: fetch spy that fails loudly
    const { tools, fetchCount } = makeWired({});

    // When: creating on the front tier against the machine namespace
    const out = await run(tools.historian_page_create, {
      path: '_meta/page-map',
      title: 'T',
      content: 'c',
      tier: 'front',
    });

    // Then: mismatch envelope, zero network
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('TierPathMismatchError');
    expect(String(out.message)).toContain('_meta');
    expect(fetchCount()).toBe(0);
  });

  it('rejects tier front + internal path _evidence/x on append before any fetch', async () => {
    // Given: fetch spy that fails loudly
    const { tools, fetchCount } = makeWired({});

    // When: appending on the front tier against the evidence namespace
    const out = await run(tools.historian_page_append, {
      path: '_evidence/x',
      section: '## x',
      tier: 'front',
    });

    // Then: mismatch envelope, zero network
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('TierPathMismatchError');
    expect(String(out.message)).toContain('_evidence');
    expect(fetchCount()).toBe(0);
  });

  it('evidence create carries the machine flags and never calls twin create', async () => {
    // Given: a wiki answering the en create + lookup
    const { tools, captured, fetchCount } = makeWired(createWiki());

    // When: creating with tier evidence while explicitly ASKING for the human
    // defaults (isPublished/twin true) — the tier must override them
    const out = await run(tools.historian_page_create, {
      path: '_evidence/run-1',
      title: 'Gate',
      content: 'body',
      tags: ['gate'],
      isPublished: true,
      twin: true,
      tier: 'evidence',
    });

    // Then: exactly one create — unpublished, private, tagged 'evidence', no twin
    const creates = varsOf(captured, 'create(');
    expect(creates.length).toBe(1);
    expect(creates[0].isPublished).toBe(false);
    expect(creates[0].isPrivate).toBe(true);
    expect(creates[0].tags).toEqual(['gate', 'evidence']);
    expect(out.twinStatus).toBe('skipped');
    expect(fetchCount()).toBe(4);
  });

  it('evidence create with locale zh hints the monolingual invariant and still creates as en', async () => {
    // Given: a wiki answering the en create + lookup
    const { tools, captured, fetchCount } = makeWired(createWiki());

    // When: passing locale:'zh' with tier evidence — spec says hint, never throw
    const out = await run(tools.historian_page_create, {
      path: '_evidence/run-2',
      title: 'Gate',
      content: 'body',
      locale: 'zh',
      tier: 'evidence',
    });

    // Then: the page was created as en and the envelope explains why
    expect(out.ok).toBe(true);
    expect(out.locale).toBe('en');
    expect(varsOf(captured, 'create(')[0].locale).toBe('en');
    expect(String(out.localeHint)).toContain('monolingual');
    expect(fetchCount()).toBe(4);
  });

  it('front append with a missing twin and wired translator bootstraps the twin (positive control)', async () => {
    // Given: zh missing, translator SPY wired — without this control the
    // evidence spy=0 assertion below would be a trivial false-green
    let spyCalls = 0;
    let zhCreated = false;
    const translate = async (text: string): Promise<string> => {
      spyCalls++;
      return TWIN_TEXT(text);
    };
    const { tools } = makeWired(
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

    // When: appending to a front en page without a zh twin
    const out = await run(tools.historian_page_append, { path: PATH, section: '## New' });

    // Then: the translator was exercised and the twin was created
    expect(out.zhStatus).toBe('created');
    expect(spyCalls).toBeGreaterThanOrEqual(1);
  });

  it('evidence append skips twin bootstrap even with the translator wired (spy=0)', async () => {
    // Given: the SAME translate-wired fixture shape as the positive control,
    // but the path lives in the internal namespace (tier inferred)
    let spyCalls = 0;
    let zhSeen = false;
    const translate = async (text: string): Promise<string> => {
      spyCalls++;
      return TWIN_TEXT(text);
    };
    const { tools, captured } = makeWired(
      {
        'singleByPath(': (vars) => {
          if (vars.locale !== 'zh') {
            return { data: { pages: { singleByPath: rawPage({ path: '_evidence/run-9' }) } } };
          }
          zhSeen = true;
          return { data: { pages: { singleByPath: null } } };
        },
        'single(': () => ({ data: { pages: { single: rawPage({ path: '_evidence/run-9' }) } } }),
        'update(': (vars) => ({
          data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } },
        }),
        'create(': () => ({ data: { pages: { create: RESP_OK } } }),
      },
      translate,
    );

    // When: appending to an _evidence page with NO explicit tier (inference rule)
    const out = await run(tools.historian_page_append, { path: '_evidence/run-9', section: '## gate' });

    // Then: primary append stands; no zh read, no bootstrap, zero translator calls
    expect(out.ok).toBe(true);
    expect(out.zhStatus).toBe('skipped');
    expect(spyCalls).toBe(0);
    expect(zhSeen).toBe(false);
    expect(varsOf(captured, 'create(').length).toBe(0);
  });

  it('evidence success envelopes (create + append) carry the machine-tier note', async () => {
    // Given: an evidence-capable wiki for both tools
    const { tools: createTools } = makeWired(createWiki());
    const { tools: appendTools } = makeWired({
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage({ path: '_evidence/n2' }) } } }),
      'single(': () => ({ data: { pages: { single: rawPage({ path: '_evidence/n2' }) } } }),
      'update(': (vars) => ({
        data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } },
      }),
    });

    // When: creating AND appending on the evidence tier
    const created = await run(createTools.historian_page_create, {
      path: '_evidence/n1',
      title: 'Gate',
      content: 'body',
      tier: 'evidence',
    });
    const appended = await run(appendTools.historian_page_append, {
      path: '_evidence/n2',
      section: '## x',
      tier: 'evidence',
    });

    // Then: both envelopes carry the plan-mandated note verbatim
    expect(created.note).toBe(MACHINE_NOTE);
    expect(appended.note).toBe(MACHINE_NOTE);
  });
});

// --- front-tier raw-dump soft gate (v3 todo 6) --------------------------------

/** A fenced block with EXACTLY `lines` lines strictly inside the ``` fence. */
const fenceBlock = (lines: number): string =>
  '```text\n' + Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join('\n') + '\n```';

/** Independent literal pin of the SYN-16 advisory wording (do not derive from
 *  the implementation — this is the contract the agent reads). */
const dumpAdvisory = (n: number): string =>
  `content contains a ${n}-line fenced block; per contract, move raw material to a ` +
  'tier:"evidence" page under _evidence/ and link it from the human page (SYN-16)';

describe('front-tier raw-dump soft gate', () => {
  it('clean front create: envelope key set unchanged, no advisory key', async () => {
    // Given: the standard front create wiki (byte-for-byte 0.2.0 fixture)
    const { tools } = makeWired(createWiki());

    // When: creating with short, fence-free content
    const out = await run(tools.historian_page_create, {
      path: PATH,
      title: 'Alpha',
      content: '# Alpha\nbody',
      tags: ['t1'],
      twin: false,
    });

    // Then: EXACTLY the pre-gate key set — the advisory key is omitted, not undefined
    expect(out).toEqual({
      ok: true,
      mode: 'create',
      path: PATH,
      locale: 'en',
      pageId: 76,
      twinStatus: 'skipped',
      urls: { en: EN_URL, zh: ZH_URL },
    });
  });

  it('front create with a 31-line fence: advisory present naming the count, write still performed', async () => {
    // Given: the same front create wiki
    const { tools, captured } = makeWired(createWiki());

    // When: creating with a fenced block just OVER the 30-line soft limit
    const content = `preamble\n${fenceBlock(31)}\ntrailer`;
    const out = await run(tools.historian_page_create, { path: PATH, title: 'Alpha', content, twin: false });

    // Then: ok stays true, the create WAS written, and the advisory is verbatim
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('create');
    expect(out.advisory).toBe(dumpAdvisory(31));
    expect(varsOf(captured, 'create(').length).toBe(1);
  });

  it('front create with an exactly-30-line fence: at the limit, no advisory', async () => {
    // Given: the same front create wiki
    const { tools } = makeWired(createWiki());

    // When: creating at the boundary (30 inside lines ≤ limit)
    const out = await run(tools.historian_page_create, {
      path: PATH,
      title: 'Alpha',
      content: fenceBlock(30),
      twin: false,
    });

    // Then: the key is absent entirely
    expect(out.ok).toBe(true);
    expect('advisory' in out).toBe(false);
  });

  it('evidence tier is NEVER checked: create AND inferred-path append with a 40-line fence stay silent', async () => {
    // Given: an evidence-capable wiki for create and append. The inventory
    // carries a FRONT page with the exact title 'Raw': if the evidence tier
    // leaked into the collision soft check, the create envelope would grow a
    // 疑似重复 advisory — raw dumps are the evidence tier's PURPOSE.
    const { tools: createTools } = makeWired(
      createWiki({ list: [{ id: 5, path: 'llm/alpha', locale: 'en', title: 'Raw' }] }),
    );
    const { tools: appendTools } = makeWired({
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage({ path: '_evidence/dump-2' }) } } }),
      'single(': () => ({ data: { pages: { single: rawPage({ path: '_evidence/dump-2' }) } } }),
      'update(': (vars) => ({
        data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } },
      }),
    });

    // When: creating with tier:"evidence" and appending WITHOUT any tier argument
    // (the _evidence/ path prefix must infer evidence) — both with 40-line fences
    const created = await run(createTools.historian_page_create, {
      path: '_evidence/dump-1',
      title: 'Raw',
      content: fenceBlock(40),
      tier: 'evidence',
    });
    const appended = await run(appendTools.historian_page_append, {
      path: '_evidence/dump-2',
      section: fenceBlock(40),
    });

    // Then: raw dumps are the evidence tier's PURPOSE — never advisories
    expect(created.ok).toBe(true);
    expect('advisory' in created).toBe(false);
    expect(appended.ok).toBe(true);
    expect(appended.zhStatus).toBe('skipped');
    expect('advisory' in appended).toBe(false);
  });

  it('page_update with a 31-line fence on a front page: advisory present', async () => {
    // Given: a front page the update tool can read + write
    const { tools } = makeWired({
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage() } } }),
      'single(': () => ({ data: { pages: { single: rawPage() } } }),
      'update(': (vars) => ({
        data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } },
      }),
    });

    // When: pushing full replacement content carrying a 31-line fence
    const out = await run(tools.historian_page_update, { path: PATH, content: fenceBlock(31) });

    // Then: the soft gate speaks (no tier argument exists on update — path inference)
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('update');
    expect(out.advisory).toBe(dumpAdvisory(31));
  });

  it('page_update with a 31-line fence on an _evidence/ page: stays silent', async () => {
    // Given: an existing machine-namespace page
    const { tools } = makeWired({
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage({ path: '_evidence/dump-3' }) } } }),
      'single(': () => ({ data: { pages: { single: rawPage({ path: '_evidence/dump-3' }) } } }),
      'update(': (vars) => ({
        data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } },
      }),
    });

    // When: updating it with the same 31-line fence content
    const out = await run(tools.historian_page_update, { path: '_evidence/dump-3', content: fenceBlock(31) });

    // Then: evidence stays unchecked on the update path too
    expect(out.ok).toBe(true);
    expect('advisory' in out).toBe(false);
  });
});
// --- options.sections enforcement (v4 todo 5) ---------------------------------

import { ConfigError, sectionGuard } from '../src/tools/shared.js';
import type { HistorianOptions } from '../src/config.js';

describe('sectionGuard (pure)', () => {
  it('undefined or empty allow-list = allow-all (the documented default)', () => {
    expect(sectionGuard('llm/anything', undefined)).toBeNull();
    expect(sectionGuard('llm/anything', [])).toBeNull();
    expect(sectionGuard('llm/anything', ['  '])).toBeNull();
  });

  it('matching section (exact or nested prefix) → allowed', () => {
    expect(sectionGuard('docs', ['docs'])).toBeNull();
    expect(sectionGuard('docs/guide/x', ['docs'])).toBeNull();
  });

  it('entries are normalized: surrounding slashes/whitespace are tolerated', () => {
    expect(sectionGuard('llm/a', ['llm/'])).toBeNull();
    expect(sectionGuard('infra/b', [' infra '])).toBeNull();
  });

  it('non-matching first segment → violation string naming segment + allow-list', () => {
    const out = sectionGuard('llm/notes', ['docs', 'ops']);
    expect(out).not.toBeNull();
    expect(out).toContain("section 'llm'");
    expect(out).toContain('docs, ops');
    expect(out).toContain('sections');
  });

  it('prefix match is SEGMENT-wise: section "doc" does not authorize "docs/x"', () => {
    expect(sectionGuard('docs/x', ['doc'])).not.toBeNull();
  });

  it('system paths stay exempt even under a restrictive allow-list', () => {
    for (const p of ['home', 'wiki-index', '_sandbox/probe', '_data/blob', '_meta/page-map', '_evidence/run-1']) {
      expect(sectionGuard(p, ['docs'])).toBeNull();
    }
  });

  it('dirty paths never crash the guard', () => {
    for (const p of ['', '..', '/home', 'HOME/x', '///', './x', 'docs/']) {
      const out = sectionGuard(p, ['docs']);
      expect(out === null || typeof out === 'string').toBe(true);
    }
    expect(sectionGuard('HOME/x', ['home'])).not.toBeNull();
  });

  it('ConfigError carries the routed name for errEnvelope', () => {
    const err = new ConfigError('boom');
    expect(err.name).toBe('ConfigError');
    expect(err).toBeInstanceOf(Error);
  });
});

/** Wired variant under an explicit sections allow-list. */
function makeWiredSections(
  sections: readonly string[],
  handlers: Record<string, (vars: Record<string, unknown>, query: string) => unknown>,
): { tools: Tools; captured: Captured[]; fetchCount: () => number } {
  const r = makeResponder(handlers);
  const tools = buildTools({ ...OPTS, sections }, { fetchImpl: r.fetchImpl, homeDir: makeKeyHome() });
  return { tools, captured: r.captured, fetchCount: r.fetchCount };
}

const expectRefused = (out: Record<string, unknown>, segment: string): void => {
  expect(out.ok).toBe(false);
  expect(out.errorKind).toBe('ConfigError');
  expect(String(out.message)).toContain(`section '${segment}'`);
  expect(String(out.actionableHint)).not.toBe('');
};

describe('historian_page_create sections enforcement', () => {
  it('path outside the allow-list → ConfigError envelope, ZERO fetches, nothing written', async () => {
    // Given: only docs/* may be written
    const { tools, fetchCount } = makeWiredSections(['docs'], createWiki());

    // When: creating under llm/
    const out = await run(tools.historian_page_create, {
      path: 'llm/notes',
      title: 'N',
      content: '# N\nbody',
      twin: false,
    });

    // Then: refused before the wiki was contacted
    expectRefused(out, 'llm');
    expect(fetchCount()).toBe(0);
  });

  it('violation refuses BOTH locales and template mode too (path-level rule)', async () => {
    const { tools, fetchCount } = makeWiredSections(['docs'], createWiki());
    const zh = await run(tools.historian_page_create, {
      path: 'llm/notes',
      title: 'N',
      content: '# N\n正文',
      locale: 'zh',
    });
    const tmpl = await run(tools.historian_page_create, { path: 'llm/notes', title: 'N' });
    expectRefused(zh, 'llm');
    expectRefused(tmpl, 'llm');
    expect(fetchCount()).toBe(0);
  });

  it('allowed section writes proceed untouched; system paths pass even when restrictive', async () => {
    // Given: docs-only wiki
    const { tools } = makeWiredSections(['docs'], createWiki());

    // When / Then: a docs page creates normally…
    const ok = await run(tools.historian_page_create, {
      path: 'docs/guide',
      title: 'G',
      content: '# G\nbody',
      twin: false,
    });
    expect(ok.ok).toBe(true);
    expect(ok.mode).toBe('create');

    // …and each exempt surface passes the guard (the create below reaches the
    // wiki; only the guard outcome is under test — non-ConfigError = passed)
    const exempt = await run(tools.historian_page_create, {
      path: '_sandbox/probe',
      title: 'S',
      content: 'x',
      twin: false,
    });
    expect(exempt.errorKind).not.toBe('ConfigError');
  });
});

describe('sections enforcement on update / append / move / delete', () => {
  it('page_update on a disallowed path refuses before any read', async () => {
    const { tools, fetchCount } = makeWiredSections(['docs'], createWiki());
    const out = await run(tools.historian_page_update, { path: 'llm/notes', content: 'x' });
    expectRefused(out, 'llm');
    expect(fetchCount()).toBe(0);
  });

  it('page_append on a disallowed path refuses before any read', async () => {
    const { tools, fetchCount } = makeWiredSections(['docs'], createWiki());
    const out = await run(tools.historian_page_append, { path: 'llm/notes', section: '## x' });
    expectRefused(out, 'llm');
    expect(fetchCount()).toBe(0);
  });

  it('page_move checks the TARGET path: forbidden destination refuses, allowed destination proceeds', async () => {
    const { tools, fetchCount } = makeWiredSections(['docs'], createWiki());

    // Destination outside the allow-list → refused, zero fetches
    const bad = await run(tools.historian_move, {
      path: 'docs/src',
      locale: 'en',
      newPath: 'llm/dst',
      confirm: 'yes',
    });
    expectRefused(bad, 'llm');
    expect(fetchCount()).toBe(0);

    // Allowed destination → guard silent (the disallowed SOURCE is not the
    // guard's business; the request reaches the fake wiki)
    const moveHandlers: Record<string, () => unknown> = {
      'singleByPath(': () => ({ data: { pages: { singleByPath: null } } }),
      'single(': () => ({ data: { pages: { single: null } } }),
    };
    const passThrough = makeWiredSections(['docs'], {
      ...moveHandlers,
      'move(': () => ({ errors: [{ message: 'fixture: move never completes' }] }),
    });
    const far = await run(passThrough.tools.historian_move, {
      path: 'llm/src',
      locale: 'en',
      newPath: 'docs/dst',
      confirm: 'yes',
    });
    expect(far.errorKind).not.toBe('ConfigError');
  });

  it('delete refuses a disallowed path, but the confirm gate still precedes everything', async () => {
    const { tools, fetchCount } = makeWiredSections(['docs'], createWiki());

    // Without confirm → the pre-existing refusal wins (zero fetches either way)
    const noConfirm = await run(tools.historian_delete, { path: 'llm/notes', locale: 'en', confirm: 'no' });
    expect(noConfirm.errorKind).toBe('ConfirmRequiredError');

    const out = await run(tools.historian_delete, { path: 'llm/notes', locale: 'en', confirm: 'yes' });
    expectRefused(out, 'llm');
    expect(fetchCount()).toBe(0);
  });

  it('default options (empty sections) stay allow-all: llm/* creates', async () => {
    // Given: OPTS ships sections: [] — the whole pre-v4 behaviour must not drift
    const { tools } = makeWired(createWiki());
    const out = await run(tools.historian_page_create, {
      path: 'llm/free',
      title: 'F',
      content: '# F\nbody',
      twin: false,
    });
    expect(out.ok).toBe(true);
  });
});

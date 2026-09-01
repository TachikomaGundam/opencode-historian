/**
 * Unit tests for src/wiki/pages.ts — page read/create/update/append/move/
 * delete/search operations encoding the wiki.js API pitfalls:
 *
 *   #1 update wipes omitted fields      → full read-modify-write payload
 *   #2 tags required on update          → always echoed from the read
 *   #4 empty content rejected pre-flight→ ContentEmptyError
 *   #5 path change requires move op     → move mutation, not update
 *   #8 create response id unreliable    → authoritative id from readPage
 *   #9 locale-shaped path / always pass locale → explicit path+locale vars
 *
 * Every request is mocked (network-free). Bodies are captured and dispatched
 * by fragment on the query text ('singleByPath(', 'single(', 'create(',
 * 'update(', 'move(', 'delete(', 'search('). An unknown query shape throws —
 * the suite fails loudly instead of asserting on garbage.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  readPage,
  createPage,
  updatePage,
  appendSection,
  movePage,
  deletePage,
  searchPages,
  ContentEmptyError,
  ConfirmRequiredError,
  PageNotFoundError,
} from '../src/wiki/pages.js';
import type { PageRecord, TranslateFn } from '../src/wiki/pages.js';
import { GraphQLError } from '../src/wiki/client.js';
import { PathValidationError } from '../src/wiki/locale.js';
import { makeClient, jsonResponse, OPTS } from './client-fixtures.js';

const PATH = '_sandbox/qa06-unit/alpha';

const RESP_OK = { responseResult: { succeeded: true, errorCode: 0, slug: '', message: '' } };

/** Live wiki.js Page shape (introspection-verified field names). */
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
    tags: [{ tag: 't1' }, { tag: 't2' }],
    publishStartDate: '',
    publishEndDate: '',
    scriptCss: '',
    scriptJs: '',
    editor: 'markdown',
    createdAt: '2026-09-01T06:05:58.555Z',
    updatedAt: '2026-09-01T06:05:58.555Z',
    ...over,
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
    if (fragment === undefined) throw new Error(`pages.test: unhandled query ${body.query}`);
    return jsonResponse(handlers[fragment](body.variables ?? {}, body.query));
  }) as typeof fetch;
  return { fetchImpl, captured, fetchCount: () => count };
}

function varsOf(captured: Captured[], fragment: string): Record<string, unknown>[] {
  return captured.filter((c) => c.query.includes(fragment)).map((c) => c.variables);
}

function expectPair(pair: { path: string; locale: string; url: string; twinLocale: string; twinUrl: string }) {
  expect(pair.path).toBe(PATH);
  expect(pair.locale).toBe('en');
  expect(pair.url).toBe(`http://localhost:3000/en/${PATH}`);
  expect(pair.twinLocale).toBe('zh');
  expect(pair.twinUrl).toBe(`http://localhost:3000/zh/${PATH}`);
}

// --- readPage ---------------------------------------------------------------

describe('readPage', () => {
  it('returns a full PageRecord via singleByPath with explicit path+locale', async () => {
    // Given: a live-shaped page under pages.singleByPath
    const { fetchImpl, captured } = makeResponder({
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage() } } }),
    });
    const { client } = makeClient(fetchImpl);

    // When: reading the page at (path, locale)
    const page = await readPage(client, PATH, 'en');

    // Then: the lookup carried explicit path + locale (pitfall #9); the record
    // maps tags to plain strings and preserves all live fields.
    expect(captured[0].variables).toEqual({ path: PATH, locale: 'en' });
    expect(page).not.toBeNull();
    const p = page as PageRecord;
    expect(p.id).toBe(76);
    expect(p.title).toBe('Alpha');
    expect(p.content).toBe('# Alpha\nbody');
    expect(p.locale).toBe('en');
    expect(p.isPublished).toBe(true);
    expect(p.isPrivate).toBe(false);
    expect(p.contentType).toBe('markdown');
    expect(p.tags).toEqual(['t1', 't2']);
    expect(p.createdAt).toBe('2026-09-01T06:05:58.555Z');
  });

  it('returns null when the server reports "This page does not exist."', async () => {
    // Given: top-level GraphQL error for a missing page (live-verified wording)
    const { fetchImpl } = makeResponder({
      'singleByPath(': () => ({ errors: [{ message: 'This page does not exist.' }] }),
    });
    const { client } = makeClient(fetchImpl);

    // When: reading a nonexistent page
    const page = await readPage(client, PATH, 'en');

    // Then: null, not an exception (the contract for "missing" is a null read)
    expect(page).toBeNull();
  });

  it('rethrows GraphQL errors that are not "does not exist"', async () => {
    // Given: an unrelated server-side error
    const { fetchImpl } = makeResponder({
      'singleByPath(': () => ({ errors: [{ message: 'Cannot query field "bogus" on type "Page"' }] }),
    });
    const { client } = makeClient(fetchImpl);

    // When: reading with a broken selection
    const err = await readPage(client, PATH, 'en').then(
      () => null,
      (e: Error) => e,
    );

    // Then: the GraphQLError surfaces (never treated as "missing")
    expect(err).toBeInstanceOf(GraphQLError);
    expect((err as GraphQLError).rawErrors[0].message).toContain('Cannot query field');
  });

  it('rejects an invalid path before any fetch (PathValidationError)', async () => {
    // Given: a responder that fails loudly if called
    const { fetchImpl, fetchCount } = makeResponder({});
    const { client } = makeClient(fetchImpl);

    // When: reading with a locale-shaped first segment
    const err = await readPage(client, 'zh/evil', 'en').then(
      () => null,
      (e: Error) => e,
    );

    // Then: validation error and zero network traffic
    expect(err).toBeInstanceOf(PathValidationError);
    expect(fetchCount()).toBe(0);
  });
});

// --- createPage -------------------------------------------------------------

describe('createPage', () => {
  it('creates primary + twin (title translated too), id from lookup not response', async () => {
    // Given: create responses advertise a WRONG id (pitfall #8: unreliable);
    // lookups return the authoritative ids. zh page mirrors a translated twin.
    const zhPage = rawPage({ id: 77, locale: 'zh', title: 'zh:Alpha', content: 'zh:# Alpha\nbody' });
    const translate: TranslateFn = vi.fn(async (text) => `zh:${text}`);
    const { fetchImpl, captured } = makeResponder({
      'create(': (vars) => ({
        data: {
          pages: { create: { ...RESP_OK, page: { id: vars.locale === 'zh' ? 998 : 999, path: vars.path, locale: vars.locale } } },
        },
      }),
      'singleByPath(': (vars) => ({
        data: { pages: { singleByPath: vars.locale === 'zh' ? zhPage : rawPage() } },
      }),
    });
    const { client } = makeClient(fetchImpl);

    // When: creating with a wired translator and twin enabled (default)
    const result = await createPage(
      { client, options: OPTS, translate },
      { path: PATH, locale: 'en', title: 'Alpha', content: '# Alpha\nbody' },
    );

    // Then: TWO creates + TWO lookups, ordered primary → lookup → twin → twin lookup
    expect(captured).toHaveLength(4);
    expect(captured[1].query).toContain('singleByPath(');
    const creates = varsOf(captured, 'create(');
    expect(creates).toHaveLength(2);
    // pitfall #8: pageId comes from the LOOKUP (76), not the create response (999)
    expect(result.pageId).toBe(76);
    expect(result.twinStatus).toBe('created');
    expect(result.twinId).toBe(77);
    // defaults: tags [] and isPublished true, description ''
    expect(creates[0]).toMatchObject({
      path: PATH,
      locale: 'en',
      title: 'Alpha',
      description: '',
      editor: 'markdown',
      isPublished: true,
      isPrivate: false,
      tags: [],
    });
    // twin uses the SAME path/tags but per-locale translated title AND content
    const twinVars = creates[1];
    expect(twinVars.locale).toBe('zh');
    expect(twinVars.title).toBe('zh:Alpha');
    expect(twinVars.content).toBe('zh:# Alpha\nbody');
    expect(twinVars.path).toBe(PATH);
    expect(twinVars.tags).toEqual([]);
    expect(translate).toHaveBeenNthCalledWith(1, 'Alpha', 'en', 'zh');
    expect(translate).toHaveBeenNthCalledWith(2, '# Alpha\nbody', 'en', 'zh');
    // D2 contract: both URLs embedded in the result
    expectPair(result);
  });

  it('fails the twin without failing the primary when the translator throws', async () => {
    // Given: a translator that hard-fails on its first call
    const translate: TranslateFn = vi.fn(async () => {
      throw new Error('translation service down');
    });
    const { fetchImpl, captured } = makeResponder({
      'create(': (vars) => ({ data: { pages: { create: { ...RESP_OK, page: { id: 999, path: vars.path, locale: vars.locale } } } } }),
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage() } } }),
    });
    const { client } = makeClient(fetchImpl);

    // When: twin translation blows up mid-create
    const result = await createPage(
      { client, options: OPTS, translate },
      { path: PATH, locale: 'en', title: 'Alpha', content: '# Alpha\nbody' },
    );

    // Then: the PRIMARY result is still returned as success, twin is pending
    expect(result.pageId).toBe(76);
    expect(result.twinStatus).toBe('pending');
    expect(result.twinReason).toContain('translation service down');
    expect(captured).toHaveLength(2); // create + lookup only — no twin mutation
    expect(varsOf(captured, 'create(')).toHaveLength(1);
    expectPair(result);
  });

  it('reports twinStatus pending with translator-not-wired when no translator', async () => {
    // Given: deps without a translator
    const { fetchImpl, captured } = makeResponder({
      'create(': (vars) => ({ data: { pages: { create: { ...RESP_OK, page: { id: 999, path: vars.path, locale: vars.locale } } } } }),
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage() } } }),
    });
    const { client } = makeClient(fetchImpl);

    // When: creating with twin enabled but no translate fn wired
    const result = await createPage({ client, options: OPTS }, { path: PATH, locale: 'en', title: 'Alpha', content: '# Alpha\nbody' });

    // Then: pending + translator-not-wired, one create, NO throw
    expect(result.twinStatus).toBe('pending');
    expect(result.twinReason).toBe('translator-not-wired');
    expect(result.pageId).toBe(76);
    expect(captured).toHaveLength(2);
    expectPair(result);
  });

  it('skips the twin entirely when twin:false', async () => {
    // Given: twin explicitly disabled
    const { fetchImpl, captured } = makeResponder({
      'create(': (vars) => ({ data: { pages: { create: { ...RESP_OK, page: { id: 999, path: vars.path, locale: vars.locale } } } } }),
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage() } } }),
    });
    const { client } = makeClient(fetchImpl);

    // When: creating with twin:false
    const result = await createPage(
      { client, options: OPTS, translate: (async (t) => `zh:${t}`) as TranslateFn },
      { path: PATH, locale: 'en', title: 'Alpha', content: '# Alpha\nbody', twin: false },
    );

    // Then: exactly one create, skipped status, no twinId
    expect(result.twinStatus).toBe('skipped');
    expect(result.twinId).toBeUndefined();
    expect(captured).toHaveLength(2);
    expect(varsOf(captured, 'create(')).toHaveLength(1);
    expectPair(result);
  });

  it('throws ContentEmptyError for whitespace-only content with zero fetches', async () => {
    // Given: a responder that fails loudly if called
    const { fetchImpl, fetchCount } = makeResponder({});
    const { client } = makeClient(fetchImpl);

    // When: creating a page whose content is only whitespace
    const err = await createPage(
      { client, options: OPTS },
      { path: PATH, locale: 'en', title: 'Alpha', content: '   ' },
    ).then(
      () => null,
      (e: Error) => e,
    );

    // Then: pitfall #4 pre-checked locally — ContentEmptyError, no HTTP traffic
    expect(err).toBeInstanceOf(ContentEmptyError);
    expect(fetchCount()).toBe(0);
  });
});

// --- updatePage -------------------------------------------------------------

describe('updatePage', () => {
  const settled = {
    id: 42,
    title: 'Old Title',
    content: 'Old content',
    description: 'Old desc',
    tags: [{ tag: 'a' }, { tag: 'b' }],
    publishStartDate: '2026-01-01T00:00:00.000Z',
    publishEndDate: '',
    scriptCss: 'h1{}',
    scriptJs: '',
  };

  function updateHarness(overrides: Record<string, unknown> = {}) {
    const fresh = rawPage({ ...settled, ...overrides });
    const { fetchImpl, captured } = makeResponder({
      'single(': () => ({ data: { pages: { single: rawPage(settled) } } }),
      'update(': (vars) => {
        Object.assign(fresh, {
          title: vars.title,
          content: vars.content,
          description: vars.description,
          tags: (vars.tags as string[]).map((t) => ({ tag: t })),
          publishStartDate: vars.publishStartDate,
          scriptCss: vars.scriptCss,
        });
        return { data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } } };
      },
      'singleByPath(': () => ({ data: { pages: { singleByPath: fresh } } }),
    });
    const { client } = makeClient(fetchImpl);
    return { fetchImpl, captured, fresh, client };
  }

  it('sends the FULL mutable field set on update — omitted fields echoed from the read (pitfall #1)', async () => {
    // Given: a page with publish dates and scripts set; harness captures the update
    const { captured, client } = updateHarness();

    // When: patching only title + content (no publishStartDate, no scriptCss)
    const result = await updatePage({ client, options: OPTS }, 42, { title: 'New Title', content: 'New content' });

    // Then: the captured update variables STILL CARRY every mutable field from the read
    const vars = varsOf(captured, 'update(')[0];
    const mutable = [
      'content', 'description', 'editor', 'isPrivate', 'isPublished', 'locale', 'path',
      'publishEndDate', 'publishStartDate', 'scriptCss', 'scriptJs', 'tags', 'title',
    ];
    for (const key of mutable) expect(vars).toHaveProperty(key);
    expect(vars.publishStartDate).toBe('2026-01-01T00:00:00.000Z');
    expect(vars.scriptCss).toBe('h1{}');
    expect(vars.publishEndDate).toBe('');
    expect(vars.scriptJs).toBe('');
    expect(vars.description).toBe('Old desc');
    expect(vars.editor).toBe('markdown');
    expect(vars.isPublished).toBe(true);
    expect(vars.isPrivate).toBe(false);
    expect(vars.locale).toBe('en');
    expect(vars.path).toBe(PATH);
    expect(vars.title).toBe('New Title');
    expect(vars.content).toBe('New content');
    // D2 contract on the result
    expectPair(result);
    expect(result.pageId).toBe(42);
  });

  it('echoes the old tags when the patch omits tags (pitfall #2)', async () => {
    // Given: same settled page; harness captures the update
    const { captured, client } = updateHarness();

    // When: updating without a tags key
    await updatePage({ client, options: OPTS }, 42, { title: 'New Title' });

    // Then: vars.tags carries the read's tags — never omitted
    expect(varsOf(captured, 'update(')[0].tags).toEqual(['a', 'b']);
  });

  it('returns pair + pageId + fresh echo when patch wins', async () => {
    // Given: harness whose echo reflects merged state
    const { captured, client } = updateHarness();

    // When: updating title, content and tags
    const result = await updatePage({ client, options: OPTS }, 42, { title: 'New Title', content: 'New content', tags: ['x'] });

    // Then: the update carried the patched values and the echo shows them
    expect(varsOf(captured, 'update(')[0].tags).toEqual(['x']);
    expect(result.page.title).toBe('New Title');
    expect(result.page.content).toBe('New content');
    expect(result.page.tags).toEqual(['x']);
  });

  it('throws PageNotFoundError when the read returns "does not exist"', async () => {
    // Given: single(id) answering with a missing-page GraphQL error
    const { fetchImpl } = makeResponder({
      'single(': () => ({ errors: [{ message: 'This page does not exist.' }] }),
    });
    const { client } = makeClient(fetchImpl);

    // When: updating a nonexistent id
    const err = await updatePage({ client, options: OPTS }, 4040, { title: 'Nope' }).then(
      () => null,
      (e: Error) => e,
    );

    // Then: typed PageNotFoundError, never a raw GraphQLError
    expect(err).toBeInstanceOf(PageNotFoundError);
  });
});

// --- appendSection ----------------------------------------------------------

describe('appendSection', () => {
  it('appends via read → update with content + \\n\\n + section', async () => {
    // Given: existing page with content; harness captures update vars and echoes
    const fresh = rawPage({ id: 42, content: 'Old content' });
    const { fetchImpl, captured } = makeResponder({
      'singleByPath(': () => ({ data: { pages: { singleByPath: fresh } } }),
      'single(': () => ({ data: { pages: { single: rawPage({ id: 42, content: 'Old content' }) } } }),
      'update(': (vars) => {
        Object.assign(fresh, { content: vars.content });
        return { data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } } };
      },
    });
    const { client } = makeClient(fetchImpl);

    // When: appending a section
    const result = await appendSection({ client, options: OPTS }, PATH, 'en', '## Later');

    // Then: update content = old + blank line + section; result echoes it
    expect(varsOf(captured, 'update(')[0].content).toBe('Old content\n\n## Later');
    expect(result.page.content).toBe('Old content\n\n## Later');
    expect(result.pageId).toBe(42);
  });

  it('throws PageNotFoundError when the source page is missing', async () => {
    // Given: read reports the source page missing
    const noPageFetch = (async () => jsonResponse({ errors: [{ message: 'This page does not exist.' }] })) as typeof fetch;
    const { client } = makeClient(noPageFetch);

    // When: appending to a missing page
    const err = await appendSection({ client, options: OPTS }, PATH, 'en', '## Later').then(
      () => null,
      (e: Error) => e,
    );

    // Then: PageNotFoundError
    expect(err).toBeInstanceOf(PageNotFoundError);
  });
});

// --- movePage / deletePage --------------------------------------------------

describe('movePage & deletePage', () => {
  it('throw ConfirmRequiredError for a non-yes confirm with ZERO fetches', async () => {
    // Given: a responder that fails loudly on any traffic
    const { fetchImpl, fetchCount } = makeResponder({});
    const { client } = makeClient(fetchImpl);

    // When: moving/deleting without the exact confirm value
    const moveErr = await movePage({ client, options: OPTS }, PATH, 'en', 'qa06-new/target', undefined, 'no').then(
      () => null,
      (e: Error) => e,
    );
    const deleteErr = await deletePage({ client, options: OPTS }, PATH, 'en', 'nope').then(
      () => null,
      (e: Error) => e,
    );

    // Then: gate fires before any network traffic
    expect(moveErr).toBeInstanceOf(ConfirmRequiredError);
    expect(deleteErr).toBeInstanceOf(ConfirmRequiredError);
    expect(fetchCount()).toBe(0);
  });

  it('moves via the move mutation (not update), destination vars + new-path pair', async () => {
    // Given: source page readable; move succeeded
    const { fetchImpl, captured } = makeResponder({
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage() } } }),
      'move(': () => ({ data: { pages: { move: RESP_OK } } }),
    });
    const { client } = makeClient(fetchImpl);

    // When: moving with confirm:yes and an explicit destination locale
    const result = await movePage({ client, options: OPTS }, PATH, 'en', 'qa06-new/target', 'zh', 'yes');

    // Then: the mutation is pages.move — never update (pitfall #5)
    const moveQuery = captured[1].query;
    expect(moveQuery).toContain('move(');
    expect(moveQuery).not.toContain('update(');
    expect(captured[1].variables).toEqual({ id: 76, destinationPath: 'qa06-new/target', destinationLocale: 'zh' });
    // pair reflects the DESTINATION path/locale
    expect(result.path).toBe('qa06-new/target');
    expect(result.locale).toBe('zh');
    expect(result.url).toBe('http://localhost:3000/zh/qa06-new/target');
    expect(result.twinUrl).toBe('http://localhost:3000/en/qa06-new/target');
    expect(result.pageId).toBe(76);
  });

  it('deletes by the id resolved from the read', async () => {
    // Given: source page readable; delete succeeded
    const { fetchImpl, captured } = makeResponder({
      'singleByPath(': () => ({ data: { pages: { singleByPath: rawPage() } } }),
      'delete(': () => ({ data: { pages: { delete: RESP_OK } } }),
    });
    const { client } = makeClient(fetchImpl);

    // When: deleting with confirm:yes
    const result = await deletePage({ client, options: OPTS }, PATH, 'en', 'yes');

    // Then: id resolved from the read (76), pair on the deleted path
    expect(captured[1].query).toContain('delete(');
    expect(captured[1].variables).toEqual({ id: 76 });
    expectPair(result);
    expect(result.pageId).toBe(76);
  });

  it('throws PageNotFoundError when moving/deleting a missing page', async () => {
    // Given: read reports the page missing
    const noPageFetch = (async () => jsonResponse({ errors: [{ message: 'This page does not exist.' }] })) as typeof fetch;
    const { client } = makeClient(noPageFetch);

    // When: moving with a valid confirm but no source page
    const err = await movePage({ client, options: OPTS }, PATH, 'en', 'qa06-new/target', undefined, 'yes').then(
      () => null,
      (e: Error) => e,
    );

    // Then: PageNotFoundError, not a raw GraphQLError
    expect(err).toBeInstanceOf(PageNotFoundError);
  });
});

// --- searchPages ------------------------------------------------------------

describe('searchPages', () => {
  it('passes query/path/locale vars through and returns results with locale untouched', async () => {
    // Given: search results that carry a per-result locale
    const { fetchImpl, captured } = makeResponder({
      'search(': () => ({
        data: {
          pages: {
            search: {
              results: [{ id: '1', title: 'Hit', description: 'd', path: '_sandbox/x', locale: 'en' }],
              suggestions: [],
              totalHits: 1,
            },
          },
        },
      }),
    });
    const { client } = makeClient(fetchImpl);

    // When: searching with a scoped path + locale
    const result = await searchPages(client, 'alpha', { path: '_sandbox', locale: 'zh' });

    // Then: vars forwarded verbatim; response passthrough keeps locale
    expect(captured[0].variables).toEqual({ query: 'alpha', path: '_sandbox', locale: 'zh' });
    expect(result.totalHits).toBe(1);
    expect(result.results[0].locale).toBe('en');
    expect(result.results[0].title).toBe('Hit');
  });

  it('sends null scopes when options are omitted', async () => {
    // Given: a minimal search responder
    const { fetchImpl, captured } = makeResponder({
      'search(': () => ({ data: { pages: { search: { results: [], suggestions: [], totalHits: 0 } } } }),
    });
    const { client } = makeClient(fetchImpl);

    // When: searching without scope options
    const result = await searchPages(client, 'alpha');

    // Then: path/locale are explicitly null in the variables
    expect(captured[0].variables).toEqual({ query: 'alpha', path: null, locale: null });
    expect(result.results).toEqual([]);
  });
});
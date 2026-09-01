import { describe, it, expect } from 'vitest';
import {
  createClient,
  gql,
  HttpError,
  GraphQLError,
  WikiError,
  PermissionError,
} from '../src/wiki/client.js';
import { ConfigError } from '../src/config.js';
import {
  OPTS,
  KEY,
  URL,
  makeClient,
  makeBareHome,
  jsonResponse,
  catchError,
  expectNoKeyLeak,
} from './client-fixtures.js';

// Every case runs against an injected fake fetchImpl — no network. `KEY` is
// synthetic; expectNoKeyLeak pins the log-leak guard (a buggy implementation
// that echoes the Authorization value into errors fails here).

describe('gql happy path', () => {
  it('POSTs to {baseUrl}/graphql with bearer auth and returns data for a plain query', async () => {
    // Given
    let capturedUrl: RequestInfo | URL | undefined;
    let capturedInit: RequestInit | undefined;
    const data = { pages: { list: [{ id: 1, path: 'x', locale: 'en' }] } };
    const { client, key } = makeClient((url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return Promise.resolve(jsonResponse({ data }));
    });
    const query =
      'query Pages($locale: String) { pages { list(locale: $locale) { id path locale } } }';
    // When
    const out = await gql<typeof data>(client, query, { locale: 'en' });
    // Then
    expect(capturedUrl).toBe(URL);
    expect(capturedInit?.method).toBe('POST');
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers.authorization).toBe(`Bearer ${key}`);
    expect(JSON.parse(String(capturedInit?.body))).toEqual({ query, variables: { locale: 'en' } });
    expect(out).toEqual(data);
  });

  it('returns data as-is when the responseResult wrapper reports succeeded: true', async () => {
    // Given
    const data = { pages: { create: { responseResult: { succeeded: true } } } };
    const { client } = makeClient(() => Promise.resolve(jsonResponse({ data })));
    // When
    const out = await gql<unknown>(client, 'mutation { pages { create } }', {});
    // Then
    expect(out).toEqual(data);
  });

  it('defaults timeoutMs to 30_000 and keeps the key off the client object', () => {
    // Given
    const { client } = makeClient(() => Promise.resolve(jsonResponse({ data: {} })));
    // Then
    expect(client.timeoutMs).toBe(30_000);
    expect(Object.keys(client).sort()).toEqual(['baseUrl', 'fetchImpl', 'timeoutMs']);
    expect(JSON.stringify(client)).not.toContain(KEY);
  });
});

describe('gql HTTP layer', () => {
  it('classifies HTTP 500 as HttpError carrying status, url and body snippet', async () => {
    // Given
    const { client } = makeClient(() =>
      Promise.resolve(new Response('server exploded', { status: 500 })),
    );
    // When
    const err = await catchError(gql(client, 'query { x }', {}));
    // Then
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(500);
    expect((err as HttpError).url).toBe(URL);
    expect((err as HttpError).bodySnippet).toBe('server exploded');
    expect(err.message).toContain('500');
    expectNoKeyLeak(err);
  });

  it('classifies HTTP 401 as PermissionError', async () => {
    // Given
    const { client } = makeClient(() =>
      Promise.resolve(new Response('{"message":"unauthorized"}', { status: 401 })),
    );
    // When
    const err = await catchError(gql(client, 'query { x }', {}));
    // Then
    expect(err).toBeInstanceOf(PermissionError);
    expect(err).toBeInstanceOf(WikiError);
    expect((err as PermissionError).errorCode).toBe('http-401');
    expect(err.message).toContain('401');
    expectNoKeyLeak(err);
  });

  it('classifies HTTP 403 as PermissionError named per plan R-b contract', async () => {
    // Given
    const { client } = makeClient(() =>
      Promise.resolve(new Response('<html><body>Forbidden</body></html>', { status: 403 })),
    );
    // When
    const err = await catchError(gql(client, 'query { x }', {}));
    // Then
    expect(err).toBeInstanceOf(PermissionError);
    expect((err as PermissionError).errorCode).toBe('http-403');
    expect(err.message).toContain('403');
    expect(err.message).toContain(URL);
    expectNoKeyLeak(err);
  });
});

describe('gql body layer', () => {
  it('classifies a non-JSON body (HTML error page) as HttpError with snippet', async () => {
    // Given
    const { client } = makeClient(() =>
      Promise.resolve(new Response('<html><body>Not Found</body></html>', { status: 200 })),
    );
    // When
    const err = await catchError(gql(client, 'query { x }', {}));
    // Then
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(200);
    expect((err as HttpError).bodySnippet).toContain('<html>');
    expect(err.message).toBe('non-json response');
    expectNoKeyLeak(err);
  });

  it('classifies a top-level errors array as GraphQLError with rawErrors', async () => {
    // Given
    const body = { errors: [{ message: 'Cannot query field "foo"', path: ['pages'] }] };
    const { client } = makeClient(() => Promise.resolve(jsonResponse(body)));
    // When
    const err = await catchError(gql(client, 'query { x }', {}));
    // Then
    expect(err).toBeInstanceOf(GraphQLError);
    expect(err.message).toContain('Cannot query field "foo"');
    expect((err as GraphQLError).rawErrors).toEqual([
      { message: 'Cannot query field "foo"', path: ['pages'] },
    ]);
    expectNoKeyLeak(err);
  });
});

describe('gql payload layer (wiki.js responseResult convention, pitfall #3)', () => {
  it('maps responseResult.succeeded=false with errorCode content.empty to WikiError fields', async () => {
    // Given
    const body = {
      data: {
        pages: {
          single: {
            responseResult: {
              succeeded: false,
              errorCode: 'content.empty',
              slug: 'foo',
              message: 'Page content cannot be empty',
            },
          },
        },
      },
    };
    const { client } = makeClient(() => Promise.resolve(jsonResponse(body)));
    // When
    const err = await catchError(gql(client, 'query { x }', {}));
    // Then
    expect(err).toBeInstanceOf(WikiError);
    expect(err).not.toBeInstanceOf(PermissionError);
    expect((err as WikiError).errorCode).toBe('content.empty');
    expect((err as WikiError).slug).toBe('foo');
    expect((err as WikiError).message).toBe('Page content cannot be empty');
    expectNoKeyLeak(err);
  });

  it('maps a permission-ish payload message to PermissionError', async () => {
    // Given
    const body = {
      data: {
        pages: {
          move: {
            responseResult: {
              succeeded: false,
              errorCode: 'not.authorized',
              slug: 'foo',
              message: 'you do not have permission to move this page',
            },
          },
        },
      },
    };
    const { client } = makeClient(() => Promise.resolve(jsonResponse(body)));
    // When
    const err = await catchError(gql(client, 'query { x }', {}));
    // Then
    expect(err).toBeInstanceOf(PermissionError);
    expect(err).toBeInstanceOf(WikiError);
    expect((err as PermissionError).errorCode).toBe('not.authorized');
    expect((err as PermissionError).message).toBe('you do not have permission to move this page');
    expectNoKeyLeak(err);
  });

  it('also detects the flat `data.<root>.responseResult` wrapper shape', async () => {
    // Given
    const body = {
      data: {
        pages: {
          responseResult: {
            succeeded: false,
            errorCode: 'page.move.forbidden',
            slug: 'x',
            message: 'forbidden by page rules',
          },
        },
      },
    };
    const { client } = makeClient(() => Promise.resolve(jsonResponse(body)));
    // When
    const err = await catchError(gql(client, 'query { x }', {}));
    // Then
    expect(err).toBeInstanceOf(PermissionError);
    expect((err as PermissionError).errorCode).toBe('page.move.forbidden');
  });
});

describe('gql transport layer', () => {
  it('classifies an abort-signal timeout as HttpError naming the timeout', async () => {
    // Given
    const timeoutMs = 40;
    const { client } = makeClient(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation was aborted', 'AbortError')),
          );
        }),
      { timeoutMs },
    );
    // When
    const err = await catchError(gql(client, 'query { x }', {}));
    // Then
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(0);
    expect(err.message).toContain(String(timeoutMs));
    expect(err.message).toContain('timed out');
    expectNoKeyLeak(err);
  });
});

describe('secret never leaks (adversarial: log leak)', () => {
  it('redacts the key when an HTML 500 body echoes it', async () => {
    // Given
    const { client } = makeClient(() =>
      Promise.resolve(new Response(`<html>Unauthorized Bearer ${KEY}</html>`, { status: 500 })),
    );
    // When
    const err = await catchError(gql(client, 'query { x }', {}));
    // Then
    expect(err).toBeInstanceOf(HttpError);
    expectNoKeyLeak(err);
  });

  it('redacts the key when a GraphQL error message echoes it', async () => {
    // Given
    const { client } = makeClient(() =>
      Promise.resolve(jsonResponse({ errors: [{ message: `token rejected: ${KEY}` }] })),
    );
    // When
    const err = await catchError(gql(client, 'query { x }', {}));
    // Then
    expect(err).toBeInstanceOf(GraphQLError);
    expect((err as GraphQLError).rawErrors[0]?.message).not.toContain(KEY);
    expectNoKeyLeak(err);
  });
});

describe('createClient key resolution', () => {
  it('resolves the key eagerly and propagates ConfigError when no key exists', () => {
    // Given: an empty home dir with no key file and no env var
    // When / Then
    expect(() =>
      createClient(OPTS, {
        fetchImpl: () => Promise.resolve(jsonResponse({ data: {} })),
        env: {},
        homeDir: makeBareHome(),
      }),
    ).toThrow(ConfigError);
  });
});
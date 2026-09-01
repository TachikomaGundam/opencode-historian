/**
 * wiki.js GraphQL client with three-layer error discrimination.
 *
 * Every failure from `gql` surfaces as one of four named, structured errors —
 * never a raw fetch/parse exception:
 *
 *   1. HTTP status outside 2xx          -> HttpError (401/403 -> PermissionError)
 *   2. Body that is not parseable JSON  -> HttpError ('non-json response')
 *   3. Top-level GraphQL `errors[]`     -> GraphQLError
 *   4. Payload `responseResult.succeeded === false` -> WikiError (permission-ish
 *      errorCode/message -> PermissionError, the class the plan's R-b contract
 *      refers to). The responseResult lookup is field-name agnostic: wiki.js
 *      wraps every pages.* operation's result key, so we inspect the first key
 *      of `data` (pitfall #3).
 *
 * The api key is resolved eagerly at createClient time (ConfigError
 * propagates) and retained in a module-private WeakMap — never an enumerable
 * client field, never embedded in any thrown message (bodies are redacted
 * before they become snippets or GraphQL error text).
 *
 * The responseResult lookup is field-name agnostic — the operation name is
 * never hardcoded. Two nesting shapes occur: the live instance nests it as
 * `data.pages.<op>.responseResult` (PageMutation -> PageResponse), and a flat
 * variant sits as `data.<root-field>.responseResult`. Both are covered.
 */

import { readWikiApiKey, type HistorianOptions } from '../config.js';
import { isRecord } from '../jsonc.js';

export const DEFAULT_TIMEOUT_MS = 30_000;

// --- Error taxonomy ---------------------------------------------------------

export interface RawGraphQLError {
  readonly message: string;
  readonly path?: readonly (string | number)[];
}

/** Transport/parse-layer failure: non-2xx status, unparseable or malformed
 *  bodies, timeouts (status 0 = no HTTP response was received). */
export class HttpError extends Error {
  readonly status: number;
  readonly bodySnippet: string;
  readonly url: string;

  constructor(message: string, status: number, bodySnippet: string, url: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.bodySnippet = bodySnippet;
    this.url = url;
  }
}

/** GraphQL-layer failure: the server answered 2xx but reported errors[]. */
export class GraphQLError extends Error {
  readonly rawErrors: readonly RawGraphQLError[];

  constructor(message: string, rawErrors: readonly RawGraphQLError[]) {
    super(message);
    this.name = 'GraphQLError';
    this.rawErrors = rawErrors;
  }
}

/** Wiki.js payload-layer failure: responseResult.succeeded === false. */
export class WikiError extends Error {
  readonly errorCode: string;
  readonly slug: string;

  constructor(errorCode: string, slug: string, message: string) {
    super(message);
    this.name = 'WikiError';
    this.errorCode = errorCode;
    this.slug = slug;
  }
}

/** Permission failures from either layer — HTTP 401/403 or a permission-ish
 *  payload errorCode/message. Named per plan R-b (wiki token scope shortage). */
export class PermissionError extends WikiError {
  constructor(errorCode: string, slug: string, message: string) {
    super(errorCode, slug, message);
    this.name = 'PermissionError';
  }
}

// --- Client -----------------------------------------------------------------

export interface GqlClient {
  readonly baseUrl: string;
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
}

/** Api keys live here, keyed by client identity — never on the client object
 *  (which would make them enumerable/loggable) and never in messages. */
const keys = new WeakMap<GqlClient, string>();

export function createClient(
  options: HistorianOptions,
  deps?: {
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
  },
): GqlClient {
  const client: GqlClient = {
    baseUrl: options.baseUrl,
    fetchImpl: deps?.fetchImpl ?? fetch,
    timeoutMs: deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
  keys.set(client, readWikiApiKey(options, deps?.env, deps?.homeDir));
  return client;
}

// --- Helpers ----------------------------------------------------------------

const PERMISSION_PATTERN = /permission|forbidden|denied|unauthorized|not\.authorized|access/i;

function isAbortError(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    (err as { name?: unknown }).name === 'AbortError'
  );
}

function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Replaces the secret with a placeholder so body-derived text can never leak
 *  it into errors. Applied before any snippet or GraphQL message is built. */
function redact(text: string, key: string): string {
  return key === '' || !text.includes(key) ? text : text.split(key).join('<redacted>');
}

function snippetOf(text: string): string {
  const MAX = 200;
  return text.length <= MAX ? text : `${text.slice(0, MAX)}…`;
}

async function readTextSafely(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toRawError(value: unknown): RawGraphQLError {
  if (isRecord(value)) {
    const message = asString(value.message) || 'graphql error';
    const path = Array.isArray(value.path)
      ? value.path.filter(
          (p): p is string | number => typeof p === 'string' || typeof p === 'number',
        )
      : undefined;
    return path === undefined ? { message } : { message, path };
  }
  return { message: JSON.stringify(value) };
}

/** wiki.js wraps every pages.* operation result in a `responseResult` object
 *  (pitfall #3); the operation name varies, so neither the root field nor the
 *  operation field is hardcoded. Two nesting shapes are checked:
 *  `data.<root>.<op>.responseResult` (live instance: PageMutation ->
 *  PageResponse) and the flat `data.<root>.responseResult` wrapper. Plain
 *  query results (e.g. `data.pages.list` arrays) expose no responseResult and
 *  pass through untouched. */
function findResponseResult(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const firstKey = Object.keys(data)[0];
  if (firstKey === undefined) return undefined;
  const value = data[firstKey];
  if (!isRecord(value)) return undefined;

  // Shape 1: data.<root>.responseResult
  const direct = value.responseResult;
  if (isRecord(direct)) return direct;

  // Shape 2: data.<root>.<op>.responseResult
  const secondKey = Object.keys(value)[0];
  if (secondKey === undefined) return undefined;
  const nested = value[secondKey];
  if (!isRecord(nested)) return undefined;
  const viaNested = nested.responseResult;
  return isRecord(viaNested) ? viaNested : undefined;
}

function isPermissionish(errorCode: string, message: string): boolean {
  return PERMISSION_PATTERN.test(errorCode) || PERMISSION_PATTERN.test(message);
}

function transportFailure(err: unknown, key: string, url: string, timeoutMs: number): HttpError {
  if (isAbortError(err)) {
    return new HttpError(`graphql request to ${url} timed out after ${timeoutMs}ms`, 0, '', url);
  }
  return new HttpError(
    `graphql request to ${url} failed: ${redact(errorMessageOf(err), key)}`,
    0,
    '',
    url,
  );
}

// --- gql --------------------------------------------------------------------

export async function gql<T>(
  client: GqlClient,
  query: string,
  vars: Record<string, unknown>,
): Promise<T> {
  const url = `${client.baseUrl}/graphql`;
  const key = keys.get(client);
  if (key === undefined) {
    throw new Error('gql: client is not bound to a wiki api key (create it via createClient)');
  }

  let res: Response;
  try {
    res = await client.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query, variables: vars }),
      signal: AbortSignal.timeout(client.timeoutMs),
    });
  } catch (err) {
    throw transportFailure(err, key, url, client.timeoutMs);
  }

  const rawBody = redact(await readTextSafely(res), key);

  // Layer 1: HTTP status.
  if (res.status < 200 || res.status >= 300) {
    const snippet = snippetOf(rawBody);
    if (res.status === 401 || res.status === 403) {
      throw new PermissionError(
        `http-${res.status}`,
        '',
        `HTTP ${res.status} from ${url}: ${snippet === '' ? 'permission denied' : snippet}`,
      );
    }
    throw new HttpError(`HTTP ${res.status} from ${url}`, res.status, snippet, url);
  }

  // Layer 2: parseable JSON body.
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new HttpError('non-json response', res.status, snippetOf(rawBody), url);
  }
  if (!isRecord(parsed)) {
    throw new HttpError('response body is not a JSON object', res.status, snippetOf(rawBody), url);
  }

  // Layer 3: top-level GraphQL errors.
  const errors = parsed.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const rawErrors = errors.map(toRawError);
    throw new GraphQLError(
      rawErrors.map((e) => e.message).join(' | '),
      rawErrors,
    );
  }

  // Layer 4: wiki.js payload convention (pitfall #3).
  const data = parsed.data;
  if (!isRecord(data)) {
    throw new HttpError('response missing data field', res.status, snippetOf(rawBody), url);
  }
  const responseResult = findResponseResult(data);
  if (responseResult !== undefined && responseResult.succeeded === false) {
    const errorCode = asString(responseResult.errorCode);
    const slug = asString(responseResult.slug);
    const message = asString(responseResult.message);
    if (isPermissionish(errorCode, message)) {
      throw new PermissionError(errorCode, slug, message || `permission denied (${errorCode})`);
    }
    throw new WikiError(errorCode, slug, message || `operation failed (${errorCode})`);
  }

  return data as T;
}
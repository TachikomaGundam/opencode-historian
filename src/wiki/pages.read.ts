/**
 * Page READ operations (readPage, searchPages) + the shared page types.
 *
 * Split from pages.ts (write ops live in pages.write.ts) to keep every source
 * file under the 250-LOC ceiling. Field names are LIVE-INTROSPECTED on the
 * running wiki.js instance (anonymous __schema), never guessed:
 *
 *   - singleByPath(path, locale) — locale is REQUIRED (pitfall #9)
 *   - a missing page answers with a top-level GraphQL error whose message
 *     contains 'does not exist' (live-verified) → surfaced as a null read
 *   - Page.tag is a nested PageTag object { tag, ... } → mapped to strings
 */

import { gql, GraphQLError, type GqlClient } from './client.js';
import { normalizeLocale, validatePath } from './locale.js';

// --- Types ------------------------------------------------------------------

export type Locale = 'en' | 'zh';

/** Port for todo 8 (real translation engine); pages.write injects it. */
export type TranslateFn = (text: string, from: Locale, to: Locale) => Promise<string>;

export interface PageRecord {
  readonly id: number;
  readonly path: string;
  readonly locale: Locale;
  readonly title: string;
  readonly description: string;
  readonly content: string;
  readonly isPublished: boolean;
  readonly isPrivate: boolean;
  readonly contentType: string;
  readonly tags: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SearchOptions {
  readonly path?: string;
  readonly locale?: Locale;
}

export interface PageSearchResult {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly locale: string;
}

export interface PageSearchResponse {
  readonly results: readonly PageSearchResult[];
  readonly suggestions: readonly string[];
  readonly totalHits: number;
}

// --- GraphQL shapes (introspection-verified) --------------------------------

const READ_FIELDS =
  'id path locale title description content isPublished isPrivate contentType tags { tag } createdAt updatedAt';

const READ_QUERY = `query r($path: String!, $locale: String!) { pages { singleByPath(path: $path, locale: $locale) { ${READ_FIELDS} } } }`;
const SEARCH_QUERY = `query q($query: String!, $path: String, $locale: String) { pages { search(query: $query, path: $path, locale: $locale) { results { id title description path locale } suggestions totalHits } } }`;

// --- Raw→typed mapping (the boundary parse) ---------------------------------

interface RawPageShape {
  readonly id: unknown;
  readonly path: unknown;
  readonly locale: unknown;
  readonly title: unknown;
  readonly description: unknown;
  readonly content: unknown;
  readonly isPublished: unknown;
  readonly isPrivate: unknown;
  readonly contentType: unknown;
  readonly tags: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function bool(v: unknown): boolean {
  return v === true;
}

export function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(str(v));
}

/** PageTag { tag, ... } → plain string[] (live read type nests tags). */
export function mapTags(v: unknown): readonly string[] {
  if (!Array.isArray(v)) return [];
  return v.map((t) => {
    if (t !== null && typeof t === 'object' && 'tag' in (t as Record<string, unknown>)) {
      return str((t as Record<string, unknown>).tag);
    }
    return str(t);
  });
}

export function mapPage(raw: RawPageShape): PageRecord {
  return {
    id: num(raw.id),
    path: str(raw.path),
    locale: normalizeLocale(str(raw.locale)),
    title: str(raw.title),
    description: str(raw.description),
    content: str(raw.content),
    isPublished: bool(raw.isPublished),
    isPrivate: bool(raw.isPrivate),
    contentType: str(raw.contentType),
    tags: mapTags(raw.tags),
    createdAt: str(raw.createdAt),
    updatedAt: str(raw.updatedAt),
  };
}

// --- readPage ---------------------------------------------------------------

/** Read a page by (path, locale). A missing page — wiki.js answers with a
 *  top-level GraphQL error containing 'does not exist' — is a null read;
 *  every other failure rethrows as-is. */
export async function readPage(client: GqlClient, path: string, locale: Locale): Promise<PageRecord | null> {
  validatePath(path);
  try {
    const data = await gql<{ pages: { singleByPath: RawPageShape | null } }>(client, READ_QUERY, {
      path,
      locale,
    });
    return data.pages.singleByPath === null ? null : mapPage(data.pages.singleByPath);
  } catch (err) {
    if (err instanceof GraphQLError && err.message.includes('does not exist')) return null;
    throw err;
  }
}

// --- searchPages ------------------------------------------------------------

/** Pass-through of pages.search — the response already carries a per-result
 *  locale and the gql layer leaves it untouched. */
export async function searchPages(client: GqlClient, query: string, opts?: SearchOptions): Promise<PageSearchResponse> {
  const data = await gql<{ pages: { search: PageSearchResponse } }>(client, SEARCH_QUERY, {
    query,
    path: opts?.path ?? null,
    locale: opts?.locale ?? null,
  });
  return data.pages.search;
}
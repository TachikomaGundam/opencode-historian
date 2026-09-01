/**
 * Page WRITE operations: create (with optional twin), update (full
 * read-modify-write), append, move, delete.
 *
 * Split from pages.ts (read ops + shared types live in pages.read.ts) to keep
 * every source file under the 250-LOC ceiling. Field names are LIVE-
 * INTROSPECTED on the running wiki.js instance, never guessed. Pitfalls this
 * module encodes:
 *
 *   #1 update() wipes any field the payload omits → every mutable field is
 *      echoed from the read and merged with the patch
 *   #2 tags is required on update → always present in the payload
 *   #4 create() rejects empty content → pre-checked client-side
 *   #5 path moves go through move(id, destinationPath, destinationLocale),
 *      never update(path:)
 *   #8 create()'s response id is unreliable → authoritative id always comes
 *      from a follow-up readPage lookup
 *   live mutation fields are scriptCss/scriptJs (not styleCss/styleJs)
 *   live mutation RESPONSES crash on page.locale ('Cannot return null for
 *   non-nullable field Page.locale.' — wiki.js 2.5.314) while the side effect
 *   still commits; the selection is therefore page { id path } and the
 *   authoritative full state always comes from a readPage lookup
 */

import { gql, GraphQLError, type GqlClient } from './client.js';
import { assertLocalePair, normalizeLocale, validatePath, type LocalePair } from './locale.js';
import type { HistorianOptions } from '../config.js';
import { str, num, bool, mapTags, readPage, type Locale, type TranslateFn, type PageRecord } from './pages.read.js';

// --- Types ------------------------------------------------------------------

export interface PageDeps { readonly client: GqlClient; readonly options: HistorianOptions; readonly translate?: TranslateFn; }

export interface CreateInput {
  readonly path: string;
  readonly locale: Locale;
  readonly title: string;
  readonly content: string;
  readonly tags?: readonly string[];
  readonly isPublished?: boolean;
  readonly twin?: boolean;
  readonly description?: string;
}

export interface CreateResult extends LocalePair { readonly pageId: number; readonly twinStatus: 'created' | 'pending' | 'skipped'; readonly twinReason?: string; readonly twinId?: number; }

export interface UpdatePatch {
  readonly title?: string;
  readonly content?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly isPublished?: boolean;
  readonly isPrivate?: boolean;
  readonly publishStartDate?: string;
  readonly publishEndDate?: string;
  readonly scriptCss?: string;
  readonly scriptJs?: string;
}

export interface UpdateResult extends LocalePair {
  readonly pageId: number;
  readonly page: PageRecord;
}

export interface WriteResult extends LocalePair { readonly pageId: number; }

// --- Errors -----------------------------------------------------------------

export class ContentEmptyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentEmptyError';
  }
}

export class ConfirmRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfirmRequiredError';
  }
}

export class PageNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageNotFoundError';
  }
}

// --- GraphQL shapes (introspection-verified) --------------------------------

const MUTABLE_FIELDS =
  'id path locale title description content isPublished isPrivate tags { tag } publishStartDate publishEndDate scriptCss scriptJs editor createdAt updatedAt';

const SINGLE_QUERY = `query s($id: Int!) { pages { single(id: $id) { ${MUTABLE_FIELDS} } } }`;
const CREATE_MUTATION = `mutation c($path: String!, $locale: String!, $title: String!, $content: String!, $description: String!, $editor: String!, $isPublished: Boolean!, $isPrivate: Boolean!, $tags: [String!]!) { pages { create(path: $path, locale: $locale, title: $title, content: $content, description: $description, editor: $editor, isPublished: $isPublished, isPrivate: $isPrivate, tags: $tags) { responseResult { succeeded errorCode slug message } page { id path } } } }`;
const UPDATE_MUTATION = `mutation u($id: Int!, $path: String!, $locale: String!, $title: String!, $content: String!, $description: String!, $editor: String!, $isPublished: Boolean!, $isPrivate: Boolean!, $tags: [String]!, $publishStartDate: Date, $publishEndDate: Date, $scriptCss: String, $scriptJs: String) { pages { update(id: $id, path: $path, locale: $locale, title: $title, content: $content, description: $description, editor: $editor, isPublished: $isPublished, isPrivate: $isPrivate, tags: $tags, publishStartDate: $publishStartDate, publishEndDate: $publishEndDate, scriptCss: $scriptCss, scriptJs: $scriptJs) { responseResult { succeeded errorCode slug message } page { id path } } } }`;
const MOVE_MUTATION = `mutation m($id: Int!, $destinationPath: String!, $destinationLocale: String!) { pages { move(id: $id, destinationPath: $destinationPath, destinationLocale: $destinationLocale) { responseResult { succeeded errorCode slug message } } } }`;
const DELETE_MUTATION = `mutation d($id: Int!) { pages { delete(id: $id) { responseResult { succeeded errorCode slug message } } } }`;

// --- Read-modify-write state -------------------------------------------------

interface RawMutablePageShape {
  readonly id: unknown;
  readonly path: unknown;
  readonly locale: unknown;
  readonly title: unknown;
  readonly description: unknown;
  readonly content: unknown;
  readonly isPublished: unknown;
  readonly isPrivate: unknown;
  readonly tags: unknown;
  readonly publishStartDate: unknown;
  readonly publishEndDate: unknown;
  readonly scriptCss: unknown;
  readonly scriptJs: unknown;
  readonly editor: unknown;
  readonly createdAt: unknown;
  readonly updatedAt: unknown;
}

interface MutableState {
  readonly id: number;
  readonly path: string;
  readonly locale: Locale;
  readonly title: string;
  readonly description: string;
  readonly content: string;
  readonly isPublished: boolean;
  readonly isPrivate: boolean;
  readonly tags: readonly string[];
  readonly publishStartDate: string;
  readonly publishEndDate: string;
  readonly scriptCss: string;
  readonly scriptJs: string;
  readonly editor: string;
}

function mapState(raw: RawMutablePageShape): MutableState {
  return {
    id: num(raw.id),
    path: str(raw.path),
    locale: normalizeLocale(str(raw.locale)),
    title: str(raw.title),
    description: str(raw.description),
    content: str(raw.content),
    isPublished: bool(raw.isPublished),
    isPrivate: bool(raw.isPrivate),
    tags: mapTags(raw.tags),
    publishStartDate: str(raw.publishStartDate),
    publishEndDate: str(raw.publishEndDate),
    scriptCss: str(raw.scriptCss),
    scriptJs: str(raw.scriptJs),
    editor: str(raw.editor),
  };
}

async function readState(client: GqlClient, id: number): Promise<MutableState> {
  try {
    const data = await gql<{ pages: { single: RawMutablePageShape | null } }>(client, SINGLE_QUERY, { id });
    if (data.pages.single === null) throw new PageNotFoundError(`page ${id} does not exist`);
    return mapState(data.pages.single);
  } catch (err) {
    if (err instanceof GraphQLError && err.message.includes('does not exist')) {
      throw new PageNotFoundError(`page ${id} does not exist`);
    }
    throw err;
  }
}

// --- createPage --------------------------------------------------------------

export async function createPage(deps: PageDeps, input: CreateInput): Promise<CreateResult> {
  validatePath(input.path);
  if (input.content.trim() === '') {
    throw new ContentEmptyError(`content is empty after trimming (wiki.js rejects empty content)`);
  }
  const locale = normalizeLocale(input.locale);
  const pair = assertLocalePair(input.path, locale, deps.options.baseUrl);
  const base = {
    path: input.path,
    locale,
    title: input.title,
    content: input.content,
    description: input.description ?? '',
    editor: 'markdown',
    isPublished: input.isPublished ?? true,
    isPrivate: false,
    tags: [...(input.tags ?? [])],
  };
  await gql(deps.client, CREATE_MUTATION, base);
  // pitfall #8: create()'s response page.id is unreliable — the authoritative
  // id comes from a fresh lookup of (path, locale).
  const page = await readPage(deps.client, input.path, locale);
  if (page === null) {
    throw new Error(`create reported success but the lookup of '${input.path}' (${locale}) returned nothing`);
  }
  if (input.twin === false) return { ...pair, pageId: page.id, twinStatus: 'skipped' };
  if (deps.translate === undefined) {
    return { ...pair, pageId: page.id, twinStatus: 'pending', twinReason: 'translator-not-wired' };
  }
  try {
    const twinLocale = pair.twinLocale;
    const [twinTitle, twinContent] = await Promise.all([
      deps.translate(input.title, locale, twinLocale),
      deps.translate(input.content, locale, twinLocale),
    ]);
    await gql(deps.client, CREATE_MUTATION, { ...base, locale: twinLocale, title: twinTitle, content: twinContent });
    const twin = await readPage(deps.client, input.path, twinLocale);
    if (twin === null) throw new Error('twin create reported success but its lookup returned nothing');
    return { ...pair, pageId: page.id, twinStatus: 'created', twinId: twin.id };
  } catch (err) {
    // Twin-failure contract: a failing translator or twin write NEVER fails
    // the primary result — the twin degrades to 'pending' with a reason.
    return {
      ...pair,
      pageId: page.id,
      twinStatus: 'pending',
      twinReason: err instanceof Error ? err.message : String(err),
    };
  }
}

// --- updatePage --------------------------------------------------------------

/** Full read-modify-write: the mutation payload ALWAYS carries every mutable
 *  field from the read, merged with the patch (pitfalls #1 + #2). */
export async function updatePage(deps: PageDeps, id: number, patch: UpdatePatch): Promise<UpdateResult> {
  const current = await readState(deps.client, id);
  const vars = {
    id,
    path: current.path,
    locale: current.locale,
    title: patch.title ?? current.title,
    content: patch.content ?? current.content,
    description: patch.description ?? current.description,
    editor: current.editor,
    isPublished: patch.isPublished ?? current.isPublished,
    isPrivate: patch.isPrivate ?? current.isPrivate,
    publishStartDate: patch.publishStartDate ?? current.publishStartDate,
    publishEndDate: patch.publishEndDate ?? current.publishEndDate,
    scriptCss: patch.scriptCss ?? current.scriptCss,
    scriptJs: patch.scriptJs ?? current.scriptJs,
    tags: [...(patch.tags ?? current.tags)],
  };
  await gql(deps.client, UPDATE_MUTATION, vars);
  const page = await readPage(deps.client, current.path, current.locale);
  if (page === null) {
    throw new Error(`update succeeded but the re-read of '${current.path}' (${current.locale}) returned nothing`);
  }
  return { ...assertLocalePair(current.path, current.locale, deps.options.baseUrl), pageId: id, page };
}

// --- appendSection -----------------------------------------------------------

export async function appendSection(deps: PageDeps, path: string, locale: Locale, section: string): Promise<UpdateResult> {
  const page = await readPage(deps.client, path, locale);
  if (page === null) throw new PageNotFoundError(`page '${path}' (${locale}) does not exist`);
  return updatePage(deps, page.id, { content: `${page.content}\n\n${section}` });
}

// --- movePage / deletePage ----------------------------------------------------

export async function movePage(
  deps: PageDeps,
  path: string,
  locale: Locale,
  newPath: string,
  newLocale?: Locale,
  confirm?: string,
): Promise<WriteResult> {
  if (confirm !== 'yes') {
    throw new ConfirmRequiredError(`movePage requires confirm:'yes' (got ${JSON.stringify(confirm)})`);
  }
  validatePath(newPath);
  const destLocale = newLocale ?? locale;
  const page = await readPage(deps.client, path, locale);
  if (page === null) throw new PageNotFoundError(`page '${path}' (${locale}) does not exist`);
  // pitfall #5: a path change is the move operation — update(path:) would
  // bypass destination-permission checks or silently misbehave.
  await gql(deps.client, MOVE_MUTATION, { id: page.id, destinationPath: newPath, destinationLocale: destLocale });
  return { ...assertLocalePair(newPath, destLocale, deps.options.baseUrl), pageId: page.id };
}

export async function deletePage(deps: PageDeps, path: string, locale: Locale, confirm?: string): Promise<WriteResult> {
  if (confirm !== 'yes') {
    throw new ConfirmRequiredError(`deletePage requires confirm:'yes' (got ${JSON.stringify(confirm)})`);
  }
  const page = await readPage(deps.client, path, locale);
  if (page === null) throw new PageNotFoundError(`page '${path}' (${locale}) does not exist`);
  await gql(deps.client, DELETE_MUTATION, { id: page.id });
  return { ...assertLocalePair(path, locale, deps.options.baseUrl), pageId: page.id };
}
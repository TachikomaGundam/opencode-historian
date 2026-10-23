/**
 * historian_read + historian_search: read-side tools. All URL composition is
 * reserved-path safe (reportUrls); search results carry per-hit URLs so the
 * agent never needs a second call to find a page.
 */

import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { normalizeLocale } from '../wiki/locale.js';
import {
  listPages,
  readPage,
  searchPages,
  type PageListItem,
  type PageSearchResponse,
  type PageSearchResult,
} from '../wiki/pages.js';
import type { GqlClient } from '../wiki/client.js';
import { readMirrorSnapshot } from '../map.js';
import { errEnvelope, okJson, reportUrls, URL_MANDATE, type ToolDeps } from './shared.js';

const s = tool.schema;

const READ_ARGS = {
  path: s.string(),
  locale: s.enum(['en', 'zh']).default('en'),
} as const;

const ReadArgsSchema = s.object(READ_ARGS);

// --- historian_read ----------------------------------------------------------

export function makeReadTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      `Read a wiki page (path + locale → full content; no raw id). A missing page returns ` +
      `found:false with a twin hint instead of failing. ${URL_MANDATE}.`,
    args: READ_ARGS,
    execute: async (raw) => {
      const args = ReadArgsSchema.parse(raw);
      try {
        const page = await readPage(deps.getClient(), args.path, args.locale);
        if (page === null) {
          const pair = reportUrls(deps.options.baseUrl, args.path, args.locale);
          const twinUrl = args.locale === 'en' ? pair.zh : pair.en;
          return okJson({
            found: false,
            path: args.path,
            locale: args.locale,
            twinHint: `No page at '${args.path}' (${args.locale}). The twin may exist at ${twinUrl} — run historian_map or historian_search to verify.`,
          });
        }
        return okJson({
          found: true,
          path: page.path,
          locale: page.locale,
          page: {
            id: page.id,
            title: page.title,
            description: page.description,
            tags: page.tags,
            isPublished: page.isPublished,
            contentType: page.contentType,
            updatedAt: page.updatedAt,
          },
          content: page.content,
          urls: reportUrls(deps.options.baseUrl, page.path, page.locale),
        });
      } catch (err) {
        return errEnvelope(err);
      }
    },
  });
}

const TAG_MODES = ['any', 'all'] as const;

const SEARCH_ARGS = {
  query: s.string(),
  kind: s.enum(['title', 'content']).default('content').describe('Informational intent; the wiki index covers both title and content'),
  tags: s
    .array(s.string().min(1))
    .min(1)
    .max(5)
    .refine((arr) => arr.every((t) => t.trim().length > 0), {
      message: 'tags entries must be non-blank (whitespace-only rejected)',
    })
    .optional()
    .describe(
      'Filter to pages carrying these tags (1-5). tagsMode "all" (DEFAULT) = EVERY listed tag ' +
      'must be present on the page — the server $tags mechanism is AND-only. tagsMode "any" = at ' +
      'LEAST ONE tag matches (client-side per-tag fan-out + union). Entries are trimmed and ' +
      'deduped; blank entries are rejected. Result rows include each page\'s tags so the agent ' +
      'can see the live tag vocabulary.'
    ),
  tagsMode: s
    .enum(TAG_MODES)
    .default('all')
    .describe('"all" (default): every tag must match (server-side AND, one request). "any": at least one tag (client-side union).'),
} as const;

const SearchArgsSchema = s.object(SEARCH_ARGS);

/** (path, locale) identity for union dedupe and query intersection. The NUL
 *  separator cannot appear in a path or locale, so concatenation stays injective. */
const matchKey = (path: string, locale: string): string => `${locale}\u0000${path}`;

/** Keys of the text-query result set, locale-normalized. Rows whose locale is
 *  outside the en/zh whitelist never equal a list row (those are always en/zh),
 *  so they simply cannot join the intersection. */
function textKeysOf(resp: PageSearchResponse): Set<string> {
  const keys = new Set<string>();
  for (const r of resp.results) {
    try {
      keys.add(matchKey(r.path, normalizeLocale(r.locale)));
    } catch {
      /* unsupported locale — legacy mapper keeps the row with url:null; the tag
         intersection just ignores it */
    }
  }
  return keys;
}

/** tagsMode "any": one list call PER tag, unioned and deduped by (path, locale).
 *  Resilience contract: a failed leg is dropped and named in `failed` — no new
 *  error class surfaces while ≥1 leg survives; only when EVERY leg fails does
 *  the original rejection propagate unchanged (standard error envelope). */
async function unionByAnyTag(
  client: GqlClient,
  tags: readonly string[],
): Promise<{ rows: readonly PageListItem[]; failed: string[] }> {
  const legs = await Promise.allSettled(tags.map((t) => listPages(client, { tags: [t] })));
  const seen = new Set<string>();
  const rows: PageListItem[] = [];
  const failures: Array<{ tag: string; reason: unknown }> = [];
  legs.forEach((leg, i) => {
    if (leg.status === 'fulfilled') {
      for (const row of leg.value) {
        const k = matchKey(row.path, row.locale);
        if (!seen.has(k)) {
          seen.add(k);
          rows.push(row);
        }
      }
    } else {
      failures.push({ tag: tags[i], reason: leg.reason });
    }
  });
  if (failures.length === tags.length) throw failures[0].reason; // schema guarantees tags.length ≥ 1
  return { rows, failed: failures.map((f) => f.tag) };
}

// --- historian_search --------------------------------------------------------

const SPLIT_ROW_CAP = 25;
const MIRROR_ROW_CAP = 10;

/**
 * Zero-hit fallback chain (live-measured: multi-word queries return 0 from
 * wiki.js even when every sub-word hits; freshly written pages lag the index):
 *   1. whitespace token fan-out, merged by (path, locale), ranked by distinct
 *      token hits — a multi-word query must not answer 0 while sub-words hit;
 *   2. pure-local page-map mirror scan on title/path substrings — closes the
 *      index-lag window for addressable titles without any network fan-out;
 *   3. honest hint — the remaining content-level lag is named, never hidden
 *      behind a bare zero.
 * The direct-hit path is byte-identical to the legacy behavior: one request,
 * no extra envelope fields. Leg failures are dropped and named (same
 * resilience contract as unionByAnyTag); only an all-legs-failed split throws.
 */
async function searchFallback(
  client: GqlClient,
  homeDir: string,
  query: string,
  direct: PageSearchResponse,
): Promise<{ readonly resp: PageSearchResponse; readonly fallback: Record<string, unknown> }> {
  if (direct.results.length > 0) return { resp: direct, fallback: {} };

  const tokens = [...new Set(query.trim().split(/\s+/).filter((t) => t.length > 0))];
  if (tokens.length >= 2) {
    const legs = await Promise.allSettled(tokens.map((t) => searchPages(client, t)));
    const failed: string[] = [];
    const byKey = new Map<string, { row: PageSearchResult; hits: number }>();
    legs.forEach((leg, i) => {
      if (leg.status === 'rejected') {
        failed.push(tokens[i]);
        return;
      }
      for (const r of leg.value.results) {
        const k = matchKey(r.path, r.locale);
        const seen = byKey.get(k);
        if (seen === undefined) byKey.set(k, { row: r, hits: 1 });
        else seen.hits += 1;
      }
    });
    if (failed.length === tokens.length) throw legs[0].status === 'rejected' ? legs[0].reason : new Error('token-split failed');
    if (byKey.size > 0) {
      const rows = [...byKey.values()]
        .sort((a, b) => b.hits - a.hits || (a.row.path < b.row.path ? -1 : a.row.path > b.row.path ? 1 : 0) || (a.row.locale < b.row.locale ? -1 : 1))
        .slice(0, SPLIT_ROW_CAP)
        .map((v) => v.row);
      return {
        resp: { results: rows, suggestions: direct.suggestions, totalHits: rows.length },
        fallback: { strategy: 'token-split', tokens, ...(failed.length > 0 ? { splitFailed: failed } : {}) },
      };
    }
  }

  const snap = readMirrorSnapshot(homeDir);
  if (snap !== null && tokens.length > 0) {
    const lowered = tokens.map((t) => t.toLowerCase());
    const hits = snap.rows
      .filter((r) => lowered.some((t) => r.title.toLowerCase().includes(t) || r.path.toLowerCase().includes(t)))
      .slice(0, MIRROR_ROW_CAP);
    if (hits.length > 0) {
      const rows: PageSearchResult[] = hits.map((r) => ({
        id: String(r.id),
        title: r.title,
        description: '',
        path: r.path,
        locale: r.locale,
      }));
      return {
        resp: { results: rows, suggestions: direct.suggestions, totalHits: rows.length },
        fallback: { strategy: 'map-mirror', tokens, mapGeneratedAt: snap.generatedAt, mapStaleSeconds: snap.staleSeconds },
      };
    }
  }

  return {
    resp: direct,
    fallback: {
      hint: 'no text-index or mirror hit; content written in the last minutes may lag the search index — verify via historian_read / historian_map',
    },
  };
}

export function makeSearchTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      `Full-text search over the wiki. kind is informational intent only — the live wiki.js ` +
      `search indexes title AND content (the engine signature is search(query, path, locale), no field scope). ` +
      `A zero-hit answer is auto-widened: multi-word queries fan out per word and merge (` +
      `strategy "token-split"), then a local page-map mirror scans titles/paths (strategy "map-mirror"); ` +
      `a bare zero without those carries a hint. ` +
      `Optional tags filter: tagsMode "all" (DEFAULT) requires EVERY tag on the page (server-side ` +
      `AND); "any" matches AT LEAST ONE tag. Result rows carry each page's tags. ` +
      `Results carry their en/zh URLs. ${URL_MANDATE}.`,
    args: SEARCH_ARGS,
    execute: async (raw) => {
      const args = SearchArgsSchema.parse(raw);
      try {
        const client = deps.getClient();
        const direct = await searchPages(client, args.query);
        const { resp, fallback } = await searchFallback(client, deps.homeDir, args.query, direct);
        const results = resp.results.map((r) => {
          try {
            const locale = normalizeLocale(r.locale);
            return {
              id: r.id,
              title: r.title,
              description: r.description,
              path: r.path,
              locale: r.locale,
              url: reportUrls(deps.options.baseUrl, r.path, locale)[locale],
            };
          } catch {
            return { id: r.id, title: r.title, description: r.description, path: r.path, locale: r.locale, url: null };
          }
        });
        if (args.tags === undefined) {
          // Legacy path — no tags given, no tags keys leak into the envelope.
          return okJson({
            query: args.query,
            kind: args.kind,
            totalHits: resp.totalHits,
            suggestions: resp.suggestions,
            results,
            ...fallback,
          });
        }

        const wanted = [...new Set(args.tags.map((t) => t.trim()))];
        let tagged: readonly PageListItem[];
        let tagsFailed: string[];
        switch (args.tagsMode) {
          case 'all':
            // Straight passthrough: ONE request, the server's $tags AND mechanism.
            tagged = await listPages(client, { tags: wanted });
            tagsFailed = [];
            break;
          case 'any': {
            const union = await unionByAnyTag(client, wanted);
            tagged = union.rows;
            tagsFailed = union.failed;
            break;
          }
        }
        const textKeys = textKeysOf(resp);
        const matched = tagged
          .filter((row) => textKeys.has(matchKey(row.path, row.locale)))
          .map((row) => ({
            id: row.id,
            title: row.title,
            description: row.description,
            path: row.path,
            locale: row.locale,
            url: reportUrls(deps.options.baseUrl, row.path, row.locale)[row.locale],
            tags: row.tags,
          }));
        return okJson({
          query: args.query,
          kind: args.kind,
          tags: wanted,
          tagsMode: args.tagsMode,
          tagsFailed,
          totalHits: matched.length,
          suggestions: resp.suggestions,
          results: matched,
          ...fallback,
        });
      } catch (err) {
        return errEnvelope(err);
      }
    },
  });
}
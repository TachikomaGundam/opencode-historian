/**
 * historian_read + historian_search: read-side tools. All URL composition is
 * reserved-path safe (reportUrls); search results carry per-hit URLs so the
 * agent never needs a second call to find a page.
 */

import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { normalizeLocale } from '../wiki/locale.js';
import { readPage, searchPages } from '../wiki/pages.js';
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

const SEARCH_ARGS = {
  query: s.string(),
  kind: s.enum(['title', 'content']).default('content').describe('Informational intent; the wiki index covers both title and content'),
} as const;

const SearchArgsSchema = s.object(SEARCH_ARGS);

// --- historian_search --------------------------------------------------------

export function makeSearchTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      `Full-text search over the wiki. kind is informational intent only — the live wiki.js ` +
      `search indexes title AND content (the engine signature is search(query, path, locale), no field scope). ` +
      `Results carry their en/zh URLs. ${URL_MANDATE}.`,
    args: SEARCH_ARGS,
    execute: async (raw) => {
      const args = SearchArgsSchema.parse(raw);
      try {
        const resp = await searchPages(deps.getClient(), args.query);
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
        return okJson({
          query: args.query,
          kind: args.kind,
          totalHits: resp.totalHits,
          suggestions: resp.suggestions,
          results,
        });
      } catch (err) {
        return errEnvelope(err);
      }
    },
  });
}
/**
 * historian_translate_snippet + historian_map: tools that never write to the
 * wiki engine (map refresh writes its cache page + mirror via the engine, but
 * only on the explicit refresh action). translate_snippet surfaces engine
 * TranslateError causes as structured output — never a throw.
 */

import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { TranslateError } from '../translate.js';
import { buildChronology, filterRowsByPath } from '../chronology.js';
import { getMap, refreshMapCache, CACHE_PATH, type MapDeps, type MapSnapshot } from '../map.js';
import { buildMaintainReport, renderMaintainMarkdown, type MaintainRow } from '../maintain.js';
import { normalizeLocale, PathValidationError } from '../wiki/locale.js';
import { listPages, readPage, type Locale } from '../wiki/pages.read.js';
import { errEnvelope, okJson, reportUrls, URL_MANDATE, type ToolDeps } from './shared.js';

const s = tool.schema;

const TRANSLATE_ARGS = {
  text: s.string(),
  from: s.enum(['en', 'zh']).default('en'),
  to: s.enum(['en', 'zh']).default('zh'),
} as const;

const TranslateArgsSchema = s.object(TRANSLATE_ARGS);

// --- historian_translate_snippet ---------------------------------------------

export function makeTranslateSnippetTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      `Translate a text snippet with the configured translation engine (pure-local, no wiki interaction). ` +
      `The engine may emit thinking parts first — only the final translated text is returned. ` +
      `Read the translation and verify it reads naturally in context before reuse.`,
    args: TRANSLATE_ARGS,
    execute: async (raw) => {
      const args = TranslateArgsSchema.parse(raw);
      if (deps.translate === undefined) {
        return JSON.stringify(
          {
            ok: false,
            error: 'not-wired',
            detail: 'No translation engine wired — configure translate (endpoint/model/apiKey) or pass a translator to buildTools.',
            actionableHint: 'Wire translation in the plugin config and retry.',
          },
          null,
          2,
        );
      }
      try {
        const translated = await deps.translate(args.text, args.from, args.to);
        return okJson({ translated, from: args.from, to: args.to });
      } catch (err) {
        if (err instanceof TranslateError) {
          return JSON.stringify(
            {
              ok: false,
              error: err.cause,
              detail: err.detail,
              message: err.message,
              actionableHint: 'Retry the translation, or use the raw text as-is.',
            },
            null,
            2,
          );
        }
        return errEnvelope(err);
      }
    },
  });
}

const MAP_ARGS = {
  action: s.enum(['show', 'refresh', 'timeline', 'maintain']).default('show'),
  days: s.number().int().positive().optional().describe('timeline: keep only rows updated within the last N days'),
  path: s.string().optional().describe('timeline: section/path prefix filter (e.g. ops)'),
  deep: s.boolean().optional().describe('maintain: additionally read every page body (freshness stamps + redirect stubs) — one bounded read per row'),
} as const;

const MapArgsSchema = s.object(MAP_ARGS);

/** maintain: light tier is map rows + ONE read-only pages.list pass per locale
 *  (the mirror's MapRow carries no tags; the list join restores the vocab view);
 *  deep additionally reads each body via readPage. Reserved-path pages (e.g.
 *  'home', probe p1) answer null instead of killing the sweep. Read-only. */
async function runMaintain(deps: ToolDeps, mapDeps: MapDeps, snapshot: MapSnapshot, deep: boolean) {
  const client = deps.getClient();
  const tagIndex = new Map<string, readonly string[]>();
  const locales = [...new Set(deps.options.locales.map(normalizeLocale))].sort();
  for (const locale of locales) {
    for (const item of await listPages(client, { locale })) {
      tagIndex.set(`${item.locale}\u0000${item.path}`, item.tags);
    }
  }
  const rows: MaintainRow[] = snapshot.rows.map((r) => ({ ...r, tags: tagIndex.get(`${r.locale}\u0000${r.path}`) ?? [] }));
  const readBody = deep
    ? async (path: string, locale: Locale): Promise<string | null> => {
        try {
          return (await readPage(client, path, locale))?.content ?? null;
        } catch (err) {
          // Unreadable page (invalid path / transport) is a scan miss, not a report failure.
          if (err instanceof PathValidationError) return null;
          throw err;
        }
      }
    : undefined;
  const report = await buildMaintainReport(
    { rows, mapGeneratedAt: snapshot.generatedAt, mapStaleSeconds: snapshot.staleSeconds },
    { deep, readBody },
  );
  return {
    action: 'maintain',
    deep: report.deep,
    generatedAt: report.generatedAt,
    rowCount: report.rowCount,
    report,
    markdown: renderMaintainMarkdown(report),
    urls: reportUrls(deps.options.baseUrl, CACHE_PATH, 'en'),
  };
}

// --- historian_map -----------------------------------------------------------

export function makeMapTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      `Inspect (show), rebuild (refresh), or aggregate recent updates (timeline) over the en/zh page map ` +
      `with its local mirror + _meta/page-map cache page. Two roles: the local mirror is the live query ` +
      `source for show/timeline; the wiki page is the audit ledger (every refresh commits a new wiki revision). ` +
      `show reads the local mirror (zero writes); refresh rebuilds from the wiki and writes the mirror + cache page ` +
      `(idempotent — the engine upserts via full RMW); timeline groups mirror rows by ISO week (newest first, ` +
      `optional days window + section/path prefix filter) into a human markdown table + machine-readable weeks JSON. ` +
      `maintain runs the read-only curation sweep (twin gap, near-duplicate titles, staleness, diffusion/orphan ` +
      `candidates, tag vocab, section distribution; deep:true adds per-body freshness stamps + redirect stubs) and ` +
      `answers a markdown report with a stable-key JSON tail. ${URL_MANDATE}.`,
    args: MAP_ARGS,
    execute: async (raw) => {
      const args = MapArgsSchema.parse(raw);
      try {
        const mapDeps: MapDeps = { client: deps.getClient(), options: deps.options };
        if (args.action === 'refresh') {
          const result = await refreshMapCache(mapDeps, { homeDir: deps.homeDir });
          return okJson({ action: 'refresh', stats: result.stats, cacheUrl: result.cacheUrl });
        }
        const snapshot = await getMap(mapDeps, deps.homeDir);
        if (args.action === 'timeline') {
          const rows = args.path === undefined ? snapshot.rows : filterRowsByPath(snapshot.rows, args.path);
          const chrono = buildChronology(rows, { days: args.days });
          return okJson({
            action: 'timeline',
            days: args.days ?? null,
            pathPrefix: args.path ?? null,
            generatedAt: snapshot.generatedAt,
            rows: rows.length,
            weeks: chrono.weeks,
            markdown: chrono.markdown,
            urls: reportUrls(deps.options.baseUrl, CACHE_PATH, 'en'),
          });
        }
        if (args.action === 'maintain') {
          return okJson(await runMaintain(deps, mapDeps, snapshot, args.deep ?? false));
        }
        return okJson({
          action: 'show',
          generatedAt: snapshot.generatedAt,
          staleSeconds: snapshot.staleSeconds,
          stats: snapshot.stats,
          rows: snapshot.rows,
        });
      } catch (err) {
        return errEnvelope(err);
      }
    },
  });
}
/**
 * historian_translate_snippet + historian_map: tools that never write to the
 * wiki engine (map refresh writes its cache page + mirror via the engine, but
 * only on the explicit refresh action). translate_snippet surfaces engine
 * TranslateError causes as structured output — never a throw.
 */

import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { TranslateError } from '../translate.js';
import { buildChronology, filterRowsByPath } from '../chronology.js';
import { getMap, refreshMapCache, CACHE_PATH, type MapDeps } from '../map.js';
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
  action: s.enum(['show', 'refresh', 'timeline']).default('show'),
  days: s.number().int().positive().optional().describe('timeline: keep only rows updated within the last N days'),
  path: s.string().optional().describe('timeline: section/path prefix filter (e.g. ops)'),
} as const;

const MapArgsSchema = s.object(MAP_ARGS);

// --- historian_map -----------------------------------------------------------

export function makeMapTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      `Inspect (show), rebuild (refresh), or aggregate recent updates (timeline) over the en/zh page map ` +
      `with its local mirror + _meta/page-map cache page. ` +
      `show reads the local mirror (zero writes); refresh rebuilds from the wiki and writes the mirror + cache page ` +
      `(idempotent — the engine upserts via full RMW); timeline groups mirror rows by ISO week (newest first, ` +
      `optional days window + section/path prefix filter) into a human markdown table + machine-readable weeks JSON. ` +
      `${URL_MANDATE}.`,
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
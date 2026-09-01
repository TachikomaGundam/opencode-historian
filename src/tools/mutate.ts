/**
 * historian_delete + historian_move + historian_migrate: destructive ops are
 * gated on confirm:"yes" BEFORE any fetch; migrate is a dry-run stub in this
 * release — apply is owned by todo 14 (the return shape is designed so the
 * apply path can grow in place without a schema change).
 */

import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { deletePage, movePage, PageNotFoundError, readPage } from '../wiki/pages.js';
import { classifyGenre, selfReviewChecklist } from '../templates/genres.js';
import { confirmRequiredJson, errEnvelope, notImplementedJson, okJson, reportUrls, urlPair, URL_MANDATE, pageDeps, type ToolDeps } from './shared.js';

const s = tool.schema;

const GENRES = ['G1', 'G2', 'G3', 'G4'] as const;

const DELETE_ARGS = {
  path: s.string(),
  locale: s.enum(['en', 'zh']).default('en'),
  confirm: s.string().optional().describe('Must be exactly "yes" to delete'),
} as const;

const DeleteArgsSchema = s.object(DELETE_ARGS);

// --- historian_delete --------------------------------------------------------

export function makeDeleteTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      `Delete a wiki page. Requires the explicit acknowledgement confirm:"yes" — anything else is ` +
      `refused before the wiki is even contacted. ${URL_MANDATE}.`,
    args: DELETE_ARGS,
    execute: async (raw) => {
      const args = DeleteArgsSchema.parse(raw);
      if (args.confirm !== 'yes') return confirmRequiredJson('historian_delete', args.confirm);
      try {
        const result = await deletePage(pageDeps(deps), args.path, args.locale, 'yes');
        return okJson({
          mode: 'delete',
          path: args.path,
          locale: args.locale,
          pageId: result.pageId,
          urls: urlPair(result),
        });
      } catch (err) {
        return errEnvelope(err);
      }
    },
  });
}

const MOVE_ARGS = {
  path: s.string(),
  locale: s.enum(['en', 'zh']).default('en'),
  newPath: s.string().describe('Destination path (first segment must NOT look like a locale code)'),
  newLocale: s.enum(['en', 'zh']).optional(),
  confirm: s.string().optional().describe('Must be exactly "yes" to move'),
} as const;

const MoveArgsSchema = s.object(MOVE_ARGS);

// --- historian_move ----------------------------------------------------------

export function makeMoveTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      `Move a wiki page to a new path (optionally a new locale). Requires the explicit acknowledgement ` +
      `confirm:"yes". Reports the NEW page URLs. ${URL_MANDATE}.`,
    args: MOVE_ARGS,
    execute: async (raw) => {
      const args = MoveArgsSchema.parse(raw);
      if (args.confirm !== 'yes') return confirmRequiredJson('historian_move', args.confirm);
      try {
        const destLocale = args.newLocale ?? args.locale;
        const result = await movePage(pageDeps(deps), args.path, args.locale, args.newPath, destLocale, 'yes');
        return okJson({
          mode: 'move',
          from: { path: args.path, locale: args.locale },
          path: result.path,
          locale: result.locale,
          pageId: result.pageId,
          urls: urlPair(result),
        });
      } catch (err) {
        return errEnvelope(err);
      }
    },
  });
}

const MIGRATE_ARGS = {
  path: s.string(),
  genre: s.enum(GENRES).optional().describe('Explicit genre; absent → engine classification of the page content'),
  apply: s.boolean().default(false).describe('apply is NOT implemented in this release — refused before any fetch'),
} as const;

const MigrateArgsSchema = s.object(MIGRATE_ARGS);

// --- historian_migrate -------------------------------------------------------

export function makeMigrateTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      `Migration DRY-RUN for a legacy page: reads the page (en, or zh fallback), suggests a genre ` +
      `(explicit arg wins, else engine classification) and previews the 10-item self-review checklist. ` +
      `Nothing is written — apply is owned by a later release. ${URL_MANDATE}.`,
    args: MIGRATE_ARGS,
    execute: async (raw) => {
      const args = MigrateArgsSchema.parse(raw);
      if (args.apply) {
        return notImplementedJson('migrate apply', 'todo 14 owns apply');
      }
      try {
        const en = await readPage(deps.getClient(), args.path, 'en');
        const page = en ?? (await readPage(deps.getClient(), args.path, 'zh'));
        if (page === null) {
          return errEnvelope(new PageNotFoundError(`page '${args.path}' does not exist (checked en and zh locales)`));
        }
        const classified = classifyGenre({ title: page.title, body: page.content });
        const suggestedGenre = args.genre ?? classified.genre;
        return okJson({
          mode: 'dry-run',
          path: page.path,
          locale: page.locale,
          suggestedGenre,
          confidence: args.genre !== undefined ? 'explicit' : classified.confidence,
          signals: args.genre !== undefined ? [] : classified.signals,
          content: page.content,
          checklist: selfReviewChecklist(suggestedGenre),
          urls: reportUrls(deps.options.baseUrl, page.path, page.locale),
        });
      } catch (err) {
        return errEnvelope(err);
      }
    },
  });
}
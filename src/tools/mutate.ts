/**
 * historian_delete + historian_move + historian_migrate: destructive ops are
 * gated on confirm:"yes" BEFORE any fetch; migrate runs the todo-14 engine —
 * dry-run (LLM restyle + deterministic checklist, no writes) or apply
 * (pre-image backup first, per-locale upsert, checkpoint, verification).
 */

import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { deletePage, movePage } from '../wiki/pages.js';
import { selfReviewChecklist } from '../templates/genres.js';
import { confirmRequiredJson, errEnvelope, okJson, urlPair, URL_MANDATE, pageDeps, type ToolDeps } from './shared.js';
import { reformatPageDraft } from '../migrate.js';
import { applyMigration } from '../migrate-apply.js';

const s = tool.schema;

const GENRES = ['G1', 'G2', 'G3', 'G4', 'G5'] as const;

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
  apply: s.boolean().default(false).describe('true → apply the migration: pre-image backup first, per-locale upsert, checkpoint'),
} as const;

const MigrateArgsSchema = s.object(MIGRATE_ARGS);

// --- historian_migrate -------------------------------------------------------

/** MigrateDeps built from the tool deps; the engine reaches the LLM through
 *  the injected fetchImpl (mocked in tests, real fetch in production). */
function migrateDeps(deps: ToolDeps) {
  return {
    client: deps.getClient(),
    options: deps.options,
    translate: deps.translate,
    fetchImpl: deps.fetchImpl,
    homeDir: deps.homeDir,
    resultsDir: deps.resultsDir,
  };
}

export function makeMigrateTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      `Migration of a legacy page into a genre skeleton: reads the page (en, or zh fallback), ` +
      `reformats it via the LLM to the suggested genre (explicit arg wins, else engine classification) ` +
      `and scores the 10-item self-review checklist on the DRAFT. Dry-run writes nothing. ` +
      `apply=true persists: pre-image backup FIRST (results/pilot-backup-<section>-<date>.json), then ` +
      `a per-locale upsert (missing twin auto-created via the translation engine) and a path-level ` +
      `checkpoint (re-apply of unchanged content is a no-op). ${URL_MANDATE}.`,
    args: MIGRATE_ARGS,
    execute: async (raw) => {
      const args = MigrateArgsSchema.parse(raw);
      try {
        const engine = migrateDeps(deps);
        const dry = await reformatPageDraft(engine, { path: args.path, genre: args.genre });
        if (!dry.ok) return errEnvelope(dry.error);
        if (!args.apply) {
          return okJson({
            mode: 'dry-run',
            path: args.path,
            locale: dry.sourceLocale,
            suggestedGenre: dry.genre,
            genre: dry.genre,
            confidence: dry.confidence,
            signals: dry.signals,
            content: dry.sourceContent,
            draft: dry.draft,
            alreadyConforms: dry.alreadyConforms,
            missingTwin: dry.missingTwin,
            checklist: selfReviewChecklist(dry.genre),
            checklistResults: dry.checklistResults,
            urls: dry.urls,
          });
        }
        const out = await applyMigration(engine, { path: args.path, genre: dry.genre, draft: dry.draft });
        if (!out.ok) return errEnvelope(out.error);
        return okJson({
          mode: 'apply',
          path: args.path,
          genre: dry.genre,
          alreadyConforms: dry.alreadyConforms,
          applied: out.applied,
          backupPath: out.backupPath,
          skipped: out.skipped,
          urls: dry.urls,
          note:
            `Pre-image backed up at ${out.backupPath}; restore = replay that file (historian_page_update ` +
            `with its fields, historian_delete for locales recorded null) or the wiki.js history view.`,
        });
      } catch (err) {
        return errEnvelope(err);
      }
    },
  });
}
/**
 * historian_page_update + historian_page_append: engine RMW update and the
 * bilingual append (en append + zh twin handling per the wiki-biling
 * semantics — the twin bootstrap composes engine primitives only:
 * appendSection / createPage / readPage / translate; never reimplemented).
 */

import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { appendSection, createPage, updatePage, PageNotFoundError } from '../wiki/pages.js';
import { readPage, type PageRecord } from '../wiki/pages.read.js';
import {
  enforceTierPath,
  errEnvelope,
  frontDumpAdvisory,
  isInternalPath,
  MACHINE_TIER_NOTE,
  monolingualRefusalJson,
  okJson,
  tierMismatchJson,
  TIERS,
  urlPair,
  URL_MANDATE,
  pageDeps,
  type Tier,
  type ToolDeps,
} from './shared.js';

const s = tool.schema;

const UPDATE_ARGS = {
  path: s.string(),
  locale: s.enum(['en', 'zh']).default('en'),
  title: s.string().optional(),
  content: s.string().optional(),
  description: s.string().optional(),
  tags: s.array(s.string()).optional(),
} as const;

const UpdateArgsSchema = s.object(UPDATE_ARGS);

export function makeUpdateTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      `Update a wiki page: full read-modify-write — omitted fields are kept unchanged (engine preserves them). ` +
      `Path + locale resolve the page; no raw id. ${URL_MANDATE}.`,
    args: UPDATE_ARGS,
    execute: async (raw) => {
      const args = UpdateArgsSchema.parse(raw);
      try {
        const page = await readPage(deps.getClient(), args.path, args.locale);
        if (page === null) {
          return errEnvelope(new PageNotFoundError(`page '${args.path}' (${args.locale}) does not exist`));
        }
        const result = await updatePage(pageDeps(deps), page.id, {
          title: args.title,
          content: args.content,
          description: args.description,
          tags: args.tags,
        });
        const advisory = frontDumpAdvisory(inferredTier(page.path), args.content ?? '');
        return okJson({
          mode: 'update',
          path: args.path,
          locale: args.locale,
          pageId: result.pageId,
          page: {
            id: result.page.id,
            title: result.page.title,
            description: result.page.description,
            tags: result.page.tags,
            isPublished: result.page.isPublished,
            contentType: result.page.contentType,
            updatedAt: result.page.updatedAt,
          },
          urls: urlPair(result),
          ...(advisory === null ? {} : { advisory }),
        });
      } catch (err) {
        return errEnvelope(err);
      }
    },
  });
}

/** Path-only tier resolution (same rule the append fallback uses): an
 *  internal namespace first segment ⇒ evidence, anything else ⇒ front. */
function inferredTier(path: string): Tier {
  return isInternalPath(path) ? 'evidence' : 'front';
}

// --- historian_page_append ---------------------------------------------------

/** Bootstrap a missing zh twin from the append — degrades to 'pending' on any
 *  failure (primary append never fails; the R-d contract). */
interface ZhOutcome {
  readonly status: 'created' | 'pending';
  readonly note?: string;
}

async function bootstrapTwin(deps: ToolDeps, primary: PageRecord, section: string, source: 'explicit' | 'translate'): Promise<ZhOutcome> {
  const translate = source === 'translate' ? deps.translate : undefined;
  try {
    const title = translate !== undefined ? await translate(primary.title, 'en', 'zh') : primary.title;
    const content = translate !== undefined ? await translate(section, 'en', 'zh') : section;
    await createPage(pageDeps(deps), {
      path: primary.path,
      locale: 'zh',
      title,
      content,
      tags: primary.tags,
      isPublished: primary.isPublished,
      twin: false,
    });
    return { status: 'created' };
  } catch (err) {
    return { status: 'pending', note: `zh twin bootstrap failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

const APPEND_ARGS = {
  path: s.string(),
  section: s.string(),
  locale: s.enum(['en', 'zh']).default('en'),
  sectionZh: s.string().optional().describe('Explicit zh section; when absent the zh side falls back to translation/wiring'),
  tier: s.enum(TIERS).optional().describe('Explicit tier; absent → inferred from the path (first segment _meta/ or _evidence/ ⇒ evidence, else front)'),
} as const;

const AppendArgsSchema = s.object(APPEND_ARGS);

export function makeAppendTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      `Append a section to an existing page (engine append + RMW). For the en page with a MISSING zh twin, ` +
      `the twin is auto-created — from sectionZh when given, else translated when the translator is wired. ` +
      `Evidence-tier pages (_meta/ or _evidence/) are monolingual en — no twin handling. ` +
      `${URL_MANDATE}.`,
    args: APPEND_ARGS,
    execute: async (raw) => {
      const args = AppendArgsSchema.parse(raw);
      // Exactly ONE resolution rule: explicit tier arg wins; otherwise infer
      // from the path prefix (internal namespace ⇒ evidence).
      const tier: Tier = args.tier ?? inferredTier(args.path);
      const mismatch = enforceTierPath(tier, args.path);
      if (mismatch !== null) return tierMismatchJson(mismatch);
      const isEvidence = tier === 'evidence';
      if (isEvidence && args.locale === 'zh') {
        return monolingualRefusalJson('historian_page_append', 'locale "zh"');
      }
      if (isEvidence && args.sectionZh !== undefined) {
        return monolingualRefusalJson('historian_page_append', 'sectionZh');
      }
      try {
        const appended = await appendSection(pageDeps(deps), args.path, args.locale, args.section);
        let zhStatus: string;
        let zhNote: string | undefined;
        if (isEvidence) {
          zhStatus = 'skipped';
          zhNote = 'evidence tier is monolingual en — no zh twin is bootstrapped or touched.';
        } else if (args.locale === 'zh') {
          zhStatus = 'appended';
          zhNote = 'Primary locale is zh — the en twin is untouched (check with historian_read(path, "en")).';
        } else if (args.sectionZh !== undefined) {
          const twin = await readPage(deps.getClient(), args.path, 'zh');
          if (twin !== null) {
            await appendSection(pageDeps(deps), args.path, 'zh', args.sectionZh);
            zhStatus = 'appended';
          } else {
            const outcome = await bootstrapTwin(deps, appended.page, args.sectionZh, 'explicit');
            zhStatus = outcome.status;
            zhNote = outcome.note;
          }
        } else {
          const twin = await readPage(deps.getClient(), args.path, 'zh');
          if (twin !== null) {
            zhStatus = 'exists';
            zhNote = 'zh twin untouched — pass sectionZh to sync it, or call historian_page_append with locale "zh".';
          } else if (deps.translate !== undefined) {
            const outcome = await bootstrapTwin(deps, appended.page, args.section, 'translate');
            zhStatus = outcome.status;
            zhNote = outcome.note;
          } else {
            zhStatus = 'missing';
            zhNote = 'No zh twin exists and no translator is wired — provide sectionZh to bootstrap it.';
          }
        }
        const advisory = frontDumpAdvisory(tier, args.section);
        return okJson({
          mode: 'append',
          path: args.path,
          locale: args.locale,
          pageId: appended.pageId,
          urls: urlPair(appended),
          zhStatus,
          zhNote,
          ...(isEvidence ? { note: MACHINE_TIER_NOTE } : {}),
          ...(advisory === null ? {} : { advisory }),
        });
      } catch (err) {
        return errEnvelope(err);
      }
    },
  });
}
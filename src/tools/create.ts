/**
 * historian_page_create: content-present → engine createPage (twin semantics
 * per the engine contract); content ABSENT → pure-local genre template mode
 * (classify + skeleton, ZERO GraphQL writes — pitfall #4 avoidance: the wiki
 * rejects empty content, so an empty create must never reach the network).
 */

import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { validatePath } from '../wiki/locale.js';
import { createPage } from '../wiki/pages.js';
import { classifyGenre, genreSkeleton } from '../templates/genres.js';
import { evidenceSkeleton } from '../templates/evidence.js';
import {
  enforceTierPath,
  errEnvelope,
  frontDumpAdvisory,
  MACHINE_TIER_NOTE,
  okJson,
  pageDeps,
  tierMismatchJson,
  TIERS,
  urlPair,
  URL_MANDATE,
  type Tier,
  type ToolDeps,
} from './shared.js';

const s = tool.schema;

const GENRES = ['G1', 'G2', 'G3', 'G4', 'G5'] as const;

const ARGS_SHAPE = {
  path: s.string().describe('Wiki path, e.g. docs/guides/foo (first segment must NOT look like a locale code)'),
  title: s.string().describe('Page title'),
  content: s.string().optional().describe('Page body (markdown). ABSENT → local template mode, nothing written'),
  genre: s.enum(GENRES).optional().describe('Genre hint: G1..G5 (template mode / classification)'),
  locale: s.enum(['en', 'zh']).default('en'),
  isPublished: s.boolean().default(true),
  tags: s.array(s.string()).default([]),
  twin: s.boolean().default(true).describe('Auto-create the opposite-locale twin via translation'),
  description: s.string().optional(),
  tier: s.enum(TIERS).default('front').describe('front = bilingual human page; evidence = machine page under _meta/ or _evidence/ (hidden, unpublished, monolingual en)'),
} as const;

const ArgsSchema = s.object(ARGS_SHAPE);

export function makeCreateTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      `Create a wiki page: primary locale content plus an optional auto-translated twin. ` +
      `Pass NO content to get a pure-local genre template (classification + skeleton, nothing is written to the wiki). ` +
      `${URL_MANDATE}.`,
    args: ARGS_SHAPE,
    execute: async (raw) => {
      const args = ArgsSchema.parse(raw);
      const tier: Tier = args.tier;
      try {
        validatePath(args.path);
      } catch (err) {
        return errEnvelope(err);
      }
      const mismatch = enforceTierPath(tier, args.path);
      if (mismatch !== null) return tierMismatchJson(mismatch);
      // Evidence pages are monolingual en: a zh locale is FORCED to en with an
      // envelope hint — plan ruling: hint, never throw.
      const isEvidence = tier === 'evidence';
      const locale = isEvidence ? 'en' : args.locale;
      const localeHint =
        isEvidence && args.locale === 'zh'
          ? 'evidence pages are monolingual en — the locale argument was forced to "en"'
          : undefined;
      if (args.content === undefined || args.content.trim() === '') {
        if (isEvidence) {
          // Evidence pages are not genre-templated: echo the machine skeleton.
          // The source page is unknown at template time, so the fields ship as
          // placeholder hints; the description arg (if given) is the context hint.
          return okJson({
            mode: 'template',
            locale,
            skeleton: evidenceSkeleton({
              sourcePath: '<human-page-path>',
              sourceUrl: '<human-page-url>',
              capturedAt: new Date().toISOString(),
              context: args.description ?? '<one-line context>',
            }),
            note:
              'Nothing was written to the wiki (template mode, no content). Paste the raw material verbatim ' +
              'into the 原文 fence, replace the <human-page-path> / <human-page-url> / <one-line context> ' +
              'placeholders with the citing human page, then call historian_page_create again with tier:"evidence" and content.',
            ...(localeHint === undefined ? {} : { localeHint }),
          });
        }
        const genre = args.genre ?? classifyGenre({ title: args.title, body: args.description ?? '' }).genre;
        return okJson({
          mode: 'template',
          genre,
          locale,
          skeleton: genreSkeleton(genre, locale),
          note: 'Nothing was written to the wiki (template mode, no content). Fill the skeleton and call historian_page_create again with content.',
          ...(localeHint === undefined ? {} : { localeHint }),
        });
      }
      try {
        const result = await createPage(pageDeps(deps), {
          path: args.path,
          locale,
          title: args.title,
          content: args.content,
          tags: isEvidence ? [...new Set([...args.tags, 'evidence'])] : args.tags,
          isPublished: isEvidence ? false : args.isPublished,
          isPrivate: isEvidence,
          twin: isEvidence ? false : args.twin,
          description: args.description,
        });
        const advisory = frontDumpAdvisory(tier, args.content);
        return okJson({
          mode: 'create',
          path: args.path,
          locale,
          pageId: result.pageId,
          twinStatus: result.twinStatus,
          twinReason: result.twinReason,
          twinId: result.twinId,
          urls: urlPair(result),
          ...(isEvidence ? { note: MACHINE_TIER_NOTE } : {}),
          ...(localeHint === undefined ? {} : { localeHint }),
          ...(advisory === null ? {} : { advisory }),
        });
      } catch (err) {
        return errEnvelope(err);
      }
    },
  });
}
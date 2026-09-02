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
import { errEnvelope, okJson, urlPair, URL_MANDATE, pageDeps, type ToolDeps } from './shared.js';

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
      try {
        validatePath(args.path);
      } catch (err) {
        return errEnvelope(err);
      }
      if (args.content === undefined || args.content.trim() === '') {
        const genre = args.genre ?? classifyGenre({ title: args.title, body: args.description ?? '' }).genre;
        return okJson({
          mode: 'template',
          genre,
          locale: args.locale,
          skeleton: genreSkeleton(genre, args.locale),
          note: 'Nothing was written to the wiki (template mode, no content). Fill the skeleton and call historian_page_create again with content.',
        });
      }
      try {
        const result = await createPage(pageDeps(deps), {
          path: args.path,
          locale: args.locale,
          title: args.title,
          content: args.content,
          tags: args.tags,
          isPublished: args.isPublished,
          twin: args.twin,
          description: args.description,
        });
        return okJson({
          mode: 'create',
          path: args.path,
          locale: args.locale,
          pageId: result.pageId,
          twinStatus: result.twinStatus,
          twinReason: result.twinReason,
          twinId: result.twinId,
          urls: urlPair(result),
        });
      } catch (err) {
        return errEnvelope(err);
      }
    },
  });
}
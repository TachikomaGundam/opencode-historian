/**
 * historian_* tool surface (todo 11) — barrel + composition.
 *
 * buildTools wires the 10 custom tools from the engine modules; this file
 * holds no engine logic, only wiring. Per-call construction (no module-level
 * cache — each buildTools call resolves a fresh client/translator), and the
 * client is resolved LAZILY: a missing/invalid wiki key surfaces as a
 * ConfigError envelope on first execution, never as a buildTools crash that
 * would kill plugin registration (todo 12).
 */

import { homedir } from 'node:os';
import type { ToolDefinition } from '@opencode-ai/plugin';
import { createClient, type GqlClient } from './wiki/client.js';
import { makeTranslator } from './translate.js';
import type { HistorianOptions } from './config.js';
import type { TranslateFn } from './wiki/pages.read.js';
import type { ToolDeps } from './tools/shared.js';
import { makeCreateTool } from './tools/create.js';
import { makeUpdateTool, makeAppendTool } from './tools/write.js';
import { makeReadTool, makeSearchTool } from './tools/read.js';
import { makeTranslateSnippetTool, makeMapTool } from './tools/local.js';
import { makeDeleteTool, makeMoveTool, makeMigrateTool } from './tools/mutate.js';

export interface BuildDeps {
  readonly client?: GqlClient;
  readonly translate?: TranslateFn;
  readonly fetchImpl?: typeof fetch;
  readonly homeDir?: string;
}

export type HistorianTools = Readonly<Record<string, ToolDefinition>>;

export function buildTools(opts: HistorianOptions, deps: BuildDeps = {}): HistorianTools {
  const homeDir = deps.homeDir ?? homedir();
  const translate = deps.translate ?? (deps.fetchImpl !== undefined ? makeTranslator(opts, { fetchImpl: deps.fetchImpl }) : undefined);
  let client: GqlClient | undefined;
  const getClient = (): GqlClient => {
    client ??= deps.client ?? createClient(opts, { fetchImpl: deps.fetchImpl, homeDir });
    return client;
  };
  const toolDeps: ToolDeps = { getClient, options: opts, translate, homeDir };
  return {
    historian_page_create: makeCreateTool(toolDeps),
    historian_page_update: makeUpdateTool(toolDeps),
    historian_page_append: makeAppendTool(toolDeps),
    historian_translate_snippet: makeTranslateSnippetTool(toolDeps),
    historian_search: makeSearchTool(toolDeps),
    historian_read: makeReadTool(toolDeps),
    historian_map: makeMapTool(toolDeps),
    historian_migrate: makeMigrateTool(toolDeps),
    historian_delete: makeDeleteTool(toolDeps),
    historian_move: makeMoveTool(toolDeps),
  };
}
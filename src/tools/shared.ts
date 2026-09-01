/**
 * Shared plumbing for the historian_* tool surface (todo 11): the tool
 * dependency bag, locale-aware URL helpers (reserved-path safe), the uniform
 * JSON envelope helpers and the error → envelope mapping.
 *
 * The tools layer is a thin adapter: all wiki logic lives in the engine
 * modules (src/wiki/*, src/map.ts, src/templates/*, src/translate.ts) and is
 * reused verbatim — no business logic is duplicated here; migrate's apply
 * path is deliberately a stub (todo 14 owns it).
 */

import type { ToolResult } from '@opencode-ai/plugin';
import type { GqlClient } from '../wiki/client.js';
import type { HistorianOptions } from '../config.js';
import type { PageDeps } from '../wiki/pages.write.js';
import type { TranslateFn, Locale } from '../wiki/pages.read.js';
import { assertLocalePair, PathValidationError, twinOf, type LocalePair } from '../wiki/locale.js';

/** Per-tool dependency bag; the client is a thunk so a bad key surface at
 *  buildTools time as nothing — only the first execution that touches the
 *  wiki resolves it (and then yields a ConfigError envelope, not a crash).
 *  The thunk is memoized per buildTools call (no module-level cache). */
export interface ToolDeps {
  readonly getClient: () => GqlClient;
  readonly options: HistorianOptions;
  readonly translate?: TranslateFn;
  readonly homeDir: string;
}

/** Engine deps for one operation; client resolved lazily at use time. */
export function pageDeps(deps: ToolDeps): PageDeps {
  return { client: deps.getClient(), options: deps.options, translate: deps.translate };
}

/** Plan-mandated closing sentence for every tool that reports URLs
 *  (verbatim —「结果必须把 en/zh URL 转述给用户」). */
export const URL_MANDATE = '结果必须把 en/zh URL 转述给用户';

/** Locale-aware engine pair → plain en/zh URL map (the pair is primary-locale
 *  aware; the agent contract is always {en, zh}). */
export function urlPair(pair: LocalePair): { en: string; zh: string } {
  return pair.locale === 'en' ? { en: pair.url, zh: pair.twinUrl } : { en: pair.twinUrl, zh: pair.url };
}

/** URLs for a server-reported path. Mirrors map.ts's *private* urlsOf: a live
 *  page can legally sit on a reserved path (the instance hosts 'home'), so
 *  the raw join is the fallback — never a failure — for read-style output.
 *  map.ts may not be modified, hence the ~10-line reproduction. */
export function reportUrls(baseUrl: string, path: string, locale: Locale): { en: string; zh: string } {
  const raw = (l: Locale): string => `${baseUrl.replace(/\/+$/, '')}/${l}/${path}`;
  try {
    return urlPair(assertLocalePair(path, locale, baseUrl));
  } catch (err) {
    if (!(err instanceof PathValidationError)) throw err;
    return { en: raw('en'), zh: raw('zh') };
  }
}

// --- JSON envelopes ----------------------------------------------------------

const dump = (body: object): string => JSON.stringify(body, null, 2);

export function okJson(body: Record<string, unknown>): ToolResult {
  return dump({ ok: true, ...body });
}

/** Engine error → uniform failure envelope (never a raw stack). */
export function errEnvelope(err: unknown): ToolResult {
  const errorKind = err instanceof Error ? err.name : 'UnknownError';
  const message = err instanceof Error ? err.message : String(err);
  return dump({ ok: false, errorKind, message, actionableHint: hintFor(errorKind) });
}

/** Destructive-action gate: refusal BEFORE any fetch when confirm is absent. */
export function confirmRequiredJson(toolName: string, got: unknown): ToolResult {
  return dump({
    ok: false,
    error: 'confirm-required',
    errorKind: 'ConfirmRequiredError',
    message: `${toolName} requires confirm:"yes" (got ${JSON.stringify(got)})`,
    actionableHint: 'Re-run the tool with confirm:"yes" to acknowledge the destructive action.',
  });
}

/** migrate apply: owned by todo 14 — the stub refuses before any fetch. */
export function notImplementedJson(feature: string, note: string): ToolResult {
  return dump({
    ok: false,
    error: 'not-implemented',
    errorKind: 'NotImplementedError',
    message: `${feature} is not implemented in this release`,
    note,
    actionableHint: 'Use the dry-run mode; the apply path is owned by a later release.',
  });
}

/** errorKind (class name) → what the agent should DO. Default covers
 *  engine-internal errors whose class names map to no dedicated guidance. */
function hintFor(errorKind: string): string {
  switch (errorKind) {
    case 'PathValidationError':
      return 'Correct the path argument per the error message and retry.';
    case 'ContentEmptyError':
      return 'Provide non-empty content, or call historian_page_create without content for a local genre template.';
    case 'ConfirmRequiredError':
      return 'Re-run the tool with confirm:"yes" to acknowledge the destructive action.';
    case 'PageNotFoundError':
      return 'The page does not exist at that path/locale — run historian_map or historian_read to verify.';
    case 'PermissionError':
      return 'The wiki.js token lacks the required scope — check Admin ▸ API Access token groups / page rules (move additionally needs manage:pages).';
    case 'WikiError':
      return 'The wiki rejected the operation — inspect message/errorCode and retry.';
    case 'TranslateError':
      return 'Translation failed — the page may still be saved with zh_status pending; retry translation later.';
    case 'ConfigError':
      return 'Fix the plugin configuration (api key file / env) and retry.';
    case 'HttpError':
      return 'The wiki endpoint is unreachable or misconfigured — check baseUrl and network.';
    case 'GraphQLError':
      return 'The wiki answered a GraphQL error — check the path/locale arguments.';
    default:
      return 'Inspect the message and retry.';
  }
}
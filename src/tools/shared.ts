/**
 * Shared plumbing for the historian_* tool surface (todo 11): the tool
 * dependency bag, locale-aware URL helpers (reserved-path safe), the uniform
 * JSON envelope helpers and the error → envelope mapping.
 *
 * The tools layer is a thin adapter: all wiki logic lives in the engine
 * modules (src/wiki/*, src/map.ts, src/templates/*, src/translate.ts,
 * src/migrate*.ts) and is reused verbatim — no business logic is duplicated
 * here.
 */

import type { ToolResult } from '@opencode-ai/plugin';
import type { GqlClient } from '../wiki/client.js';
import type { HistorianOptions } from '../config.js';
import type { PageDeps } from '../wiki/pages.write.js';
import type { TranslateFn, Locale, PageListItem } from '../wiki/pages.read.js';
import { assertLocalePair, PathValidationError, twinOf, type LocalePair } from '../wiki/locale.js';

/** Per-tool dependency bag; the client is a thunk so a bad key surface at
 *  buildTools time as nothing — only the first execution that touches the
 *  wiki resolves it (and then yields a ConfigError envelope, not a crash).
 *  The thunk is memoized per buildTools call (no module-level cache). */
export interface ToolDeps {
  readonly getClient: () => GqlClient;
  readonly options: HistorianOptions;
  readonly translate?: TranslateFn;
  readonly fetchImpl?: typeof fetch;
  readonly resultsDir?: string;
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

// --- Tier plumbing (v3 todo 4) ------------------------------------------------

/** Machine namespaces: pages whose first path segment lives here are hidden
 *  machine-tier pages (the `_meta/page-map` cache precedent in src/map.ts —
 *  isPublished:false + isPrivate:true + tags + twin:false). */
export const INTERNAL_NAMESPACES = ['_meta', '_evidence'] as const;

/** Plan-mandated note on every evidence-tier success envelope (verbatim). */
export const MACHINE_TIER_NOTE = 'machine-tier page; anonymous visits 404 by design';

/** Tier enum values — single source of truth. The zod schema itself must be
 *  declared locally per tool via `s.enum(TIERS)`: exporting a zod value from
 *  here breaks declaration emit (TS2742 — tool.schema is zod 4.1.8 nested in
 *  @opencode-ai/plugin, unnameable without a zod import, and root zod is v3). */
export const TIERS = ['front', 'evidence'] as const;

/** Page tier: 'front' = bilingual human surface; 'evidence' = machine namespace. */
export type Tier = (typeof TIERS)[number];

/** True when the path's first segment is an internal (machine) namespace. */
export function isInternalPath(path: string): boolean {
  const first = path.split('/')[0];
  return (INTERNAL_NAMESPACES as readonly string[]).includes(first);
}

/** Pure tier↔path guard: null when the pair is legal, an error string when
 *  not (evidence ⇒ internal namespace; front ⇒ NOT internal). */
export function enforceTierPath(tier: Tier, path: string): string | null {
  const internal = isInternalPath(path);
  switch (tier) {
    case 'evidence':
      return internal
        ? null
        : `tier "evidence" requires a machine namespace path (${INTERNAL_NAMESPACES.map((n) => `${n}/`).join(' or ')}) — got '${path}'`;
    case 'front':
      return internal
        ? `tier "front" cannot write to the machine namespace '${path}' — use tier "evidence" for ${INTERNAL_NAMESPACES.map((n) => `${n}/`).join(' or ')} paths`
        : null;
  }
}

/** Tier↔path mismatch → uniform failure envelope (no fetch has run yet). */
export function tierMismatchJson(message: string): ToolResult {
  return dump({
    ok: false,
    error: 'tier-path-mismatch',
    errorKind: 'TierPathMismatchError',
    message,
    actionableHint: 'Pass the tier that matches the path namespace: _meta/ and _evidence/ are machine (evidence) paths; everything else is front.',
  });
}

/** Evidence-tier zh-side input → refusal envelope (monolingual invariant). */
export function monolingualRefusalJson(toolName: string, argumentName: string): ToolResult {
  return dump({
    ok: false,
    error: 'evidence-monolingual',
    errorKind: 'TierMonolingualError',
    message: `${toolName} received "${argumentName}" on an evidence-tier page, which is monolingual en`,
    actionableHint: 'Drop the zh-side argument (locale "zh" / sectionZh) — evidence machine pages never carry a bilingual twin.',
  });
}

// --- Front-tier raw-dump soft gate (v3 todo 6) --------------------------------

/** Contract band (SKILL.md SYN-16): a human page stays a 5-10 line excerpt;
 *  longer raw material belongs on an evidence page. Strictly ABOVE this many
 *  fence-interior lines triggers the advisory — 30 is the soft gate, never a
 *  hard refusal. Deliberately layered vs the contract bands; do not unify. */
const FRONT_DUMP_FENCE_LIMIT = 30;

/** Longest fenced code block in the content, counting lines STRICTLY inside
 *  the ``` fences (fence markers excluded). An unterminated fence counts to
 *  EOF. Fences opening at line start (after optional indentation) close on
 *  the next ```-leading line. */
function longestFenceLines(content: string): number {
  let longest = 0;
  let inside = false;
  let count = 0;
  for (const line of content.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      if (inside) {
        if (count > longest) longest = count;
        inside = false;
        count = 0;
      } else {
        inside = true;
        count = 0;
      }
    } else if (inside) {
      count++;
    }
  }
  if (inside && count > longest) longest = count; // unterminated fence → EOF
  return longest;
}

/** Soft-gate advisory for front-tier raw dumps: null when nothing to say
 *  (evidence tier NEVER checked — machine pages are the raw-material home;
 *  fence at or under the limit). The advisory is informational only: every
 *  caller still performs the write. */
export function frontDumpAdvisory(tier: Tier, content: string): string | null {
  if (tier !== 'front') return null;
  const lines = longestFenceLines(content);
  if (lines <= FRONT_DUMP_FENCE_LIMIT) return null;
  return (
    `content contains a ${lines}-line fenced block; per contract, move raw material to a ` +
    `tier:"evidence" page under _evidence/ and link it from the human page (SYN-16)`
  );
}

// --- Create-path collision advisory (v4 todo 3) --------------------------------

/** Title equality for duplicate detection: trim, collapse internal whitespace,
 *  casefold — 'LLM Eval' == ' llm\neval '. */
function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

/** Number of duplicate paths shown verbatim before the overflow count. */
const COLLISION_DUPE_DISPLAY_LIMIT = 3;

export interface CollisionInput {
  readonly tier: Tier;
  readonly path: string;
  readonly locale: Locale;
  readonly title: string;
  readonly baseUrl: string;
  /** Exact-(path, locale) pre-read result. A FAILED read must pass false — a
   *  transport hiccup never masquerades as a collision (the write proceeds
   *  with no advice rather than with wrong advice). */
  readonly exists: boolean;
  /** listPages inventory snapshot; a failed listPages read yields [] → no
   *  duplicate advice, only the (independent) path-existence line can fire. */
  readonly inventory: readonly PageListItem[];
}

/** Advisory-only duplicate detector for historian_page_create:
 *  (a) the exact target (path, locale) already exists → prefer
 *      historian_page_update, with the page URL;
 *  (b) the same normalized title lives on a DIFFERENT non-machine path →
 *      疑似重复 … 先读再写, with each path's URLs (first 3, then a count).
 *  Pure over its inputs and advisory-only: it NEVER throws and NEVER blocks —
 *  a same-path other-locale twin is not a duplicate, evidence-tier writes skip
 *  (b) (raw-material pages legitimately echo human titles), and machine
 *  namespaces (_meta/, _evidence/) never surface as duplicates. */
export function collisionAdvisory(input: CollisionInput): string | null {
  const parts: string[] = [];
  if (input.exists) {
    const urls = reportUrls(input.baseUrl, input.path, input.locale);
    parts.push(
      `path exists — '${input.path}' (${input.locale}) already holds a page; ` +
        `prefer historian_page_update to amend it; ${urls[input.locale]}`,
    );
  }
  const norm = normalizeTitle(input.title);
  if (input.tier === 'front' && norm !== '') {
    const dupes = input.inventory.filter(
      (row) => row.path !== input.path && !isInternalPath(row.path) && normalizeTitle(row.title) === norm,
    );
    const paths = [...new Set(dupes.map((row) => row.path))];
    if (paths.length > 0) {
      const shown = paths.slice(0, COLLISION_DUPE_DISPLAY_LIMIT).map((p) => {
        const urls = reportUrls(input.baseUrl, p, input.locale);
        return `${p} (en=${urls.en} zh=${urls.zh})`;
      });
      const overflow = paths.length - shown.length;
      parts.push(
        `疑似重复: title matches other path(s) ${shown.join('; ')}` +
          (overflow > 0 ? ` +${overflow} more` : '') +
          ` — 先读再写 (historian_read the existing page, prefer historian_page_update over a new twin)`,
      );
    }
  }
  return parts.length === 0 ? null : parts.join('\n');
}
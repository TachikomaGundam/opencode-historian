/**
 * Configuration model for the opencode-historian plugin.
 *
 * The plugin keeps a zero-runtime-dependency surface: no zod, no bun, only
 * node builtins. Secrets are resolved from explicit sources (raw plugin
 * options, env vars, the machine's opencode.jsonc) and never from the network.
 *
 * Home directory and env are injectable parameters on every resolver so unit
 * tests drive fixtures in tmp dirs — the real ~/.config is never touched by
 * the suite (see test/config.test.ts).
 */

import { homedir } from 'node:os';
import { readFileSync } from 'node:fs';
import { parseJsonc, isRecord } from './jsonc.js';
import { ConfigError } from './jsonc.js';

// Contract re-exports: consumers (client.ts, translate.ts) import these from
// './config.js'.
export { ConfigError } from './jsonc.js';
export type { ConfigErrorCode } from './jsonc.js';

// --- Public types -----------------------------------------------------------

/** Fully resolved plugin options. All fields are non-optional; = what the
 *  rest of the plugin (client, translate engine) consumes. */
export interface HistorianOptions {
  readonly baseUrl: string;
  /** Raw path; may contain a leading `~`, which `readWikiApiKey` expands at
   *  read time (the key file is not read during option resolution). */
  readonly apiKeyPath: string;
  readonly translate: Readonly<{
    /** Empty string = NOT CONFIGURED. Resolution chain: raw option →
     *  env HISTORIAN_TRANSLATE_ENDPOINT → unset. The shipped package
     *  deliberately carries no endpoint default; every translate call
     *  degrades to TranslateError('config') before touching the network. */
    readonly endpoint: string;
    readonly model: string;
    readonly apiKey: string;
    /** jsonc provider whose `options.apiKey` is the third translation-key
     *  trust leg (see resolveTranslationApiKey). Empty string = NOT
     *  CONFIGURED: the jsonc leg is opt-in via `translate.providerKey`;
     *  the shipped package carries no default provider name. */
    readonly providerKey: string;
  }>;
  /** Path-prefix whitelist. Empty (the shipped default) = no restriction —
   *  any syntactically valid path is allowed; wiki.js page-rules remain the
   *  real authorization gate. Consumers must treat [] as allow-any. */
  readonly sections: readonly string[];
  readonly locales: readonly string[];
  /** v2 reading-loop gate: true (the shipped default) makes the plugin push a
   *  consult-the-wiki advisory block into every chat request's system array via
   *  the experimental.chat.system.transform hook. false = hook is a pure no-op. */
  readonly readingLoop: boolean;
}

/** Raw, user-supplied plugin options (the opencode PluginOptions shape).
 *  Every field optional — unresolved fields fall back to defaults / env. */
export interface HistorianPluginOptions {
  readonly baseUrl?: string;
  readonly apiKeyPath?: string;
  readonly translate?: Readonly<{
    readonly endpoint?: string;
    readonly model?: string;
    readonly apiKey?: string;
    /** jsonc provider name for the apiKey fallback leg. No default: when
     *  unset the jsonc leg never runs. */
    readonly providerKey?: string;
  }>;
  readonly sections?: readonly string[];
  readonly locales?: readonly string[];
  readonly readingLoop?: boolean;
}

// --- Defaults (single source of truth for the plan's contract) --------------
// Machine-agnostic by contract: the shipped package carries no deployment's
// section taxonomy, translation gateway URL, or provider layout.

export const DEFAULT_BASE_URL = 'http://localhost:3000';
export const DEFAULT_API_KEY_PATH = '~/.wikijs-api-key';
/** Env leg of the endpoint chain: raw option → this env var → unset (''). */
export const ENV_TRANSLATE_ENDPOINT = 'HISTORIAN_TRANSLATE_ENDPOINT';
export const DEFAULT_TRANSLATE_MODEL = 'qwen3.7-plus';
/** Empty = no path-prefix restriction (see HistorianOptions.sections). */
export const DEFAULT_SECTIONS: readonly string[] = [];
export const DEFAULT_LOCALES = ['en', 'zh'] as const;
/** Reading loop is on unless explicitly disabled (plan v2 todo 8). */
export const DEFAULT_READING_LOOP = true;

// --- Resolution -------------------------------------------------------------

/**
 * Resolve raw plugin options against defaults, env vars and the machine's
 * `~/.config/opencode/opencode.jsonc` into a fully typed HistorianOptions.
 *
 * Translation key priority (highest wins):
 *   1. raw.translate.apiKey
 *   2. env DASHSCOPE_API_KEY
 *   3. jsonc provider[translate.providerKey].options.apiKey — only when
 *      `translate.providerKey` is set explicitly (no default provider name)
 *   4. throw ConfigError('missing translation key')
 *
 * Translation endpoint priority: raw.translate.endpoint →
 * env HISTORIAN_TRANSLATE_ENDPOINT → unset (''). There is no baked-in
 * gateway URL; an unset endpoint degrades translate calls to
 * TranslateError('config') (twins go pending, see translate.ts).
 *
 * There is deliberately NO anthropic fallback leg (removed by plan — the
 * provider layout varies per machine; the jsonc leg is opt-in via
 * translate.providerKey).
 */
export function resolveOptions(
  raw: Partial<HistorianPluginOptions>,
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): HistorianOptions {
  const providerKey = raw.translate?.providerKey ?? '';
  const translateApiKey = resolveTranslationApiKey(raw, env, homeDir, providerKey);
  return {
    baseUrl: raw.baseUrl ?? DEFAULT_BASE_URL,
    apiKeyPath: raw.apiKeyPath ?? DEFAULT_API_KEY_PATH,
    translate: {
      endpoint: raw.translate?.endpoint ?? env[ENV_TRANSLATE_ENDPOINT] ?? '',
      model: raw.translate?.model ?? DEFAULT_TRANSLATE_MODEL,
      apiKey: translateApiKey,
      providerKey,
    },
    sections: raw.sections ?? DEFAULT_SECTIONS,
    locales: raw.locales ?? DEFAULT_LOCALES,
    readingLoop: raw.readingLoop ?? DEFAULT_READING_LOOP,
  };
}

function resolveTranslationApiKey(
  raw: Partial<HistorianPluginOptions>,
  env: NodeJS.ProcessEnv,
  homeDir: string,
  providerKey: string,
): string {
  const rawKey = raw.translate?.apiKey;
  if (isNonEmpty(rawKey)) return rawKey;

  const envKey = env.DASHSCOPE_API_KEY;
  if (isNonEmpty(envKey)) return envKey;

  if (providerKey !== '') {
    const jsoncKey = readProviderApiKeyFromJsonc(homeDir, providerKey);
    if (isNonEmpty(jsoncKey)) return jsoncKey;
  }

  const jsoncHint =
    providerKey !== ''
      ? `add provider["${providerKey}"].options.apiKey`
      : `set translate.providerKey and add the key to provider["<name>"].options.apiKey`;
  throw new ConfigError(
    'missing-translation-key',
    `Missing translation api key: set plugin option translate.apiKey, ` +
      `export DASHSCOPE_API_KEY, or ${jsoncHint} ` +
      `in ${opencodeJsoncPath(homeDir)}.`,
  );
}

/**
 * Read the wiki.js api key. Priority: key file (path from options.apiKeyPath,
 * `~` expanded) first; env WIKIJS_API_KEY as fallback; ConfigError otherwise.
 * The key file content is trimmed (a trailing newline is common).
 */
export function readWikiApiKey(
  options: HistorianOptions,
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = homedir(),
): string {
  const expandedPath = expandHome(options.apiKeyPath, homeDir);
  let fileKey: string | undefined;
  try {
    fileKey = readFileSync(expandedPath, 'utf8').trim();
  } catch {
    fileKey = undefined; // fall through to env leg; the thrown error names the path
  }
  if (isNonEmpty(fileKey)) return fileKey;

  const envKey = env.WIKIJS_API_KEY;
  if (isNonEmpty(envKey)) return envKey;

  throw new ConfigError(
    'missing-wiki-api-key',
    `Missing wiki.js api key: create '${expandedPath}' containing the token ` +
      '(one line, trimmed on read) or export WIKIJS_API_KEY.',
  );
}

// --- jsonc source leg -------------------------------------------------------

function opencodeJsoncPath(homeDir: string): string {
  return `${homeDir}/.config/opencode/opencode.jsonc`;
}

/** Read provider[providerKey].options.apiKey from the machine config.
 *  Missing file or missing key -> undefined (a later leg decides); malformed
 *  file -> ConfigError. Commented-out apiKey lines never survive stripping. */
function readProviderApiKeyFromJsonc(homeDir: string, providerKey: string): string | undefined {
  const path = opencodeJsoncPath(homeDir);
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return undefined; // no config file -> simply not a key source
  }

  const parsed: unknown = parseJsonc(content, path);
  if (!isRecord(parsed)) {
    throw new ConfigError(
      'invalid-jsonc',
      `Invalid opencode config '${path}': top-level value must be a JSON object.`,
    );
  }

  const provider = parsed.provider;
  if (!isRecord(provider)) return undefined; // no providers at all -> not a key source
  const chosen = provider[providerKey];
  if (!isRecord(chosen)) return undefined;
  const options = chosen.options;
  if (!isRecord(options)) return undefined;
  const apiKey = options.apiKey;

  return typeof apiKey === 'string' && apiKey.trim() !== '' ? apiKey : undefined;
}

// --- small helpers ----------------------------------------------------------

function isNonEmpty(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/** Expand a leading `~` in a path against homeDir. Only `~` and `~/...` are
 *  supported (no `~user` forms). */
function expandHome(p: string, homeDir: string): string {
  if (p === '~') return homeDir;
  if (p.startsWith('~/')) return `${homeDir}/${p.slice(2)}`;
  return p;
}
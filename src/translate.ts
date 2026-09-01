/**
 * DashScope Anthropic-compatible translation engine (replaces wiki-biling.py).
 * Every failure surfaces as a named TranslateError. URL: append /v1/messages
 * unless the endpoint already ends with /v1 or /v1/messages (double-v1 trap,
 * machine-verified). Key redacted from body-derived details; no retry loop
 * (chunked translation is deterministic, each request costs quota).
 */

import type { HistorianOptions } from './config.js';
import type { Locale, TranslateFn } from './wiki/pages.read.js';
import { isRecord } from './jsonc.js';

// --- Error taxonomy ---------------------------------------------------------

export type TranslateErrorCause = 'network' | 'http' | 'malformed' | 'truncated' | 'timeout';

export class TranslateError extends Error {
  readonly cause: TranslateErrorCause;
  readonly detail: string;

  constructor(cause: TranslateErrorCause, detail: string) {
    super(`translate ${cause}: ${detail}`);
    this.name = 'TranslateError';
    this.cause = cause;
    this.detail = detail;
  }
}

// --- Constants (legacy wiki-biling values, config-driven via opts) ----------

export const DEFAULT_TRANSLATE_TIMEOUT_MS = 300_000;
const MAX_CHUNK_CHARS = 4000;
const SHORT_TEXT_CHARS = 1500;
const SHORT_MAX_TOKENS = 500;
const LONG_MAX_TOKENS = 32_000;
const ANTHROPIC_VERSION = '2023-06-01';

// --- URL normalization ------------------------------------------------------

export function normalizeMessagesUrl(endpoint: string): string {
  const base = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
  const lower = base.toLowerCase();
  if (lower.endsWith('/v1/messages') || lower.endsWith('/v1')) return base;
  return `${base}/v1/messages`;
}

// --- Chunking ---------------------------------------------------------------

const FENCE_LINE = /^\s*```/;

/** True when the block toggles the fence-open state (odd delimiter count). */
function togglesFence(block: string): boolean {
  return block.split('\n').reduce((c, l) => (FENCE_LINE.test(l) ? c + 1 : c), 0) % 2 === 1;
}

/** Split on blank lines into groups of at most `max` chars. Oversized single
 *  blocks and fence runs pass through whole (never split inside ``` fences),
 *  so rejoining translated groups with '\n\n' reproduces the input structure. */
export function splitMarkdownBlocks(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const groups: string[] = [];
  let current: string[] = [];
  let currentLen = 0;
  let inFence = false;
  const flush = (): void => {
    if (current.length > 0) groups.push(current.join('\n\n'));
    current = [];
    currentLen = 0;
  };
  for (const block of text.split(/\n\s*\n/)) {
    if (inFence) {
      current.push(block);
      currentLen += 2 + block.length;
      if (togglesFence(block)) {
        inFence = false;
        flush();
      }
      continue;
    }
    if (togglesFence(block)) {
      if (currentLen > 0) flush();
      inFence = true;
      current.push(block);
      currentLen = block.length;
      continue;
    }
    if (currentLen > 0 && currentLen + 2 + block.length > max) flush();
    current.push(block);
    currentLen = currentLen === 0 ? block.length : currentLen + 2 + block.length;
  }
  flush();
  return groups;
}

// --- Response parsing -------------------------------------------------------

/** Primary: the first content part when it is a text part. Fallback: join
 *  all text-type parts (content[0] may be a tool_use part). Missing/empty
 *  text is malformed — never silently translated to ''. */
export function pickResponseText(json: unknown): string {
  if (!isRecord(json)) throw new TranslateError('malformed', 'response body is not a JSON object');
  const content = json.content;
  if (!Array.isArray(content)) {
    throw new TranslateError('malformed', 'response content is missing or not an array');
  }
  const texts: string[] = [];
  for (const part of content) {
    if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
      texts.push(part.text);
    }
  }
  if (texts.length === 0) {
    throw new TranslateError('malformed', 'response content has no text parts');
  }
  const out =
    isRecord(content[0]) && content[0].type === 'text' && typeof content[0].text === 'string'
      ? content[0].text
      : texts.join('');
  if (out === '') throw new TranslateError('malformed', 'response text is empty');
  return out;
}

// --- System prompt ----------------------------------------------------------

/** Machine-consumed routing tokens (DIRECTION, GLOSSARY table) plus the
 *  untranslatable-surface rules. Tests pin the tokens, not the prose. */
export function buildSystemPrompt(
  from: Locale,
  to: Locale,
  glossary?: Record<string, string>,
): string {
  const lines = [
    `DIRECTION: ${from}->${to}`,
    'Translate only natural prose. Preserve markdown structure exactly: do not translate code blocks, inline code, URLs, HTML tags, .is-* marker classes, table cell structure (pipes, alignment rows), numbers, or IDs.',
  ];
  if (glossary !== undefined) {
    lines.push('GLOSSARY:');
    for (const [term, translation] of Object.entries(glossary)) {
      lines.push(`${term}|${translation}`);
    }
  }
  return lines.join('\n');
}

// --- Engine -----------------------------------------------------------------

export interface TranslateDeps {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly glossary?: Record<string, string>;
}

export function makeTranslator(opts: HistorianOptions, deps?: TranslateDeps): TranslateFn {
  const url = normalizeMessagesUrl(opts.translate.endpoint);
  const key = opts.translate.apiKey;
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TRANSLATE_TIMEOUT_MS;
  const glossary = deps?.glossary;

  return async (text, from, to): Promise<string> => {
    const chunks = splitMarkdownBlocks(text, MAX_CHUNK_CHARS);
    const translated: string[] = [];
    for (const chunk of chunks) {
      translated.push(await translateChunk(chunk, from, to));
    }
    return translated.join('\n\n');
  };

  async function translateChunk(chunk: string, from: Locale, to: Locale): Promise<string> {
    const maxTokens = chunk.length < SHORT_TEXT_CHARS ? SHORT_MAX_TOKENS : LONG_MAX_TOKENS;
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: opts.translate.model,
          max_tokens: maxTokens,
          system: buildSystemPrompt(from, to, glossary),
          messages: [{ role: 'user', content: chunk }],
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new TranslateError('timeout', `request to ${url} timed out after ${timeoutMs}ms`);
      }
      throw new TranslateError(
        'network',
        `request to ${url} failed: ${redact(err instanceof Error ? err.message : String(err), key)}`,
      );
    }
    const rawBody = redact(await readTextSafely(res), key);
    if (res.status < 200 || res.status >= 300) {
      throw new TranslateError('http', `HTTP ${res.status} from ${url}: ${snippetOf(rawBody)}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new TranslateError('malformed', `non-json response from ${url}: ${snippetOf(rawBody)}`);
    }
    if (isRecord(parsed) && parsed.stop_reason === 'max_tokens') {
      throw new TranslateError('truncated', `response stop_reason 'max_tokens' from ${url}`);
    }
    return pickResponseText(parsed);
  }
}

// --- small helpers (client.ts's guard patterns, kept local) -----------------

function isAbortError(err: unknown): boolean {
  return (
    err !== null && typeof err === 'object' && (err as { name?: unknown }).name === 'AbortError'
  );
}

const redact = (text: string, key: string): string =>
  key === '' || !text.includes(key) ? text : text.split(key).join('<redacted>');

const snippetOf = (text: string): string =>
  text.length <= 200 ? text : `${text.slice(0, 200)}…`;

async function readTextSafely(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
/**
 * JSONC parsing for opencode's `~/.config/opencode/opencode.jsonc`.
 *
 * String-aware comment stripping — a `//` or `/*` inside a quoted string
 * (e.g. "https://...") is literal, never a comment. Malformed input always
 * surfaces as ConfigError, never a raw SyntaxError.
 */

export type ConfigErrorCode =
  | 'missing-translation-key'
  | 'invalid-jsonc'
  | 'missing-wiki-api-key';

/** Structured configuration error. `code` lets callers branch programmatically;
 *  `message` is written for a human to act on. Never throw bare strings. */
export class ConfigError extends Error {
  readonly code: ConfigErrorCode;

  constructor(code: ConfigErrorCode, message: string) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
  }
}

/** Parse JSONC into an unknown value. `path` is used in error messages. */
export function parseJsonc(content: string, path: string): unknown {
  const stripped = stripComments(content, path);
  const withCommasStripped = stripTrailingCommas(stripped, path);
  try {
    return JSON.parse(withCommasStripped) as unknown;
  } catch (err) {
    throw new ConfigError(
      'invalid-jsonc',
      `Invalid opencode config '${path}': JSON parse failed (${(err as Error).message}).`,
    );
  }
}

/** Character scanner (not regex) so comment markers inside strings stay literal. */
function stripComments(content: string, path: string): string {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const next = content[i + 1];

    if (inLineComment) {
      if (c === '\n') {
        inLineComment = false;
        out += c;
      }
      continue;
    }
    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += c;
      if (c === '\\' && next !== undefined) {
        out += next;
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (c === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    out += c;
  }

  if (inBlockComment) {
    throw new ConfigError('invalid-jsonc', `Invalid opencode config '${path}': unterminated block comment.`);
  }
  if (inString) {
    throw new ConfigError('invalid-jsonc', `Invalid opencode config '${path}': unterminated string.`);
  }
  return out;
}

/** Drop commas that trail an object/array entry: `[1,2,]` -> `[1,2]`. */
function stripTrailingCommas(content: string, path: string): string {
  let out = '';
  let inString = false;

  for (let i = 0; i < content.length; i++) {
    const c = content[i];

    if (inString) {
      out += c;
      if (c === '\\' && content[i + 1] !== undefined) {
        out += content[i + 1];
        i++;
      } else if (c === '"') {
        inString = false;
      }
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (c === ',') {
      let j = i + 1;
      while (
        j < content.length &&
        (content[j] === ' ' || content[j] === '\t' || content[j] === '\n' || content[j] === '\r')
      ) {
        j++;
      }
      if (content[j] === '}' || content[j] === ']') {
        continue; // drop the trailing comma
      }
      out += c;
      continue;
    }
    out += c;
  }

  if (inString) {
    throw new ConfigError('invalid-jsonc', `Invalid opencode config '${path}': unterminated string.`);
  }
  return out;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
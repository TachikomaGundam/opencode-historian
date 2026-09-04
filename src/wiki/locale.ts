/**
 * Path validation + locale URL model.
 *
 * This module is the boundary parser for wiki.js URLs: every path segment
 * must be safe for the wiki.js router (no path traversal, no reserved words
 * that collide with wiki.js's own endpoints, no locale-shaped first segments
 * that wiki.js `parsePath` would reinterpret as a namespace prefix — pitfall
 * #9). Errors are thrown as `PathValidationError` with ACTIONABLE messages
 * naming the offending segment + the rule, so callers (pages.ts, tools.ts)
 * surface the diagnostic directly to the user.
 */

// --- Error ------------------------------------------------------------------

export class PathValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathValidationError';
  }
}

// --- Constants --------------------------------------------------------------

const RESERVED_WORDS = new Set([
  'home',
  'login',
  'register',
  'graphql',
  'healthz',
  '_assets',
  'favicon',
]);

// wiki.js parsePath treats ANY 2-letter (or 2-letter + dash + 2-letter) first
// segment as a locale candidate. Rejecting shape-matches (not a fixed list) is
// the only way to stop wiki.js from silently reinterpreting `zh/foo` as
// "locale=zh, path=foo" and creating a duplicate namespace. This applies
// equally to `xy/foo` — the shape is the danger, not the specific letters.
const LOCALE_SHAPE = /^[A-Za-z]{2}(-[A-Za-z]{2})?$/;

const SEGMENT_CHARS = /^[A-Za-z0-9._-]+$/;

// --- validatePath -----------------------------------------------------------

/**
 * Reject paths that wiki.js would misinterpret or that are unsafe:
 *
 *  1. empty / whitespace-only
 *  2. absolute (leading `/`)
 *  3. contains `..` (path traversal)
 *  4. contains space, backslash, or `//` (wiki.js URL-unsafe)
 *  5. first segment matches the locale shape (pitfall #9)
 *  6. any segment is length 1 (wiki.js rejects single-char path components)
 *  7. any segment contains characters outside `[A-Za-z0-9._-]`
 *  8. any segment is a reserved word (wiki.js endpoint collision), except the
 *     exact top-level 'home' (a live published path — see D9 note at the check)
 *
 * Order matters: cheap substring checks first, then per-segment rules.
 * Every rejection names the offending segment + the rule in the message.
 */
export function validatePath(p: string): void {
  if (p.trim() === '') {
    throw new PathValidationError(
      `path is empty or whitespace-only (got ${JSON.stringify(p)})`,
    );
  }
  if (p.startsWith('/')) {
    throw new PathValidationError(
      `path must not be absolute (got leading '/'; drop the leading slash)`,
    );
  }
  if (p.includes('..')) {
    throw new PathValidationError(
      `path contains '..' (path traversal; remove any '..' segment)`,
    );
  }
  if (p.includes(' ')) {
    throw new PathValidationError(
      `path contains a space character (spaces are URL-unsafe in wiki.js paths)`,
    );
  }
  if (p.includes('\\')) {
    throw new PathValidationError(
      `path contains a backslash (use '/' as the segment separator)`,
    );
  }
  if (p.includes('//')) {
    throw new PathValidationError(
      `path contains '//' (empty segment between two slashes; remove the duplicate separator)`,
    );
  }

  const segments = p.split('/');
  const first = segments[0];
  if (first === undefined) {
    throw new PathValidationError(`path has no segments (got ${JSON.stringify(p)})`);
  }
  if (LOCALE_SHAPE.test(first)) {
    throw new PathValidationError(
      `first segment '${first}' matches the locale shape (2 letters, optionally +dash+2 letters); ` +
        `wiki.js would reinterpret it as a namespace prefix — use a longer or digit-bearing name`,
    );
  }

  for (const seg of segments) {
    if (seg.length === 1) {
      throw new PathValidationError(
        `segment '${seg}' has length 1 (wiki.js rejects single-character path segments)`,
      );
    }
    if (!SEGMENT_CHARS.test(seg)) {
      throw new PathValidationError(
        `segment '${seg}' contains invalid characters (allowed: [A-Za-z0-9._-])`,
      );
    }
    // D9 bypass (probe p1): wiki.js 2.5.314 hosts a live published page at
    // path=home (id48, en+zh) — the reserved-word block was plugin-side
    // folklore, not a server limit. Allow the EXACT top-level segment 'home'
    // only; nested 'home' (foo/home) and case variants (HOME) stay rejected.
    const isExactTopLevelHome = segments.length === 1 && seg === 'home';
    if (!isExactTopLevelHome && RESERVED_WORDS.has(seg.toLowerCase())) {
      throw new PathValidationError(
        `segment '${seg}' is a reserved wiki.js word (home|login|register|graphql|healthz|_assets|favicon)`,
      );
    }
  }
}

// --- normalizeLocale --------------------------------------------------------

/**
 * Map a locale input to the instance's active locale set (en | zh).
 *
 * Whitelist (case-insensitive):
 *  - 'en', 'en-<region>'  -> 'en'
 *  - 'zh', 'zh-cn'        -> 'zh'
 *
 * Everything else (including 'zh-tw', 'zh-hant', 'de', '') throws
 * PathValidationError naming the input. Silent mapping of unsupported
 * variants (e.g. zh-tw -> zh) would hide config drift, so it is forbidden.
 */
export function normalizeLocale(l: string): 'en' | 'zh' {
  const lower = l.toLowerCase();
  if (lower === 'en') return 'en';
  if (lower === 'zh') return 'zh';
  if (lower === 'zh-cn') return 'zh';
  if (lower.startsWith('en-')) return 'en';
  throw new PathValidationError(
    `unsupported locale '${l}' (instance whitelist: en, zh, en-<region>, zh-cn)`,
  );
}

// --- localeUrl --------------------------------------------------------------

/**
 * Compose `<baseUrl>/<locale>/<path>` with a single slash between each part.
 * Trailing slashes on baseUrl are stripped. Caller must pass a normalized
 * locale (run normalizeLocale first); path is validated via validatePath.
 */
export function localeUrl(baseUrl: string, locale: 'en' | 'zh', path: string): string {
  validatePath(path);
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/${locale}/${path}`;
}

// --- twinOf ----------------------------------------------------------------

/**
 * Return the other locale of the (en, zh) pair. Exhaustive switch — no
 * default leg; the TS compiler enforces completeness at compile time.
 */
export function twinOf(locale: 'en' | 'zh'): 'en' | 'zh' {
  switch (locale) {
    case 'en':
      return 'zh';
    case 'zh':
      return 'en';
  }
}

// --- assertLocalePair -------------------------------------------------------

export interface LocalePair {
  readonly path: string;
  readonly locale: 'en' | 'zh';
  readonly url: string;
  readonly twinLocale: 'en' | 'zh';
  readonly twinUrl: string;
}

/**
 * Build the (url, twinUrl) pair for a path at the given locale. Used by
 * pages.ts to return both the canonical URL and its twin in every tool
 * result (plan contract: every page op returns both URLs).
 */
export function assertLocalePair(
  path: string,
  locale: 'en' | 'zh',
  baseUrl: string,
): LocalePair {
  const twin = twinOf(locale);
  return {
    path,
    locale,
    url: localeUrl(baseUrl, locale, path),
    twinLocale: twin,
    twinUrl: localeUrl(baseUrl, twin, path),
  };
}

import { describe, it, expect } from 'vitest';
import {
  validatePath,
  normalizeLocale,
  localeUrl,
  twinOf,
  assertLocalePair,
  PathValidationError,
} from '../src/wiki/locale.js';

// Pure-module tests: no network, no fs. Adversarial class = malformed_input
// (the whole module is a boundary parser); every reject case asserts the
// actionable error message names the offending segment/rule.

const BASE = 'http://localhost:3000';

// --- validatePath ----------------------------------------------------------

describe('validatePath rejects', () => {
  const rejects = (input: string, fragment: string): void => {
    expect(() => validatePath(input)).toThrow(PathValidationError);
    try {
      validatePath(input);
    } catch (err) {
      expect((err as PathValidationError).message.toLowerCase()).toContain(fragment);
    }
  };

  it('empty string', () => rejects('', 'empty'));
  it('whitespace-only string', () => rejects('   ', 'empty'));
  it('leading slash (absolute path)', () => rejects('/foo/bar', 'absolute'));
  it('double dot segment', () => rejects('foo/../bar', '..'));
  it('double dot in middle', () => rejects('foo/..hidden/bar', '..'));
  it('space in segment', () => rejects('foo/bar baz', 'space'));
  it('backslash separator', () => rejects('foo\\bar', 'backslash'));
  it('double slash', () => rejects('foo//bar', '//'));
  // v0.4.0 (v4 plan D9): the EXACT top-level segment 'home' is allowed — the
  // instance hosts a live published page at path=home (wiki.js 2.5.314, id48,
  // en+zh). Every other 'home' shape keeps today's reserved-word rejection.
  it('reserved word: HOME upper (bypass is exact lowercase only)', () => rejects('HOME', 'home'));
  it('home as nested segment (pinned: still rejected)', () => rejects('foo/home', 'home'));
  it('home as second segment (pinned: still rejected)', () => rejects('ops/home', 'home'));
  it('reserved word as second segment', () => rejects('ops/login', 'login'));
  it('reserved word: _assets', () => rejects('_assets/img', '_assets'));
  it('reserved word: favicon', () => rejects('favicon', 'favicon'));
  it('reserved word: graphql (nested)', () => rejects('ops/graphql', 'graphql'));
  it('reserved word: healthz', () => rejects('healthz', 'healthz'));
  it('reserved word: register', () => rejects('register', 'register'));

  // Plan-mandated locale-shape rejections (case-insensitive first segment).
  it('zh/foo — first seg is a locale shape (plan-mandated)', () => rejects('zh/foo', 'locale'));
  it('ZH/foo — uppercase still rejected (plan-mandated)', () => rejects('ZH/foo', 'locale'));
  it('en-GB/x — 4-letter locale-with-region (plan-mandated)', () => rejects('en-GB/x', 'locale'));
  it('xy/foo — generic 2-letter first seg also matches locale shape', () => rejects('xy/foo', 'locale'));
  it('ab/c — another 2-letter shape rejection', () => rejects('ab/c', 'locale'));

  // Single-character segments.
  it('a/foo — single-char first seg (plan-mandated)', () => rejects('a/foo', 'length'));
  it('foo/b — single-char second seg', () => rejects('foo/b', 'length'));

  // Non-ASCII / invalid character segments (after shape checks pass).
  it('故障/x — non-ASCII segment', () => rejects('故障/x', '故障'));
  it('foo/émoji — non-ASCII segment', () => rejects('foo/émoji', 'émoji'));
  it('foo/bar! — forbidden punctuation', () => rejects('foo/bar!', 'bar!'));
});

describe('validatePath accepts', () => {
  const accepts = (input: string): void => {
    expect(() => validatePath(input)).not.toThrow();
  };

  // D9 bypass: top-level 'home' (exact, lowercase) is a legal live path.
  it('home (exact top-level — live page id48)', () => accepts('home'));
  it('ops/foo (real section)', () => accepts('ops/foo'));
  it('_sandbox/incident-2026-09-01', () => accepts('_sandbox/incident-2026-09-01'));
  it('llm-server/vllm-notes', () => accepts('llm-server/vllm-notes'));
  it('foo/bar.md (file extension preserved)', () => accepts('foo/bar.md'));
  it('_meta/page-map', () => accepts('_meta/page-map'));
  it('a-very-long-first-segment/y (not a locale shape — >2 letters)', () =>
    accepts('a-very-long-first-segment/yy'));
  it('ab1/y (3 chars starting with 2 letters — not locale shape, has digit)', () =>
    accepts('ab1/yy'));
  it('a1b/y (mixed — not locale shape)', () => accepts('a1b/yy'));
  it('abc/y (3-letter first seg, no dash — not locale shape)', () => accepts('abc/yy'));
  it('deeply/nested/path/ok', () => accepts('deeply/nested/path/ok'));
});

// --- normalizeLocale -------------------------------------------------------

describe('normalizeLocale', () => {
  it('exact en', () => expect(normalizeLocale('en')).toBe('en'));
  it('exact zh', () => expect(normalizeLocale('zh')).toBe('zh'));
  it('zh-cn maps to zh', () => expect(normalizeLocale('zh-cn')).toBe('zh'));
  it('zh-CN maps to zh', () => expect(normalizeLocale('zh-CN')).toBe('zh'));
  it('ZH-CN maps to zh (uppercase)', () => expect(normalizeLocale('ZH-CN')).toBe('zh'));
  it('en-us maps to en', () => expect(normalizeLocale('en-us')).toBe('en'));
  it('en-GB maps to en (mixed case)', () => expect(normalizeLocale('en-GB')).toBe('en'));
  it('EN upper maps to en', () => expect(normalizeLocale('EN')).toBe('en'));

  it('de rejected (unsupported locale)', () => {
    expect(() => normalizeLocale('de')).toThrow(PathValidationError);
    try {
      normalizeLocale('de');
    } catch (err) {
      expect((err as PathValidationError).message).toContain('de');
    }
  });

  // zh-TW and zh-Hant are NOT in the instance whitelist; silent mapping
  // would hide config drift.
  it('zh-TW rejected (not in instance whitelist)', () => {
    expect(() => normalizeLocale('zh-TW')).toThrow(PathValidationError);
    try {
      normalizeLocale('zh-TW');
    } catch (err) {
      expect((err as PathValidationError).message).toContain('zh-TW');
    }
  });
  it('zh-Hant rejected', () => {
    expect(() => normalizeLocale('zh-Hant')).toThrow(PathValidationError);
  });
  it('empty string rejected', () => {
    expect(() => normalizeLocale('')).toThrow(PathValidationError);
  });
});

// --- localeUrl -------------------------------------------------------------

describe('localeUrl', () => {
  it('composes baseUrl + locale + path (no trailing slash on base)', () => {
    expect(localeUrl(BASE, 'en', 'ops/foo')).toBe(`${BASE}/en/ops/foo`);
  });
  it('strips trailing slash from baseUrl', () => {
    expect(localeUrl(`${BASE}/`, 'zh', 'ops/foo')).toBe(`${BASE}/zh/ops/foo`);
  });
  it('strips multiple trailing slashes from baseUrl', () => {
    expect(localeUrl(`${BASE}///`, 'en', 'foo/bar')).toBe(`${BASE}/en/foo/bar`);
  });
  it('rejects invalid path via validatePath', () => {
    expect(() => localeUrl(BASE, 'en', 'login')).toThrow(PathValidationError);
  });
  it('composes URL for exact top-level home (D9)', () => {
    expect(localeUrl(BASE, 'en', 'home')).toBe(`${BASE}/en/home`);
  });
});

// --- twinOf ----------------------------------------------------------------

describe('twinOf', () => {
  it('en -> zh', () => expect(twinOf('en')).toBe('zh'));
  it('zh -> en', () => expect(twinOf('zh')).toBe('en'));
});

// --- assertLocalePair ------------------------------------------------------

describe('assertLocalePair', () => {
  it('returns full shape for both locales', () => {
    const pair = assertLocalePair('ops/foo', 'en', BASE);
    expect(pair.path).toBe('ops/foo');
    expect(pair.locale).toBe('en');
    expect(pair.url).toBe(`${BASE}/en/ops/foo`);
    expect(pair.twinLocale).toBe('zh');
    expect(pair.twinUrl).toBe(`${BASE}/zh/ops/foo`);
  });
  it('rejects invalid path', () => {
    expect(() => assertLocalePair('login', 'en', BASE)).toThrow(PathValidationError);
  });
  it('accepts exact top-level home (D9)', () => {
    const pair = assertLocalePair('home', 'en', BASE);
    expect(pair.url).toBe(`${BASE}/en/home`);
    expect(pair.twinUrl).toBe(`${BASE}/zh/home`);
  });
});

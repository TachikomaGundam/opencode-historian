/**
 * src/wiki/nav.ts tests (plan v0.5.1-①): tolerant shape parsing of the live
 * `navigation { config tree }` payload and the never-throws degradation
 * contract of readPrimaryNav (unreadable nav → null → surface marks
 * available:false instead of claiming a clean sidebar).
 */

import { describe, it, expect } from 'vitest';
import { parseNav, readPrimaryNav } from '../src/wiki/nav.js';
import type { GqlClient } from '../src/wiki/client.js';

describe('parseNav', () => {
  it('parses the live flat tree shape (probed 2026-09-08, children rejected by server)', () => {
    const snap = parseNav({
      navigation: {
        config: { mode: 'STATIC' },
        tree: [
          { locale: 'en', items: [{ label: 'Home', targetType: 'home', target: '/' }] },
          { locale: 'zh', items: [{ label: '首页', targetType: 'url', target: '/zh/home' }, { label: '中文', targetType: 'url', target: '/en/home' }] },
        ],
      },
    });
    expect(snap?.mode).toBe('STATIC');
    expect(snap?.trees.map((t) => `${t.locale}:${t.items.length}`)).toEqual(['en:1', 'zh:2']);
    expect(snap?.trees[1]?.items[0]?.target).toBe('/zh/home');
  });

  it('returns null when the payload carries no navigation (mark unavailable, not clean)', () => {
    expect(parseNav({})).toBeNull();
    expect(parseNav(null)).toBeNull();
    expect(parseNav(undefined)).toBeNull();
  });

  it('degrades unknownish fields to empty strings instead of throwing', () => {
    const snap = parseNav({ navigation: { config: {}, tree: [{ items: [null, { label: 1 }] }] } });
    expect(snap).toEqual({
      mode: '',
      trees: [{ locale: '', items: [
        { label: '', targetType: '', target: '' },
        { label: '', targetType: '', target: '' },
      ] }],
    });
  });
});

describe('readPrimaryNav', () => {
  it('returns null for a client without a bound api key (transport failure degrades, never throws)', async () => {
    const unbound: GqlClient = { baseUrl: 'http://wiki.invalid', fetchImpl: fetch, timeoutMs: 1000 };
    expect(await readPrimaryNav(unbound)).toBeNull();
  });
});

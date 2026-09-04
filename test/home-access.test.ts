/**
 * v4 plan D9 tool-layer proof: the exact top-level path 'home' must pass
 * validatePath for every historian operation. wiki.js 2.5.314 hosts a live
 * published page at path=home (id48, en+zh); the old plugin-side reserved-word
 * block made all 10 tools fail before any fetch (probe p1).
 *
 * Harness replicates tools.test.ts (fragment-dispatch fake fetch) — that file
 * is owned by a parallel lane and is not edited here.
 */

import { describe, it, expect } from 'vitest';
import { type ToolDefinition } from '@opencode-ai/plugin';
import { OPTS, makeKeyHome, jsonResponse } from './client-fixtures.js';
import { buildTools } from '../src/tools.js';

const BASE = 'http://localhost:3000';
const HOME = 'home';
const EN_URL = `${BASE}/en/${HOME}`;
const ZH_URL = `${BASE}/zh/${HOME}`;
const RESP_OK = { responseResult: { succeeded: true, errorCode: 0, slug: '', message: '' } };

function homePage(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 48,
    path: HOME,
    locale: 'en',
    title: 'Home',
    description: 'portal',
    content: '# Home',
    isPublished: true,
    isPrivate: false,
    contentType: 'markdown',
    tags: [],
    publishStartDate: '',
    publishEndDate: '',
    scriptCss: '',
    scriptJs: '',
    editor: 'markdown',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

interface Captured {
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

function makeWired(
  handlers: Record<string, (vars: Record<string, unknown>, query: string) => unknown>,
): { tools: Record<string, ToolDefinition>; captured: Captured[]; fetchCount: () => number } {
  const captured: Captured[] = [];
  let count = 0;
  const fetchImpl = (async (_input: unknown, init?: unknown): Promise<Response> => {
    count++;
    const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    captured.push(body);
    const fragment = Object.keys(handlers).find((f) => body.query.includes(f));
    if (fragment === undefined) throw new Error(`home-access.test: unhandled query ${body.query}`);
    return jsonResponse(handlers[fragment](body.variables ?? {}, body.query));
  }) as typeof fetch;
  const tools = buildTools(OPTS, { fetchImpl, homeDir: makeKeyHome() });
  return { tools, captured, fetchCount: () => count };
}

async function run(toolDef: ToolDefinition, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = await toolDef.execute(args as never, {} as never);
  const text = typeof out === 'string' ? out : String((out as { output: string }).output);
  return JSON.parse(text) as Record<string, unknown>;
}

describe("top-level 'home' through the tool layer (D9)", () => {
  it('historian_read on home: validatePath passes, page + dual URLs returned', async () => {
    // Given: the fake server holds the live id48 home page
    const { tools, fetchCount } = makeWired({
      'singleByPath(': () => ({ data: { pages: { singleByPath: homePage() } } }),
    });

    // When: reading path 'home'
    const out = await run(tools.historian_read, { path: HOME, locale: 'en' });

    // Then: no PathValidationError envelope; the fetch actually happened
    expect(out.ok).toBe(true);
    expect(out.found).toBe(true);
    expect(out.errorKind).toBeUndefined();
    expect((out.page as Record<string, unknown>).id).toBe(48);
    expect(out.urls).toEqual({ en: EN_URL, zh: ZH_URL });
    expect(fetchCount()).toBeGreaterThan(0);
  });

  it('historian_page_update on home: read-then-write proceeds past validatePath', async () => {
    // Given: a mutable home page; update echoes the patch
    let state = homePage();
    const { tools, captured, fetchCount } = makeWired({
      'singleByPath(': () => ({ data: { pages: { singleByPath: { ...state } } } }),
      'single(': () => ({ data: { pages: { single: { ...state } } } }),
      'update(': (vars) => {
        state = { ...state, title: vars.title as string };
        return { data: { pages: { update: { ...RESP_OK, page: { id: vars.id, path: vars.path, locale: vars.locale } } } } };
      },
    });

    // When: updating only the title on path 'home'
    const out = await run(tools.historian_page_update, { path: HOME, title: 'Home v4' });

    // Then: the update mutation reached the wire (pre-fix: zero-fetch
    // PathValidationError envelope)
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('update');
    expect(out.urls).toEqual({ en: EN_URL, zh: ZH_URL });
    const updates = captured.filter((c) => c.query.includes('update('));
    expect(updates.length).toBe(1);
    expect(updates[0].variables.path).toBe(HOME);
    expect((out.page as Record<string, unknown>).title).toBe('Home v4');
    expect(fetchCount()).toBeGreaterThan(1);
  });

  it('historian_read on HOME: case bypass stays closed (pinned rejection, zero fetch)', async () => {
    // Given: a responder that fails on ANY fetch
    const { tools, fetchCount } = makeWired({});

    // When: reading the uppercase variant
    const out = await run(tools.historian_read, { path: 'HOME', locale: 'en' });

    // Then: rejected pre-flight, exactly as before the D9 bypass
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('PathValidationError');
    expect(fetchCount()).toBe(0);
  });

  it('historian_read on foo/home: nested reserved segment stays rejected (zero fetch)', async () => {
    // Given: a responder that fails on ANY fetch
    const { tools, fetchCount } = makeWired({});

    // When: reading a nested 'home' segment
    const out = await run(tools.historian_read, { path: 'foo/home', locale: 'en' });

    // Then: pinned today-behavior — rejected pre-flight
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('PathValidationError');
    expect(fetchCount()).toBe(0);
  });
});

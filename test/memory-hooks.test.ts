/**
 * Plugin-entry tests for the memory-layer hooks: the v3 reading-loop
 * system.transform (double-signal gate: option + on-machine sentinel;
 * single-block-safe append) and the capture event/config paths, driven through
 * the real server() with synthetic options (translate.apiKey provided raw, so
 * no env or live config is read) and a fake PluginInput client that records
 * emitted toasts. The reading-loop describe redirects homedir() into a
 * per-test tmp fixture home — the real ~/.config is never read or written.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config, Hooks, PluginInput } from '@opencode-ai/plugin';
import plugin from '../src/index.js';
import { loopStatePath } from '../src/loop-state.js';

// The v3 gate reads homedir() per request (uncached by design). Redirect it to
// a per-test fixture home: the factory runs once at import time, but the
// closure body only evaluates when homedir() is CALLED (inside server()/
// transform during a test), so the mutable `let` is safe despite hoisting.
// tmpdir / homedir share this module identity, so keep the rest of node:os real.
let fakeHome = '';
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => fakeHome };
});

type TransformHook = NonNullable<Hooks['experimental.chat.system.transform']>;
type TransformInput = Parameters<TransformHook>[0];
const noInput = {} as TransformInput;
type EventHook = NonNullable<Hooks['event']>;
type EventInput = Parameters<EventHook>[0];

type ToastRequest = {
  body: { title?: string; message: string; variant: string; duration?: number };
};

const BASE_OPTS = { translate: { apiKey: 'sk-memory-hooks-fixture' } };

function eventOf(sessionID: string): EventInput {
  return { event: { type: 'session.idle', properties: { sessionID } } };
}

function fakeInput(): { input: PluginInput; toasts: ToastRequest[] } {
  const toasts: ToastRequest[] = [];
  const client = { tui: { showToast: (req: ToastRequest) => toasts.push(req) } };
  const input = {
    client,
    project: { id: 'test' },
    directory: '/tmp',
    worktree: '/tmp',
    experimental_workspace: { register: () => undefined },
    serverUrl: new URL('http://localhost'),
    $: {},
  } as unknown as PluginInput;
  return { input, toasts };
}

async function transformFor(rawOptions: Record<string, unknown>): Promise<TransformHook> {
  const hooks = await plugin.server(fakeInput().input, rawOptions);
  const hook = hooks['experimental.chat.system.transform'];
  if (hook === undefined) throw new Error('system.transform hook missing');
  return hook;
}

async function eventFor(
  rawOptions: Record<string, unknown>,
): Promise<{ event: EventHook; toasts: ToastRequest[] }> {
  const { input, toasts } = fakeInput();
  const hooks = await plugin.server(input, rawOptions);
  if (hooks.event === undefined) throw new Error('event hook missing');
  return { event: hooks.event, toasts };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// v3 double-signal gate: the readingLoop option AND the on-machine sentinel
// file (<home>/.config/opencode/historian-reading-loop.json) must BOTH confirm
// before injection, and the advisory merges into the LAST system block instead
// of appending a second entry (strict chat templates HTTP-400 on two system
// messages — the entry count relative to pre-injection must never grow).
const CONFIRMED_SENTINEL = '{"version":1,"confirmed":true}';

function confirmSentinel(content = CONFIRMED_SENTINEL): void {
  mkdirSync(join(fakeHome, '.config', 'opencode'), { recursive: true });
  writeFileSync(loopStatePath(fakeHome), content, 'utf8');
}

function loopOpts(): Record<string, unknown> {
  return { ...BASE_OPTS, readingLoop: true };
}

describe('reading-loop system.transform (v3 double-signal gate)', () => {
  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'historian-loop-home-'));
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('is registered on the returned Hooks', async () => {
    const hooks = await plugin.server(fakeInput().input, BASE_OPTS);
    expect(typeof hooks['experimental.chat.system.transform']).toBe('function');
  });

  it('injects nothing by default: readingLoop absent or false is a pure no-op even with the sentinel', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    confirmSentinel();
    const output = { system: ['base prompt'] };

    const absent = await transformFor(BASE_OPTS);
    await absent(noInput, output);
    expect(output.system).toEqual(['base prompt']);

    const explicit = await transformFor({ ...BASE_OPTS, readingLoop: false });
    await explicit(noInput, output);
    expect(output.system).toEqual(['base prompt']);
    expect(spy).not.toHaveBeenCalled();
  });

  it('config true without the sentinel: no injection, one-time startup hint naming the sentinel file', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hook = await transformFor(loopOpts());
    const output = { system: ['base prompt'] };
    await hook(noInput, output);
    expect(output.system).toEqual(['base prompt']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain('historian-reading-loop.json');
  });

  it('merges the advisory into the last block: entry count stays 1, base text preserved', async () => {
    confirmSentinel();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hook = await transformFor(loopOpts());
    const output = { system: ['base prompt'] };
    await hook(noInput, output);
    expect(output.system).toHaveLength(1);
    expect(output.system[0]).toContain('base prompt');
    expect(output.system[0]).toContain('historian_search');
    expect(output.system[0]).toContain('historian_map action:"timeline"');
    expect(output.system[0]).toContain('G5');
    expect(output.system[0]).toContain('Cite');
    expect(output.system[0]).toContain('\n\n');
    expect(output.system[0].split('\n').length).toBeLessThanOrEqual(13);
    expect(spy).not.toHaveBeenCalled();
  });

  it('pushes a single advisory block when system is empty', async () => {
    confirmSentinel();
    const hook = await transformFor(loopOpts());
    const output = { system: [] as string[] };
    await hook(noInput, output);
    expect(output.system).toHaveLength(1);
    expect(output.system[0]).toContain('historian_search');
    expect(output.system[0].split('\n').length).toBeLessThanOrEqual(6);
  });

  it('is idempotent: double invocation injects the advisory exactly once', async () => {
    confirmSentinel();
    const hook = await transformFor(loopOpts());
    const output = { system: ['base prompt'] };
    await hook(noInput, output);
    await hook(noInput, output);
    expect(output.system).toHaveLength(1);
    expect(output.system[0]?.match(/historian_search/g)).toHaveLength(1);
  });

  it('leaves a pre-existing historian_search block byte-identical', async () => {
    confirmSentinel();
    const hook = await transformFor(loopOpts());
    const seeded = { system: ['user-authored historian_search guidance'] };
    await hook(noInput, seeded);
    expect(seeded.system).toStrictEqual(['user-authored historian_search guidance']);
  });

  it('never throws: an undefined system array is logged once and swallowed', async () => {
    confirmSentinel();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hook = await transformFor(loopOpts());
    const broken = { system: undefined as unknown as string[] };
    await expect(hook(noInput, broken)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain('[opencode-historian]');
  });

  it('honours a mid-session sentinel flip with the same hook instance (no caching)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hook = await transformFor(loopOpts());
    const output = { system: ['base prompt'] };

    await hook(noInput, output);
    expect(output.system).toEqual(['base prompt']);

    confirmSentinel();
    await hook(noInput, output);
    expect(output.system).toHaveLength(1);
    expect(output.system[0]).toContain('historian_search');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('treats a malformed sentinel as not confirmed and never throws', async () => {
    confirmSentinel('{"version":1,conf');
    const hook = await transformFor(loopOpts());
    const output = { system: ['base prompt'] };
    await expect(hook(noInput, output)).resolves.toBeUndefined();
    expect(output.system).toEqual(['base prompt']);
  });

  it('stays silent when options are broken (server() already returned empty hooks)', async () => {
    vi.stubEnv('DASHSCOPE_API_KEY', '');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hooks = await plugin.server(fakeInput().input, {});
    expect(hooks['experimental.chat.system.transform']).toBeUndefined();
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('capture event + /historian-capture command (todo 9)', () => {
  it('event hook is registered on the returned Hooks', async () => {
    const hooks = await plugin.server(fakeInput().input, BASE_OPTS);
    expect(typeof hooks.event).toBe('function');
  });

  it('disabled capture: session.idle makes zero client calls', async () => {
    const showToast = vi.fn();
    const input = { client: { tui: { showToast } } } as unknown as PluginInput;
    const hooks = await plugin.server(input, BASE_OPTS);
    if (hooks.event === undefined) throw new Error('event hook missing');
    await hooks.event(eventOf('ses_disabled'));
    expect(showToast).not.toHaveBeenCalled();
  });

  it('enabled capture: idle session gets exactly one reminder naming /historian-capture', async () => {
    const { event, toasts } = await eventFor({ ...BASE_OPTS, capture: { enabled: true } });
    await event(eventOf('ses_a'));
    await event(eventOf('ses_a'));
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.body.message).toContain('/historian-capture');
    expect(toasts[0]?.body.variant).toBe('info');
    expect(toasts[0]?.body.title).toContain('historian');
  });

  it('enabled capture: other event types ignored, other sessions reminded separately', async () => {
    const { event, toasts } = await eventFor({ ...BASE_OPTS, capture: { enabled: true } });
    await event({ event: { type: 'session.compacted', properties: { sessionID: 'ses_a' } } });
    expect(toasts).toHaveLength(0);
    await event(eventOf('ses_b'));
    expect(toasts).toHaveLength(1);
  });

  it('enabled capture: a rejecting toast client is logged, never propagated', async () => {
    const client = { tui: { showToast: () => Promise.reject(new Error('toast down')) } };
    const input = { client } as unknown as PluginInput;
    const hooks = await plugin.server(input, { ...BASE_OPTS, capture: { enabled: true } });
    if (hooks.event === undefined) throw new Error('event hook missing');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(hooks.event(eventOf('ses_reject'))).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain('[opencode-historian]');
  });

  it('config hook registers /historian-capture even with capture disabled, keeping user commands', async () => {
    const hooks = await plugin.server(fakeInput().input, BASE_OPTS);
    if (hooks.config === undefined) throw new Error('config hook missing');
    const cfg: Config = { command: { mine: { template: 'echo' } } };
    await hooks.config(cfg);
    expect(cfg.command?.mine).toEqual({ template: 'echo' });
    const cmd = cfg.command?.['historian-capture'];
    expect(cmd?.description).toBe('把本次会话记为史官事件页 / record this session as a historian event page');
    expect(cmd?.template).toContain('historian_page_create');
    expect(cmd?.template).toContain('G1');
    expect(cmd?.template).toContain('过程/Process');
    expect(cmd?.template).toContain('改进/Improvement');
    expect(cmd?.template).toContain('(en + zh)');
  });

  it('config hook never clobbers a user-defined /historian-capture command', async () => {
    const hooks = await plugin.server(fakeInput().input, BASE_OPTS);
    if (hooks.config === undefined) throw new Error('config hook missing');
    const userCmd = { template: 'user-defined', description: 'mine' };
    const cfg: Config = { command: { 'historian-capture': { ...userCmd }, mine: { template: 'echo' } } };
    await hooks.config(cfg);
    expect(cfg.command?.['historian-capture']).toEqual(userCmd);
    expect(cfg.command?.mine).toEqual({ template: 'echo' });
  });
});

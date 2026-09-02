/**
 * Plugin-entry tests for the v2 memory-layer hooks (todos 8-9): the
 * reading-loop system.transform injection and the capture event/config paths,
 * driven through the real server() with synthetic options (translate.apiKey
 * provided raw, so no env or live config is read) and a fake PluginInput
 * client that records emitted toasts.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Config, Hooks, PluginInput } from '@opencode-ai/plugin';
import plugin from '../src/index.js';

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

describe('reading-loop system.transform (todo 8)', () => {
  it('is registered on the returned Hooks', async () => {
    const hooks = await plugin.server(fakeInput().input, BASE_OPTS);
    expect(typeof hooks['experimental.chat.system.transform']).toBe('function');
  });

  it('pushes exactly one advisory block mentioning historian_search by default', async () => {
    const hook = await transformFor(BASE_OPTS);
    const output = { system: ['base prompt'] };
    await hook(noInput, output);
    expect(output.system).toHaveLength(2);
    expect(output.system[1]).toContain('historian_search');
    expect(output.system[1]).toContain('historian_map action:"timeline"');
    expect(output.system[1]).toContain('G5');
    expect(output.system[1]).toContain('Cite');
    expect(output.system[1].split('\n').length).toBeLessThanOrEqual(6);
  });

  it('is a pure no-op when readingLoop is disabled', async () => {
    const hook = await transformFor({ ...BASE_OPTS, readingLoop: false });
    const output = { system: ['base prompt'] };
    await hook(noInput, output);
    expect(output.system).toEqual(['base prompt']);
  });

  it('never duplicates: idempotent across double invocation and pre-seeded blocks', async () => {
    const hook = await transformFor(BASE_OPTS);
    const output: { system: string[] } = { system: [] };
    await hook(noInput, output);
    await hook(noInput, output);
    expect(output.system).toHaveLength(1);

    const seeded = { system: ['user-authored historian_search guidance'] };
    await hook(noInput, seeded);
    expect(seeded.system).toEqual(['user-authored historian_search guidance']);
  });

  it('never throws: a malformed output is logged and the request continues', async () => {
    const hook = await transformFor(BASE_OPTS);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { system: undefined as unknown as string[] };
    await expect(hook(noInput, broken)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain('[opencode-historian]');
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
});

/**
 * Plugin-entry tests for the v2 memory-layer hooks (todos 8-9): the
 * reading-loop system.transform injection and the capture event/config paths,
 * driven through the real server() with synthetic options (translate.apiKey
 * provided raw, so no env or live config is read) and a fake PluginInput
 * client that records emitted toasts.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Hooks, PluginInput } from '@opencode-ai/plugin';
import plugin from '../src/index.js';

type TransformHook = NonNullable<Hooks['experimental.chat.system.transform']>;
type TransformInput = Parameters<TransformHook>[0];
const noInput = {} as TransformInput;

const BASE_OPTS = { translate: { apiKey: 'sk-memory-hooks-fixture' } };

function fakeInput(): { input: PluginInput; toasts: unknown[] } {
  const toasts: unknown[] = [];
  const client = { tui: { showToast: (req: unknown) => toasts.push(req) } };
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

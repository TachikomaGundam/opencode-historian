import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import type { Config } from '@opencode-ai/plugin';

// Mock resolveOptions to avoid hitting real config/env in tests
vi.mock('../src/config.js', async () => {
  const actual = await vi.importActual('../src/config.js');
  return {
    ...actual,
    resolveOptions: vi.fn(() => ({
      baseUrl: 'http://localhost:3000',
      apiKeyPath: '~/.wikijs-api-key',
      translate: {
        endpoint: 'https://example.com',
        model: 'test-model',
        apiKey: 'sk-test-key',
      },
      sections: ['test'],
      locales: ['en', 'zh'],
      readingLoop: true,
      capture: { enabled: false },
    })),
  };
});

// Mock buildTools to avoid constructing real clients
vi.mock('../src/tools.js', () => ({
  buildTools: vi.fn(() => ({
    historian_test_tool: {
      description: 'test tool',
      parameters: {} as any,
      execute: vi.fn(),
    },
  })),
}));

import plugin from '../src/index.js';
import { resolveOptions } from '../src/config.js';
import { buildTools } from '../src/tools.js';

const expectedSkillsDir = fileURLToPath(new URL('../skills/', import.meta.url));

describe('plugin default export shape', () => {
  it('has id and server function', () => {
    expect(plugin).toBeDefined();
    expect(plugin.id).toBe('opencode-historian');
    expect(typeof plugin.server).toBe('function');
  });
});

describe('server() config hook', () => {
  let mockInput: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockInput = {
      client: {},
      project: { id: 'test' },
      directory: '/tmp',
      worktree: '/tmp',
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL('http://localhost'),
      $: {},
    };
  });

  it('adds skillsDir to empty cfg.skills', async () => {
    const hooks = await plugin.server(mockInput, {});
    expect(hooks.config).toBeDefined();

    const cfg: Config = {};
    await hooks.config!(cfg);

    const cfgWithSkills = cfg as Config & { skills?: { paths?: string[] } };
    expect(cfgWithSkills.skills).toBeDefined();
    expect(cfgWithSkills.skills!.paths).toEqual([expectedSkillsDir]);
    expect(typeof cfgWithSkills.skills!.paths![0]).toBe('string');
  });

  it('preserves existing paths and deduplicates', async () => {
    const hooks = await plugin.server(mockInput, {});
    const cfg: Config = {
      skills: {
        paths: ['/existing/path1', '/existing/path2'],
      },
    } as Config;

    await hooks.config!(cfg);

    const cfgWithSkills = cfg as Config & { skills?: { paths?: string[] } };
    expect(cfgWithSkills.skills!.paths).toEqual([
      '/existing/path1',
      '/existing/path2',
      expectedSkillsDir,
    ]);
  });

  it('deduplicates when skillsDir already present', async () => {
    const hooks = await plugin.server(mockInput, {});
    const cfg: Config = {
      skills: {
        paths: [expectedSkillsDir, '/other/path'],
      },
    } as Config;

    await hooks.config!(cfg);

    const cfgWithSkills = cfg as Config & { skills?: { paths?: string[] } };
    expect(cfgWithSkills.skills!.paths).toEqual([expectedSkillsDir, '/other/path']);
    expect(cfgWithSkills.skills!.paths!.filter((p) => p === expectedSkillsDir).length).toBe(1);
  });

  it('returns absolute string path, not URL object', async () => {
    const hooks = await plugin.server(mockInput, {});
    const cfg: Config = {};

    await hooks.config!(cfg);

    const cfgWithSkills = cfg as Config & { skills?: { paths?: string[] } };
    const path = cfgWithSkills.skills!.paths![0];
    expect(typeof path).toBe('string');
    expect(path).not.toContain('file://');
    expect(path.startsWith('/')).toBe(true);
  });
});

describe('server() defensive error handling', () => {
  it('catches resolveOptions errors and returns empty hooks', async () => {
    vi.mocked(resolveOptions).mockImplementationOnce(() => {
      throw new Error('ConfigError: missing translation key');
    });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const mockInput: any = {
      client: {},
      project: { id: 'test' },
      directory: '/tmp',
      worktree: '/tmp',
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL('http://localhost'),
      $: {},
    };

    const hooks = await plugin.server(mockInput, {});

    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy.mock.calls[0][0]).toContain('[opencode-historian]');
    expect(hooks.tool).toBeUndefined();
    expect(hooks.config).toBeUndefined();

    consoleSpy.mockRestore();
  });
});

describe('server() tool wiring', () => {
  it('calls buildTools with resolved options', async () => {
    const mockInput: any = {
      client: {},
      project: { id: 'test' },
      directory: '/tmp',
      worktree: '/tmp',
      experimental_workspace: { register: vi.fn() },
      serverUrl: new URL('http://localhost'),
      $: {},
    };

    await plugin.server(mockInput, { baseUrl: 'http://custom:3000' });

    expect(resolveOptions).toHaveBeenCalledWith({ baseUrl: 'http://custom:3000' });
    expect(buildTools).toHaveBeenCalled();
  });
});

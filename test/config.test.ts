import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  resolveOptions,
  readWikiApiKey,
  ConfigError,
  type HistorianOptions,
  type HistorianPluginOptions,
} from '../src/config.js';

// All fixtures use synthetic keys (sk-...) only. homeDir is injected in every
// test; a buggy implementation reading the real ~/.config/opencode/opencode.jsonc
// would yield the machine's live key and fail these assertions instead of
// passing — the injection is itself the stale-state guard.

const tmpDirs: string[] = [];

function makeHomeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opencode-historian-test-'));
  tmpDirs.push(dir);
  return dir;
}

/** Writes the fixture opencode.jsonc under <homeDir>/.config/opencode/. */
function writeJsonc(homeDir: string, content: string): void {
  const p = join(homeDir, '.config', 'opencode', 'opencode.jsonc');
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

/** Mirrors the machine's live structure (comments, trailing commas, https://
 *  inside a string, commented-out apiKey right after the live one) with
 *  synthetic key values. */
const REALISTIC_JSONC = `{
  // opencode config fixture — synthetic keys only
  "provider": {
    "anthropic": {
      "npm": "@ai-sdk/anthropic",
      "options": {
        "baseURL": "https://api.anthropic.com",
        "apiKey": "sk-anthropic-unrelated-provider",
      },
    },
    "my-provider": {
      "npm": "@ai-sdk/anthropic",
      "name": "Alibaba Cloud Model Studio",
      "options": {
        "baseURL": "https://gateway.example.net/apps/anthropic/v1", // https:// in this string must survive
        "note": "/* not a block comment */ // not a line comment",
        "apiKey": "sk-jsonc-live",
      },
      //        "apiKey": "sk-jsonc-commented-out",
    },
  },
  /* trailing-comma check: */
  "things": [1, 2, 3,],
}`;

const NO_ENV: NodeJS.ProcessEnv = {};

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('resolveOptions translation-key priority matrix', () => {
  it('raw plugin option wins over env and jsonc when raw translate.apiKey present', () => {
    const homeDir = makeHomeDir();
    writeJsonc(homeDir, REALISTIC_JSONC);
    const raw: HistorianPluginOptions = {
      translate: { apiKey: 'sk-raw' },
      baseUrl: 'http://wiki.example.test:8080',
      sections: ['custom'],
    };
    const opts = resolveOptions(raw, { DASHSCOPE_API_KEY: 'sk-env' }, homeDir);
    expect(opts.translate.apiKey).toBe('sk-raw');
    expect(opts.baseUrl).toBe('http://wiki.example.test:8080');
    expect(opts.sections).toEqual(['custom']);
  });

  it('env DASHSCOPE_API_KEY beats jsonc provider-x key when raw absent', () => {
    const homeDir = makeHomeDir();
    writeJsonc(homeDir, REALISTIC_JSONC);
    const opts = resolveOptions({}, { DASHSCOPE_API_KEY: 'sk-env' }, homeDir);
    expect(opts.translate.apiKey).toBe('sk-env');
  });

  it('jsonc my-provider key is picked when raw and env are absent', () => {
    const homeDir = makeHomeDir();
    writeJsonc(homeDir, REALISTIC_JSONC);
    const opts = resolveOptions({}, NO_ENV, homeDir);
    expect(opts.translate.apiKey).toBe('sk-jsonc-live');
  });

  it('throws ConfigError when all three legs are absent (fixture homeDir proves real config is not read)', () => {
    const emptyHomeDir = makeHomeDir(); // no .config/opencode/opencode.jsonc here
    let caught: unknown;
    try {
      resolveOptions({}, NO_ENV, emptyHomeDir);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).name).toBe('ConfigError');
    expect((caught as ConfigError).message).toContain('translation');
  });

  it('throws ConfigError when only an unrelated provider (anthropic) carries an apiKey', () => {
    const homeDir = makeHomeDir();
    writeJsonc(
      homeDir,
      `{
  "provider": {
    "anthropic": {
      "options": { "apiKey": "sk-anthropic-only" }
    }
  }
}`,
    );
    expect(() => resolveOptions({}, NO_ENV, homeDir)).toThrow(ConfigError);
  });

  it('throws ConfigError when provider-x exists but its apiKey is an empty string', () => {
    const homeDir = makeHomeDir();
    writeJsonc(
      homeDir,
      `{
  "provider": {
    "my-provider": { "options": { "apiKey": "" } }
  }
}`,
    );
    expect(() => resolveOptions({}, NO_ENV, homeDir)).toThrow(ConfigError);
  });
});

describe('resolveOptions defaults', () => {
  it('lands every documented default when raw options are empty and env supplies the key', () => {
    const opts = resolveOptions({}, { DASHSCOPE_API_KEY: 'sk-env' }, makeHomeDir());
    expect(opts.baseUrl).toBe('http://localhost:3000');
    expect(opts.apiKeyPath).toBe('~/.wikijs-api-key');
    expect(opts.translate.endpoint).toBe(
      'https://gateway.example.net/apps/anthropic',
    );
    expect(opts.translate.model).toBe('qwen3.7-plus');
    expect(opts.sections).toEqual([
      'ops',
      'inference-notes',
      'llm-server',
      'perf-notes',
      'opencode',
      'agent-eval',
      'troubleshooting',
      'scratch',
      '_sandbox',
    ]);
    expect(opts.locales).toEqual(['en', 'zh']);
    void opts satisfies HistorianOptions;
  });

  it('raw overrides are reflected in the resolved options', () => {
    const raw: HistorianPluginOptions = {
      baseUrl: 'http://elsewhere:4321',
      apiKeyPath: '/opt/secrets/wiki.key',
      translate: { endpoint: 'http://tts:9000/v1', model: 'qwen-other', apiKey: 'sk-raw' },
      sections: ['agent-eval'],
      locales: ['en'],
    };
    const opts = resolveOptions(raw, NO_ENV, makeHomeDir());
    expect(opts.baseUrl).toBe('http://elsewhere:4321');
    expect(opts.apiKeyPath).toBe('/opt/secrets/wiki.key');
    expect(opts.translate.endpoint).toBe('http://tts:9000/v1');
    expect(opts.translate.model).toBe('qwen-other');
    expect(opts.sections).toEqual(['agent-eval']);
    expect(opts.locales).toEqual(['en']);
  });
});

describe('resolveOptions malformed jsonc (adversarial: malformed_input)', () => {
  it('throws ConfigError for unterminated block comment instead of crashing', () => {
    const homeDir = makeHomeDir();
    writeJsonc(homeDir, '{"provider": {} /* never closed');
    expect(() => resolveOptions({}, NO_ENV, homeDir)).toThrow(ConfigError);
  });

  it('throws ConfigError for unterminated string instead of crashing', () => {
    const homeDir = makeHomeDir();
    writeJsonc(homeDir, '{"provider": {"x": "oops');
    expect(() => resolveOptions({}, NO_ENV, homeDir)).toThrow(ConfigError);
  });

  it('throws ConfigError when top-level jsonc is not an object', () => {
    const homeDir = makeHomeDir();
    writeJsonc(homeDir, '[{"provider": {"my-provider": {"options": {"apiKey": "sk-x"}}}}]');
    expect(() => resolveOptions({}, NO_ENV, homeDir)).toThrow(ConfigError);
  });

  it('throws ConfigError when jsonc is pure garbage', () => {
    const homeDir = makeHomeDir();
    writeJsonc(homeDir, 'this is { not json');
    expect(() => resolveOptions({}, NO_ENV, homeDir)).toThrow(ConfigError);
  });
});

describe('readWikiApiKey', () => {
  it('returns trimmed file content when the key file exists at the default path', () => {
    const homeDir = makeHomeDir();
    const keyPath = join(homeDir, '.wikijs-api-key');
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, 'sk-file-key\n', 'utf8');
    const opts = resolveOptions({}, { DASHSCOPE_API_KEY: 'sk-translation' }, homeDir);
    expect(readWikiApiKey(opts, NO_ENV, homeDir)).toBe('sk-file-key');
  });

  it('falls back to env WIKIJS_API_KEY when the key file is missing', () => {
    const homeDir = makeHomeDir();
    const opts = resolveOptions({}, { DASHSCOPE_API_KEY: 'sk-translation' }, homeDir);
    expect(
      readWikiApiKey(opts, { DASHSCOPE_API_KEY: 'sk-translation', WIKIJS_API_KEY: 'sk-env-wiki' }, homeDir),
    ).toBe('sk-env-wiki');
  });

  it('throws ConfigError with the resolved path when file and env are both absent', () => {
    const homeDir = makeHomeDir();
    const opts = resolveOptions({}, { DASHSCOPE_API_KEY: 'sk-translation' }, homeDir);
    let caught: unknown;
    try {
      readWikiApiKey(opts, NO_ENV, homeDir);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).name).toBe('ConfigError');
    expect((caught as ConfigError).message).toContain(join(homeDir, '.wikijs-api-key'));
  });

  it('prefers the file over env WIKIJS_API_KEY when both exist', () => {
    const homeDir = makeHomeDir();
    const keyPath = join(homeDir, '.wikijs-api-key');
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, 'sk-file-wins\n', 'utf8');
    const opts = resolveOptions({}, { DASHSCOPE_API_KEY: 'sk-translation' }, homeDir);
    expect(
      readWikiApiKey(opts, { DASHSCOPE_API_KEY: 'sk-translation', WIKIJS_API_KEY: 'sk-env-loses' }, homeDir),
    ).toBe('sk-file-wins');
  });

  it('expands ~ in a custom apiKeyPath relative to the injected homeDir', () => {
    const homeDir = makeHomeDir();
    const keyPath = join(homeDir, 'keys', 'wiki.txt');
    mkdirSync(dirname(keyPath), { recursive: true });
    writeFileSync(keyPath, 'sk-custom-path\n', 'utf8');
    const opts = resolveOptions(
      { apiKeyPath: '~/keys/wiki.txt', translate: { apiKey: 'sk-translation' } },
      NO_ENV,
      homeDir,
    );
    expect(readWikiApiKey(opts, NO_ENV, homeDir)).toBe('sk-custom-path');
  });
});
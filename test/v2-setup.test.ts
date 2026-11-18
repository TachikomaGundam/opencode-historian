/**
 * V2 setup adapter tests — every migrated surface of the v2 plugin port gets
 * vitest coverage. The fake ctx mirrors only
 * the host contract that src/v2.ts consumes (probe-verified against engine
 * 2.2.7/2.3.0): tool/command/skill transforms with add-editors, the session
 * context hook, and the event async-iterable.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import plugin from '../src/index.js';
import { setup, argsToJsonSchema, type V2Ctx, type SetupDeps } from '../src/v2.js';

// --- fake host ---------------------------------------------------------------

interface RegisteredTool {
  name: string;
  description: string;
  input: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: { sessionID: string }) => Promise<{ content: string }>;
}

interface FakeHost {
  ctx: Record<string, unknown>;
  tools: RegisteredTool[];
  commands: Array<{ name: string; description: string; template: string }>;
  skills: Array<Record<string, string>>;
  hooks: Array<{ name: string; handler: (ev: unknown) => unknown }>;
  logs: string[];
  commandListCalls: number;
}

function fakeHost(opts: Record<string, unknown> = {}, commandList: ReadonlyArray<{ name: string }> = []): FakeHost {
  const h: FakeHost = {
    ctx: {},
    tools: [],
    commands: [],
    skills: [],
    hooks: [],
    logs: [],
    commandListCalls: 0,
  };
  const log = (m: unknown, m2?: unknown) => {
    h.logs.push([m, m2].filter((x) => x !== undefined).map(String).join(' '));
  };
  h.ctx = {
    options: opts,
    tool: {
      async transform(fn: (editor: { add: (d: RegisteredTool) => void }) => void) {
        fn({ add: (d) => h.tools.push(d) });
      },
    },
    command: {
      async list() {
        h.commandListCalls += 1;
        return commandList;
      },
      async transform(fn: (editor: { add: (d: { name: string; description: string; template: string }) => void }) => void) {
        fn({ add: (d) => h.commands.push(d) });
      },
    },
    skill: {
      async transform(fn: (editor: { add: (d: Record<string, string>) => void }) => void) {
        fn({ add: (d) => h.skills.push(d) });
      },
    },
    session: {
      hook(name: string, handler: (ev: unknown) => unknown) {
        h.hooks.push({ name, handler });
        return { dispose() {} };
      },
    },
    event: {
      subscribe: () => (async function* () {})(),
    },
  };
  (h as unknown as { log: typeof log }).log = log;
  return h;
}

/** Options that always resolve: WIKIJS_API_KEY env leg + fake homeDir (no
 *  jsonc leg, no sentinel). */
const GOOD_OPTIONS = { translate: { apiKey: 'test-translate-key' } };
const GOOD_ENV = { WIKIJS_API_KEY: 'test-wiki-key' } as NodeJS.ProcessEnv;

function emptyHome(): string {
  return mkdtempSync(join(tmpdir(), 'hist-v2-home-'));
}

function homeWithSentinel(): string {
  const home = emptyHome();
  const dir = join(home, '.config', 'opencode');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'historian-reading-loop.json'), JSON.stringify({ version: 1, confirmed: true }));
  return home;
}

function runSetup(h: FakeHost, overrides: Partial<SetupDeps> = {}): Promise<void> {
  return setup(h.ctx as unknown as V2Ctx, {
    homeDir: emptyHome(),
    env: GOOD_ENV,
    log: (m) => h.logs.push(m),
    ...overrides,
  });
}

const ALL_TOOL_NAMES = [
  'historian_page_create',
  'historian_page_update',
  'historian_page_append',
  'historian_translate_snippet',
  'historian_search',
  'historian_read',
  'historian_map',
  'historian_migrate',
  'historian_delete',
  'historian_move',
  'historian_anchor',
];

// --- default export shape ------------------------------------------------------

describe('dual-generation default export', () => {
  it('exposes {id, setup, server} — the id is the npm package name', () => {
    expect(plugin.id).toBe('opencode-wiki-historian');
    expect(typeof plugin.setup).toBe('function');
    expect(typeof plugin.server).toBe('function');
  });
});

// --- fail-closed options -------------------------------------------------------

describe('setup fail-closed parity', () => {
  it('registers NOTHING and logs once when options cannot resolve', async () => {
    // resolveOptions is deliberately lazy about missing keys (load-time
    // absence is supported: tools alive, call-time failure) — the one real
    // throw path is an invalid ~/.config/opencode/opencode.jsonc on the
    // opt-in translate.providerKey leg. Fixture drives exactly that.
    const home = emptyHome();
    mkdirSync(join(home, '.config', 'opencode'), { recursive: true });
    writeFileSync(join(home, '.config', 'opencode', 'opencode.jsonc'), '"not-an-object"');
    const h = fakeHost({ translate: { providerKey: 'some-provider' } });
    await runSetup(h, { env: {}, homeDir: home });
    expect(h.tools.length).toBe(0);
    expect(h.commands.length).toBe(0);
    expect(h.skills.length).toBe(0);
    expect(h.hooks.length).toBe(0);
    expect(h.commandListCalls).toBe(0); // disabled before touching the command surface
    expect(h.logs.join('\n')).toContain('plugin disabled');
  });

  it('registers the full tool set + bundled skill when options resolve', async () => {
    const h = fakeHost(GOOD_OPTIONS);
    await runSetup(h);
    expect(h.tools.map((t) => t.name).sort()).toEqual([...ALL_TOOL_NAMES].sort());
    // bundled skills/ ships through skill.transform in V2 (no config hook)
    expect(h.skills.some((s) => s.id === 'historian')).toBe(true);
    expect(h.skills.every((s) => s.id && s.name && s.description && s.path && s.content)).toBe(true);
  });
});

// --- tool surface --------------------------------------------------------------

describe('tool surface', () => {
  it('registers JSON Schema inputs converted from the V1 zod shapes (defaults stay optional)', async () => {
    const h = fakeHost(GOOD_OPTIONS);
    await runSetup(h);
    const t = h.tools.find((x) => x.name === 'historian_translate_snippet');
    expect(t).toBeDefined();
    expect(t!.input.type).toBe('object');
    const props = (t!.input.properties ?? {}) as Record<string, unknown>;
    expect(props.text).toBeDefined();
    expect(t!.input.required).toEqual(['text']); // from/to carry defaults → not required
    expect(t!.description.length).toBeGreaterThan(20);
  });

  it('execute returns {content} with the V1 JSON-string envelope passed through verbatim', async () => {
    const h = fakeHost(GOOD_OPTIONS);
    await runSetup(h, { buildDeps: { translate: async (text: string) => `TRANSLATED:${text}` } });
    const t = h.tools.find((x) => x.name === 'historian_translate_snippet')!;
    const res = await t.execute({ text: 'hello' }, { sessionID: 'ses_test' });
    expect(typeof res.content).toBe('string');
    const parsed = JSON.parse(res.content);
    expect(parsed.ok).toBe(true);
    expect(parsed.translated).toBe('TRANSLATED:hello');
  });

  it('execute never throws into the host — a failing translator yields an error envelope string', async () => {
    const h = fakeHost(GOOD_OPTIONS);
    await runSetup(h, {
      buildDeps: {
        translate: async () => {
          throw new Error('boom');
        },
      },
    });
    const t = h.tools.find((x) => x.name === 'historian_translate_snippet')!;
    const res = await t.execute({ text: 'x', to: 'zh', from: 'en' }, { sessionID: 'ses_test' });
    expect(typeof res.content).toBe('string');
    expect(() => JSON.parse(res.content)).not.toThrow(); // envelope, not double-encoded string
    expect(JSON.parse(res.content).ok).not.toBe(true);
  });

  it('argsToJsonSchema falls back to a permissive schema instead of throwing on exotic shapes', () => {
    const out = argsToJsonSchema({ bad: { parse: 42, nope: true } as never });
    expect(out.__permissive).toBe(true);
    expect(out.type).toBe('object');
  });
});

// --- command surface -----------------------------------------------------------

describe('/historian-capture command surface', () => {
  it('registers template command when the user has none (??= default)', async () => {
    const h = fakeHost(GOOD_OPTIONS, []);
    await runSetup(h);
    expect(h.commands.length).toBe(1);
    expect(h.commands[0].name).toBe('historian-capture');
    expect(h.commands[0].template).toContain('historian_page_create');
    expect(h.commands[0].template).toContain('四段式');
  });

  it('skips registration when a user-defined command of the same name exists', async () => {
    const h = fakeHost(GOOD_OPTIONS, [{ name: 'historian-capture' }]);
    await runSetup(h);
    expect(h.commands.length).toBe(0);
    expect(h.logs.join('\n')).toContain('already defined by user config');
  });
});

// --- reading-loop advisory (context hook) ---------------------------------------

describe('reading-loop advisory on session context hook', () => {
  async function wired(opts: Record<string, unknown>, sentinelHome: string): Promise<FakeHost> {
    const h = fakeHost({ ...GOOD_OPTIONS, readingLoop: true, ...opts });
    await runSetup(h, { homeDir: sentinelHome });
    return h;
  }

  it('double gate: option true + sentinel present → advisory merged into the LAST text part, block count unchanged', async () => {
    const h = await wired({}, homeWithSentinel());
    expect(h.hooks.length).toBe(1);
    const ev = { system: [{ type: 'text', text: 'BASE-A' }, { type: 'text', text: 'BASE-B' }] };
    await h.hooks[0].handler(ev);
    expect(ev.system.length).toBe(2);
    expect(ev.system[1].text).toContain('BASE-B');
    expect(ev.system[1].text).toContain('historian_search'); // advisory content
    expect(ev.system[0].text).toBe('BASE-A');
  });

  it('double gate: option true but sentinel absent → no injection, activation pointer logged', async () => {
    const h = await wired({}, emptyHome());
    const ev = { system: [{ type: 'text', text: 'BASE' }] };
    await h.hooks[0].handler(ev);
    expect(ev.system[0].text).toBe('BASE');
    expect(h.logs.join('\n')).toContain('not confirmed on this machine');
  });

  it('dedupe: an advisory already present anywhere (historian_search marker) is never doubled', async () => {
    const h = await wired({}, homeWithSentinel());
    const ev = { system: [{ type: 'text', text: 'you have historian_search available' }, { type: 'text', text: 'TAIL' }] };
    await h.hooks[0].handler(ev);
    expect(ev.system[1].text).toBe('TAIL');
  });

  it('gate off (readingLoop unset) → hook still registered but inert; a garbage event never escapes', async () => {
    const h = fakeHost(GOOD_OPTIONS); // readingLoop unset → default false
    await runSetup(h);
    expect(h.hooks.length).toBe(1);
    const ev = { system: [{ type: 'text', text: 'BASE' }] };
    await h.hooks[0].handler(ev);
    expect(ev.system[0].text).toBe('BASE');
    expect(() => h.hooks[0].handler({ system: 'not-an-array' })).not.toThrow();
  });
});

// --- capture reminder (event stream) --------------------------------------------

describe('capture reminder (v2 console fallback)', () => {
  it('off by default: no reminder without capture.enabled', async () => {
    const h = fakeHost(GOOD_OPTIONS);
    await runSetup(h);
    await new Promise((r) => setTimeout(r, 5));
    expect(h.logs.join('\n')).not.toContain('capture reminder');
  });

  it('enabled: exactly one reminder per session.idle session', async () => {
    const h = fakeHost({ ...GOOD_OPTIONS, capture: { enabled: true } });
    const events = [
      { type: 'session.idle', properties: { sessionID: 's1' } },
      { type: 'session.idle', properties: { sessionID: 's1' } },
      { type: 'session.idle', properties: { sessionID: 's2' } },
    ];
    let idx = 0;
    h.ctx.event = {
      subscribe: () =>
        ({
          [Symbol.asyncIterator]: () => ({
            next: async () =>
              idx < events.length
                ? { value: events[idx++], done: false }
                : { value: undefined, done: true },
          }),
        }) as never,
    };
    await runSetup(h);
    await new Promise((r) => setTimeout(r, 20));
    const reminders = h.logs.filter((l) => l.includes('capture reminder'));
    expect(reminders.length).toBe(2); // s1 once, s2 once, s1 duplicate suppressed
  });
});

// --- graceful degradation --------------------------------------------------------

describe('missing host surfaces degrade with logs, never crashes', () => {
  for (const surface of ['tool', 'command', 'skill', 'session', 'event'] as const) {
    it(`without ${surface}: setup completes and names the gap`, async () => {
      const h = fakeHost({ ...GOOD_OPTIONS, capture: { enabled: true }, readingLoop: true });
      const ctx = { ...h.ctx };
      delete ctx[surface];
      await setup(ctx as unknown as V2Ctx, { homeDir: emptyHome(), env: GOOD_ENV, log: (m) => h.logs.push(m) });
      const joined = h.logs.join('\n');
      if (surface === 'command') expect(joined).toContain('command.transform');
      if (surface === 'tool') expect(joined).toContain('tool.transform');
      if (surface === 'skill') expect(joined).toContain('skill.transform');
      if (surface === 'session') expect(joined).toContain('session.hook');
      if (surface === 'event') expect(joined).toContain('event.subscribe');
    });
  }
});

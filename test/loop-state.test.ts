import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  LOOP_STATE_VERSION,
  loopStatePath,
  isReadingLoopConfirmed,
} from '../src/loop-state.js';

// Fixture-tmp discipline mirrors test/config.test.ts: every case drives an
// injected tmp home; the real ~/.config is never read or written. The reader
// must never throw, so adversarial inputs (truncated JSON, garbage, non-object
// top-level) assert `false` rather than an exception.

const tmpDirs: string[] = [];

function makeHomeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opencode-historian-test-'));
  tmpDirs.push(dir);
  return dir;
}

/** Writes the fixture sentinel under <homeDir>/.config/opencode/. */
function writeSentinel(homeDir: string, content: string): void {
  const p = loopStatePath(homeDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content, 'utf8');
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loopStatePath', () => {
  it('joins the sentinel file under .config/opencode of the injected home', () => {
    expect(loopStatePath('/tmp/example-home')).toBe(
      '/tmp/example-home/.config/opencode/historian-reading-loop.json',
    );
  });

  it('exposes the sentinel schema version as 1', () => {
    expect(LOOP_STATE_VERSION).toBe(1);
  });
});

describe('isReadingLoopConfirmed (adversarial: malformed_input)', () => {
  it('returns false when the sentinel file is missing', () => {
    expect(isReadingLoopConfirmed(makeHomeDir())).toBe(false);
  });

  it('returns false for truncated JSON without throwing', () => {
    const homeDir = makeHomeDir();
    writeSentinel(homeDir, '{"version": 1, "confirmed": tr');
    expect(isReadingLoopConfirmed(homeDir)).toBe(false);
  });

  it('returns false for `{]` garbage without throwing', () => {
    const homeDir = makeHomeDir();
    writeSentinel(homeDir, '{]');
    expect(isReadingLoopConfirmed(homeDir)).toBe(false);
  });

  it('returns false when the top-level value is an array', () => {
    const homeDir = makeHomeDir();
    writeSentinel(homeDir, '[{"version":1,"confirmed":true}]');
    expect(isReadingLoopConfirmed(homeDir)).toBe(false);
  });

  it('returns false when the top-level value is a string', () => {
    const homeDir = makeHomeDir();
    writeSentinel(homeDir, '"confirmed"');
    expect(isReadingLoopConfirmed(homeDir)).toBe(false);
  });

  it('returns false when the top-level value is a number', () => {
    const homeDir = makeHomeDir();
    writeSentinel(homeDir, '42');
    expect(isReadingLoopConfirmed(homeDir)).toBe(false);
  });

  it('returns false when the file is empty', () => {
    const homeDir = makeHomeDir();
    writeSentinel(homeDir, '');
    expect(isReadingLoopConfirmed(homeDir)).toBe(false);
  });
});

describe('isReadingLoopConfirmed (shape + strict equality)', () => {
  it('returns false when confirmed is false', () => {
    const homeDir = makeHomeDir();
    writeSentinel(homeDir, '{"version":1,"confirmed":false}');
    expect(isReadingLoopConfirmed(homeDir)).toBe(false);
  });

  it('returns true only for {"version":1,"confirmed":true}', () => {
    const homeDir = makeHomeDir();
    writeSentinel(homeDir, '{"version":1,"confirmed":true}');
    expect(isReadingLoopConfirmed(homeDir)).toBe(true);
  });

  it('returns false for a future schema version (strict === 1, not truthy)', () => {
    const homeDir = makeHomeDir();
    writeSentinel(homeDir, '{"version":2,"confirmed":true}');
    expect(isReadingLoopConfirmed(homeDir)).toBe(false);
  });

  it('returns false when version is missing', () => {
    const homeDir = makeHomeDir();
    writeSentinel(homeDir, '{"confirmed":true}');
    expect(isReadingLoopConfirmed(homeDir)).toBe(false);
  });

  it('returns false when confirmed is the string "true" (strict === true)', () => {
    const homeDir = makeHomeDir();
    writeSentinel(homeDir, '{"version":1,"confirmed":"true"}');
    expect(isReadingLoopConfirmed(homeDir)).toBe(false);
  });

  it('returns false when version is the string "1" (strict === 1)', () => {
    const homeDir = makeHomeDir();
    writeSentinel(homeDir, '{"version":"1","confirmed":true}');
    expect(isReadingLoopConfirmed(homeDir)).toBe(false);
  });

  it('accepts JSONC comments and trailing commas (parsed via parseJsonc)', () => {
    const homeDir = makeHomeDir();
    writeSentinel(homeDir, '{ // human-written, by-hand confirmation\n"version":1,"confirmed":true,}');
    expect(isReadingLoopConfirmed(homeDir)).toBe(true);
  });
});

describe('isReadingLoopConfirmed (adversarial: stale_state — no caching)', () => {
  it('reflects a sentinel rewritten between two sequential calls', () => {
    const homeDir = makeHomeDir();
    writeSentinel(homeDir, '{"version":1,"confirmed":false}');
    expect(isReadingLoopConfirmed(homeDir)).toBe(false);
    writeSentinel(homeDir, '{"version":1,"confirmed":true}');
    expect(isReadingLoopConfirmed(homeDir)).toBe(true);
    rmSync(loopStatePath(homeDir));
    expect(isReadingLoopConfirmed(homeDir)).toBe(false);
  });
});

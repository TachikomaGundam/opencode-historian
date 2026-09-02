import { afterEach, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type GqlClient } from '../src/wiki/client.js';
import type { HistorianOptions } from '../src/config.js';

// Shared fixtures for test/client.test.ts (kept under the 250-LOC ceiling by
// splitting). Every fixture uses the synthetic key below; helpers are pure —
// no network, real config, or shared mutable state between tests.

export const KEY = 'sk-wiki-unit-fixture-7c2e9f';
export const URL = 'http://localhost:3000/graphql';

export const OPTS: HistorianOptions = {
  baseUrl: 'http://localhost:3000',
  apiKeyPath: '~/.wikijs-api-key',
  translate: {
    endpoint: 'http://translate.test',
    model: 'qwen3.7-plus',
    apiKey: 'sk-translate',
    providerKey: 'my-provider',
  },
  sections: ['_sandbox'],
  locales: ['en', 'zh'],
  readingLoop: true,
};

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Home dir containing a key file; lets createClient resolve the key via fs. */
export function makeKeyHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'historian-client-test-'));
  tmpDirs.push(dir);
  writeFileSync(join(dir, '.wikijs-api-key'), `${KEY}\n`, 'utf8');
  return dir;
}

/** Home dir with no key file and no key sources — for ConfigError cases. */
export function makeBareHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'historian-client-nokey-'));
  tmpDirs.push(dir);
  return dir;
}

export function makeClient(
  fetchImpl: typeof fetch,
  extra?: { timeoutMs?: number; env?: NodeJS.ProcessEnv; homeDir?: string },
): { client: GqlClient; key: string } {
  const client = createClient(OPTS, {
    fetchImpl,
    timeoutMs: extra?.timeoutMs,
    env: extra?.env,
    homeDir: extra?.homeDir ?? makeKeyHome(),
  });
  return { client, key: KEY };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Captures the edge error; rethrows (test failure) if the promise resolves. */
export async function catchError(p: Promise<unknown>): Promise<Error> {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected gql() to reject');
}

/** Every own string field of the error — the whole leak surface. */
function stringFields(err: object): readonly string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(err)) {
    if (typeof v === 'string') out.push(`${k}=${v}`);
  }
  return out;
}

export function expectNoKeyLeak(err: object): void {
  for (const field of stringFields(err)) {
    expect(field).not.toContain(KEY);
  }
}
/**
 * Machine-tier evidence page template (v3 todo 5): evidenceSkeleton() unit
 * contract + historian_page_create template-mode wiring for tier "evidence".
 *
 * evidenceSkeleton is a pure function — every assertion uses deterministic
 * inputs (capturedAt passed explicitly; the create-tool case pins the clock
 * with fake timers). The tool cases reuse the zero-fetch mock pattern from
 * test/tools.test.ts: an empty fragment-dispatch responder throws on ANY gql
 * call, so "no fetch performed" is a hard failure, not a silent pass.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type ToolDefinition } from '@opencode-ai/plugin';
import { OPTS, jsonResponse } from './client-fixtures.js';
import { genreSkeleton, classifyGenre } from '../src/templates/genres.js';
import { evidenceSkeleton } from '../src/templates/evidence.js';
import { buildTools } from '../src/tools.js';

// --- evidenceSkeleton (pure) --------------------------------------------------

const INPUT = {
  sourcePath: 'ops/incident-a',
  sourceUrl: 'http://x/y',
  capturedAt: '2026-09-03T00:00:00Z',
  context: 'demo',
} as const;

describe('evidenceSkeleton', () => {
  const skeleton = evidenceSkeleton(INPUT);

  it('renders the machine-tier header blockquote with injected values verbatim', () => {
    // Given / When: the skeleton above / Then: the exact plan-mandated line
    expect(skeleton).toContain(
      '> 机器层证据页 (machine-tier evidence). 来源页 (source): [ops/incident-a](http://x/y)' +
        ' · 采集 (captured): 2026-09-03T00:00:00Z · 上下文 (context): demo',
    );
  });

  it('has both mandated section headers', () => {
    expect(skeleton).toContain('## 原文 (verbatim)');
    expect(skeleton).toContain('## 采集环境 (capture context)');
  });

  it('carries an empty verbatim fence and the three capture-context placeholders', () => {
    // Given / Then: fence opens and closes with nothing between
    expect(skeleton).toContain('```\n```');
    // Three placeholder lines: command / cwd / time
    expect(skeleton).toMatch(/^.*command.*`<.*`$/m);
    expect(skeleton).toMatch(/^.*cwd.*`<.*`$/m);
    expect(skeleton).toMatch(/^.*time.*`<.*`$/m);
  });

  it('is not genre-templated: no toc macro, no YAML frontmatter, no ::: containers', () => {
    expect(skeleton).not.toContain('{{toc}}');
    expect(skeleton.startsWith('---')).toBe(false);
    expect(skeleton).not.toContain(':::');
  });

  it('is deterministic: two calls with the same input are byte-identical', () => {
    expect(evidenceSkeleton(INPUT)).toBe(evidenceSkeleton(INPUT));
  });

  it('stays structurally valid on empty-string inputs (no "undefined" leaks)', () => {
    // Given: malformed caller passes empty strings for sourcePath / context
    const empty = evidenceSkeleton({
      sourcePath: '',
      sourceUrl: '',
      capturedAt: '',
      context: '',
    });
    // Then: header + both sections + empty fence still present; fields render
    // as empty placeholders, never the literal string "undefined".
    expect(empty).toContain('> 机器层证据页 (machine-tier evidence). 来源页 (source): []()');
    expect(empty).toContain('## 原文 (verbatim)');
    expect(empty).toContain('## 采集环境 (capture context)');
    expect(empty).toContain('```\n```');
    expect(empty).not.toContain('undefined');
  });
});

// --- historian_page_create template-mode wiring --------------------------------

const EVIDENCE_PATH = '_evidence/demo';
const FRONT_PATH = 'docs/index';

/** Local copy of the tools.test.ts harness: empty handlers make ANY gql fetch
 *  throw; tmp home carries the synthetic key so client construction (never
 *  resolution — template mode must not touch it) stays side-effect-free. */
function makeWired(): { tools: Record<string, ToolDefinition>; fetchCount: () => number } {
  let count = 0;
  const fetchImpl = (async (input: unknown, init?: unknown): Promise<Response> => {
    count++;
    const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as { query: string };
    throw new Error(`evidence.test: unhandled query ${body.query}`);
  }) as typeof fetch;
  const home = mkdtempSync(join(tmpdir(), 'historian-evidence-test-'));
  writeFileSync(join(home, '.wikijs-api-key'), 'sk-wiki-unit-fixture-7c2e9f\n', 'utf8');
  const tools = buildTools(OPTS, { fetchImpl, homeDir: home });
  return { tools, fetchCount: () => count };
}

async function run(toolDef: ToolDefinition, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = await toolDef.execute(args as never, {} as never);
  const text = typeof out === 'string' ? out : String((out as { output: string }).output);
  return JSON.parse(text) as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('historian_page_create template mode (blank content)', () => {
  it('tier evidence: echoes the evidence skeleton, genre-free, ZERO fetches', async () => {
    // Given: a frozen clock so capturedAt is deterministic
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T00:00:00.000Z'));
    const { tools, fetchCount } = makeWired();

    // When: creating an evidence page with no content and a description hint
    const out = await run(tools.historian_page_create, {
      path: EVIDENCE_PATH,
      title: 'Capture A',
      tier: 'evidence',
      description: 'incident demo',
    });

    // Then: template mode with the machine skeleton, description wired as context
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('template');
    expect(out.genre).toBeUndefined();
    expect(out.skeleton).toBe(
      evidenceSkeleton({
        sourcePath: '<human-page-path>',
        sourceUrl: '<human-page-url>',
        capturedAt: '2026-09-03T00:00:00.000Z',
        context: 'incident demo',
      }),
    );
    // The note steers the caller: fill verbatim + replace the placeholders
    expect(String(out.note)).toContain('Nothing was written to the wiki');
    expect(String(out.note)).toContain('原文');
    expect(String(out.note)).toContain('<human-page-path>');
    // D4-4: template envelopes carry no machine-tier 404 note
    expect(String(out.note)).not.toContain('anonymous visits 404');
    expect(fetchCount()).toBe(0);
  });

  it('tier evidence + locale zh: skeleton forced en with the localeHint', async () => {
    // Given
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T00:00:00.000Z'));
    const { tools } = makeWired();

    // When
    const out = await run(tools.historian_page_create, {
      path: EVIDENCE_PATH,
      title: 'Capture A',
      tier: 'evidence',
      locale: 'zh',
    });

    // Then: en skeleton, no description → context placeholder kept
    expect(out.mode).toBe('template');
    expect(out.locale).toBe('en');
    expect(out.skeleton).toBe(
      evidenceSkeleton({
        sourcePath: '<human-page-path>',
        sourceUrl: '<human-page-url>',
        capturedAt: '2026-09-03T00:00:00.000Z',
        context: '<one-line context>',
      }),
    );
    expect(String(out.localeHint)).toContain('monolingual en');
  });

  it('tier front: genre skeleton path is byte-identical to before (regression pin)', async () => {
    // Given
    const { tools, fetchCount } = makeWired();
    const input = { path: FRONT_PATH, title: 'Alpha' };

    // When: front-tier blank content (classification fallback)
    const out = await run(tools.historian_page_create, input);

    // Then: exactly the pre-todo-5 envelope — genre key present, old note text
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('template');
    const expected = classifyGenre({ title: 'Alpha', body: '' });
    expect(out.genre).toBe(expected.genre);
    expect(out.locale).toBe('en');
    expect(out.skeleton).toBe(genreSkeleton(expected.genre, 'en'));
    expect(out.note).toBe(
      'Nothing was written to the wiki (template mode, no content). Fill the skeleton and call historian_page_create again with content.',
    );
    expect(fetchCount()).toBe(0);
  });

  it('tier front + explicit genre G3: still the genre envelope (regression pin)', async () => {
    const { tools, fetchCount } = makeWired();
    const out = await run(tools.historian_page_create, {
      path: FRONT_PATH,
      title: 'Alpha',
      genre: 'G3',
    });
    expect(out.mode).toBe('template');
    expect(out.genre).toBe('G3');
    expect(out.skeleton).toBe(genreSkeleton('G3', 'en'));
    expect(fetchCount()).toBe(0);
  });
});

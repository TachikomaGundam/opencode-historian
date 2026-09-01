/**
 * Migration engine tests (plan todo 14): reformat dry-run + apply pipeline.
 * Everything is mocked: dual-mode fetch (gql fragments + the LLM messages
 * endpoint), tmp home dir, tmp results dir, fixed `now` for deterministic
 * backup filenames. The LLM text and the deterministic checklist calculator
 * are the only oracle inputs — the engine itself stays network-free.
 */

import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeClient, makeKeyHome, OPTS, jsonResponse } from './client-fixtures.js';
import { reformatPageDraft } from '../src/migrate.js';
import { applyMigration } from '../src/migrate-apply.js';
import { scoreChecklist, contentSimilar } from '../src/migrate-score.js';
import { backupFileFor, checkpointPath, hashText, writeCheckpoint } from '../src/migrate-store.js';
import { TranslateError } from '../src/translate.js';
import { PageNotFoundError } from '../src/wiki/pages.js';
import type { MigrateDeps } from '../src/migrate.js';

const PATH = '_sandbox/algo';
const NOW_LOCAL = new Date(2026, 8, 1, 12, 0, 0); // local date 2026-09-01 in any TZ
const DATE_KEY = '2026-09-01';
const BACKUP_NAME = `pilot-backup-_sandbox-${DATE_KEY}.json`;
const zh = (t: string): string => `译:${t}`;
const SOURCE_CONTENT = '# ROCm Tuning\n\nfacts here.';

const DRAFT = `# ROCm Tuning (sandbox)

ROCm tuning notes tracked with tests.

## Target

| knob | register | effect |
| --- | --- | --- |
| a | x | y |

## Status

Green.`;

function pageFixture(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 76,
    path: PATH,
    locale: 'en',
    title: 'ROCm Tuning (sandbox)',
    description: 'desc',
    content: SOURCE_CONTENT,
    isPublished: false,
    isPrivate: true,
    contentType: 'markdown',
    tags: [{ tag: 't1' }],
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

const zhPage = (): Record<string, unknown> => pageFixture({ id: 998, locale: 'zh', title: '阿尔法' });

const RESP_OK = {
  data: {
    pages: {
      update: { responseResult: { succeeded: true, errorCode: 0, slug: '', message: '' } },
      create: { responseResult: { succeeded: true, errorCode: 0, slug: '', message: '' } },
    },
  },
};

interface GqlCall { readonly query: string; readonly variables: Record<string, unknown>; }
interface LlmCall { readonly system: string; readonly user: string; readonly model: string; }

/** Dual-mode fetch: body.query → gql fragment dispatch; body.model+messages →
 *  LLM reply (or a canned HTTP status for failure-path tests). */
function makeDuel(
  handlers: Record<string, (vars: Record<string, unknown>) => unknown>,
  llm: { text: string } | { status: number },
): { fetchImpl: typeof fetch; gqlCalls: GqlCall[]; llmCalls: LlmCall[]; fetchCount: () => number } {
  const gqlCalls: GqlCall[] = [];
  const llmCalls: LlmCall[] = [];
  let count = 0;
  const fetchImpl = (async (_input: unknown, init?: unknown): Promise<Response> => {
    count++;
    const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as Record<string, unknown>;
    if (typeof body.query === 'string') {
      const query = body.query as string;
      const variables = (body.variables ?? {}) as Record<string, unknown>;
      gqlCalls.push({ query, variables });
      const fragment = Object.keys(handlers).find((f) => query.includes(f));
      if (fragment === undefined) throw new Error(`migrate.test: unhandled query ${query}`);
      return jsonResponse(handlers[fragment]!(variables));
    }
    if (typeof body.model === 'string' && Array.isArray(body.messages)) {
      const messages = body.messages as Array<{ role: string; content: string }>;
      llmCalls.push({ system: String(body.system ?? ''), user: messages[0]?.content ?? '', model: body.model });
      if ('status' in llm) {
        return new Response(JSON.stringify({ error: { message: 'LLM boom' } }), {
          status: llm.status,
          headers: { 'content-type': 'application/json' },
        });
      }
      return jsonResponse({ content: [{ type: 'text', text: llm.text }] });
    }
    throw new Error('migrate.test: unknown fetch body shape');
  }) as typeof fetch;
  return { fetchImpl, gqlCalls, llmCalls, fetchCount: () => count };
}

const tmpDirs: string[] = [];

function makeDeps(duel: ReturnType<typeof makeDuel>): { deps: MigrateDeps; home: string; resultsDir: string; backupFile: string } {
  const home = makeKeyHome();
  const resultsDir = fs.mkdtempSync(join(tmpdir(), 'hist-migrate-'));
  tmpDirs.push(resultsDir);
  return {
    deps: {
      client: makeClient(duel.fetchImpl).client,
      options: OPTS,
      fetchImpl: duel.fetchImpl,
      homeDir: home,
      resultsDir,
    },
    home,
    resultsDir,
    backupFile: backupFileFor('_sandbox', DATE_KEY, resultsDir),
  };
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('reformatPageDraft', () => {
  it('embeds RESTYLE token, rules R1..R8, preservation instruction and the original content in the LLM payload', async () => {
    // Given: an en page and an explicit G3 genre
    const duel = makeDuel(
      {
        'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? null : pageFixture() } } }),
      },
      { text: DRAFT },
    );
    const { deps } = makeDeps(duel);

    // When: running the dry-run
    const out = await reformatPageDraft(deps, { path: PATH, genre: 'G3' });

    // Then: the LLM saw the restyle system + the G3 skeleton + the original verbatim
    expect(out.ok).toBe(true);
    expect(duel.llmCalls).toHaveLength(1);
    const system = duel.llmCalls[0]!.system;
    expect(system).toContain('RESTYLE: en->en');
    expect(system).toContain('R1 结论先行');
    expect(system).toContain('R8 行动项五要素');
    expect(system).toMatch(/PRESERVE/);
    expect(system).toMatch(/verbatim/);
    expect(system).toContain('code fences');
    expect(system).not.toContain('DIRECTION:');
    const user = duel.llmCalls[0]!.user;
    expect(user).toContain('TARGET GENRE SKELETON (G3, en):');
    expect(user).toContain('ORIGINAL CONTENT TO RESTRUCTURE:');
    expect(user).toContain(SOURCE_CONTENT);
    expect(user).not.toContain('REVISE HINTS');
  });

  it('appends reviseHints into the restyle user prompt and omits the section when none are passed', async () => {
    // Given: an en page with an explicit G3 genre
    const duel = makeDuel(
      { 'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? null : pageFixture() } } }) },
      { text: DRAFT },
    );
    const { deps } = makeDeps(duel);

    // When: dry-run with revise hints
    const out = await reformatPageDraft(deps, { path: PATH, genre: 'G3', reviseHints: ['中文句长 ≤20 字，拆短句', 'timeline rows must carry a source'] });

    // Then: every hint rides the user prompt under the machine marker, in order
    expect(out.ok).toBe(true);
    expect(duel.llmCalls).toHaveLength(1);
    const user = duel.llmCalls[0]!.user;
    expect(user).toContain('REVISE HINTS (the restructure MUST satisfy every hint):');
    expect(user).toContain('- 中文句长 ≤20 字，拆短句');
    expect(user).toContain('- timeline rows must carry a source');
    expect(user.indexOf('中文句长 ≤20 字，拆短句')).toBeLessThan(user.indexOf('timeline rows must carry a source'));
    expect(user.indexOf('ORIGINAL CONTENT TO RESTRUCTURE:')).toBeLessThan(user.indexOf('REVISE HINTS'));
  });

  it('restyles same-language for a zh source and flags the missing en twin', async () => {
    // Given: a zh-only page
    const duel = makeDuel(
      { 'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? zhPage() : null } } }) },
      { text: DRAFT },
    );
    const { deps } = makeDeps(duel);

    // When: dry-run without an explicit genre
    const out = await reformatPageDraft(deps, { path: PATH });

    // Then: zh->zh restyle; en twin reported missing; genre classified from the zh body
    expect(out.ok).toBe(true);
    expect(duel.llmCalls[0]!.system).toContain('RESTYLE: zh->zh');
    expect(out.sourceLocale).toBe('zh');
    expect(out.missingTwin).toBe(true);
    expect(out.genre).toBeDefined();
  });

  it('scores the checklist on the DRAFT with the N/A contract (G3 → items 4,5,6 na; 9,10 deferred)', async () => {
    // Given: a source WITHOUT tables/marketing but a draft WITH a table…
    const duel = makeDuel(
      { 'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? null : pageFixture() } } }) },
      { text: DRAFT },
    );
    const { deps } = makeDeps(duel);

    // When: dry-run with an explicit G3 genre
    const out = await reformatPageDraft(deps, { path: PATH, genre: 'G3' });

    // Then: …the draft's table passes item 3 (draft-scoring, not source-scoring)
    expect(out.ok).toBe(true);
    const verdict = (id: number): string => out.checklistResults!.find((c) => c.id === id)!.verdict;
    expect(verdict(1)).toBe('pass');
    expect(verdict(2)).toBe('pass');
    expect(verdict(3)).toBe('pass');
    expect(verdict(4)).toBe('na');
    expect(verdict(5)).toBe('na');
    expect(verdict(6)).toBe('na');
    expect(verdict(7)).toBe('pass');
    expect(verdict(8)).toBe('pass');
    expect(verdict(9)).toBe('deferred');
    expect(verdict(10)).toBe('deferred');
    expect(out.checklistResults!.find((c) => c.id === 4)!.note).toContain('N/A — genre G3');
  });

  it('flags unbacked marketing terms on the draft (item 8) deterministically', async () => {
    // Given: a draft containing a style.md banned word while the source is clean
    const duel = makeDuel(
      { 'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? null : pageFixture() } } }) },
      { text: DRAFT.replace('notes tracked with tests', 'notes deliver robust, world-class tracking') },
    );
    const { deps } = makeDeps(duel);

    // When: dry-run
    const out = await reformatPageDraft(deps, { path: PATH, genre: 'G3' });

    // Then: deterministic code — not the LLM — caught the word
    expect(out.ok).toBe(true);
    const item8 = out.checklistResults!.find((c) => c.id === 8)!;
    expect(item8.verdict).toBe('fail');
    expect(item8.note).toContain('robust');
  });

  it('scores G1 tables deterministically: sourced timeline + five-essentials action table', () => {
    // Given: a conformant G1 draft
    const g1 = `# X

lead.

## 时间线

| 时间 | 事件 | 来源 |
| --- | --- | --- |
| 2026 | a | s |

## 行动项

| 措施 | 类型 | 负责人 | 期限 | 验证 | 状态 |
| --- | --- | --- | --- | --- | --- |
| m | t | o | d | v | s |`;

    // When: scoring it
    const verdicts = scoreChecklist('G1', g1);

    // Then: timeline has a source; the action table has the five essentials
    expect(verdicts.find((c) => c.id === 5)!.verdict).toBe('pass');
    expect(verdicts.find((c) => c.id === 6)!.verdict).toBe('pass');
    expect(verdicts.find((c) => c.id === 3)!.verdict).toBe('pass');
  });

  it('returns a structured TranslateError when the LLM is down (HTTP 500)', async () => {
    // Given: LLM endpoint failing
    const duel = makeDuel(
      { 'singleByPath(': () => ({ data: { pages: { singleByPath: pageFixture() } } }) },
      { status: 500 },
    );
    const { deps } = makeDeps(duel);

    // When: dry-run
    const out = await reformatPageDraft(deps, { path: PATH, genre: 'G3' });

    // Then: {ok:false} with the shared translate error taxonomy — never a crash
    expect(out.ok).toBe(false);
    expect(out.error).toBeInstanceOf(TranslateError);
    expect((out.error as TranslateError).cause).toBe('http');
  });

  it('returns PageNotFoundError when neither locale exists — without touching the LLM', async () => {
    // Given: page missing in en and zh
    const duel = makeDuel(
      { 'singleByPath(': () => ({ data: { pages: { singleByPath: null } } }) },
      { text: DRAFT },
    );
    const { deps } = makeDeps(duel);

    // When: dry-run
    const out = await reformatPageDraft(deps, { path: PATH });

    // Then: not-found envelope; both locale probes, zero LLM calls
    expect(out.ok).toBe(false);
    expect(out.error).toBeInstanceOf(PageNotFoundError);
    expect(duel.fetchCount()).toBe(2);
    expect(duel.llmCalls).toHaveLength(0);
  });

  it('reports alreadyConforms=true when the restyle is whitespace-identical to the stored content', async () => {
    // Given: LLM echoes the exact stored content
    const duel = makeDuel(
      { 'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? null : pageFixture() } } }) },
      { text: SOURCE_CONTENT },
    );
    const { deps } = makeDeps(duel);

    // When/Then: the conformance signal is a diff-based computation, not prose
    const out = await reformatPageDraft(deps, { path: PATH, genre: 'G3' });
    expect(out.alreadyConforms).toBe(true);
  });

  it('reports alreadyConforms=false for a genuinely restyled draft', async () => {
    // Given: a real restyle
    const duel = makeDuel(
      { 'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? null : pageFixture() } } }) },
      { text: DRAFT },
    );
    const { deps } = makeDeps(duel);

    // When/Then
    const out = await reformatPageDraft(deps, { path: PATH, genre: 'G3' });
    expect(out.alreadyConforms).toBe(false);
  });

  it('contentSimilar: whitespace drift counts as conformant, different prose does not', () => {
    expect(contentSimilar('a  b\nc', 'a b  c')).toBe(true);
    expect(contentSimilar('a b c', 'a b d')).toBe(false);
  });
});

describe('applyMigration', () => {
  it('writes the pre-image backup BEFORE the first mutation (call-order enforcement)', async () => {
    // Given: both locales present; a mutation handler that OBSERVES the backup
    let backupExistedAtFirstMutation: boolean | null = null;
    let backupFilePath = '';
    const duel = makeDuel(
      {
        'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? zhPage() : pageFixture() } } }),
        'single(': (vars) => ({ data: { pages: { single: vars.id === 998 ? zhPage() : pageFixture() } } }),
        'update(': () => {
          if (backupExistedAtFirstMutation === null) backupExistedAtFirstMutation = fs.existsSync(backupFilePath);
          return RESP_OK;
        },
      },
      { text: DRAFT },
    );
    const { deps, backupFile } = makeDeps(duel);
    backupFilePath = backupFile;

    // When: applying with the dry-run draft
    const out = await applyMigration(deps, { path: PATH, genre: 'G3', draft: DRAFT, now: NOW_LOCAL });

    // Then: the first mutation observed the backup already on disk
    expect(out.ok).toBe(true);
    expect(backupExistedAtFirstMutation).toBe(true);
    expect(fs.existsSync(backupFile)).toBe(true);
  });

  it('upserts both locales: en=raw draft, zh=engine-translated draft, RMW echo preserved', async () => {
    // Given: en+zh pages with a publishStartDate on the en pre-image
    const storeEn = pageFixture({ publishStartDate: '2025-01-01T00:00:00.000Z' });
    const storeZh = zhPage();
    const duel = makeDuel(
      {
        'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? storeZh : storeEn } } }),
        'single(': (vars) => ({ data: { pages: { single: vars.id === 998 ? storeZh : storeEn } } }),
        'update(': (vars) => {
          const v = vars as Record<string, unknown>;
          const rec = v.locale === 'zh' ? storeZh : storeEn;
          Object.assign(rec, {
            title: v.title,
            content: v.content,
            description: v.description,
            isPublished: v.isPublished,
            isPrivate: v.isPrivate,
            publishStartDate: v.publishStartDate,
            publishEndDate: v.publishEndDate,
            scriptCss: v.scriptCss,
            scriptJs: v.scriptJs,
            tags: (v.tags as string[]).map((t) => ({ tag: t })),
          });
          return RESP_OK;
        },
      },
      { text: DRAFT },
    );
    const { deps: base, home, backupFile } = makeDeps(duel);
    const deps = { ...base, translate: zh };

    // When
    const out = await applyMigration(deps, { path: PATH, genre: 'G3', draft: DRAFT, now: NOW_LOCAL });

    // Then: applied entries + per-locale write payloads
    expect(out.ok).toBe(true);
    const applied = (out.ok && out.applied) || [];
    expect(applied.map((a) => `${a.locale}:${a.action}`)).toEqual(['en:updated', 'zh:updated']);
    const updates = duel.gqlCalls.filter((c) => c.query.includes('update('));
    expect(updates).toHaveLength(2);
    const enVars = updates.find((c) => c.variables.id === 76)!.variables;
    const zhVars = updates.find((c) => c.variables.id === 998)!.variables;
    expect(enVars.content).toBe(DRAFT);
    expect(zhVars.content).toBe(zh(DRAFT));
    // RMW echo: unpublished + tags survive the write (pitfall #2)
    expect(zhVars.isPublished).toBe(false);
    expect(zhVars.tags).toEqual(['t1']);

    // Then: pre-image backup captured the full write-side field set
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8')) as { paths: Record<string, { en: Record<string, unknown>; zh: Record<string, unknown> }> };
    expect(backup.paths[PATH].en.content).toBe(SOURCE_CONTENT);
    expect(backup.paths[PATH].en.title).toBe('ROCm Tuning (sandbox)');
    expect(backup.paths[PATH].en.description).toBe('desc');
    expect(backup.paths[PATH].en.tags).toEqual(['t1']);
    expect(backup.paths[PATH].en.isPublished).toBe(false);
    expect(backup.paths[PATH].en.publishStartDate).toBe('2025-01-01T00:00:00.000Z');
    expect(backup.paths[PATH].en.publishEndDate).toBe('');
    expect(backup.paths[PATH].zh.content).toBe(SOURCE_CONTENT);

    // Then: second-pass verification scored on the STORED (post-write) content
    expect(applied[0]!.checklist).toEqual(scoreChecklist('G3', storeEn.content as string));
    expect(applied[1]!.checklist).toEqual(scoreChecklist('G3', storeZh.content as string));

    // Then: checkpoint latches the PRE-state hashes
    const cp = JSON.parse(fs.readFileSync(checkpointPath(home), 'utf8')) as { paths: Record<string, { contentHash: string; zhHash: string; genre: string }> };
    expect(cp.paths[PATH].contentHash).toBe(hashText(SOURCE_CONTENT));
    expect(cp.paths[PATH].zhHash).toBe(hashText(SOURCE_CONTENT));
    expect(cp.paths[PATH].genre).toBe('G3');
  });

  it('auto-creates the missing zh twin (translated, unpublished, no twin dupe) with pre-image zh=null', async () => {
    // Given: en only; zh appears only after the create
    const storeEn = pageFixture();
    const storeZh = zhPage();
    let zhCreated = false;
    const duel = makeDuel(
      {
        'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? (zhCreated ? storeZh : null) : storeEn } } }),
        'single(': (vars) => ({ data: { pages: { single: vars.id === 998 ? storeZh : storeEn } } }),
        'update(': () => RESP_OK,
        'create(': () => {
          zhCreated = true;
          return RESP_OK;
        },
      },
      { text: DRAFT },
    );
    const { deps: base, backupFile } = makeDeps(duel);
    const deps = { ...base, translate: zh };

    // When
    const out = await applyMigration(deps, { path: PATH, genre: 'G3', draft: DRAFT, now: NOW_LOCAL });

    // Then: exactly ONE create (no twin duplication), translated title+content, isPublished inherited (never published)
    expect(out.ok).toBe(true);
    const creates = duel.gqlCalls.filter((c) => c.query.includes('create('));
    expect(creates).toHaveLength(1);
    const v = creates[0]!.variables;
    expect(v.path).toBe(PATH);
    expect(v.locale).toBe('zh');
    expect(v.title).toBe(zh('ROCm Tuning (sandbox)'));
    expect(v.content).toBe(zh(DRAFT));
    expect(v.isPublished).toBe(false);
    expect(v.tags).toEqual(['t1']);
    const applied = (out.ok && out.applied) || [];
    expect(applied.map((a) => `${a.locale}:${a.action}`)).toEqual(['en:updated', 'zh:created']);

    // Then: the missing twin's pre-image is recorded null
    const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8')) as { paths: Record<string, { en: unknown; zh: unknown }> };
    expect(backup.paths[PATH].zh).toBeNull();
    expect(backup.paths[PATH].en).not.toBeNull();
  });

  it('survives a mid-apply failure: backup left, checkpoint absent, re-apply resumes', async () => {
    // Given: zh update fails once, then succeeds
    let zhFailures = 1;
    const storeEn = pageFixture();
    const storeZh = zhPage();
    const duel = makeDuel(
      {
        'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? storeZh : storeEn } } }),
        'single(': (vars) => ({ data: { pages: { single: vars.id === 998 ? storeZh : storeEn } } }),
        'update(': (vars) => {
          if (vars.id === 998 && zhFailures > 0) {
            zhFailures--;
            throw new Error('boom: zh write failed');
          }
          const v = vars as Record<string, unknown>;
          const rec = v.locale === 'zh' ? storeZh : storeEn;
          Object.assign(rec, { content: v.content, title: v.title, description: v.description, isPublished: v.isPublished, tags: (v.tags as string[]).map((t) => ({ tag: t })) });
          return RESP_OK;
        },
      },
      { text: DRAFT },
    );
    const { deps: base, home, backupFile } = makeDeps(duel);
    const deps = { ...base, translate: zh };

    // When: first attempt hits the failing zh write
    const first = await applyMigration(deps, { path: PATH, genre: 'G3', draft: DRAFT, now: NOW_LOCAL });

    // Then: structured failure; backup persisted; NO checkpoint (resumable)
    expect(first.ok).toBe(false);
    expect(String((first as { error: Error }).error.message)).toContain('boom');
    expect(fs.existsSync(backupFile)).toBe(true);
    expect(fs.existsSync(checkpointPath(home))).toBe(false);

    // When: re-apply after the transient failure
    const second = await applyMigration(deps, { path: PATH, genre: 'G3', draft: DRAFT, now: NOW_LOCAL });

    // Then: completes; checkpoint present; zh content is the translated draft
    expect(second.ok).toBe(true);
    expect(fs.existsSync(checkpointPath(home))).toBe(true);
    const zhUpdates = duel.gqlCalls.filter((c) => c.query.includes('update(') && c.variables.id === 998);
    expect(zhUpdates[zhUpdates.length - 1]!.variables.content).toBe(zh(DRAFT));
  });

  it('skips as a checkpoint no-op when path + pre-state hashes match (zero mutations, zero backup writes)', async () => {
    // Given: an existing checkpoint entry whose hashes match the CURRENT pre-state
    const storeEn = pageFixture();
    const storeZh = zhPage();
    const duel = makeDuel(
      {
        'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? storeZh : storeEn } } }),
      },
      { text: DRAFT },
    );
    const { deps: base, home, resultsDir } = makeDeps(duel);
    const deps = { ...base, translate: zh };
    writeCheckpoint(home, {
      version: 1,
      paths: {
        [PATH]: { contentHash: hashText(SOURCE_CONTENT), zhHash: hashText(SOURCE_CONTENT), appliedAt: '2026-08-30T00:00:00.000Z', genre: 'G3' },
      },
    });

    // When / Then: reads only; no updates, no backup file, structured skip reason
    const out = await applyMigration(deps, { path: PATH, genre: 'G3', draft: DRAFT, now: NOW_LOCAL });
    expect(out.ok).toBe(true);
    expect((out as { skipped?: string }).skipped).toContain('checkpoint no-op');
    expect((out as { applied: readonly unknown[] }).applied).toHaveLength(0);
    expect(duel.fetchCount()).toBe(2);
    expect(fs.readdirSync(resultsDir).filter((f) => f.endsWith('.json'))).toHaveLength(0);
  });

  it('reformats a zh-only source and creates the en twin from the translated zh draft', async () => {
    // Given: zh exists, en missing
    const storeEn = pageFixture();
    const storeZh = zhPage();
    let enCreated = false;
    const duel = makeDuel(
      {
        'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'en' ? (enCreated ? storeEn : null) : storeZh } } }),
        'single(': (vars) => ({ data: { pages: { single: vars.id === 998 ? storeZh : storeEn } } }),
        'update(': () => RESP_OK,
        'create(': () => {
          enCreated = true;
          return RESP_OK;
        },
      },
      { text: DRAFT },
    );
    const { deps: base } = makeDeps(duel);
    const deps = { ...base, translate: zh };
    const zhDraft = '这是按 G3 重整的草稿。';

    // When
    const out = await applyMigration(deps, { path: PATH, genre: 'G3', draft: zhDraft, now: NOW_LOCAL });

    // Then: en created from the zh-translated draft; zh updated with the raw draft
    expect(out.ok).toBe(true);
    const applied = (out.ok && out.applied) || [];
    expect(applied.map((a) => `${a.locale}:${a.action}`)).toEqual(['en:created', 'zh:updated']);
    const createVars = duel.gqlCalls.find((c) => c.query.includes('create('))!.variables;
    expect(createVars.locale).toBe('en');
    expect(createVars.title).toBe(zh('阿尔法'));
    expect(createVars.content).toBe(zh(zhDraft));
    expect(createVars.isPublished).toBe(false);
  });

  it('returns PageNotFoundError when applying to a missing page', async () => {
    // Given: nothing exists
    const duel = makeDuel(
      { 'singleByPath(': () => ({ data: { pages: { singleByPath: null } } }) },
      { text: DRAFT },
    );
    const { deps } = makeDeps(duel);

    // When / Then: structured not-found before any write
    const out = await applyMigration(deps, { path: PATH, genre: 'G3', draft: DRAFT, now: NOW_LOCAL });
    expect(out.ok).toBe(false);
    expect(out.error).toBeInstanceOf(PageNotFoundError);
    expect(duel.llmCalls).toHaveLength(0);
  });

  it('re-runs the reformat itself when invoked without a draft or genre (autonomous apply)', async () => {
    // Given: both locales present; no draft/genre passed
    const storeEn = pageFixture();
    const storeZh = zhPage();
    const duel = makeDuel(
      {
        'singleByPath(': (vars) => ({ data: { pages: { singleByPath: vars.locale === 'zh' ? storeZh : storeEn } } }),
        'single(': (vars) => ({ data: { pages: { single: vars.id === 998 ? storeZh : storeEn } } }),
        'update(': () => RESP_OK,
      },
      { text: DRAFT },
    );
    const { deps: base } = makeDeps(duel);
    const deps = { ...base, translate: zh };

    // When
    const out = await applyMigration(deps, { path: PATH, now: NOW_LOCAL });

    // Then: the engine internally ran the LLM reformat (G3-classified) and applied it
    expect(out.ok).toBe(true);
    expect(duel.llmCalls).toHaveLength(1);
    expect(duel.gqlCalls.filter((c) => c.query.includes('update('))).toHaveLength(2);
  });
});
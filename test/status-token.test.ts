/**
 * S1 status-token integrity (plan historian-evolution-round-1 task 2 / swarm P1).
 *
 * Ground truth this locks down: the live contradiction on wiki ids 9/92 was
 * MACHINE-INDUCED — every G6 skeleton shipped the colon-header token
 * (`**状态/Status**: draft`) AND a metadata-table token (`| Status | … |`),
 * and the demotion batches rewrote only the header, leaving the table row
 * claiming Active. lint.ts parsed only the colon header, so no gate and no
 * deep scan ever saw the second token.
 *
 * Contract under test:
 *  - the colon header stays the AUTHORITY (state comes only from it);
 *  - a table row whose parsed state DISAGREES with the header is a
 *    `status-token-conflict` FINDING (never a silent fix);
 *  - publish gate R4: an Active write carrying such a conflict is HARD-REFUSED;
 *  - skeletons ship ONE token pair in agreement — a fresh page never births
 *    a latent contradiction.
 *
 * Baseline characterization (pre-change): with no table-row parsing, a body
 * shaped `header Active + | 状态 | draft |` lints to state 'active' with NO
 * conflict fact and publishGateViolations() stays EMPTY — the contradictory
 * write sailed through today. The conflict tests below are the failing-first
 * half of that red-green pair.
 */

import { describe, it, expect } from 'vitest';
import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { lintBody, publishGateViolations, statusTokenFindings, type LintOpts } from '../src/lint.js';
import { publishGateRefusalJson } from '../src/tools/shared.js';
import { genreSkeleton, GENRES, type Genre } from '../src/templates/genres.js';
import { OPTS, makeKeyHome, jsonResponse } from './client-fixtures.js';
import { buildTools } from '../src/tools.js';

const BASE: LintOpts = { locale: 'en', baseUrl: 'http://localhost:3000', title: '服务手册' };
const BASE_ZH: LintOpts = { ...BASE, locale: 'zh' };

// --- fixtures ------------------------------------------------------------------

/** A genuinely clean Active page (passes R2) whose 元数据表 carries `tableRow`.
 *  Varying ONLY the table row isolates R4 / the conflict finding from every
 *  other lint rule. */
function bodyWithTable(tableRow: string, headerState = 'Active'): string {
  return [
    '# 服务手册',
    '',
    `**状态/Status**: ${headerState} · **日期/Date**: 2026-09-13`,
    '',
    '本页说明 demo 服务的启动、停止与故障处置步骤，导言写得足够长以通过导言占比判定检查。',
    '',
    '## 操作步骤',
    '',
    '1. 运行 `systemctl restart demo` 并确认服务恢复。',
    '',
    '## 元数据表',
    '',
    '| 元数据 | 值 |',
    '| --- | --- |',
    tableRow,
    '| 上次核实 | 2026-09-13 |',
    '',
    '## 相关页面',
    '',
    '- [首页](/home)',
    '',
  ].join('\n');
}

/** Legacy dual-token shape — exactly what skeletons.ts shipped until P1:
 *  colon header demoted to draft, table row left claiming Active. */
const LEGACY_CONFLICT_ZH = bodyWithTable('| 状态 | Active |', 'draft');
const CONFLICT_EN = bodyWithTable('| Status | draft |');
const CONFLICT_ZH = bodyWithTable('| 状态 | draft |');

// --- baseline characterization (pinned on the UNCHANGED parser) -----------------

describe('status-token integrity — baseline characterization', () => {
  it('header-only parsing keeps state authority on the colon header', () => {
    const l = lintBody(CONFLICT_ZH, BASE_ZH);
    expect(l.state).toBe('active'); // header wins, table row ignored for authority
    expect(l.hasStateBlock).toBe(true);
  });

  it('the table row is a STATE token: the conflicting write must be seen', () => {
    // Pre-P1 this field does not exist and the gate below stays empty — the
    // red of the red-green pair: the contradiction is invisible to lint.
    const l = lintBody(CONFLICT_ZH, BASE);
    expect(l.tableState).toBe('draft');
    expect(l.statusTokenConflict).toBe(true);
  });
});

// --- lintBody — table token parsing ----------------------------------------------------------------

describe('lintBody — TABLE_STATE_RE token parsing', () => {
  it('agreeing tokens (Active header + Active row) → no conflict', () => {
    const l = lintBody(bodyWithTable('| Status | Active |'), BASE);
    expect(l.tableState).toBe('active');
    expect(l.statusTokenConflict).toBe(false);
    expect(statusTokenFindings(l)).toEqual([]);
  });

  it('disagreeing tokens (Active header + draft row) → status-token-conflict', () => {
    const l = lintBody(CONFLICT_EN, BASE);
    expect(l.state).toBe('active');
    expect(l.tableState).toBe('draft');
    expect(l.statusTokenConflict).toBe(true);
    const findings = statusTokenFindings(l);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.key).toBe('status-token-conflict');
    // detail names both sides so the fix pass knows what to reconcile
    expect(findings[0]?.detail).toContain('active');
    expect(findings[0]?.detail).toContain('draft');
  });

  it('draft-only page with no table row → no token, no conflict', () => {
    const l = lintBody('# X\n\n**状态/Status**: draft\n\n## A\n\n正文内容。', BASE);
    expect(l.tableState).toBeNull();
    expect(l.tableStates).toEqual([]);
    expect(l.statusTokenConflict).toBe(false);
  });

  it('draft header vs Active row is STILL a conflict (any disagreement, any state)', () => {
    const l = lintBody(LEGACY_CONFLICT_ZH, BASE_ZH);
    expect(l.state).toBe('draft'); // authority: header
    expect(l.statusTokenConflict).toBe(true);
  });

  it('superseded header vs draft row → conflict (all four state tokens compare)', () => {
    expect(lintBody(bodyWithTable('| 状态 | draft |', 'Superseded'), BASE_ZH).statusTokenConflict).toBe(true);
    expect(lintBody(bodyWithTable('| 状态 | superseded |', 'Superseded'), BASE_ZH).statusTokenConflict).toBe(false);
    expect(lintBody(bodyWithTable('| 状态 | Active |', 'Deprecated'), BASE_ZH).statusTokenConflict).toBe(true);
  });

  it('CJK tolerance: 状态 / Status / 状态/Status / Status/状态 labels, mixed case', () => {
    for (const row of ['| 状态 | draft |', '| Status | draft |', '| 状态/Status | draft |', '| Status / 状态 | draft |']) {
      expect(lintBody(bodyWithTable(row), BASE).tableState).toBe('draft');
    }
  });

  it('malformed shapes: extra spaces, bold label, escaped pipe, trailing cells', () => {
    expect(lintBody(bodyWithTable('|   状态   |    draft   |'), BASE_ZH).tableState).toBe('draft');
    expect(lintBody(bodyWithTable('| **状态** | draft |'), BASE_ZH).tableState).toBe('draft');
    expect(lintBody(bodyWithTable('| 状态 | Active \\| 归档 |'), BASE_ZH).tableState).toBe('active');
    expect(lintBody(bodyWithTable('| 状态 | draft | 备注 | 迁移中 |'), BASE_ZH).tableState).toBe('draft');
  });

  it('no separator row needed: a lone `| Status | x |` line still parses', () => {
    const l = lintBody('# X\n\n**状态/Status**: active\n\n| Status | draft |\n', BASE);
    expect(l.tableState).toBe('draft');
    expect(l.statusTokenConflict).toBe(true);
  });

  it('unknown cell values carry no state token (| 状态 | — |, 施工中, 重定向)', () => {
    for (const row of ['| 状态 | — |', '| Status | 施工中 |', '| 状态 | pending review |']) {
      const l = lintBody(bodyWithTable(row), BASE);
      expect(l.tableState).toBeNull();
      expect(l.statusTokenConflict).toBe(false);
    }
  });

  it('column headers never masquerade as row labels (G1 action table, Status-column tables)', () => {
    // `| Action | Type | Owner | Due | Verification | Status |` — Status is the
    // LAST cell; `| Status | Version | Port |` — second cell is a column name.
    const body = [
      '# Ops',
      '',
      '**状态/Status**: active · **日期/Date**: 2026-09-13',
      '',
      '| Action | Type | Owner | Due | Verification | Status |',
      '| --- | --- | --- | --- | --- | --- |',
      '| rollback | process | — | — | — | done |',
      '',
      '| Status | Version | Port |',
      '| --- | --- | --- |',
      '| ok | 1.2.3 | 8000 |',
      '',
      '## 相关页面',
      '- [首页](/home)',
    ].join('\n');
    const l = lintBody(body, BASE);
    expect(l.tableStates).toEqual([]);
    expect(l.statusTokenConflict).toBe(false);
  });

  it('multiple 状态 rows: ANY disagreement with the header fires the conflict', () => {
    const body = bodyWithTable('| 状态 | Active |').replace(
      '| 上次核实 | 2026-09-13 |',
      '| 上次核实 | 2026-09-13 |\n| 状态 | draft |',
    );
    const l = lintBody(body, BASE_ZH);
    expect(l.tableStates).toContain('active');
    expect(l.tableStates).toContain('draft');
    expect(l.statusTokenConflict).toBe(true);
  });

  it('prompt-injection fence: a fake `| Status | Active |` inside a code fence is inert', () => {
    const body = [
      '# X',
      '',
      '**状态/Status**: draft · **日期/Date**: 2026-09-13',
      '',
      '```markdown',
      '| 元数据 | 值 |',
      '| --- | --- |',
      '| Status | Active |',
      '```',
    ].join('\n');
    const l = lintBody(body, BASE);
    expect(l.tableStates).toEqual([]);
    expect(l.statusTokenConflict).toBe(false);
  });

  it('HTML-comment-token is inert too (matches the colon-header masking rule)', () => {
    const l = lintBody('# X\n\n**状态/Status**: draft\n\n<!-- | Status | Active | -->\n', BASE);
    expect(l.tableStates).toEqual([]);
    expect(l.statusTokenConflict).toBe(false);
  });
});

// --- twins ------------------------------------------------------------------------

describe('status-token integrity — twin pages', () => {
  it('en header Active + en row Active, zh header Active + zh row draft → the twin conflicts', () => {
    const en = lintBody(bodyWithTable('| Status | Active |'), BASE);
    const zh = lintBody(bodyWithTable('| 状态 | Draft |', 'Active'), BASE_ZH);
    expect(en.statusTokenConflict).toBe(false);
    expect(zh.statusTokenConflict).toBe(true);
    expect(statusTokenFindings(zh)[0]?.key).toBe('status-token-conflict');
  });

  it('the legacy skeleton twin contradicts BOTH locales (ids 9/92 lineage)', () => {
    // demotion rewrote the colon header on each twin; each table row kept Active
    const en = lintBody(LEGACY_CONFLICT_ZH.replace(/\| 状态 \|/g, '| Status |'), BASE);
    const zh = lintBody(LEGACY_CONFLICT_ZH, BASE_ZH);
    expect(en.statusTokenConflict).toBe(true);
    expect(zh.statusTokenConflict).toBe(true);
  });
});

// --- findings shape ------------------------------------------------------------------

describe('statusTokenFindings', () => {
  it('emits exactly one keyed finding on conflict, none when a token is absent', () => {
    expect(statusTokenFindings(lintBody(CONFLICT_EN, BASE)).map((f) => f.key)).toEqual(['status-token-conflict']);
    // header without table row / table row without header → single-token, no conflict
    expect(statusTokenFindings(lintBody('# X\n\n**状态/Status**: active\n', BASE))).toEqual([]);
    expect(statusTokenFindings(lintBody('# X\n\n| Status | draft |\n', BASE))).toEqual([]);
  });
});

// --- publish gate R4 ---------------------------------------------------------------------

describe('publish gate R4 — Active write × token conflict', () => {
  it('publishGateViolations gains status-token-conflict only on Active authority', () => {
    expect(publishGateViolations(lintBody(CONFLICT_EN, BASE))).toContain('status-token-conflict');
    // draft keeps the sanctioned work-in-progress escape hatch: finding, no refusal
    expect(publishGateViolations(lintBody(LEGACY_CONFLICT_ZH, BASE_ZH))).not.toContain('status-token-conflict');
    // agreeing Active page: R4 silent
    expect(publishGateViolations(lintBody(bodyWithTable('| Status | Active |'), BASE))).toEqual([]);
  });

  it('publishGateRefusalJson rejects with the gate message style, _sandbox exempt', () => {
    const refused = publishGateRefusalJson(CONFLICT_EN, 'en', 'docs/manual', 'http://localhost:3000');
    expect(refused).not.toBeNull();
    const out = JSON.parse(refused as string) as Record<string, unknown>;
    expect(out.errorKind).toBe('PublishGateError');
    expect(String(out.message)).toContain("publish-gate: status-token-conflict on 'docs/manual' (en)");
    expect(publishGateRefusalJson(CONFLICT_EN, 'en', '_sandbox/mess/token', 'http://localhost:3000')).toBeNull();
    expect(publishGateRefusalJson(bodyWithTable('| Status | Active |'), 'en', 'docs/manual', 'http://localhost:3000')).toBeNull();
  });

  it('tool-level create: Active + conflicting row is refused with zero fetches', async () => {
    const tools = buildTools(OPTS, {
      fetchImpl: (async () => {
        throw new Error('status-token.test: the gate must refuse before any fetch');
      }) as typeof fetch,
      homeDir: makeKeyHome(),
    });
    const out = await runTool(tools.historian_page_create, {
      path: 'docs/manual',
      title: '服务手册',
      content: CONFLICT_EN,
      twin: false,
    });
    expect(out.ok).toBe(false);
    expect(out.errorKind).toBe('PublishGateError');
    expect(String(out.message)).toContain('status-token-conflict');
  });

  it('tool-level create: Active + consistent row passes the gate', async () => {
    const created: Record<string, unknown>[] = [];
    const tools = buildTools(OPTS, {
      fetchImpl: makeFragmentResponder(created),
      homeDir: makeKeyHome(),
    });
    const out = await runTool(tools.historian_page_create, {
      path: 'docs/manual',
      title: '服务手册',
      content: bodyWithTable('| 状态 | Active |'),
      twin: false,
    });
    expect(out.ok).toBe(true);
    expect(created.length).toBeGreaterThan(0); // the write actually happened
  });
});

// --- skeletons ship one agreeing token pair -------------------------------------------------

describe('skeletons — no dual-token birth defect (root cause of ids 9/92)', () => {
  const LANGS = [
    ['zh', 'zh'] as const,
    ['en', 'en'] as const,
  ] satisfies readonly (readonly [GenreLangAlias, LintOpts['locale']])[];
  type GenreLangAlias = 'zh' | 'en';

  it('every genre × language skeleton lints WITHOUT a token conflict', () => {
    for (const [lang, locale] of LANGS) {
      for (const genre of GENRES as readonly Genre[]) {
        const body = genreSkeleton(genre, lang);
        const l = lintBody(body, { ...BASE, locale, title: 'x' });
        expect(l.statusTokenConflict).toBe(false);
      }
    }
  });

  it('G6 metadata table row carries the SAME token as the colon header (draft)', () => {
    const zh = genreSkeleton('G6', 'zh');
    const en = genreSkeleton('G6', 'en');
    expect(zh).toContain('| 状态 | draft');
    expect(en).toContain('| Status | draft');
    for (const [body, lang] of [
      [zh, 'zh'],
      [en, 'en'],
    ] as const) {
      const l = lintBody(body, { ...BASE, locale: lang });
      expect(l.state).toBe('draft');
      expect(l.tableState).toBe('draft');
      expect(l.statusTokenConflict).toBe(false);
    }
  });

  it('no skeleton ships a table token that disagrees with its header token', () => {
    for (const lang of ['zh', 'en'] as const) {
      for (const genre of GENRES as readonly Genre[]) {
        const l = lintBody(genreSkeleton(genre, lang), { ...BASE, locale: lang });
        if (l.tableStates.length > 0) {
          expect(l.tableStates).toEqual([l.state]);
        }
      }
    }
  });
});

// --- maintain deep surfaces the key (tool-level integration) ---------------------

describe('maintain deep — status-token-conflict surfacing', () => {
  const CONFLICT_ROW = {
    id: 901,
    path: '_sandbox/mess/token-conflict',
    locale: 'zh',
    title: '令牌矛盾',
    description: '',
    contentType: 'markdown',
    isPublished: true,
    isPrivate: false,
    privateNS: null,
    createdAt: '2026-09-13T00:00:00.000Z',
    updatedAt: '2026-09-13T00:00:00.000Z',
    tags: [] as string[],
  };
  const CLEAN_TWIN = { ...CONFLICT_ROW, id: 902, locale: 'en', title: 'Token Conflict (en)' };
  const BODIES: Record<string, string> = {
    // the seeded fixture shape: header Active, legacy table row draft
    'zh|_sandbox/mess/token-conflict': CONFLICT_ZH,
    // consistent twin — must stay silent (zero false positives)
    'en|_sandbox/mess/token-conflict': bodyWithTable('| Status | Active |'),
  };

  function makeMapWired(): ToolDefinition {
    const fetchImpl = (async (_input: unknown, init?: unknown): Promise<Response> => {
      const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      if (body.query.includes('list(')) {
        const locale = String(body.variables.locale);
        const rows = [CONFLICT_ROW, CLEAN_TWIN].filter((r) => r.locale === locale);
        return jsonResponse({ data: { pages: { list: rows } } });
      }
      if (body.query.includes('singleByPath(')) {
        const key = `${String(body.variables.locale)}|${String(body.variables.path)}`;
        const content = BODIES[key];
        if (content === undefined) return jsonResponse({ data: { pages: { singleByPath: null } } });
        return jsonResponse({
          data: {
            pages: {
              singleByPath: { ...CONFLICT_ROW, locale: key.split('|')[0], content, editor: 'markdown' },
            },
          },
        });
      }
      throw new Error(`status-token.test: unhandled maintain query: ${body.query.slice(0, 80)}`);
    }) as typeof fetch;
    const tools = buildTools(OPTS, { fetchImpl, homeDir: makeKeyHome() });
    return tools.historian_map;
  }

  it('deep maintain reports the seeded conflict exactly once, twin clean stays silent', async () => {
    const out = await runTool(makeMapWired(), { action: 'maintain', deep: true });
    expect(out.ok).toBe(true);
    const report = out.report as Record<string, unknown>;
    const conflicts = report.statusTokenConflicts as Record<string, unknown>[];
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      path: '_sandbox/mess/token-conflict',
      locale: 'zh',
      key: 'status-token-conflict',
    });
    expect(conflicts[0]?.detail).toContain('active');
    expect(conflicts[0]?.detail).toContain('draft');
    expect(String(out.markdown)).toContain('status-token-conflict');
  });

  it('light maintain carries no conflicts (bodies unread)', async () => {
    const out = await runTool(makeMapWired(), { action: 'maintain' });
    expect(out.ok).toBe(true);
    const report = out.report as Record<string, unknown>;
    expect(report.statusTokenConflicts).toEqual([]);
  });
});

// --- tiny tool harness (mirrors tools.test.ts's fragment-dispatch fake) -------------------

async function runTool(toolDef: ToolDefinition, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = await toolDef.execute(args as never, {} as never);
  const text = typeof out === 'string' ? out : String((out as { output: string }).output);
  return JSON.parse(text) as Record<string, unknown>;
}

/** Minimal live-wiki fake: page lookups miss (fresh create), creates succeed
 *  and echo back; the create-path lookup after `create(` finds the page. */
function makeFragmentResponder(writes: Record<string, unknown>[]): typeof fetch {
  return (async (_input: unknown, init?: unknown): Promise<Response> => {
    const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as {
      query: string;
      variables: Record<string, unknown>;
    };
    if (body.query.includes('list(')) {
      return jsonResponse({ data: { pages: { list: [] } } });
    }
    if (body.query.includes('create(')) {
      writes.push(body.variables);
      return jsonResponse({
        data: { pages: { create: { result: { succeeded: true, errorCode: 0 }, page: { id: 76, path: body.variables.path, locale: body.variables.locale } } } },
      });
    }
    if (body.query.includes('singleByPath(')) {
      return jsonResponse({
        data: {
          pages: {
            singleByPath: {
              id: 76,
              path: String(body.variables.path),
              locale: String(body.variables.locale),
              title: '服务手册',
              description: 'desc',
              content: '# 服务手册\nbody',
              isPublished: true,
              isPrivate: false,
              contentType: 'markdown',
              tags: [],
              publishStartDate: '',
              publishEndDate: '',
              scriptCss: '',
              scriptJs: '',
              editor: 'markdown',
              createdAt: '2026-09-13T00:00:00.000Z',
              updatedAt: '2026-09-13T00:00:00.000Z',
            },
          },
        },
      });
    }
    throw new Error(`status-token.test: unhandled query ${body.query}`);
  }) as typeof fetch;
}

/**
 * Maintain curation report (plan todo-7, D3 CURATE / D12): fixture-first tests
 * for the pure buildMaintainReport over MapRow-shaped rows — every light metric
 * asserted exactly (counts, cluster membership, ordering, JSON-tail key
 * stability, generation timestamp + row count), the deep sweep via a stubbed
 * readBody (freshness stamps, expired review-by, redirect stubs), and the
 * historian_map action:"maintain" tool layer via the fragment-dispatch fake
 * client (bounded list-only fetch in light, singleByPath reads in deep).
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolDefinition } from '@opencode-ai/plugin';
import { OPTS, makeKeyHome, jsonResponse } from './client-fixtures.js';
import { buildTools } from '../src/tools.js';
import { buildMaintainReport, renderMaintainMarkdown, overdueActionsOf, DUP_TITLE_THRESHOLD, type MaintainRow } from '../src/maintain.js';
import type { MapRow } from '../src/map.js';
import type { Locale } from '../src/wiki/pages.read.js';

const NOW = new Date('2026-09-04T12:00:00.000Z');

// --- fixture helpers ----------------------------------------------------------

/** MapRow-shaped fixture row; url/twin fields are inert for maintain metrics. */
function mk(id: number, locale: Locale, path: string, title: string, updatedAt: string, tags?: readonly string[]): MaintainRow {
  const base: MapRow = {
    id,
    locale,
    path,
    title,
    updatedAt: `${updatedAt}T00:00:00.000Z`,
    url: `http://localhost:3000/${locale}/${path}`,
    twinUrl: null,
    twinId: null,
  };
  return tags === undefined ? base : { ...base, tags };
}

/** The canonical chaos fixture: twin gaps, one exact + one near title dup, a
 *  single-child chain, flat depth-2 root pages, tag drift, an internal-namespace
 *  row that must be dropped, and a depth-1 'home' page. */
function lightRows(): MaintainRow[] {
  return [
    mk(1, 'en', 'llm/gpu-notes', 'GPU Notes A', '2026-08-20', ['gpu', 'llm']),
    mk(2, 'zh', 'llm/gpu-notes', '显卡笔记', '2026-08-19', ['gpu']),
    mk(3, 'en', 'llm/gpu-notes-old', 'GPU Notes A', '2026-03-01', ['gpu']),
    mk(4, 'en', 'llm/overview', 'vLLM Inference Overview', '2026-08-01', ['llm']),
    mk(5, 'zh', 'llm/overview', 'vLLM 推理概览', '2026-08-01', []),
    mk(6, 'en', 'llm/inference', 'vLLM Inference Overview Copy', '2026-01-01', []),
    mk(7, 'en', 'infra/single-kid/only-page', 'Fan Control Notes', '2026-06-01', ['infra']),
    mk(8, 'en', 'eda/one-cat', 'KiCad Layers', '2026-05-05', []),
    mk(9, 'en', 'docs/alpha', 'Alpha Doc', '2026-07-07', ['docs']),
    mk(10, 'en', 'docs/deep/a', 'Deep A', '2026-02-01', []),
    mk(11, 'en', 'docs/deep/b', 'Deep B', '2026-02-02', []),
    mk(12, 'en', '_sandbox/test', 'Sandbox Fixture', '2026-08-30', ['sandbox']),
    mk(13, 'en', 'home', 'Home Hub', '2026-08-31', []),
    mk(14, 'zh', 'home', '首页', '2026-08-31', []),
    mk(15, 'en', '_meta/page-map', 'Page Map Cache', '2026-09-01', []),
  ];
}

function tailJson(markdown: string): Record<string, unknown> {
  const open = markdown.lastIndexOf('```json');
  expect(open).toBeGreaterThanOrEqual(0);
  const body = markdown.slice(open + '```json'.length);
  const close = body.indexOf('```');
  expect(close).toBeGreaterThanOrEqual(0);
  return JSON.parse(body.slice(0, close)) as Record<string, unknown>;
}

// --- light sweep (map rows only) ----------------------------------------------

describe('buildMaintainReport (light)', () => {
  it('counts rows/paths/locales and lists the twin gap — exact fixture numbers', async () => {
    const report = await buildMaintainReport(
      { rows: lightRows(), mapGeneratedAt: '2026-09-04T11:00:00.000Z', mapStaleSeconds: 3600 },
      { now: NOW },
    );
    // stale_state guard: the report says when it was built and over how many rows
    expect(report.schema).toBe('historian.maintain.v3');
    expect(report.generatedAt).toBe('2026-09-04T12:00:00.000Z');
    expect(report.rowCount).toBe(15); // input rows, pre-filter
    expect(report.mapGeneratedAt).toBe('2026-09-04T11:00:00.000Z');
    expect(report.mapStaleSeconds).toBe(3600);
    expect(report.deep).toBe(false);
    expect(report.pages.rows).toBe(14); // _meta/page-map dropped
    expect(report.pages.paths).toBe(11);
    expect(report.pages.perLocale).toEqual({ en: 11, zh: 3 });
    expect(report.pages.missingTwinPaths).toEqual([
      '_sandbox/test', 'docs/alpha', 'docs/deep/a', 'docs/deep/b',
      'eda/one-cat', 'infra/single-kid/only-page', 'llm/gpu-notes-old', 'llm/inference',
    ]);
  });

  it('clusters exact and near-duplicate titles across paths, never twins', async () => {
    const report = await buildMaintainReport({ rows: lightRows() }, { now: NOW });
    expect(report.duplicates.threshold).toBe(DUP_TITLE_THRESHOLD);
    expect(report.duplicates.clusters).toEqual([
      { paths: ['llm/gpu-notes', 'llm/gpu-notes-old'], titles: ['GPU Notes A'] },
      { paths: ['llm/inference', 'llm/overview'], titles: ['vLLM Inference Overview', 'vLLM Inference Overview Copy'] },
    ]);
  });

  it('never clusters (重定向)/(redirect)-suffixed stub titles (bold-merge leftovers are by design)', async () => {
    const report = await buildMaintainReport(
      {
        rows: [
          mk(1, 'en', 'llm/canon', 'GPU Notes A', '2026-08-20'),
          mk(2, 'en', 'llm/stub-en', 'GPU Notes A (redirect)', '2026-08-20'),
          mk(3, 'zh', 'llm/stub-zh', 'GPU Notes A（重定向）', '2026-08-20'),
        ],
      },
      { now: NOW },
    );
    expect(report.duplicates.clusters).toEqual([]);
  });

  it('lists the oldest Top-N paths by twin-newest updatedAt', async () => {
    const report = await buildMaintainReport({ rows: lightRows() }, { now: NOW, topN: 3 });
    expect(report.staleness.topN).toBe(3);
    expect(report.staleness.oldest).toEqual([
      { path: 'llm/inference', updatedAt: '2026-01-01T00:00:00.000Z', daysOld: 246.5, locales: ['en'] },
      { path: 'docs/deep/a', updatedAt: '2026-02-01T00:00:00.000Z', daysOld: 215.5, locales: ['en'] },
      { path: 'docs/deep/b', updatedAt: '2026-02-02T00:00:00.000Z', daysOld: 214.5, locales: ['en'] },
    ]);
  });

  it('finds single-child dirs (shallowest of a chain only) and flat depth-2 root pages', async () => {
    const report = await buildMaintainReport({ rows: lightRows() }, { now: NOW });
    expect(report.diffusion.singleChildDirs).toEqual([
      { dir: '_sandbox', childPath: '_sandbox/test' },
      { dir: 'eda', childPath: 'eda/one-cat' },
      { dir: 'infra', childPath: 'infra/single-kid/only-page' },
    ]);
    expect(report.flatRootPages).toEqual([
      { section: '_sandbox', paths: ['_sandbox/test'] },
      { section: 'docs', paths: ['docs/alpha'] },
      { section: 'eda', paths: ['eda/one-cat'] },
      { section: 'llm', paths: ['llm/gpu-notes', 'llm/gpu-notes-old', 'llm/inference', 'llm/overview'] },
    ]);
  });

  it('reports the tag vocabulary when rows carry tags, and the limitation when they do not', async () => {
    const withTags = await buildMaintainReport({ rows: lightRows() }, { now: NOW });
    expect(withTags.tags).toEqual({
      available: true,
      vocabulary: [
        { tag: 'gpu', count: 3 },
        { tag: 'llm', count: 2 },
        { tag: 'docs', count: 1 },
        { tag: 'infra', count: 1 },
        { tag: 'sandbox', count: 1 },
      ],
    });
    const bare = await buildMaintainReport(
      { rows: lightRows().map(({ tags: _tags, ...row }) => row as MaintainRow) },
      { now: NOW },
    );
    expect(bare.tags).toEqual({ available: false, vocabulary: [] });
    expect(renderMaintainMarkdown(bare)).toContain('no tag data');
  });

  it('light mode cannot see bodies: redirect stubs unavailable, noted as limitation', async () => {
    const report = await buildMaintainReport({ rows: lightRows() }, { now: NOW });
    expect(report.redirects).toEqual({ available: false, count: 0, stubs: [] });
    expect(report.freshness).toBeNull();
    expect(renderMaintainMarkdown(report)).toContain('deep:true');
  });

  it('distributes paths/rows per top-level section, largest first', async () => {
    const report = await buildMaintainReport({ rows: lightRows() }, { now: NOW });
    expect(report.sections).toEqual([
      { section: 'llm', paths: 4, rows: 6 },
      { section: 'docs', paths: 3, rows: 3 },
      { section: '_sandbox', paths: 1, rows: 1 },
      { section: 'eda', paths: 1, rows: 1 },
      { section: 'home', paths: 1, rows: 2 },
      { section: 'infra', paths: 1, rows: 1 },
    ]);
  });

  it('markdown ends with a parseable fenced JSON block with the stable top-level keys', async () => {
    const report = await buildMaintainReport({ rows: lightRows() }, { now: NOW });
    const markdown = renderMaintainMarkdown(report);
    expect(markdown).toContain('# Maintain Report');
    expect(markdown).toContain('2026-09-04T12:00:00.000Z');
    expect(markdown).toContain('15 map rows');
    const tail = tailJson(markdown);
    expect(Object.keys(tail)).toEqual([
      'schema', 'generatedAt', 'rowCount', 'mapGeneratedAt', 'mapStaleSeconds', 'deep',
      'pages', 'duplicates', 'staleness', 'diffusion', 'flatRootPages', 'tags', 'redirects',
      'sections', 'freshness', 'dueForReview', 'overdueActions',
    ]);
    expect(tail.rowCount).toBe(15);
    expect(tail.generatedAt).toBe('2026-09-04T12:00:00.000Z');
  });

  it('empty input produces an empty-but-valid report', async () => {
    const report = await buildMaintainReport({ rows: [] }, { now: NOW });
    expect(report.rowCount).toBe(0);
    expect(report.pages.paths).toBe(0);
    expect(report.duplicates.clusters).toEqual([]);
    expect(report.staleness.oldest).toEqual([]);
    expect(report.sections).toEqual([]);
  });
});

// --- deep sweep (bodies via injected readBody) ---------------------------------

describe('buildMaintainReport (deep)', () => {
  const BODIES: Readonly<Record<string, string | null>> = {
    'en|ops/status-card': '# 服务现状卡\n\n## 部署物\n\n| 组件 | 版本 |\n| api | 1.0 |\n',
    'en|ops/ledger':
      '# Ledger\n\n## 元数据表\n\n| 元数据 | 值 |\n| --- | --- |\n| 状态 | Active |\n| 上次核实 | 2026-08-01 |\n| 复核周期 | 2026-08-15 |\n\n已部署组件见下表。\n',
    'en|ops/fresh': '# Fresh 现状卡\n\n| 元数据 | 值 |\n| 上次核实 | 2026-09-01 |\n| 复核周期 | 2026-12-31 |\n',
    'en|llm/note': '# Growth Curves\n\nplain prose without any genre cue at all.\n',
    'en|old/alias': '> Redirect: /en/ops/ledger\n\nmoved 2026-09-01.\n',
    'en|docs/gone': null,
  };
  const rows = (): MaintainRow[] =>
    Object.keys(BODIES).map((key, i) => {
      const [locale, path] = key.split('|') as [Locale, string];
      const title =
        path === 'ops/status-card' ? '服务现状卡' : path === 'ops/ledger' ? 'Ledger 当前状态'
        : path === 'ops/fresh' ? 'Fresh 现状卡' : path === 'old/alias' ? 'Old Alias' : `${path} page`;
      return mk(100 + i, locale, path, title, '2026-08-10');
    });

  it('flags G5 pages missing the 上次核实 stamp, expired review-by, and counts redirect stubs', async () => {
    const readBody = async (path: string, locale: Locale): Promise<string | null> =>
      BODIES[`${locale}|${path}`] ?? null;
    const report = await buildMaintainReport({ rows: rows() }, { now: NOW, deep: true, readBody });
    expect(report.deep).toBe(true);
    expect(report.redirects).toEqual({
      available: true,
      count: 1,
      stubs: [{ path: 'old/alias', locale: 'en', target: '/en/ops/ledger' }],
    });
    const fresh = report.freshness;
    expect(fresh).not.toBeNull();
    expect(fresh?.scanned).toBe(5); // docs/gone read as null → unreadable
    expect(fresh?.unreadable).toBe(1);
    expect(fresh?.missingLastVerified).toEqual([{ path: 'ops/status-card', locale: 'en', genre: 'G5' }]);
    expect(fresh?.expiredReviewBy).toEqual([
      { path: 'ops/ledger', locale: 'en', reviewBy: '2026-08-15', daysExpired: 20 },
    ]);
    expect(renderMaintainMarkdown(report)).toContain('Freshness');
  });

  it('deep without readBody is a programmer error, not a silent light run', async () => {
    await expect(buildMaintainReport({ rows: rows() }, { now: NOW, deep: true })).rejects.toThrow(/readBody/);
  });
});

// --- dueForReview (task-03: cadence × stamp join, advisory-only) ----------------

/** NOW 2026-09-04T12:00Z vs a UTC-midnight stamp date ⇒ floor truncates the
 *  half-day, so 08-20 reads age 15, 09-01 age 3. The boundary pair uses
 *  NOW_MID (00:00Z) where ages are whole days: 08-28 ⇒ exactly 7 (due at
 *  age === cadence), 08-29 ⇒ 6 (not due). */
const NOW_MID = new Date('2026-09-04T00:00:00.000Z');

const G5_ZH_STALE = `# API 部署现状卡

**状态/Status**: Active · **日期/Date**: 2026-08-15

## 部署物清单

| 组件 | 版本 | 端口/路径 | 端点 | 依赖 | 上次核实于 |
| --- | --- | --- | --- | --- | --- |
| api | 1.0 | 8000 | http://localhost:8000/health | postgres | 2026-08-15 |
| worker | 2.0 | 8001 | http://localhost:8001/health | redis | 2026-08-20 |
| legacy | 0.9 | 8002 | — | none | 2026-07-01 (未复跑) |

## 验证方法

| 组件 | 复核命令 | 预期结果 |
| --- | --- | --- |
| api | \`curl -s http://localhost:8000/health\` | HTTP 200 |
| worker | \`systemctl is-active worker\` | active |
| legacy |  | — |
| dupe | \`curl -s http://localhost:8000/health\` | HTTP 200 |
`;

const G5_EN_STALE = `# API Current State Card

**状态/Status**: Active · **日期/Date**: 2026-08-15

## Deployed Components

| Component | Version | Port/Path | Endpoint | Depends on | Last verified |
| --- | --- | --- | --- | --- | --- |
| api | 1.0 | 8000 | http://localhost:8000/health | postgres | 2026-08-15 |

## Verification

| Component | Re-check command | Expected result |
| --- | --- | --- |
| api | \`curl -s http://localhost:8000/health\` | HTTP 200 |
`;

// Live infra/cockpit (id 9) metadata-table pattern — local replica fixture only.
const G6_CONFESSINAL = `# Cockpit Runbook Replica

**状态/Status**: Active · **日期/Date**: 2026-09-01

## Goal

重启后核对 cockpit.socket 与 LDAP 链路。

## Metadata

| Field | Value | Source |
|---|---|---|
| Status | Active | this page |
| Last verified | 2026-09-01 (skeleton-backfill baseline; content not re-run) | revision log |
| Review cadence | TODO | TODO |
`;

const G4_OLD = `# KV Cache 原理笔记

**状态/Status**: Active · **日期/Date**: 2026-05-01

解释 KV Cache 在多轮推理中的原理与显存占用。

> **Last verified**: 2026-05-01 · reran bench.py on the live box, exit 0
`;

const G5_SUPERSEDED = `# Mixed Runbook

**状态/Status**: Active · **日期/Date**: 2026-09-02

## 目标

如何安全重启网关。

上次核实于 2026-09-02（复跑全部行，exit 0）。
~~上次核实于 2026-08-15（未复跑，baseline）~~
`;

function g5Dated(rowDate: string): string {
  return `# API 部署现状卡

**状态/Status**: Active · **日期/Date**: ${rowDate}

## 部署物清单

| 组件 | 版本 | 端口/路径 | 端点 | 依赖 | 上次核实于 |
| --- | --- | --- | --- | --- | --- |
| api | 1.0 | 8000 | http://localhost:8000/health | postgres | ${rowDate} |
`;
}

function g5WithCadence(cadenceValue: string): string {
  return `${g5Dated('2026-08-15')}
## 元数据表

| 元数据 | 值 |
| --- | --- |
| 复核周期 | ${cadenceValue} |
`;
}

async function dfrReport(path: string, title: string, body: string, now = NOW): Promise<unknown[]> {
  const report = await buildMaintainReport(
    { rows: [mk(1, 'en', path, title, '2026-08-10')] },
    { now, deep: true, readBody: async () => body },
  );
  return report.dueForReview as unknown[];
}

describe('buildMaintainReport — dueForReview (deep)', () => {
  it('expired G5 card: newest honest row date drives stampAge, cadence default 7d, zh verify commands attached', async () => {
    expect(await dfrReport('ops/g5-stale', 'API 部署现状卡', G5_ZH_STALE)).toEqual([
      {
        path: 'ops/g5-stale',
        locale: 'en',
        stampAge: 15,
        cadence: 7,
        verifyCommands: ['curl -s http://localhost:8000/health', 'systemctl is-active worker'],
      },
    ]);
  });

  it('en G5 column names (Last verified / Re-check command) parse identically', async () => {
    expect(await dfrReport('ops/g5-en', 'API Current State Card', G5_EN_STALE)).toEqual([
      {
        path: 'ops/g5-en',
        locale: 'en',
        stampAge: 20,
        cadence: 7,
        verifyCommands: ['curl -s http://localhost:8000/health'],
      },
    ]);
  });

  it('fresh G5 card (age 3 < 7d cadence) does NOT appear', async () => {
    expect(await dfrReport('ops/g5-fresh', 'API 部署现状卡', g5Dated('2026-09-01'))).toEqual([]);
  });

  it('boundary at age === cadence is due; one day younger is not', async () => {
    expect(await dfrReport('ops/g5-due7', 'API 部署现状卡', g5Dated('2026-08-28'), NOW_MID)).toEqual([
      expect.objectContaining({ path: 'ops/g5-due7', stampAge: 7, cadence: 7 }),
    ]);
    expect(await dfrReport('ops/g5-ok6', 'API 部署现状卡', g5Dated('2026-08-29'), NOW_MID)).toEqual([]);
  });

  it('confessional-only stamp is due regardless of age (cadence clock never reset by a confession)', async () => {
    expect(await dfrReport('ops/g6-cockpit', 'Cockpit Runbook Replica', G6_CONFESSINAL)).toEqual([
      { path: 'ops/g6-cockpit', locale: 'en', stampAge: 3, cadence: 90, verifyCommands: [] },
    ]);
  });

  it('G4 stamped page uses the 90d genre default', async () => {
    expect(await dfrReport('docs/g4-old', 'KV Cache 原理笔记', G4_OLD)).toEqual([
      { path: 'docs/g4-old', locale: 'en', stampAge: 126, cadence: 90, verifyCommands: [] },
    ]);
  });

  it('supersede-keeping-struck-old: the fresh honest stamp wins the clock — not due', async () => {
    expect(await dfrReport('ops/g5-mixed', 'Mixed Runbook', G5_SUPERSEDED)).toEqual([]);
  });

  // Guards the date-less-header rule: a `| 复核周期 | 2026-09-03 |` value row under
  // a label-style 上次核实 row must NOT leak in as an honest ledger date.
  it('a metadata review-by date is not an honest stamp date — confessional force survives it', async () => {
    const body = `# Cockpit Cadence Runbook\n\n**状态/Status**: Active · **日期/Date**: 2026-09-01\n\n## Metadata\n\n| 元数据 | 值 |\n| --- | --- |\n| 上次核实 | 2026-09-01 (content not re-run) |\n| 复核周期 | 2026-09-03 |\n`;
    expect(await dfrReport('ops/g6-cad', 'Cockpit Cadence Runbook', body)).toEqual([
      { path: 'ops/g6-cad', locale: 'en', stampAge: 3, cadence: 90, verifyCommands: [] },
    ]);
  });

  it('metadata 复核周期 row overrides the genre default; unparseable values fall back', async () => {
    const cases: readonly (readonly [string, number])[] = [
      ['30天', 30], ['每 30 天', 30], ['every 30 days', 30], ['2 weeks', 14], ['1 week', 7],
      ['7d', 7], ['7 days', 7], ['14', 14],
      // malformed / non-duration values must NOT fabricate a cadence:
      ['经常', 7], ['TODO', 7], ['2026-12-31', 7],
    ];
    for (const [value, expected] of cases) {
      const rows = await dfrReport('ops/g5-cad', 'API 部署现状卡', g5WithCadence(value));
      const got = rows.length === 1 ? (rows[0] as { cadence: number }).cadence : 7;
      // age is 20d: due iff expected cadence <= 20 — the presence check doubles as the parse check
      expect(rows.length, `复核周期 ${value}`).toBe(expected <= 20 ? 1 : 0);
      if (rows.length === 1) expect(got, `复核周期 ${value}`).toBe(expected);
    }
  });

  it('G5 card without a command column reports empty verifyCommands', async () => {
    expect(await dfrReport('ops/g5-nocmd', 'API 部署现状卡', g5Dated('2026-08-15'))).toEqual([
      { path: 'ops/g5-nocmd', locale: 'en', stampAge: 20, cadence: 7, verifyCommands: [] },
    ]);
  });

  it('light mode cannot see stamps: dueForReview is null like freshness', async () => {
    const report = await buildMaintainReport({ rows: lightRows() }, { now: NOW });
    expect(report.dueForReview).toBeNull();
  });
});

// --- tool layer: historian_map action:"maintain" -------------------------------

interface Captured {
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

function makeWired(handlers: Record<string, (vars: Record<string, unknown>) => unknown>, homeDir: string) {
  const captured: Captured[] = [];
  let count = 0;
  const fetchImpl = (async (_input: unknown, init?: unknown): Promise<Response> => {
    count++;
    const body = JSON.parse(String((init as RequestInit | undefined)?.body)) as Captured;
    captured.push(body);
    const fragment = Object.keys(handlers).find((f) => body.query.includes(f));
    if (fragment === undefined) {
      if (body.query.includes('navigation {')) {
        return jsonResponse({ data: { navigation: { config: { mode: 'STATIC' }, tree: [] } } });
      }
      throw new Error(`maintain.test: unhandled query ${body.query}`);
    }
    return jsonResponse(handlers[fragment](body.variables ?? {}));
  }) as typeof fetch;
  const tools = buildTools(OPTS, { fetchImpl, homeDir });
  return { tools, captured, fetchCount: () => count };
}

async function run(toolDef: ToolDefinition, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return JSON.parse(String(await toolDef.execute(args as never, {} as never))) as Record<string, unknown>;
}

/** Two-row mirror: an en+zh twin pair plus an en-only stale page. */
function writeMirror(home: string): string {
  const homeCfg = join(home, '.config', 'opencode');
  mkdirSync(homeCfg, { recursive: true });
  const generatedAt = '2026-09-03T00:00:00.000Z';
  const row = (id: number, locale: Locale, path: string, title: string, ago: string): Record<string, unknown> => ({
    id, locale, path, title, updatedAt: ago,
    url: `http://localhost:3000/${locale}/${path}`, twinUrl: null, twinId: null,
  });
  writeFileSync(
    join(homeCfg, 'historian-map.json'),
    `${JSON.stringify({
      generatedAt,
      rows: [
        row(1, 'en', 'llm/alpha', 'Alpha Note', '2026-09-01T00:00:00.000Z'),
        row(2, 'zh', 'llm/alpha', '阿尔法笔记', '2026-09-01T00:00:00.000Z'),
        row(3, 'en', 'llm/bravo', 'Alpha Note Old', '2026-01-01T00:00:00.000Z'),
      ],
      stats: { rows: 3, paths: 2, perLocale: { en: 2, zh: 1 }, missingTwinPaths: ['llm/bravo'] },
    })}\n`,
    'utf8',
  );
  return generatedAt;
}

const listRow = (id: number, locale: Locale, path: string, tags: readonly string[]): Record<string, unknown> => ({
  id, path, locale, title: 'T', description: 'd', contentType: 'markdown',
  isPublished: true, isPrivate: false, privateNS: null,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', tags,
});

describe('historian_map action:"maintain"', () => {
  it('light: joins tags from ONE bounded list pass per locale, zero body reads', async () => {
    const home = makeKeyHome();
    writeMirror(home);
    const { tools, captured, fetchCount } = makeWired({
      'pages { list(': (vars) => ({
        data: {
          pages: {
            list: vars.locale === 'en'
              ? [listRow(1, 'en', 'llm/alpha', ['llm']), listRow(3, 'en', 'llm/bravo', ['llm', 'gpu'])]
              : [listRow(2, 'zh', 'llm/alpha', ['llm'])],
          },
        },
      }),
    }, home);

    const out = await run(tools.historian_map, { action: 'maintain' });

    expect(out.ok).toBe(true);
    expect(out.action).toBe('maintain');
    expect(out.deep).toBe(false);
    expect(out.schema).toBe('historian.maintain.v3');
    // F4 envelope guard: every v3 key stays intact (arrayContaining — concurrent
    // lanes may add, like statusTokenConflicts); dueForReview is additive INSIDE
    // report, never a new top-level envelope key.
    expect(Object.keys(out)).toEqual(
      expect.arrayContaining(['ok', 'action', 'schema', 'deep', 'generatedAt', 'rowCount', 'report', 'surface', 'markdown', 'urls']),
    );
    expect(out).not.toHaveProperty('dueForReview');
    const report = out.report as Record<string, Record<string, unknown>>;
    expect(report.rowCount).toBe(3);
    expect(report.tags).toEqual({
      available: true,
      vocabulary: [{ tag: 'llm', count: 3 }, { tag: 'gpu', count: 1 }],
    });
    expect(report.redirects.available).toBe(false);
    // bounded read-only pass: one list per locale + one nav read, no writes/bodies
    expect(fetchCount()).toBe(3);
    expect(captured.every((c) => c.query.includes('pages { list(') || c.query.includes('navigation {'))).toBe(true);
    expect(out.urls).toEqual({
      en: 'http://localhost:3000/en/_meta/page-map',
      zh: 'http://localhost:3000/zh/_meta/page-map',
    });
    const tail = tailJson(String(out.markdown));
    expect(tail.schema).toBe('historian.surface.v1');
    const surface = out.surface as Record<string, unknown>;
    expect((surface.nav as { sectionLandingMissing: { dir: string }[] }).sectionLandingMissing.map((s) => s.dir)).toContain('llm');
    const nav = (surface.nav as { available: boolean; mode: string | null; filesystemExposed: boolean });
    expect(nav.available).toBe(true);
    expect(nav.mode).toBe('STATIC');
    expect(nav.filesystemExposed).toBe(false);
  });

  it('deep: reads each page body once via singleByPath and surfaces freshness + stubs', async () => {
    const home = makeKeyHome();
    writeMirror(home);
    const { tools, captured, fetchCount } = makeWired({
      'pages { list(': (vars) => ({
        data: { pages: { list: vars.locale === 'en'
          ? [listRow(1, 'en', 'llm/alpha', ['llm']), listRow(3, 'en', 'llm/bravo', ['llm'])]
          : [listRow(2, 'zh', 'llm/alpha', ['llm'])] } },
      }),
      'singleByPath(': (vars) => {
        const path = vars.path as string;
        const content = path === 'llm/bravo'
          ? '> Redirect: /en/llm/alpha\n\nmerged.\n'
          : '# 部署现状卡\n\n| 元数据 | 值 |\n| 上次核实 | 2026-01-01 |\n| 复核周期 | 2020-01-01 |\n';
        return {
          data: {
            pages: {
              singleByPath: {
                id: 1, path, locale: vars.locale, title: '部署现状卡', description: '', content,
                isPublished: true, isPrivate: false, contentType: 'markdown', tags: [],
                createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
              },
            },
          },
        };
      },
    }, home);

    const out = await run(tools.historian_map, { action: 'maintain', deep: true });

    expect(out.ok).toBe(true);
    expect(out.deep).toBe(true);
    const report = out.report as Record<string, Record<string, unknown>>;
    expect(report.redirects.available).toBe(true);
    expect(report.redirects.count).toBe(1);
    const freshness = report.freshness as Record<string, unknown[]>;
    // llm/bravo is a redirect stub (exempt from the stamp rule, not classified G5);
    // the llm/alpha twins classify G5 via their 上次核实-bearing body, carry the
    // stamp, and their 2020-01-01 review-by is expired on any realistic clock.
    expect(freshness.missingLastVerified).toEqual([]);
    expect(freshness.expiredReviewBy.length).toBe(2);
    // llm/alpha twins stamped 2026-01-01 (no parseable duration in 复核周期's
    // date value → genre default 7d): both due, exact row shape.
    const due = report.dueForReview as Record<string, unknown>[];
    expect(due.map((x) => `${x.locale}/${x.path}`).sort()).toEqual(['en/llm/alpha', 'zh/llm/alpha']);
    expect(due.map((x) => Object.keys(x))).toEqual([
      ['path', 'locale', 'stampAge', 'cadence', 'verifyCommands'],
      ['path', 'locale', 'stampAge', 'cadence', 'verifyCommands'],
    ]);
    expect(due.map((x) => [x.cadence, x.verifyCommands])).toEqual([
      [7, []],
      [7, []],
    ]);
    const reads = captured.filter((c) => c.query.includes('singleByPath('));
    expect(reads.length).toBe(3); // one bounded read per map row
    expect(fetchCount()).toBe(6); // 2 list + 1 nav + 3 singleByPath
  });

  it('rejects unknown actions at the schema (maintain is now a legal enum member)', async () => {
    const home = makeKeyHome();
    const { tools } = makeWired({}, home);
    await expect(run(tools.historian_map, { action: 'bogus' })).rejects.toThrow();
  });
});

// --- overdueActions (I-16: G1 action tables must not rot silently) -------------

describe('overdueActionsOf', () => {
  const TABLE = (rows: string) =>
    `# 某事件复盘\n\n## 行动项\n\n| 措施 | 类型 | 负责人 | 期限 | 验证 | 状态 |\n| --- | --- | --- | --- | --- | --- |\n${rows}\n\n## 相关页面\n`;
  it('fires only on open+overdue+dated rows; done/future/TBD/neutral stay quiet', () => {
    const body = TABLE(
      '| 回填复核命令 | prevent | 用户 | 2026-08-20 | grep | 待办 |\n' +
      '| 上游反馈 | process | agent | 2026-09-10 | issue | pending |\n' +
      '| 重启观察 | verify | 用户 | 2026-08-01 | grep | 已完成 |\n' +
      '| 补文档 | process | 未定 | 未定 | issue | Pending |\n' +
      '| 再启用 | process | 用户 | 2026-08-02 | x | 未完成 |',
    );
    expect(overdueActionsOf(body, NOW)).toEqual([
      { action: '回填复核命令', due: '2026-08-20', daysOverdue: 15, status: '待办' },
    ]);
  });
  it('en headers + in-progress status also fire; a table without the 期限 column never matches', () => {
    const en = '# Post\n\n## Action Items\n\n| Action | Owner | Due | Verification | Status |\n| --- | --- | --- | --- | --- |\n| file upstream **issue** | agent | 2026-08-31 | link | in progress |\n';
    expect(overdueActionsOf(en, NOW)).toEqual([
      { action: 'file upstream issue', due: '2026-08-31', daysOverdue: 4, status: 'in progress' },
    ]);
    const noDue = '| 措施 | 负责人 | 状态 |\n| --- | --- | --- |\n| 做事 | 我 | 待办 |\n';
    expect(overdueActionsOf(noDue, NOW)).toEqual([]);
  });
});

describe('buildMaintainReport overdue queue (deep)', () => {
  const PAGE_EN =
    '# 事故复盘\n\n**状态/Status**: active · **日期/Date**: 2026-08-01\n\n## 行动项\n\n' +
    '| 措施 | 类型 | 负责人 | 期限 | 验证 | 状态 |\n| --- | --- | --- | --- | --- | --- |\n' +
    '| 观察日志 | 验证 | 用户 | 2026-08-20 | grep | Pending |\n| 提交 issue | 改进 | agent | 2026-08-25 | link | 进行中 |\n';
  const rows: MaintainRow[] = [
    mk(200, 'en', 'ops/incident', '事故复盘', '2026-08-10'),
    mk(201, 'zh', 'ops/incident', '事故复盘', '2026-08-10'),
  ];
  it('lists all open overdue items of one path, dedupes twins to the en row, null in light', async () => {
    const readBody = async (): Promise<string | null> => PAGE_EN;
    const report = await buildMaintainReport({ rows }, { now: NOW, deep: true, readBody });
    expect(report.overdueActions).toEqual([
      { path: 'ops/incident', locale: 'en', action: '观察日志', due: '2026-08-20', daysOverdue: 15, status: 'Pending' },
      { path: 'ops/incident', locale: 'en', action: '提交 issue', due: '2026-08-25', daysOverdue: 10, status: '进行中' },
    ]);
    expect(renderMaintainMarkdown(report)).toContain('逾期行动项');
    const light = await buildMaintainReport({ rows }, { now: NOW });
    expect(light.overdueActions).toBeNull();
  });
});

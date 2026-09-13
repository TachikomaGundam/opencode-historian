/**
 * src/surface.ts — human-interface & content-hygiene detectors (V6.1).
 *
 * maintain.ts owns per-page G5/G6 freshness; this module owns the WIKI-WIDE
 * structural health of the human surface (HANDOFF issues #1-#6): navigation
 * hygiene, map-vs-live coverage, redirect-stub reachability, broken / stacked /
 * index-less links, orphans, twin divergence, zh-first language, unfinished
 * skeletons and claim ledgers that beg re-verification.
 *
 * Pure functions over rows + live inventory + an injected readBody; the light
 * tier costs nothing beyond the map baseline, the deep tier reads every body
 * once (caller pools the reads).
 */

import { isInternalPath } from './tools/shared.js';
import { lintBody, type BodyLint } from './lint.js';
import { classifyGenre } from './templates/genres.js';
import { CONFESSIONAL_STAMP_RE, STAMP_LINE_RE, type MaintainRow } from './maintain.js';
import type { Locale } from './wiki/pages.read.js';
import type { NavSnapshot } from './wiki/nav.js';

export const SURFACE_SCHEMA = 'historian.surface.v1' as const;

/** Minimal shape of a live `pages.list` row the surface diff needs. */
export interface LiveRow {
  readonly path: string;
  readonly locale: Locale;
  readonly isPublished?: boolean;
  readonly isPrivate?: boolean;
}

export interface SurfaceInput {
  readonly rows: readonly MaintainRow[];
  readonly generatedAt: string;
  readonly baseUrl: string;
  readonly liveInventory?: readonly LiveRow[];
  /**
   * Live primary nav. Issue #1's disease is sidebar exposure, so the check
   * must read the real tree — omit/null reports `available: false` rather
   * than falsely claiming a clean nav.
   */
  readonly nav?: NavSnapshot | null;
  readonly deep?: boolean;
  readonly readBody?: (path: string, locale: Locale) => Promise<string | null>;
}

export interface SurfaceCoverage {
  readonly liveRows: number;
  readonly mapRows: number;
  readonly missingFromMap: { readonly path: string; readonly locale: Locale }[];
  readonly removedFromLive: number;
}

export interface SurfaceNav {
  readonly available: boolean;
  readonly mode: string | null;
  /** DYNAMIC/MIXED re-mirror the filesystem page tree into the sidebar — the exact Issue #1 relapse. */
  readonly filesystemExposed: boolean;
  /** Underscore-prefixed (machine-namespace) links explicitly mounted in the curated tree. */
  readonly machineLinks: { readonly locale: string; readonly label: string; readonly target: string }[];
  /** Informational: underscore segments in the PAGE tree — by design (_meta/_evidence/_sandbox/_data). */
  readonly machinePaths: readonly string[];
  readonly sectionLandingMissing: { readonly dir: string; readonly pagePaths: number }[];
}

export interface SurfaceUnfinished {
  readonly path: string;
  readonly locale: Locale;
  readonly title: string;
  readonly todo: number;
  readonly emptySections: readonly string[];
  readonly introEmpty: boolean;
  readonly active: boolean;
  readonly h1Mismatch: boolean;
}

export interface SurfaceStub {
  readonly path: string;
  readonly locale: Locale;
  readonly target: string | null;
  readonly clickable: boolean;
  readonly targetLive: boolean;
}

export interface SurfaceLinks {
  readonly broken: { readonly from: string; readonly locale: Locale; readonly target: string }[];
  readonly toStubs: { readonly from: string; readonly locale: Locale; readonly target: string }[];
  readonly sameTargetStacks: { readonly from: string; readonly locale: Locale; readonly target: string; readonly texts: number }[];
  readonly orphanPages: readonly string[];
  readonly indexMissing: readonly string[];
}

export interface SurfaceTwin {
  readonly path: string;
  readonly lenRatio: number;
  readonly sectionCountRatio: number;
  readonly relatedMismatch: boolean;
  readonly divergent: boolean;
}

export interface SurfaceDeep {
  readonly unfinished: SurfaceUnfinished[];
  readonly stubs: SurfaceStub[];
  readonly links: SurfaceLinks;
  readonly roleDivergence: { readonly path: string; readonly stubIn: Locale; readonly liveIn: Locale }[];
  readonly twinParity: SurfaceTwin[];
  readonly zhEnglishDominant: { readonly path: string; readonly cjkRatio: number }[];
  readonly ledgerClaims: { readonly path: string; readonly locale: Locale; readonly genre: string; readonly ports: number; readonly paths: number; readonly commands: number }[];
}

export interface SurfaceReport {
  readonly schema: typeof SURFACE_SCHEMA;
  readonly generatedAt: string;
  readonly deep: boolean;
  readonly coverage: SurfaceCoverage | null;
  readonly nav: SurfaceNav;
  readonly tagsEmpty: { readonly path: string; readonly locale: Locale }[];
  readonly deepReport: SurfaceDeep | null;
}

const MACHINE_SEG_RE = /^_/;
// nav targets carry a leading slash and may pre-pend the locale segment
// (/zh/_meta/x) — machine check runs on the first real path segment.
const MACHINE_TARGET_RE = /^\/(?:(?:en|zh)\/)?_[^/]+/;
const ROOT_EXEMPT = new Set(['home', 'wiki-index']);

const visible = (r: LiveRow): boolean => r.isPublished !== false && r.isPrivate !== true;
const rowKey = (path: string, locale: Locale): string => `${locale}\u0000${path}`;

function isFrontPath(path: string): boolean {
  return !isInternalPath(path) && !path.startsWith('_sandbox/') && !path.startsWith('_data/');
}

// --- light tier ---------------------------------------------------------------

function buildNav(
  rows: readonly MaintainRow[],
  live: readonly LiveRow[] | undefined,
  nav: NavSnapshot | null | undefined,
): SurfaceNav {
  const paths = new Set<string>();
  for (const r of rows) paths.add(r.path);
  for (const r of live ?? []) paths.add(r.path);
  const machinePaths = [...new Set([...paths].map((p) => p.split('/')[0] as string))]
    .filter((s) => MACHINE_SEG_RE.test(s))
    .sort();
  const mode = nav?.mode ?? null;
  const machineLinks: SurfaceNav['machineLinks'] = [];
  for (const t of nav?.trees ?? []) {
    for (const it of t.items) {
      if (MACHINE_TARGET_RE.test(it.target)) {
        machineLinks.push({ locale: t.locale, label: it.label, target: it.target });
      }
    }
  }
  const perDir = new Map<string, number>();
  for (const p of paths) {
    const seg = p.split('/');
    if (seg.length < 2 || MACHINE_SEG_RE.test(seg[0] as string)) continue;
    perDir.set(seg[0] as string, (perDir.get(seg[0] as string) ?? 0) + 1);
  }
  const sectionLandingMissing = [...perDir.entries()]
    .filter(([dir, n]) => n >= 2 && !paths.has(dir))
    .map(([dir, pagePaths]) => ({ dir, pagePaths }))
    .sort((a, b) => b.pagePaths - a.pagePaths || a.dir.localeCompare(b.dir));
  return {
    available: nav != null,
    mode,
    filesystemExposed: mode === 'DYNAMIC' || mode === 'MIXED',
    machineLinks,
    machinePaths,
    sectionLandingMissing,
  };
}

function buildCoverage(rows: readonly MaintainRow[], live: readonly LiveRow[] | undefined): SurfaceCoverage | null {
  if (live === undefined) return null;
  const mapKeys = new Set(rows.map((r) => rowKey(r.path, r.locale)));
  const liveVisible = live.filter(visible);
  const liveKeys = new Set(liveVisible.map((r) => rowKey(r.path, r.locale)));
  const missingFromMap = liveVisible
    .filter((r) => !mapKeys.has(rowKey(r.path, r.locale)))
    .map((r) => ({ path: r.path, locale: r.locale }))
    .sort((a, b) => a.path.localeCompare(b.path) || a.locale.localeCompare(b.locale));
  let removedFromLive = 0;
  for (const k of mapKeys) if (!liveKeys.has(k)) removedFromLive += 1;
  return { liveRows: liveVisible.length, mapRows: rows.length, missingFromMap, removedFromLive };
}

// --- deep tier ----------------------------------------------------------------

interface ScanRow {
  readonly row: MaintainRow;
  readonly lint: BodyLint | null;
  readonly body: string;
}

const STACK_MD_RE = /\[([^\]]+)\]\((?:https?:\/\/[^\s)]+|\/[^\s)]*)\)/g;

function anchorTexts(body: string): { raw: string; text: string }[] {
  const out: { raw: string; text: string }[] = [];
  STACK_MD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STACK_MD_RE.exec(body)) !== null) out.push({ raw: m[0], text: (m[1] as string).trim() });
  return out;
}

function resolveTargetPath(baseUrl: string, rawHref: string): { path: string; locale: Locale } | null {
  let t = rawHref.trim();
  if (t === '' || t.startsWith('#') || /^(mailto:|javascript:)/i.test(t)) return null;
  const host = baseUrl.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(t)) {
    if (!t.toLowerCase().startsWith(host.toLowerCase())) return null;
    t = t.slice(host.length);
  }
  if (/\.(png|jpe?g|gif|svg|webp|pdf|zip|css|js)\b/i.test(t)) return null;
  t = (t.split('#')[0] as string).split('?')[0] as string;
  t = t.replace(/^\/+/, '');
  if (t === '') return null;
  if (t.startsWith('zh/')) return { path: t.slice(3), locale: 'zh' };
  if (t.startsWith('en/')) return { path: t.slice(3), locale: 'en' };
  return { path: t, locale: 'en' };
}

/** True when EVERY stamp-bearing line confesses non-execution — see the
 *  ledgerClaims rule in buildDeep. Lines are the unit of judgement because a
 *  struck old stamp beside a fresh honest one must keep the exemption. */
function isConfessionalStamp(body: string): boolean {
  const stampLines = body.split('\n').filter((l) => STAMP_LINE_RE.test(l));
  return stampLines.length > 0 && stampLines.every((l) => CONFESSIONAL_STAMP_RE.test(l));
}

async function scanBodies(
  input: SurfaceInput,
): Promise<ScanRow[]> {
  if (input.readBody === undefined) return [];
  const targets = input.rows.filter((r) => !isInternalPath(r.path));
  const results: ScanRow[] = [];
  const queue = [...targets];
  const worker = async (): Promise<void> => {
    for (;;) {
      const row = queue.shift();
      if (row === undefined) return;
      const body = (await input.readBody?.(row.path, row.locale)) ?? '';
      results.push({ row, lint: body === '' ? null : lintBody(body, { locale: row.locale, baseUrl: input.baseUrl, title: row.title }), body });
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, () => worker()));
  return results;
}

function buildDeep(input: SurfaceInput, scans: ScanRow[]): SurfaceDeep | null {
  if (scans.length === 0) return null;
  const ok = scans.filter((s): s is ScanRow & { lint: BodyLint } => s.lint !== null);

  const unfinished: SurfaceUnfinished[] = ok
    .filter((s) => !s.lint.isRedirectStub && isFrontPath(s.row.path))
    .filter((s) => s.lint.todoMarkers > 0 || s.lint.emptySections.length > 0 || s.lint.introEmpty)
    .map((s) => ({
      path: s.row.path,
      locale: s.row.locale,
      title: s.row.title,
      todo: s.lint.todoMarkers,
      emptySections: s.lint.emptySections,
      introEmpty: s.lint.introEmpty,
      active: s.lint.state === 'active',
      h1Mismatch: s.lint.h1 !== null && s.lint.h1.trim() !== s.row.title.trim(),
    }))
    .sort((a, b) => Number(b.active) - Number(a.active) || b.todo + b.emptySections.length - (a.todo + a.emptySections.length));

  const pathSet = new Set<string>();
  for (const r of input.rows) pathSet.add(r.path);
  for (const r of input.liveInventory ?? []) pathSet.add(r.path);
  const stubPaths = new Map<string, Set<Locale>>();
  const stubs: SurfaceStub[] = [];
  for (const s of ok.filter((x) => x.lint.isRedirectStub)) {
    const target = s.lint.redirectTarget === null ? null : resolveTargetPath(input.baseUrl, s.lint.redirectTarget)?.path ?? null;
    stubs.push({ path: s.row.path, locale: s.row.locale, target: s.lint.redirectTarget, clickable: s.lint.stubHasLink, targetLive: target !== null && pathSet.has(target) });
    if (!stubPaths.has(s.row.path)) stubPaths.set(s.row.path, new Set());
    (stubPaths.get(s.row.path) as Set<Locale>).add(s.row.locale);
  }
  stubs.sort((a, b) => Number(a.clickable) - Number(b.clickable) || a.path.localeCompare(b.path));

  const broken: SurfaceLinks['broken'] = [];
  const toStubs: SurfaceLinks['toStubs'] = [];
  const inbound = new Map<string, number>();
  const indexTargets = new Set<string>();
  const sameTargetStacks: SurfaceLinks['sameTargetStacks'] = [];
  for (const s of ok) {
    const isIndex = s.row.path === 'wiki-index';
    const byTarget = new Map<string, Set<string>>();
    for (const a of anchorTexts(s.body)) {
      const t = resolveTargetPath(input.baseUrl, a.raw.slice(a.raw.indexOf('](') + 2, -1));
      if (t === null) continue;
      if (!byTarget.has(t.path)) byTarget.set(t.path, new Set());
      (byTarget.get(t.path) as Set<string>).add(a.text);
    }
    for (const link of s.lint.links) {
      if (!isFrontPath(link.path) || ROOT_EXEMPT.has(link.path)) continue;
      if (!link.path.startsWith('_sandbox/')) inbound.set(link.path, (inbound.get(link.path) ?? 0) + 1);
      if (isIndex) indexTargets.add(link.path);
      if (link.path === s.row.path) continue;
      if (!pathSet.has(link.path)) {
        if (!broken.some((b) => b.from === s.row.path && b.locale === s.row.locale && b.target === link.path)) {
          broken.push({ from: s.row.path, locale: s.row.locale, target: link.path });
        }
      } else if (stubPaths.has(link.path) && !broken.some((b) => b.target === link.path)) {
        toStubs.push({ from: s.row.path, locale: s.row.locale, target: link.path });
      }
    }
    for (const [target, texts] of byTarget) {
      if (texts.size >= 3 && pathSet.has(target)) sameTargetStacks.push({ from: s.row.path, locale: s.row.locale, target, texts: texts.size });
    }
  }

  const liveByPathLocale = new Map<string, ScanRow>();
  for (const s of ok) liveByPathLocale.set(rowKey(s.row.path, s.row.locale), s);
  const roleDivergence: SurfaceDeep['roleDivergence'] = [];
  const twinParity: SurfaceTwin[] = [];
  const pathsAll = new Set<string>();
  for (const s of ok) pathsAll.add(s.row.path);
  for (const p of [...pathsAll].sort()) {
    const en = liveByPathLocale.get(rowKey(p, 'en'));
    const zh = liveByPathLocale.get(rowKey(p, 'zh'));
    const enStub = stubPaths.get(p)?.has('en') ?? false;
    const zhStub = stubPaths.get(p)?.has('zh') ?? false;
    if (enStub !== zhStub && en !== undefined && zh !== undefined) {
      roleDivergence.push({ path: p, stubIn: enStub ? 'en' : 'zh', liveIn: enStub ? 'zh' : 'en' });
    }
    if (en !== undefined && zh !== undefined && !enStub && !zhStub && isFrontPath(p)) {
      const enLen = (en.body.match(/\S/g) ?? []).length;
      const zhLen = (zh.body.match(/\S/g) ?? []).length;
      if (enLen === 0 || zhLen === 0) continue;
      // Length must be script-weighted: a CJK glyph carries ~3x the information
      // of a latin char, so raw lengths flagged faithful zh translations as
      // "truncated" (0.47 ratio at 1.0 section parity in the live scan).
      const eff = (n: number, cjkRatio: number) => n * (1 + 2 * cjkRatio);
      // Structural, not literal: en/zh heading STRINGS are translations, so
      // text-jaccard measured 0 on 85/98 live pairs (pure noise). What survives
      // translation: level>=2 section count + Related Pages tail (SYN-9).
      const h2 = (l?: { readonly headings: readonly { level: number }[] } | null) =>
        (l?.headings ?? []).filter((h) => h.level >= 2).length;
      const nEn = h2(en.lint);
      const nZh = h2(zh.lint);
      const sectionCountRatio = Math.max(nEn, nZh) === 0 ? 1 : Math.min(nEn, nZh) / Math.max(nEn, nZh);
      const relatedMismatch =
        (en.lint?.hasRelatedPages ?? false) !== (zh.lint?.hasRelatedPages ?? false);
      const lenRatio = Math.min(eff(enLen, en.lint?.cjkRatio ?? 0), eff(zhLen, zh.lint?.cjkRatio ?? 0))
        / Math.max(eff(enLen, en.lint?.cjkRatio ?? 0), eff(zhLen, zh.lint?.cjkRatio ?? 0));
      twinParity.push({
        path: p,
        lenRatio: Number(lenRatio.toFixed(2)),
        sectionCountRatio: Number(sectionCountRatio.toFixed(2)),
        relatedMismatch,
        divergent: sectionCountRatio < 0.6 || lenRatio < 0.5 || relatedMismatch,
      });
    }
  }
  twinParity.sort((a, b) => Number(b.divergent) - Number(a.divergent) || a.lenRatio - b.lenRatio);

  const zhEnglishDominant = ok
    .filter((s) => s.row.locale === 'zh' && isFrontPath(s.row.path) && !s.lint.isRedirectStub)
    .filter((s) => (s.body.match(/\S/g) ?? []).length > 400 && s.lint.cjkRatio < 0.06)
    .map((s) => ({ path: s.row.path, cjkRatio: Number(s.lint.cjkRatio.toFixed(3)) }));

  const ledgerClaims: SurfaceDeep['ledgerClaims'] = [];
  for (const s of ok) {
    // Stamp honesty (swarm-A P2): a stamp that only ever confesses the review
    // never ran ("…(content not re-run)"/未复跑/未复核/baseline) is not evidence —
    // claiming review without execution must not suppress the claim ledger.
    // Any single non-confessional stamp line (incl. supersede-keeping-struck-old)
    // exempts exactly as before.
    const exempt = s.lint.hasStamp && !isConfessionalStamp(s.body);
    if (s.lint.isRedirectStub || !isFrontPath(s.row.path) || exempt) continue;
    const genre = classifyGenre({ title: s.row.title, body: s.body }).genre;
    if (!(genre === 'G4' || genre === 'G5' || genre === 'G6')) continue;
    if (s.lint.claimTotal < 3) continue;
    ledgerClaims.push({ path: s.row.path, locale: s.row.locale, genre, ports: s.lint.claims.ports, paths: s.lint.claims.paths, commands: s.lint.claims.commands });
  }
  ledgerClaims.sort((a, b) => b.ports + b.paths + b.commands - (a.ports + a.paths + a.commands));

  const orphanPages = ok
    .filter((s) => isFrontPath(s.row.path) && !s.lint.isRedirectStub && !ROOT_EXEMPT.has(s.row.path))
    .map((s) => s.row.path)
    .filter((p, i, arr) => arr.indexOf(p) === i && (inbound.get(p) ?? 0) === 0)
    .sort();

  const indexMissing = [...new Set(ok.filter((s) => isFrontPath(s.row.path)).map((s) => s.row.path))]
    .filter((p) => !ROOT_EXEMPT.has(p) && !(stubPaths.get(p)?.has('en') ?? false) && !indexTargets.has(p))
    .sort();

  return {
    unfinished,
    stubs,
    links: { broken, toStubs, sameTargetStacks, orphanPages, indexMissing },
    roleDivergence,
    twinParity,
    zhEnglishDominant,
    ledgerClaims,
  };
}

// --- entry --------------------------------------------------------------------

export async function buildSurfaceReport(input: SurfaceInput): Promise<SurfaceReport> {
  const scans = input.deep === true ? await scanBodies(input) : [];
  return {
    schema: SURFACE_SCHEMA,
    generatedAt: input.generatedAt,
    deep: input.deep === true,
    coverage: buildCoverage(input.rows, input.liveInventory),
    nav: buildNav(input.rows, input.liveInventory, input.nav),
    tagsEmpty: input.rows
      .filter((r) => isFrontPath(r.path) && (r.tags?.length ?? 0) === 0)
      .map((r) => ({ path: r.path, locale: r.locale }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    deepReport: buildDeep(input, scans),
  };
}

// --- render -------------------------------------------------------------------

const cap = <T>(arr: readonly T[], n: number): readonly T[] => arr.slice(0, n);

export function renderSurfaceMarkdown(r: SurfaceReport): string {
  const L: string[] = [];
  L.push(`# 界面健康 Surface Report (${r.deep ? 'deep' : 'light'})`, '');
  L.push(`> ${r.generatedAt} · schema ${r.schema}`, '');

  L.push('## 覆盖 Coverage（地图 vs 实时）', '');
  if (r.coverage === null) L.push('- （未提供 live inventory — 由 `maintain` 工具自动采集）');
  else {
    L.push(`- live ${r.coverage.liveRows} 行 / map ${r.coverage.mapRows} 行 · 地图外 missingFromMap ${r.coverage.missingFromMap.length} · 地图内已消失 removedFromLive ${r.coverage.removedFromLive}`);
    for (const m of cap(r.coverage.missingFromMap, 40)) L.push(`  - \`${m.locale}/${m.path}\``);
  }

  L.push('', '## 导航 Nav（真相 = 实时导航树，非页面树推断）', '');
  if (!r.nav.available) {
    L.push('- ⚠ 导航树不可读（nav.available=false）— 机器段暴露无法核验，请检查 token 的导航读取权限');
  } else {
    L.push(
      `- mode: \`${r.nav.mode}\` · 文件系统暴露 filesystemExposed: ${
        r.nav.filesystemExposed ? '⚠ 是 — DYNAMIC/MIXED 会把页面树镜像回侧栏（Issue #1 复发）' : '否'
      }`,
    );
    if (r.nav.machineLinks.length > 0) {
      L.push(`- ⚠ 导航树内机器段链接 machineLinks (${r.nav.machineLinks.length}):`);
      for (const m of cap(r.nav.machineLinks, 20)) L.push(`  - [${m.locale}] ${m.label} → \`${m.target}\``);
    } else {
      L.push(`- 导航树内机器段链接: none ✓（页面树存档段 ${r.nav.machinePaths.map((s) => `\`${s}/\``).join(' ') || '—'} 属设计内，仅备查）`);
    }
  }
  if (r.nav.sectionLandingMissing.length > 0) {
    L.push(`- 落地页缺失 sectionLandingMissing（面包屑 404 / 空目录页）:`);
    for (const s of r.nav.sectionLandingMissing) L.push(`  - \`/${s.dir}\` — ${s.pagePaths} 页在此目录下`);
  }

  L.push('', `## 元数据卫生 Tags（前台空标签 ${r.tagsEmpty.length}）`, '');
  if (r.tagsEmpty.length === 0) L.push('- none');
  else {
    const byPath = new Map<string, string[]>();
    for (const t of r.tagsEmpty) byPath.set(t.path, [...(byPath.get(t.path) ?? []), t.locale]);
    for (const [p, ls] of cap([...byPath.entries()], 40)) L.push(`- \`${p}\` (${ls.join(',')})`);
  }

  if (r.deepReport === null) {
    L.push('', '## Deep —（light 扫描未含正文级检测；用 deep:true）', '');
    L.push('', '```json', JSON.stringify(r, null, 2), '```');
    return L.join('\n');
  }
  const d = r.deepReport;

  L.push('', `## 未完成正文 Unfinished skeletons (${d.unfinished.length})`, '');
  L.push('| Path | 语言 | TODO | 空节 | 导言空 | Active谎报 | H1≠标题 |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const u of cap(d.unfinished, 50)) {
    L.push(`| \`${u.path}\` | ${u.locale} | ${u.todo} | ${u.emptySections.length} | ${u.introEmpty ? '✓' : ''} | ${u.active ? '**✓**' : ''} | ${u.h1Mismatch ? '✓' : ''} |`);
  }

  L.push('', `## 重定向存根 Redirect stubs (${d.stubs.length})`, '');
  const dead = d.stubs.filter((s) => !s.clickable || !s.targetLive);
  L.push(`- 无出口或死目标 dead/no-exit: ${dead.length}${dead.length > 0 ? '' : ' ✓'}`);
  for (const s of cap(dead, 30)) L.push(`  - \`${s.locale}/${s.path}\` → ${s.target ?? '?'} ${s.clickable ? '' : '（正文无可点击链接）'}${s.targetLive ? '' : '（目标不存在）'}`);

  L.push('', '## 链接 Links', '');
  L.push(`- 断链 broken: ${d.links.broken.length}`);
  for (const b of cap(d.links.broken, 30)) L.push(`  - \`${b.locale}/${b.from}\` → \`${b.target}\``);
  L.push(`- 指向存根 toStubs: ${d.links.toStubs.length}`);
  for (const b of cap(d.links.toStubs, 20)) L.push(`  - \`${b.locale}/${b.from}\` → 存根 \`${b.target}\``);
  L.push(`- 同目标堆叠 sameTargetStacks（≥3 锚文本指同页）: ${d.links.sameTargetStacks.length}`);
  for (const b of cap(d.links.sameTargetStacks, 20)) L.push(`  - \`${b.locale}/${b.from}\` × ${b.texts} → \`${b.target}\``);
  L.push(`- 孤儿 orphanPages（全库无任何入链）: ${d.links.orphanPages.length}`);
  for (const p of cap(d.links.orphanPages, 30)) L.push(`  - \`${p}\``);
  L.push(`- 索引缺席 indexMissing（wiki-index 未收录）: ${d.links.indexMissing.length}`);
  for (const p of cap(d.links.indexMissing, 40)) L.push(`  - \`${p}\``);

  L.push('', `## 双语孪生 Twins`, '');
  L.push(`- 角色分歧 roleDivergence（一侧存根一侧活页）: ${d.roleDivergence.length}`);
  for (const t of d.roleDivergence) L.push(`  - \`${t.path}\` — ${t.stubIn} 存根 / ${t.liveIn} 活页`);
  const divergent = d.twinParity.filter((t) => t.divergent);
  L.push(`- 内容分歧 divergent pairs: ${divergent.length} / ${d.twinParity.length}`);
  for (const t of cap(divergent, 30)) L.push(`  - \`${t.path}\` 长度比 ${t.lenRatio} 小节比 ${t.sectionCountRatio}${t.relatedMismatch ? ' 相关页尾缺失' : ''}`);
  L.push(`- zh 页英文主导 zhEnglishDominant（违背中文为主）: ${d.zhEnglishDominant.length}`);
  for (const t of cap(d.zhEnglishDominant, 20)) L.push(`  - \`${t.path}\` cjk ${(t.cjkRatio * 100).toFixed(1)}%`);

  L.push('', `## 台账风险 Ledger claims（G4/G5/G6 具体机器事实但无核实戳）: ${d.ledgerClaims.length}`, '');
  for (const c of cap(d.ledgerClaims, 30)) L.push(`- \`${c.locale}/${c.path}\` (${c.genre}) ports:${c.ports} paths:${c.paths} cmds:${c.commands}`);

  L.push('', '```json', JSON.stringify(r, null, 2), '```');
  return L.join('\n');
}

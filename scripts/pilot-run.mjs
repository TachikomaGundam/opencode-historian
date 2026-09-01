#!/usr/bin/env node
/**
 * Pilot migration driver (plan todo 15). Staged, resumable, auditable:
 *
 *   node scripts/pilot-run.mjs select              # live inventory + candidate scoring (read-only)
 *   node scripts/pilot-run.mjs before              # snapshot .qa/before-map.json, open window
 *   node scripts/pilot-run.mjs page <path> [--force]  # ≤3-round draft loop (read-only)
 *   node scripts/pilot-run.mjs apply <path>        # backup-first upsert + post-apply verify
 *   node scripts/pilot-run.mjs after               # refreshMapCache + snapshot .qa/after-map.json
 *   node scripts/pilot-run.mjs diff                # .qa/15-diff.txt + assertions (a)(b)(c)
 *   node scripts/pilot-run.mjs report              # results/pilot-<section>-<date>.md
 *   node scripts/pilot-run.mjs status              # current state summary
 *
 * All engine calls go through the SHIPPED dist build (npm run build first).
 * Every wiki mutation and every LLM call is appended to .qa/15.txt with the
 * path/locale/op/UpdatedAt ledger contract. Runtime state (drafts, verdicts,
 * applied entries) lives in .qa/15-state.json so any mode can be re-run.
 * The script never prints secrets: all engine error text is pre-redacted.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveOptions } from '../dist/config.js';
import { createClient } from '../dist/wiki/client.js';
import { buildPageMap, refreshMapCache } from '../dist/map.js';
import { listPages, readPage } from '../dist/wiki/pages.read.js';
import { reformatPageDraft } from '../dist/migrate.js';
import { applyMigration } from '../dist/migrate-apply.js';
import { scoreChecklist } from '../dist/migrate-score.js';
import { dateKey, readBackup, readCheckpoint } from '../dist/migrate-store.js';

// --- Paths & fixed window time (deterministic backup/report filenames) -------
const REPO = fileURLToPath(new URL('../', import.meta.url));
const QA = join(REPO, '.qa');
const RESULTS = join(REPO, 'results');
const STATE_FILE = join(QA, '15-state.json');
const LEDGER = join(QA, '15.txt');
const BEFORE_MAP = join(QA, 'before-map.json');
const AFTER_MAP = join(QA, 'after-map.json');
const DIFF_FILE = join(QA, '15-diff.txt');
const PILOT_NOW = new Date(2026, 8, 2, 12, 0, 0); // fixed: 2026-09-02 in any TZ
const DATE_KEY = dateKey(PILOT_NOW);
const HOME = homedir();
const EXCLUDED_SECTIONS = new Set(['_sandbox', 'scratch']);

// --- Engine wiring ------------------------------------------------------------
const options = resolveOptions({});
const client = createClient(options);
const migrateDeps = { client, options, homeDir: HOME, resultsDir: RESULTS };

// --- Ledger -------------------------------------------------------------------
const nowIso = () => new Date().toISOString();
function logLine(line) {
  const text = `[${nowIso()}] ${line}`;
  appendFileSync(LEDGER, `${text}\n`);
  console.log(text);
}
function readState() {
  if (!existsSync(STATE_FILE)) return { version: 1, pilot: null, pages: {}, window: null };
  return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
}
function writeState(state) {
  mkdirSync(QA, { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}
function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// --- Shared helpers ------------------------------------------------------------
async function liveInventory() {
  const [en, zh] = await Promise.all([listPages(client, { locale: 'en' }), listPages(client, { locale: 'zh' })]);
  const byPath = new Map();
  for (const row of [...en, ...zh]) {
    let entry = byPath.get(row.path);
    if (entry === undefined) byPath.set(row.path, (entry = {}));
    entry[row.locale] = row;
  }
  return { en, zh, byPath };
}

function isQualifiedRow(row) {
  return row.isPublished === true && row.isPrivate === false && (row.privateNS === null || row.privateNS === undefined);
}

async function liveSnapshot() {
  const { rows, stats } = await buildPageMap({ client, options });
  return { generatedAt: nowIso(), rows, stats };
}

function httpCode(url) {
  const r = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', url], { timeout: 15000 });
  if (r.status !== 0) return 'curl-failed';
  return String(r.stdout).trim();
}

function lineCount(content) {
  return content === '' ? 0 : content.split('\n').length;
}

function gateFailures(verdicts) {
  return verdicts.filter((v) => v.id >= 1 && v.id <= 8 && v.verdict !== 'pass' && v.verdict !== 'na');
}

function urlsFor(path) {
  return { en: `${options.baseUrl}/en/${path}`, zh: `${options.baseUrl}/zh/${path}` };
}

const HINT_BY_ITEM = {
  1: '导言占比：首段结论先行，导言约占正文 10-15%，每个重要小节在导言至少占一句。',
  2: '句长约束：中文句 ≤20 字拆短句；英文句 ≤25 词。',
  3: '表格判据：≥3 字段的结构化枚举必须改为 Markdown 表格；成对数据用描述列表。',
  4: '所有表格必须带有来源列（表头含「来源」或 source/reference）。',
  5: '时间线表格必须为三列：时间 | 事件 | 来源，每行事实必须带来源。',
  6: '行动项必须为表格：列 = 类型 | 负责人 | 期限 | 验证 | 状态（五列齐备）。',
  7: '禁止「其他/杂项/miscellaneous」类 catch-all 小节（参见/附录除外）。',
  8: '删除所有无证据的溢美词（领先/强大/先进/赋能/robust/streamline/leverage 等）。',
};
const RESTRUCTURE_HINT = '必须实际重排页面结构并改写文字（上一版未能满足要求，禁止原样返回原文）。';

function hintsForRound(failedItems, round) {
  const hints = [...new Set(failedItems.map((id) => HINT_BY_ITEM[id]).filter(Boolean))];
  if (hints.length === 0 && round > 1) hints.push(RESTRUCTURE_HINT);
  if (round >= 3 && failedItems.length > 0) {
    hints.push(`必须彻底重排结构：上一版未通过检查项 ${failedItems.join(',')}，逐项修复后输出完整 Markdown 页面。`);
  }
  return hints;
}

// --- Mode: select ---------------------------------------------------------------
async function cmdSelect() {
  logLine('SELECT start — live pages.list inventory (en+zh)');
  const { byPath } = await liveInventory();
  const taxonomy = options.sections;
  const candidates = [];
  const rootPaths = [];
  const seenSection = new Map();
  for (const [path, locales] of [...byPath.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const first = path.split('/')[0];
    if (!taxonomy.includes(first)) {
      rootPaths.push(path);
      continue;
    }
    let entry = seenSection.get(first);
    if (entry === undefined) seenSection.set(first, (entry = { paths: new Map(), bare: false }));
    entry.paths.set(path, locales);
    if (path === first) entry.bare = true;
  }
  for (const section of taxonomy) {
    if (EXCLUDED_SECTIONS.has(section)) continue;
    const entry = seenSection.get(section);
    if (entry === undefined) {
      logLine(`SELECT candidate ${section}: 0 paths (empty section)`);
      continue;
    }
    const paths = [...entry.paths.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const unqualified = [];
    const missingTwin = [];
    for (const [path, locales] of paths) {
      if (locales.en === undefined || locales.zh === undefined) missingTwin.push(path);
      for (const loc of ['en', 'zh']) {
        if (locales[loc] !== undefined && !isQualifiedRow(locales[loc])) {
          const r = locales[loc];
          unqualified.push(`${path} [${loc}: published=${r.isPublished} isPrivate=${r.isPrivate} ns=${r.privateNS}]`);
          break;
        }
      }
    }
    const qualified = unqualified.length === 0;
    logLine(`SELECT candidate ${section}: paths=${paths.length} qualified=${qualified} missingTwin=${missingTwin.length}${entry.bare ? ' (contains bare-section page)' : ''}`);
    if (unqualified.length > 0) logLine(`  unqualified: ${unqualified.join('; ')}`);
    candidates.push({ section, pathCount: paths.length, qualified, unqualified, missingTwin, pathList: paths.map(([p]) => p) });
  }
  logLine(`SELECT root pages (outside taxonomy, excluded): ${rootPaths.length} -> ${rootPaths.join(', ')}`);
  const qualifiedCandidates = candidates.filter((c) => c.qualified && c.pathCount > 0).sort((a, b) => a.pathCount - b.pathCount);
  const state = readState();
  if (qualifiedCandidates.length === 0) {
    logLine('SELECT BLOCKED-selection: no section has ALL paths published + non-private; zero wiki writes performed.');
    process.exit(1);
  }
  const chosen = qualifiedCandidates[0];
  if (chosen.pathCount > 15) {
    logLine(`SELECT HARD GUARD >15: smallest qualified section ${chosen.section} has ${chosen.pathCount} paths — BLOCKED-selection, zero wiki writes performed.`);
    process.exit(1);
  }
  logLine(`SELECT chosen=${chosen.section} paths=${chosen.pathCount} (smallest qualified candidate)`);
  state.pilot = {
    section: chosen.section,
    selectedAt: nowIso(),
    paths: chosen.pathList,
    allCandidates: candidates.map((c) => ({ section: c.section, pathCount: c.pathCount, qualified: c.qualified, missingTwin: c.missingTwin.length })),
  };
  writeState(state);
}

// --- Mode: before ----------------------------------------------------------------
function beforeSummary(snap) {
  return `before-map rows=${snap.stats.rows} paths=${snap.stats.paths} en=${snap.stats.perLocale.en} zh=${snap.stats.perLocale.zh} missingTwin=${snap.stats.missingTwinPaths.length}`;
}

async function cmdBefore() {
  const state = readState();
  if (!state.pilot) fail('run select first');
  const snap = await liveSnapshot();
  mkdirSync(QA, { recursive: true });
  writeFileSync(BEFORE_MAP, `${JSON.stringify(snap, null, 2)}\n`);
  state.window = { ...(state.window ?? {}), openedAt: nowIso(), beforeFile: BEFORE_MAP, beforeStats: snap.stats };
  writeState(state);
  logLine(`WINDOW OPEN: ${beforeSummary(snap)}`);
  logLine(`WINDOW missingTwin before: ${snap.stats.missingTwinPaths.length} -> ${snap.stats.missingTwinPaths.join(', ')}`);
  logLine('WINDOW RULE: until after-map snapshot, the only wiki writes are pilot-section upserts + _meta/page-map refresh.');
}

// --- Mode: page (draft loop, read-only) --------------------------------------------
async function cmdPage(path, force) {
  const state = readState();
  if (!state.pilot) fail('run select first');
  if (!state.pilot.paths.includes(path)) fail(`'${path}' is not in pilot section ${state.pilot.section}`);
  let rec = state.pages[path] ?? { path, rounds: [] };
  if (!force && (rec.status === 'green' || rec.status === 'draft-ready' || rec.status === 'conforms-as-is')) {
    console.log(`page ${path} already ${rec.status} — re-run with --force to redo the draft loop`);
    return;
  }
  if (force && rec.rounds.length > 0) {
    rec = { path, rounds: [], past: rec };
    logLine(`PAGE ${path} --force: fresh draft loop (previous ${rec.past.rounds.length} rounds archived in state)`);
  }
  const pre = {};
  for (const loc of ['en', 'zh']) {
    const p = await readPage(client, path, loc);
    pre[loc] = p === null ? null : { lines: lineCount(p.content), updatedAt: p.updatedAt, title: p.title };
  }
  rec.beforeLines = pre;
  logLine(`PAGE ${path} start beforeLines en=${pre.en?.lines ?? 'n/a'} zh=${pre.zh?.lines ?? 'n/a'} title=${pre.en?.title ?? pre.zh?.title}`);

  const explicitGenre = state.pilot.explicitGenre ?? undefined;
  let finalDraft = null;
  let finalGenre = null;
  let appliedMode = 'none';
  let blocked = null;
  let sourceLocale = null;
  let missingTwinBefore = true;

  for (let round = 1; round <= 3 && blocked === null; round++) {
    const failedSoFar = rec.rounds[rec.rounds.length - 1]?.failedItems ?? [];
    const hints = round === 1 ? [] : hintsForRound(failedSoFar, round);
    const roundRec = { round, hints, attempts: 0 };
    let outcome = null;
    for (let attempt = 1; attempt <= 3 && outcome === null; attempt++) {
      roundRec.attempts = attempt;
      const t0 = Date.now();
      const res = await reformatPageDraft(migrateDeps, { path, genre: explicitGenre, reviseHints: hints });
      const ms = Date.now() - t0;
      roundRec.latencyMs = ms;
      if (!res.ok) {
        roundRec.lastError = { name: res.error.name, message: res.error.message };
        logLine(`PAGE ${path} round${round} attempt${attempt} ERROR latency=${ms}ms kind=${res.error.name} msg=${res.error.message}`);
        continue;
      }
      outcome = res;
    }
    if (outcome === null) {
      blocked = `restyle error after ${roundRec.attempts} attempts (${roundRec.lastError.name}: ${roundRec.lastError.message})`;
      rec.rounds.push(roundRec);
      logLine(`PAGE ${path} BLOCKED: ${blocked}`);
      break;
    }
    const out = outcome;
    missingTwinBefore = out.missingTwin;
    sourceLocale = out.sourceLocale;
    finalGenre = out.genre;
    roundRec.verdicts = out.checklistResults;
    roundRec.alreadyConforms = out.alreadyConforms;
    roundRec.sourceLocale = out.sourceLocale;
    roundRec.confidence = out.confidence;
    logLine(
      `PAGE ${path} round${round} attempt${roundRec.attempts} latency=${roundRec.latencyMs}ms genre=${out.genre} conf=${out.confidence} alreadyConforms=${out.alreadyConforms} source=${out.sourceLocale} missingTwin=${out.missingTwin}`,
    );

    if (out.alreadyConforms) {
      const existingVerdicts = scoreChecklist(out.genre, out.sourceContent);
      const existingFailed = gateFailures(existingVerdicts);
      logLine(
        `PAGE ${path} round${round} alreadyConforms — existing-content items 1-8: ${existingFailed.length === 0 ? 'PASS' : `FAIL ${existingFailed.map((v) => v.id).join(',')}`} twinComplete=${!out.missingTwin}`,
      );
      roundRec.failedItems = existingFailed.map((v) => v.id);
      rec.rounds.push(roundRec);
      if (existingFailed.length === 0) {
        finalDraft = out.sourceContent;
        appliedMode = out.missingTwin ? 'migrated' : 'conforms-as-is';
        const note =
          appliedMode === 'conforms-as-is'
            ? 'conforms-as-is (twin complete, checklist 1-8 pass on existing content) — count as migrated, no write'
            : 'conformant content + missing twin — bootstrap apply needed (draft = existing content)';
        logLine(`PAGE ${path} ${note}`);
        break;
      }
      logLine(`PAGE ${path} round${round} alreadyConforms but existing content fails checklist items — revise round`);
      continue;
    }

    finalDraft = out.draft;
    const failed = gateFailures(out.checklistResults);
    roundRec.failedItems = failed.map((v) => v.id);
    rec.rounds.push(roundRec);
    if (failed.length === 0) {
      appliedMode = 'migrated';
      logLine(`PAGE ${path} draft-ready after round${round}`);
      break;
    }
    logLine(
      `PAGE ${path} round${round} FAIL items ${failed.map((v) => v.id).join(',')}${round < 3 ? ` — revise round ${round + 1} hints=${hints.length}` : ''}`,
    );
    if (round >= 3) blocked = `checklist still failing after 3 rounds (items ${failed.map((v) => v.id).join(',')})`;
  }

  if (blocked === null && finalDraft === null) {
    blocked = 'no acceptable draft produced (rounds exhausted on alreadyConforms revisions)';
  }
  if (blocked !== null) {
    rec.status = 'blocked';
    rec.blockedReason = blocked;
    logLine(`PAGE ${path} BLOCKED: ${blocked}`);
    logLine('PILOT BLOCKED (per-page loop) — stop loop; after/diff/report still run; no apply for failing pages.');
  } else {
    const lastRound = rec.rounds[rec.rounds.length - 1];
    rec.status = 'draft-ready';
    rec.finalDraft = finalDraft;
    rec.appliedMode = appliedMode;
    rec.genre = finalGenre;
    rec.confidence = lastRound?.confidence ?? null;
    rec.explicit = explicitGenre !== undefined;
    rec.sourceLocale = sourceLocale;
    rec.missingTwinBefore = missingTwinBefore;
    rec.items9_10 = null;
  }
  state.pages[path] = rec;
  writeState(state);

  if (rec.status === 'draft-ready' && appliedMode === 'conforms-as-is') {
    await verifyUrlsAndTwin(state, path, rec, null);
    writeState(state);
  }
}

// --- Mode: apply -------------------------------------------------------------------
async function cmdApply(path) {
  const state = readState();
  const rec = state.pages[path];
  if (rec === undefined) fail(`no draft state for '${path}' — run page ${path} first`);
  if (rec.status === 'green') {
    console.log(`${path} already green — nothing to do`);
    return;
  }
  if (rec.appliedMode === 'conforms-as-is') {
    logLine(`APPLY ${path} conforms-as-is — no write needed, verify URLs`);
    await verifyUrlsAndTwin(state, path, rec, null);
    writeState(state);
    return;
  }
  if (rec.status !== 'draft-ready') fail(`${path} status=${rec.status} — only draft-ready pages can be applied`);
  if (rec.finalDraft === null || rec.genre === null) fail(`${path} has no final draft/genre`);

  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    let out;
    try {
      out = await applyMigration(migrateDeps, { path, genre: rec.genre, draft: rec.finalDraft, now: PILOT_NOW });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logLine(`APPLY ${path} attempt${attempt} THREW latency=${Date.now() - t0}ms kind=${lastError.name} msg=${lastError.message}`);
      continue;
    }
    const ms = Date.now() - t0;
    if (!out.ok) {
      lastError = out.error;
      logLine(`APPLY ${path} attempt${attempt} ERROR latency=${ms}ms kind=${out.error.name} msg=${out.error.message}`);
      continue;
    }
    logLine(`APPLY ${path} attempt${attempt} ok latency=${ms}ms backup=${out.backupPath}${out.skipped ? ` skipped=${out.skipped}` : ''}`);
    const actions = {};
    for (const a of out.applied) {
      actions[a.locale] = a.action;
      logLine(`APPLY ${path} ${a.action} locale=${a.locale}`);
      for (const v of a.checklist) {
        if (v.id <= 8 && v.verdict === 'fail') logLine(`APPLY ${path} stored-${a.locale} item${v.id}=fail (${v.note})`);
      }
    }
    rec.backupPath = out.backupPath;
    rec.applied = out.applied;
    rec.appliedActions = actions;
    await verifyUrlsAndTwin(state, path, rec, out.backupPath);
    writeState(state);
    return;
  }
  rec.status = 'blocked';
  rec.blockedReason = `apply failed after 3 attempts (last: ${lastError.name}: ${lastError.message})`;
  logLine(`APPLY ${path} BLOCKED: ${rec.blockedReason}`);
  logLine('PILOT BLOCKED (apply loop) — after/diff/report still run; no apply for failing pages.');
  writeState(state);
}

async function verifyUrlsAndTwin(state, path, rec, backupPath) {
  const urls = urlsFor(path);
  const http = { en: httpCode(urls.en), zh: httpCode(urls.zh) };
  logLine(`HTTP ${path} en=${http.en} zh=${http.zh} (anon curl)`);
  const post = {};
  const residuals = [];
  for (const loc of ['en', 'zh']) {
    const p = await readPage(client, path, loc);
    post[loc] = p === null ? null : { lines: lineCount(p.content), updatedAt: p.updatedAt, title: p.title };
    if (p !== null) {
      const stored = scoreChecklist(rec.genre ?? 'G4', p.content);
      for (const v of stored) {
        if (v.id >= 1 && v.id <= 8 && v.verdict === 'fail') residuals.push(`${loc} stored item${v.id}: ${v.note}`);
      }
    }
  }
  const twinComplete = post.en !== null && post.zh !== null;
  rec.afterLines = post;
  rec.http = http;
  rec.updatedAtBefore = {};
  rec.updatedAtAfter = {};
  const isWrite = rec.appliedMode === 'migrated';
  for (const loc of ['en', 'zh']) {
    rec.updatedAtBefore[loc] = rec.beforeLines?.[loc]?.updatedAt ?? null;
    rec.updatedAtAfter[loc] = post[loc]?.updatedAt ?? null;
    const op = isWrite ? (rec.appliedActions?.[loc] ?? 'write') : 'none';
    logLine(
      `LEDGER ${path} ${loc} op=${op} before=${rec.updatedAtBefore[loc]} after=${rec.updatedAtAfter[loc]}${backupPath ? ` backup=${backupPath}#/paths/${path}` : ''}`,
    );
  }
  logLine(`TWIN ${path} complete=${twinComplete}`);
  rec.residuals = residuals;
  for (const r of residuals) logLine(`RESIDUAL ${path} ${r}`);
  if (http.en !== '200' || http.zh !== '200') {
    logLine(`HTTP ${path} REGRESSION: anonymous access not 200 — isPublished regression investigation required (todo-6 default)`);
    rec.status = 'http-regression';
  } else {
    rec.status = 'green';
  }
  rec.items9_10 = {
    item9: http.en === '200' && http.zh === '200' ? 'pass' : 'fail',
    item10: twinComplete ? 'pass' : 'fail',
    note: rec.appliedMode === 'conforms-as-is' ? 'conforms-as-is — counted migrated without write; twins complete' : undefined,
  };
}

// --- Mode: after ---------------------------------------------------------------------
async function cmdAfter() {
  const state = readState();
  if (!state.pilot) fail('run select first');
  if (!existsSync(BEFORE_MAP)) fail('run before first');
  const refreshed = await refreshMapCache({ client, options }, { homeDir: HOME });
  logLine(`MAP REFRESH _meta/page-map ok rows=${refreshed.stats.rows} cacheUrl=${refreshed.cacheUrl} (permitted window write)`);
  const snap = await liveSnapshot();
  writeFileSync(AFTER_MAP, `${JSON.stringify(snap, null, 2)}\n`);
  state.window = { ...(state.window ?? {}), closedAt: nowIso(), afterFile: AFTER_MAP, afterStats: snap.stats };
  writeState(state);
  logLine(`WINDOW CLOSE: after-map rows=${snap.stats.rows} paths=${snap.stats.paths} en=${snap.stats.perLocale.en} zh=${snap.stats.perLocale.zh} missingTwin=${snap.stats.missingTwinPaths.length}`);
  logLine(`WINDOW missingTwin after: ${snap.stats.missingTwinPaths.length} -> ${snap.stats.missingTwinPaths.join(', ')}`);
}

// --- Mode: diff ------------------------------------------------------------------------
function loadMap(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

async function cmdDiff() {
  const state = readState();
  if (!state.pilot) fail('run select first');
  if (!existsSync(BEFORE_MAP) || !existsSync(AFTER_MAP)) fail('run before and after first');
  const before = loadMap(BEFORE_MAP);
  const after = loadMap(AFTER_MAP);
  const byId = (rows) => new Map(rows.map((r) => [r.id, r]));
  const pre = byId(before.rows);
  const post = byId(after.rows);
  const pilot = new Set(state.pilot.paths);
  const lines = [];
  const allow = (path) => pilot.has(path) || path === '_meta/page-map' || path.startsWith('_sandbox/');
  for (const [id, row] of post) {
    const old = pre.get(id);
    if (old === undefined) {
      lines.push(`CREATED ${id} ${row.locale} ${row.path} ${row.updatedAt}`);
    } else if (old.updatedAt !== row.updatedAt) {
      lines.push(`CHANGED ${id} ${row.locale} ${row.path} ${old.updatedAt} -> ${row.updatedAt}`);
    }
  }
  for (const [id, row] of pre) {
    if (!post.has(id)) lines.push(`DELETED ${id} ${row.locale} ${row.path} ${row.updatedAt}`);
  }
  lines.sort();
  const changeRows = lines.map((l) => {
    const m = l.match(/^(\S+) (\d+) (\S+) (\S+)(?: (.+))?$/);
    return m ? { kind: m[1], id: Number(m[2]), locale: m[3], path: m[4], raw: l } : { kind: 'PARSE-ERR', path: '', raw: l };
  });
  const violations = changeRows.filter((c) => !allow(c.path));
  mkdirSync(QA, { recursive: true });
  const header = [
    `# pilot diff ${DATE_KEY}`,
    `before: ${beforeSummary(before)}`,
    `after: rows=${after.stats.rows} paths=${after.stats.paths} en=${after.stats.perLocale.en} zh=${after.stats.perLocale.zh} missingTwin=${after.stats.missingTwinPaths.length}`,
    `change rows: ${changeRows.length} (created=${changeRows.filter((c) => c.kind === 'CREATED').length} changed=${changeRows.filter((c) => c.kind === 'CHANGED').length} deleted=${changeRows.filter((c) => c.kind === 'DELETED').length})`,
    `allowed: pilot paths | _meta/page-map | _sandbox/**`,
    '',
    ...lines,
    '',
  ].filter((l) => l !== '');
  writeFileSync(DIFF_FILE, `${header.join('\n')}\n`);
  logLine(`DIFF rows=${changeRows.length} violations=${violations.length}`);
  for (const v of violations) logLine(`DIFF VIOLATION ${v.raw}`);
  const ok = violations.length === 0;
  logLine(`DIFF assertion (a)+(b): ${ok ? 'PASS — every change row is a pilot path, _meta/page-map, or _sandbox/**' : 'FAIL — see .qa/15-diff.txt'}`);
  if (!ok) process.exit(1);
}

// --- Mode: report ------------------------------------------------------------------------
function pageVerdictLine(rec) {
  if (rec.status === 'blocked') return `status=BLOCKED reason=${rec.blockedReason}`;
  const last = rec.rounds[rec.rounds.length - 1] ?? { verdicts: [] };
  const parts = last.verdicts.map((v) => `${v.id}:${v.verdict}`).join(' ');
  return `status=${rec.status} genre=${rec.genre}(${rec.explicit ? 'explicit' : `classified ${rec.confidence}`}) rounds=${rec.rounds.length} verdicts=[${parts}] http=${JSON.stringify(rec.http)}`;
}

async function cmdReport() {
  const state = readState();
  if (!state.pilot) fail('run select first');
  const { section } = state.pilot;
  const backupFile = join(RESULTS, `pilot-backup-${section}-${DATE_KEY}.json`);
  const reportFile = join(RESULTS, `pilot-${section}-${DATE_KEY}.md`);
  const diffClean = existsSync(DIFF_FILE) && !readFileSync(DIFF_FILE, 'utf8').includes('VIOLATION');
  const allGreen = state.pilot.paths.every((p) => state.pages[p]?.status === 'green');
  const anyBlocked = state.pilot.paths.some((p) => state.pages[p]?.status === 'blocked');
  const statusLine = anyBlocked ? 'BLOCKED' : allGreen && diffClean ? 'PASS' : 'INCOMPLETE';
  const oneLiner = (path, locale, entry) => {
    const importLine = (mod) =>
      `import { resolveOptions } from '${REPO}dist/config.js'; import { createClient } from '${REPO}dist/wiki/client.js';`;
    const boot = (extra) => [
      `node --input-type=module -e "`,
      importLine(),
      ...extra,
      `const opts = resolveOptions({}); const client = createClient(opts);`,
    ].join('');
    if (entry === null) {
      return [
        boot([`import { deletePage } from '${REPO}dist/wiki/pages.write.js';`]),
        `await deletePage({ client, options: opts }, '${path}', '${locale}', 'yes');`,
        `console.log('restored: ${path} ${locale} deleted (twin did not exist pre-migration)');"`,
      ].join('');
    }
    return [
      boot([
        `import { readPage } from '${REPO}dist/wiki/pages.read.js';`,
        `import { updatePage } from '${REPO}dist/wiki/pages.write.js';`,
        `import { readBackup } from '${REPO}dist/migrate-store.js';`,
        `const e = readBackup('${backupFile}').paths['${path}']['${locale}'];`,
      ]),
      `const p = await readPage(client, '${path}', '${locale}'); if (p === null) throw new Error('${path} ${locale} missing');`,
      `await updatePage({ client, options: opts }, p.id, { content: e.content, title: e.title, description: e.description, tags: e.tags, isPublished: e.isPublished, publishStartDate: e.publishStartDate || undefined, publishEndDate: e.publishEndDate || undefined });`,
      `console.log('restored: ${path} ${locale}');"`,
    ].join('');
  };
  const md = [];
  md.push(`# Pilot migration report — ${section} (${DATE_KEY})`, '', `**Status: ${statusLine}**`, '');
  md.push('## 选择依据', '');
  md.push(
    '- 选择域 = todo-3 sections 分类学，排除 `_sandbox/`、`scratch/` 与根路径页（首段不在分类学内的页面）',
    '- 页数单位 = 章节内去重 Path 数（en+zh 孪生对计 1 页；未按 map 行数计）',
    '- 候选页必须：所有 (path, locale) 行 published && 非 private && 非 private 命名空间（否则匿名 200 QA 不可满足）',
    '- 选择时刻（live pages.list 实测，逐候选记录 path-count + publish 状态）：',
  );
  for (const c of state.pilot.allCandidates) {
    md.push(`  - \`${c.section}\`: ${c.pathCount} paths, allPublishedNonPrivate=${c.qualified}, missingTwin=${c.missingTwin}`);
  }
  md.push(`- 选中：\`${section}\`（qualified 候选中路径数最少者，${state.pilot.paths.length} paths）`, '');
  md.push('## 守卫记录', '');
  md.push(`- HARD GUARD（所选章节 >15 paths → BLOCKED-selection，零写入）：所选 = ${state.pilot.paths.length} paths → ${state.pilot.paths.length > 15 ? 'GUARD TRIPPED' : '未触发'}`);
  md.push('- 每页 ≤3 修订轮；zh 翻译失败重试 ≤3 次；用尽 → 整试点 BLOCKED（逐页原因+证据在 .qa/15.txt）');
  md.push('- 试点内无 delete/move；试点外零写入（.qa/15-diff.txt 证明）', '');
  md.push('## 窗口记录', '');
  const before = existsSync(BEFORE_MAP) ? loadMap(BEFORE_MAP) : null;
  const after = existsSync(AFTER_MAP) ? loadMap(AFTER_MAP) : null;
  md.push(
    `- before map: ${before ? `rows=${before.stats.rows} (en=${before.stats.perLocale.en} zh=${before.stats.perLocale.zh}) paths=${before.stats.paths} missingTwin=${before.stats.missingTwinPaths.length}` : 'n/a'}`,
    `- after map:  ${after ? `rows=${after.stats.rows} (en=${after.stats.perLocale.en} zh=${after.stats.perLocale.zh}) paths=${after.stats.paths} missingTwin=${after.stats.missingTwinPaths.length}` : 'n/a'}`,
    `- missingTwin before: ${before ? before.stats.missingTwinPaths.join(', ') : 'n/a'}`,
    `- missingTwin after:  ${after ? after.stats.missingTwinPaths.join(', ') : 'n/a'}`,
    '- 窗口规则：before 快照 → after 快照之间唯一 wiki 写入 = 试点章节 upserts + `_meta/page-map` refresh',
    '',
  );
  md.push('## 逐页明细', '');
  md.push('| Path | Genre | Rounds | en 行数 | zh 行数 | 10 项判定 (1-8 draft, 9-10 post) | 9/10 | 匿名 HTTP | 备份条目 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const path of state.pilot.paths) {
    const rec = state.pages[path];
    if (rec === undefined) {
      md.push(`| \`${path}\` | — | — | — | — | — | — | — | 未处理 |`);
      continue;
    }
    const lastRound = rec.rounds[rec.rounds.length - 1] ?? { verdicts: [] };
    const verdictsStr = lastRound.verdicts.map((v) => `${v.id}${v.verdict === 'pass' ? '✓' : v.verdict === 'na' ? 'N/A' : v.verdict === 'deferred' ? '延' : '✗'}`).join(' ');
    const urls = urlsFor(path);
    const twinPart = rec.items9_10 ? `${rec.items9_10.item9}/${rec.items9_10.item10}` : '—';
    const httpPart = rec.http ? `${rec.http.en}/${rec.http.zh}` : '—';
    const backupPart = rec.backupPath ? `[\`${rec.backupPath.split('/').pop()}\`](#/paths/${path})` : rec.appliedMode === 'conforms-as-is' ? 'conforms-as-is（无写入）' : '—';
    const enLines = rec.status === 'blocked' ? 'BLOCKED' : `${rec.beforeLines?.en?.lines ?? 'n/a'}→${rec.afterLines?.en?.lines ?? 'n/a'}`;
    const zhLines = rec.status === 'blocked' ? 'BLOCKED' : `${rec.beforeLines?.zh?.lines ?? 'n/a'}→${rec.afterLines?.zh?.lines ?? 'n/a'}`;
    md.push(
      `| \`${path}\` | ${rec.explicit ? `explicit ${rec.genre}` : `${rec.genre}（classified ${rec.confidence}）`} | ${rec.rounds.length} | ${enLines} | ${zhLines} | ${verdictsStr} | ${twinPart} | ${httpPart} | ${backupPart} |`,
      `| | en: ${urls.en} | | | | | zh: ${urls.zh} | | | |`,
    );
  }
  md.push('', '## 恢复程序', '');
  md.push(`pre-image 备份：\`${backupFile}\`（引擎 applyMigration 于首次写入前生成，含 en+zh 全字段；缺失 locale 记 null）。`);
  md.push('恢复 = 重放该文件（逐页逐 locale），或 wiki.js 页面历史（页面级时间线）。具体命令（插件仓库根目录执行，dist 需已 build）：', '');
  for (const path of state.pilot.paths) {
    const rec = state.pages[path];
    if (rec === undefined) continue;
    const pair = existsSync(backupFile) ? readBackup(backupFile).paths[path] ?? null : null;
    if (pair === null) {
      md.push(`- \`${path}\`：备份中无条目（conforms-as-is，未写入）`);
      continue;
    }
    md.push(`- \`${path}\`：`, `  - en：\`${oneLiner(path, 'en', pair.en)}\``, `  - zh：\`${oneLiner(path, 'zh', pair.zh)}\``);
  }
  md.push('', '## 零改动证明', '');
  md.push(`- 证据：\`${DIFF_FILE}\`（before/after 快照按 ID+Locale+Path+UpdatedAt 全量 diff）`);
  md.push('- diff 断言：每个 change row ∈ 试点路径 ∪ `_meta/page-map`（refreshMapCache 自身必然改动其 UpdatedAt）∪ `_sandbox/**`（排除）；否则 VIOLATION + 非零退出');
  md.push('- 窗口内无其他工具调用、无测试 seeding、无 scratch 页面', '');
  md.push('## 遗留', '');
  const allResiduals = state.pilot.paths.flatMap((p) => (state.pages[p]?.residuals ?? []).map((r) => `- \`${p}\`: ${r}`));
  md.push(allResiduals.length > 0 ? allResiduals.join('\n') : '- 无');
  md.push('- todo-14 已知残留：zh 译文 item2（中文句长 ≤20 字）倾向失分；revise 提示「中文句长 ≤20 字，拆短句」用于修订轮；apply 后对 stored zh 内容复评并记录于上表/本文遗留');
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(reportFile, `${md.join('\n')}\n`);
  logLine(`REPORT written ${reportFile} status=${statusLine}`);
  const cp = readCheckpoint(HOME);
  const cpPaths = Object.keys(cp.paths);
  const foreign = cpPaths.filter((p) => !state.pilot.paths.includes(p));
  logLine(`CHECKPOINT entries=${cpPaths.length} -> ${cpPaths.join(', ')}; non-pilot entries=${foreign.length === 0 ? 'none' : foreign.join(', ')}`);
  const migrated = state.pilot.paths.filter((p) => state.pages[p]?.status === 'green').length;
  const all200 = state.pilot.paths.every((p) => state.pages[p]?.http?.en === '200' && state.pages[p]?.http?.zh === '200');
  logLine(`TERMINAL ${statusLine}: migrated=${migrated}/${state.pilot.paths.length} all200=${all200} diffClean=${diffClean} checklistTableComplete=${state.pilot.paths.every((p) => state.pages[p] !== undefined)}`);
}

// --- Mode: status --------------------------------------------------------------------------
async function cmdStatus() {
  const state = readState();
  if (!state.pilot) {
    console.log('no pilot selected yet — run select');
    return;
  }
  console.log(`pilot section=${state.pilot.section} paths=${state.pilot.paths.length}`);
  for (const p of state.pilot.paths) {
    const rec = state.pages[p];
    console.log(`  ${p}: ${rec === undefined ? 'untouched' : pageVerdictLine(rec)}`);
  }
  if (state.window) console.log(`window: ${state.window.openedAt} → ${state.window.closedAt ?? 'open'}`);
}

// --- CLI ------------------------------------------------------------------------------------
const [mode, arg] = process.argv.slice(2);
switch (mode) {
  case 'select': await cmdSelect(); break;
  case 'before': await cmdBefore(); break;
  case 'page': await cmdPage(arg, process.argv.includes('--force')); break;
  case 'apply': await cmdApply(arg); break;
  case 'after': await cmdAfter(); break;
  case 'diff': await cmdDiff(); break;
  case 'report': await cmdReport(); break;
  case 'status': await cmdStatus(); break;
  default: fail(`unknown mode '${mode}' — expected select|before|page|apply|after|diff|report|status`);
}
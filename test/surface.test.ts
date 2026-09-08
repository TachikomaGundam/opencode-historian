import { describe, expect, it } from 'vitest';
import { buildSurfaceReport, renderSurfaceMarkdown, type LiveRow } from '../src/surface.js';
import type { MaintainRow } from '../src/maintain.js';

const BASE_URL = 'http://localhost:3000';

function mkRow(path: string, locale: 'en' | 'zh', title: string, tags: readonly string[] = ['x']): MaintainRow {
  return { id: 1, locale, path, title, updatedAt: '2026-09-07T00:00:00Z', url: `${BASE_URL}/${path}`, twinUrl: null, twinId: null, tags };
}

const LONG = '这是一段足够长的导言说明覆盖系统分层与调用链路以及本页适用范围与边界条件的详细中文描述内容确保超过权重阈值四十。';

const INDEX_EN = `# Wiki Index\n\n${LONG}\n\n## 台账\n- [服务](/infra/services)\n- [网络](/infra/network)\n- [断链制造者](/infra/broken-linker)\n- [存根](/infra/dead-stub)\n- [簇](/llm-eval/cluster)\n- [双生](/infra/twin)\n- [台账风险](/ops/twin)\n- [英文zh](/ops/english-zh)\n\n## 相关页面\n- [首页](/home)`;
const INDEX_ZH = `# 索引\n\n${LONG}\n\n## 台账\n- [服务](/zh/infra/services)\n- [网络](/zh/infra/network)\n- [双生](/zh/infra/twin)\n- [存根](/zh/llm-eval/dup)\n- [簇](/zh/llm-eval/cluster)\n- [英文zh](/zh/ops/english-zh)\n- [台账风险](/zh/ops/twin)\n- [断链制造者](/zh/infra/broken-linker)`;

const SERVICES_EN = `# Services Ledger\n\n**状态/Status**: Active · **日期/Date**: 2026-09-07\n\n${LONG}\n\n## 服务清单\n网关与认证与数据四层服务运行状态说明文字。\n\n## 相关页面\n- [索引](/wiki-index)`;
const NETWORK_EN = `# Network\n\n${LONG}\n\n正文说明网络拓扑与端口规划内容足够长度的中文描述文字说明。\n\n## 相关页面\n- [索引](/wiki-index)`;
const BROKEN_LINKER = `# Broken Linker\n\n${LONG}\n\n参见 [幽灵页](/infra/does-not-exist) 与 [存根页](/infra/dead-stub)。\n\n## 相关页面\n- [索引](/wiki-index)`;
const DEAD_STUB = `# Dead Stub\n\n> Redirect: ${BASE_URL}/en/infra/gone\n`;
const DUP_STUB_EN = `# Dup Stub\n\n> Redirect: ${BASE_URL}/en/llm-eval/dup-canonical\n<!-- [旧链接](/llm-eval/dup-canonical) -->\n`;
const DUP_LIVE_ZH = `# 重复页\n\n${LONG}\n\n## 相关页面\n- [索引](/zh/wiki-index)`;
const CLUSTER_EN = `# Cluster\n\n${LONG}\n\n[说法一](/wiki-index)\n\n[说法二](/wiki-index)\n\n[说法三](/wiki-index)\n\n## 相关页面\n- [索引](/wiki-index)`;
const TWIN_EN = `# Twin Page English Side\n\n${LONG}\n\n${LONG}\n\n${LONG}\n\n## Section Alpha\n内容甲。\n## Section Beta\n内容乙。\n## Related Pages\n- [Index](/wiki-index)`;
const TWIN_ZH = `# 双生中文侧\n\n短。\n\n## 相关页面\n- [索引](/zh/wiki-index)`;
const ENGLISH_ZH = `# English Dominant zh Page\n\n${'This Chinese-labelled page body is written almost entirely in English prose with many sentences and paragraphs which makes it violate the zh-first policy of this wiki. '.repeat(9)}\n\n## Related Pages\n- [Index](/zh/wiki-index)`;
const LEDGER_BODY = `# 服务台账 当前状态\n\n**状态/Status**: Active · **日期/Date**: 2026-09-01\n\n${LONG}\n\n## 端口\n:3000、:8000、:11434、:8443 端口分工说明。\ncurl http://localhost:3000/api && systemctl status docker && ls /opt/services/docker-compose.yml /etc/caddy/Caddyfile\n\n## 相关页面\n- [索引](/wiki-index)`;
const ORPHAN = `# Orphan Page\n\n${LONG}\n\n孤立页面没有任何入链除了自身。\n\n## 相关页面\n- [索引](/wiki-index)`;
const HOME_EN = `# Home\n\n${LONG}\n\n## 相关页面\n- [索引](/wiki-index)`;
const SKELETON = `# Wrong Title H1\n\n**状态/Status**: Active\n\n${LONG}\n\nTODO: 补齐端口表\n\n## 硬件清单\n\n## 相关页面\n- [索引](/wiki-index)`;
const CJK_TWIN_EN = `# CJK Faithful Twin EN\n\n${LONG}\n\n${LONG}\n\n## Section Alpha\nEnglish body sentence alpha carries the full explanation of the layer composition and the request path details end to end.\n## Section Beta\nEnglish body sentence beta with boundary conditions failure handling and the verification commands described inline per row.\n## Section Gamma\nEnglish body gamma notes the trade offs and the exceptions observed during the live scan incident window earlier this week.\n## Section Delta\nEnglish body delta wraps up cross references to the ledger the runbook and the postmortem appendix table rows below.\n## Related Pages\n- [Index](/wiki-index)`;
const CJK_TWIN_ZH = `# 双生忠实中文版\n\n本页用于验证跨脚本的长度加权判据，中文版忠实翻译英文结构且小节数量完全一致。\n\n## 甲节\n分层组成与请求链路的完整说明，逐段对齐英文原文。\n## 乙节\n边界条件、失败处置与每行对应的验证命令说明。\n## 丙节\n本周扫描事故窗口内观察到的取舍与例外记录。\n## 丁节\n指向台账、手册与复盘附录表格的交叉引用。\n## 相关页面\n- [索引](/zh/wiki-index)`;

const bodies = new Map<string, string>([
  ['en\u0000wiki-index', INDEX_EN], ['zh\u0000wiki-index', INDEX_ZH],
  ['en\u0000infra/services', SERVICES_EN], ['en\u0000infra/network', NETWORK_EN], ['zh\u0000infra/network', NETWORK_EN.replace(/\/wiki-index/g, '/zh/wiki-index')],
  ['en\u0000infra/broken-linker', BROKEN_LINKER], ['zh\u0000infra/broken-linker', BROKEN_LINKER.replace(/\/wiki-index/g, '/zh/wiki-index')],
  ['en\u0000infra/dead-stub', DEAD_STUB],
  ['en\u0000llm-eval/dup', DUP_STUB_EN], ['zh\u0000llm-eval/dup', DUP_LIVE_ZH],
  ['en\u0000llm-eval/cluster', CLUSTER_EN],
  ['en\u0000infra/twin', TWIN_EN], ['zh\u0000infra/twin', TWIN_ZH],
  ['en\u0000infra/cjk-twin', CJK_TWIN_EN], ['zh\u0000infra/cjk-twin', CJK_TWIN_ZH],
  ['zh\u0000ops/english-zh', ENGLISH_ZH],
  ['en\u0000ops/twin', LEDGER_BODY], ['zh\u0000ops/twin', `${LEDGER_BODY}\n上次核实于 2026-09-07。\n`],
  ['en\u0000infra/orphan', ORPHAN], ['zh\u0000infra/orphan', ORPHAN.replace(/\/wiki-index/g, '/zh/wiki-index')],
  ['en\u0000infra/skeleton', SKELETON],
  ['en\u0000home', HOME_EN],
  ['en\u0000_sandbox/probe', '# probe\n\nsandbox body 内容。'], ['zh\u0000_sandbox/probe', '# probe\n\nsandbox body 内容。'],
]);

const readBody = async (path: string, locale: 'en' | 'zh'): Promise<string | null> =>
  bodies.get(`${locale}\u0000${path}`) ?? null;

const rows: MaintainRow[] = [
  mkRow('wiki-index', 'en', 'Wiki Index'), mkRow('wiki-index', 'zh', '索引'),
  mkRow('home', 'en', 'Home'),
  mkRow('infra/services', 'en', 'Services Ledger', []),
  mkRow('infra/network', 'en', 'Network'), mkRow('infra/network', 'zh', '网络'),
  mkRow('infra/broken-linker', 'en', 'Broken Linker'), mkRow('infra/broken-linker', 'zh', '断链制造者'),
  mkRow('infra/dead-stub', 'en', 'Dead Stub'),
  mkRow('llm-eval/dup', 'en', 'Dup Stub'), mkRow('llm-eval/dup', 'zh', '重复页'),
  mkRow('llm-eval/cluster', 'en', 'Cluster'),
  mkRow('infra/twin', 'en', 'Twin Page'), mkRow('infra/twin', 'zh', '双生页'),
  mkRow('infra/cjk-twin', 'en', 'CJK Twin EN'), mkRow('infra/cjk-twin', 'zh', 'CJK 双生页'),
  mkRow('ops/english-zh', 'zh', 'English Dominant zh Page'),
  mkRow('ops/twin', 'en', '服务台账 当前状态'), mkRow('ops/twin', 'zh', '服务台账 当前状态'),
  mkRow('infra/orphan', 'en', 'Orphan Page'), mkRow('infra/orphan', 'zh', '孤立页'),
  mkRow('infra/skeleton', 'en', 'Infra Skeleton'),
  mkRow('_meta/page-map', 'en', 'Page Map', []),
  mkRow('_sandbox/probe', 'en', 'probe', []), mkRow('_sandbox/probe', 'zh', 'probe', []),
];

const live: LiveRow[] = [
  ...rows.map((r) => ({ path: r.path, locale: r.locale })),
  { path: 'opencode/brand-new', locale: 'en' },
  { path: 'infra/private-secret', locale: 'en', isPublished: false },
];

describe('buildSurfaceReport — light tier', () => {
  it('detects coverage gaps, machine nav sections, missing landings, empty tags', async () => {
    const r = await buildSurfaceReport({ rows, generatedAt: '2026-09-07T00:00:00Z', baseUrl: BASE_URL, liveInventory: live });
    expect(r.coverage?.missingFromMap).toEqual([{ path: 'opencode/brand-new', locale: 'en' }]);
    expect(r.coverage?.removedFromLive).toBe(0);
    expect(r.nav.available).toBe(false); // no nav injected = unverifiable, NOT clean
    expect(r.nav.mode).toBeNull();
    expect(r.nav.filesystemExposed).toBe(false);
    expect(r.nav.machinePaths).toEqual(['_meta', '_sandbox']);
    expect(r.nav.sectionLandingMissing.map((s) => s.dir)).toEqual(expect.arrayContaining(['infra', 'ops', 'llm-eval']));
    expect(r.nav.sectionLandingMissing.find((s) => s.dir === 'infra')?.pagePaths).toBeGreaterThanOrEqual(2);
    expect(r.tagsEmpty).toContainEqual({ path: 'infra/services', locale: 'en' });
    expect(r.tagsEmpty.some((t) => t.path.startsWith('_'))).toBe(false);
    expect(r.deepReport).toBeNull();
  });
});

describe('buildSurfaceReport — nav truth table (v0.5.1)', () => {
  const clean = { mode: 'STATIC', trees: [{ locale: 'en', items: [{ label: 'Wiki', targetType: 'page', target: '/wiki-index' }] }] };
  it('STATIC curated nav without machine links is clean', async () => {
    const r = await buildSurfaceReport({ rows, generatedAt: 'x', baseUrl: BASE_URL, nav: clean });
    expect(r.nav.available).toBe(true);
    expect(r.nav.filesystemExposed).toBe(false);
    expect(r.nav.machineLinks).toEqual([]);
  });
  it('DYNAMIC or MIXED mode = filesystem mirrored into the sidebar (Issue #1 relapse)', async () => {
    for (const mode of ['DYNAMIC', 'MIXED']) {
      const r = await buildSurfaceReport({ rows, generatedAt: 'x', baseUrl: BASE_URL, nav: { ...clean, mode } });
      expect(r.nav.filesystemExposed).toBe(true);
    }
  });
  it('flags machine-namespace links mounted in the tree, with or without locale prefix', async () => {
    const r = await buildSurfaceReport({
      rows,
      generatedAt: 'x',
      baseUrl: BASE_URL,
      nav: { mode: 'STATIC', trees: [
        { locale: 'en', items: [
          { label: 'Sandbox', targetType: 'page', target: '/_sandbox/probe' },
          { label: '证据', targetType: 'url', target: '/zh/_evidence/x' },
          { label: 'Ok', targetType: 'page', target: '/infra/wiki' },
        ] },
      ] },
    });
    expect(r.nav.machineLinks).toEqual([
      { locale: 'en', label: 'Sandbox', target: '/_sandbox/probe' },
      { locale: 'en', label: '证据', target: '/zh/_evidence/x' },
    ]);
  });
});

describe('buildSurfaceReport — deep tier', () => {
  const run = async () =>
    buildSurfaceReport({ rows, generatedAt: '2026-09-07T00:00:00Z', baseUrl: BASE_URL, liveInventory: live, deep: true, readBody });

  it('flags dead redirect stub without clickable exit and dead target (#5.1)', async () => {
    const d = (await run()).deepReport!;
    const dead = d.stubs.find((s) => s.path === 'infra/dead-stub')!;
    expect(dead.clickable).toBe(false);
    expect(dead.targetLive).toBe(false);
    const dup = d.stubs.find((s) => s.path === 'llm-eval/dup')!;
    expect(dup.clickable).toBe(false); // only a commented-out link exists
  });

  it('reports role divergence between locales (#5.4)', async () => {
    const d = (await run()).deepReport!;
    expect(d.roleDivergence).toContainEqual({ path: 'llm-eval/dup', stubIn: 'en', liveIn: 'zh' });
  });

  it('finds broken links, stub-pointing links, 3+ anchor stacks, orphans, index misses (#5.2/#5.3/#6.6)', async () => {
    const d = (await run()).deepReport!;
    expect(d.links.broken).toContainEqual({ from: 'infra/broken-linker', locale: 'en', target: 'infra/does-not-exist' });
    expect(d.links.toStubs.some((l) => l.target === 'infra/dead-stub')).toBe(true);
    const stack = d.links.sameTargetStacks.find((s) => s.from === 'llm-eval/cluster')!;
    expect(stack).toMatchObject({ target: 'wiki-index', texts: 4 });
    expect(d.links.orphanPages).toContain('infra/orphan');
    expect(d.links.orphanPages).toContain('infra/skeleton');
    expect(d.links.orphanPages).not.toContain('home');
    expect(d.links.orphanPages).not.toContain('_sandbox/probe');
    expect(d.links.orphanPages).not.toContain('infra/services');
    expect(d.links.indexMissing).toContain('infra/orphan');
    expect(d.links.indexMissing).not.toContain('infra/services');
    expect(d.links.indexMissing).not.toContain('infra/dead-stub');
  });

  it('lists unfinished skeletons with fake-Active and h1 mismatch (#6.1/#6.5/#6.9)', async () => {
    const d = (await run()).deepReport!;
    const u = d.unfinished.find((x) => x.path === 'infra/skeleton')!;
    expect(u).toMatchObject({ todo: 1, introEmpty: false, active: true, h1Mismatch: true });
    expect(u.emptySections).toEqual(['硬件清单']);
    expect(d.unfinished.find((x) => x.path === 'infra/services')).toBeUndefined();
  });

  it('flags twin parity divergence + zh-english-dominant (#6.15/#6.16)', async () => {
    const d = (await run()).deepReport!;
    const twin = d.twinParity.find((t) => t.path === 'infra/twin')!;
    expect(twin.divergent).toBe(true);
    expect(d.twinParity.find((t) => t.path === 'ops/twin')?.divergent).toBe(false);
    const cjk = d.twinParity.find((t) => t.path === 'infra/cjk-twin')!;
    expect(cjk.divergent).toBe(false);
    expect(cjk.lenRatio).toBeGreaterThanOrEqual(0.5);
    expect(d.zhEnglishDominant.map((z) => z.path)).toContain('ops/english-zh');
  });

  it('surfaces un-stamped machine-fact ledgers (#6.8)', async () => {
    const d = (await run()).deepReport!;
    const claim = d.ledgerClaims.find((c) => c.path === 'ops/twin' && c.locale === 'en')!;
    expect(claim).toBeDefined();
    expect(claim.ports).toBeGreaterThanOrEqual(3);
    expect(d.ledgerClaims.some((c) => c.path === 'ops/twin' && c.locale === 'zh')).toBe(false);
  });

  it('renderSurfaceMarkdown emits zh-first headers + JSON tail', async () => {
    const md = renderSurfaceMarkdown(await run());
    expect(md).toContain('界面健康 Surface Report (deep)');
    expect(md).toContain('断链 broken');
    expect(md).toContain('"schema": "historian.surface.v1"');
  });
});

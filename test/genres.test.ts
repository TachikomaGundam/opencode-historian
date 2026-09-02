import { describe, it, expect } from 'vitest';
import {
  GENRES,
  G1_ZH,
  classifyGenre,
  genreSkeleton,
  selfReviewChecklist,
} from '../src/templates/genres.js';
import { scoreChecklist } from '../src/migrate-score.js';
import type { Genre, Confidence, ClassifyInput } from '../src/templates/genres.js';

// Unit surface of the todo-9 page-genre system: bilingual G1–G5 skeletons (the
// harness rubric-C anatomy + wiki.js expression pieces), deterministic genre
// classification, and the 10-item self-review gate. Everything is pure string
// logic — no network, no fs, no time.

const LANGS = ['en', 'zh'] as const;

// --- classifyGenre: 19 deterministic cases + 7 corpus regressions ------------

interface ClassifyCase {
  name: string;
  input: ClassifyInput;
  genre: Genre;
  confidence: Confidence;
  /** Signals must equal exactly this list, when provided. */
  expectSignals?: readonly string[];
  /** Signals must contain each of these cues, when provided. */
  expectSignalsContain?: readonly string[];
}

const BODY_HUGE = 200_100; // > 200_000 truncation guard

const CLASSIFY_CASES: readonly ClassifyCase[] = [
  // G1 × 3 (zh / en / mixed)
  {
    name: 'G1 zh title 故障复盘',
    input: { title: '线上故障复盘', body: '页面加载失败，5 分钟恢复，时间线见日志。' },
    genre: 'G1',
    confidence: 'high',
  },
  {
    name: 'G1 en postmortem+outage in title',
    input: { title: 'Postmortem: search outage 2026-09-01', body: 'impact, root cause, action items' },
    genre: 'G1',
    confidence: 'high',
  },
  {
    name: 'G1 mixed en title + zh body cues',
    input: { title: 'Incident Report', body: '故障详情与复盘记录。' },
    genre: 'G1',
    confidence: 'high',
  },
  // G2 × 3 (zh / en / single body cue)
  {
    name: 'G2 zh title 对比选型',
    input: { title: 'RAG 方案对比选型', body: '维度：延迟、成本、准确性。' },
    genre: 'G2',
    confidence: 'high',
  },
  {
    name: 'G2 en vs+benchmark in title',
    input: { title: 'Kafka vs Pulsar benchmark', body: 'compare latency and throughput; alternatives evaluated' },
    genre: 'G2',
    confidence: 'high',
  },
  {
    name: 'G2 single body cue → medium',
    input: { title: '脑暴记录', body: '饭后对比了两种部署方式。' },
    genre: 'G2',
    confidence: 'medium',
  },
  // G3 × 3 (zh / en / en body checklist)
  {
    name: 'G3 zh title 清单',
    input: { title: '推理服务器部署清单', body: '检查项、命令、验证步骤。' },
    genre: 'G3',
    confidence: 'high',
  },
  {
    name: 'G3 en inventory+catalog in title',
    input: { title: 'LLM 服务 inventory', body: 'catalog of endpoints and configs' },
    genre: 'G3',
    confidence: 'high',
  },
  {
    name: 'G3 zh title 命令速查 + en body checklist',
    input: { title: '常用命令速查', body: 'checklist 式条目，逐行验证。' },
    genre: 'G3',
    confidence: 'high',
  },
  // G4 × 2 (title cue / body cue)
  {
    name: 'G4 zh title 为什么 + body 原理机制',
    input: { title: '为什么 KV cache 能加速生成', body: '原理与机制说明。' },
    genre: 'G4',
    confidence: 'high',
  },
  {
    name: 'G4 single body cue 机制 → medium',
    input: { title: 'RAG 笔记', body: '解释一下核心机制。' },
    genre: 'G4',
    confidence: 'medium',
  },
  // tie → G4 medium
  {
    name: 'tie G1 vs G2 → G4 medium',
    input: { title: 'News', body: 'incident vs trade-off' },
    genre: 'G4',
    confidence: 'medium',
    expectSignalsContain: ['incident', 'vs'],
  },
  // garbage → G4 low, no signals
  {
    name: 'garbage input → G4 low, empty signals',
    input: { title: '周末随笔', body: '今天天气不错，去公园散步。' },
    genre: 'G4',
    confidence: 'low',
    expectSignals: [],
  },
  // huge body guard: cue inside the retained prefix still counts
  {
    name: 'huge body keeps early cue (truncate keeps prefix)',
    input: { title: '压测汇总', body: '复盘' + 'x'.repeat(BODY_HUGE) },
    genre: 'G1',
    confidence: 'medium',
    expectSignalsContain: ['复盘'],
  },
  // huge body guard: cue beyond the cut-off is invisible
  {
    name: 'huge body drops late cue (cue past truncation)',
    input: { title: '汇总', body: 'z'.repeat(BODY_HUGE) + ' 复盘' },
    genre: 'G4',
    confidence: 'low',
  },
  // latin word boundaries: "vs" inside "moves" must not fire
  {
    name: 'latin keyword word boundary (vs in moves)',
    input: { title: 'notes', body: 'the service moves slowly today' },
    genre: 'G4',
    confidence: 'low',
  },
  // G5 × 3 (zh ledger card / en ledger card / single body cue → medium)
  {
    name: 'G5 zh 现状卡 title + deployed-state body',
    input: {
      title: 'team-notes 服务现状卡',
      body: '当前状态：api 已部署，端口 8000，端点 http://example.com:8000/health。上次核实于 2026-09-01。失效策略：版本变更即过期。',
    },
    genre: 'G5',
    confidence: 'high',
    expectSignalsContain: ['现状卡', '端口', '上次核实'],
  },
  {
    name: 'G5 en current state + deployed/last verified',
    input: {
      title: 'LLM serving stack current state',
      body: 'deployed on port 8000; the gateway is running now; last verified 2026-09-01.',
    },
    genre: 'G5',
    confidence: 'high',
    expectSignalsContain: ['current state', 'deployed', 'last verified', 'running now'],
  },
  {
    name: 'G5 single body cue 上线 → medium',
    input: { title: '服务快照', body: '组件已于昨日上线。' },
    genre: 'G5',
    confidence: 'medium',
  },
];

// Harness corpus regression: one fixture per eval scenario 01–07, modeled on
// the scenario material. These pages must keep classifying into their v1
// genres (G1/G2/G3/G4) after G5 joins the vocabulary — every G5 cue was kept
// deployed-state-specific for exactly this reason (no bare 部署/版本).
const CORPUS_CASES: readonly ClassifyCase[] = [
  {
    name: 'corpus 01 new-finding → G4',
    input: {
      title: '推理服务解码调优发现',
      body: '线程数与后端覆盖参数生效后 decode 从 47.4 提到 53.7 tok/s；原因机制尚未定论，可能是变通而非普适原理。',
    },
    genre: 'G4',
    confidence: 'medium',
  },
  {
    name: 'corpus 02 incident → G1',
    input: {
      title: 'Wiki.js 502 事故记录',
      body: '昨夜容器 OOM 重启三次，用户看到 502。根因：搜索后端 JVM heap 无上限。修复：编排文件封顶堆内存。',
    },
    genre: 'G1',
    confidence: 'high',
  },
  {
    name: 'corpus 03 overlap-integration (tuning page update) → G4',
    input: {
      title: 'GPU 推理调优参数与结果',
      body: '覆盖参数的机制说明与结果表；NUMA 绑定降低首 token 延迟，原理见参数表。',
    },
    genre: 'G4',
    confidence: 'medium',
  },
  {
    name: 'corpus 04 organize-mess (curated index) → G3',
    input: { title: '沙盒页面清单', body: 'GPU 风扇曲线重复页合并后的规范入口列表。' },
    genre: 'G3',
    confidence: 'high',
  },
  {
    name: 'corpus 05 worthiness scratch note → G4 low, empty signals',
    input: { title: '今日操作记录', body: '下午重启了一次网盘容器，重启后恢复正常，没有特殊原因。' },
    genre: 'G4',
    confidence: 'low',
    expectSignals: [],
  },
  {
    name: 'corpus 06 incident G1 verbal log → G1',
    input: {
      title: '2026-08-28 wiki 5xx 故障复盘',
      body: '告警机器人连发 6 条 5xx；搜索容器占 14.2GB 无堆上限；恢复后复盘根因为模板删除了 heap 行。',
    },
    genre: 'G1',
    confidence: 'high',
  },
  {
    name: 'corpus 07 CLI one-liner note → G4 low',
    input: {
      title: 'CLI 别名与输出开关备忘',
      body: '加了一个 shortcut 别名，用户反馈不错；JSON 输出在 TTY 下强制 pretty-print 的小 bug。',
    },
    genre: 'G4',
    confidence: 'low',
  },
];

describe('classifyGenre', () => {
  for (const c of [...CLASSIFY_CASES, ...CORPUS_CASES]) {
    it(`${c.name} → ${c.genre}/${c.confidence}`, () => {
      const result = classifyGenre(c.input);
      expect(result.genre).toBe(c.genre);
      expect(result.confidence).toBe(c.confidence);
      if (c.expectSignals !== undefined) {
        expect(result.signals).toEqual(c.expectSignals);
      }
      if (c.expectSignalsContain !== undefined) {
        expect(result.signals).toEqual(expect.arrayContaining(c.expectSignalsContain));
      }
      // Determinism: pure function, no randomness, twice the same answer.
      expect(classifyGenre(c.input)).toEqual(result);
    });
  }
});

// --- genreSkeleton: rubric-C anatomy + wiki.js constraints (8 combos) -------

/** Lines of the skeleton that look like `{.is-...}` class-attribution lines. */
function admonitionLineIndexes(s: string): number[] {
  const idxs: number[] = [];
  s.split('\n').forEach((line, i) => {
    if (line.trimStart().startsWith('{.is-')) idxs.push(i);
  });
  return idxs;
}

describe('genreSkeleton anatomy per genre × lang', () => {
  for (const genre of GENRES) {
    for (const lang of LANGS) {
      it(`${genre} ${lang}: rubric-C anatomy + no forbidden constructs`, () => {
        const s = genreSkeleton(genre, lang);

        // Rubric dimension C: near-top status block with date + lifecycle value.
        expect(s).toContain('**状态/Status**: Active');
        expect(s).toContain('**日期/Date**: YYYY-MM-DD');
        expect(s).toMatch(/Active|Historical|Superseded/);
        expect(s.indexOf('**状态/Status**')).toBeLessThan(500);

        // One-line scope sentence, language-native label.
        expect(s).toContain(lang === 'en' ? '**This page answers:**' : '**本页回答：**');

        // Fixed tail (SYN-9), language-native heading.
        expect(s).toContain(lang === 'en' ? '## Related Pages' : '## 相关页面');

        // wiki.js forbidden constructs: NO {{toc}}, NO ::: containers, NO
        // frontmatter fence at position 0 (renders as body text otherwise).
        expect(s).not.toContain('{{toc}}');
        expect(s).not.toContain('{{');
        expect(s).not.toContain('::');
        expect(s.startsWith('---')).toBe(false);

        // At least one blockquote admonition `> ...` + `{.is-info}` per digest:
        // the attrs line must sit directly under a blockquote line.
        const admonitionIdxs = admonitionLineIndexes(s);
        expect(admonitionIdxs.length).toBeGreaterThanOrEqual(1);
        for (const i of admonitionIdxs) {
          const prev = s.split('\n')[i - 1];
          expect(prev !== undefined && prev.trimStart().startsWith('>')).toBe(true);
        }

        // Information-dense: a real template has ≥ 5 H2 sections.
        expect((s.match(/^## /gm) ?? []).length).toBeGreaterThanOrEqual(5);
      });
    }
  }
});

// --- G1 specifics ------------------------------------------------------------

describe('genreSkeleton G1', () => {
  it('zh: timeline table, 5 Whys, 6-column action table, footnote slot', () => {
    const zh = genreSkeleton('G1', 'zh');
    expect(zh).toContain('| 时间 | 事件 | 来源 |');
    expect(zh).toContain('5 Whys');
    // Digest action-item table: 措施 | 类型 | 负责人 | 期限 | 验证 | 状态
    expect(zh).toContain('| 措施 | 类型 | 负责人 | 期限 | 验证 | 状态 |');
    expect(zh).toContain('[^1]');
  });
  it('en: parallel timeline table, 5 Whys, action table header, footnote slot', () => {
    const en = genreSkeleton('G1', 'en');
    expect(en).toContain('| Time | Event | Source |');
    expect(en).toContain('5 Whys');
    expect(en).toContain('| Action | Type | Owner | Due | Verification | Status |');
    expect(en).toContain('[^1]');
  });
});

// --- G2 specifics ------------------------------------------------------------

describe('genreSkeleton G2', () => {
  it('zh: dimension-definition table + source column, dense comparison table', () => {
    const zh = genreSkeleton('G2', 'zh');
    expect(zh).toContain('| 维度 | 为什么重要 | 数据来源 |');
    expect(zh).toContain('| 来源 |');
    expect(zh).toContain('{.dense}');
  });
  it('en: parallel dimension table and source column', () => {
    const en = genreSkeleton('G2', 'en');
    expect(en).toContain('| Dimension | Why it matters | Data source |');
    expect(en).toContain('| Source |');
  });
});

// --- barrel ------------------------------------------------------------------

describe('genres barrel', () => {
  it('re-exports raw skeleton data from skeletons.ts', () => {
    expect(G1_ZH).toBe(genreSkeleton('G1', 'zh'));
    expect(genreSkeleton('G1', 'en')).not.toBe(G1_ZH);
  });
});

// --- selfReviewChecklist -----------------------------------------------------

describe('selfReviewChecklist', () => {
  it('returns exactly 10 items with contiguous ids 1..10 (any genre)', () => {
    for (const genre of GENRES) {
      const items = selfReviewChecklist(genre);
      expect(items).toHaveLength(10);
      expect(items.map((i) => i.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    }
  });

  it('exactly 2 post-write items (ids 9, 10)', () => {
    const items = selfReviewChecklist('G1');
    const postWrite = items.filter((i) => i.kind === 'post-write');
    expect(postWrite).toHaveLength(2);
    expect(postWrite.map((i) => i.id)).toEqual([9, 10]);
  });

  it('genre-specific gating fields are consistent (content 1-3,7,8 | gs 4→G2, 5-6→G1 | post 9-10)', () => {
    const items = selfReviewChecklist('G1');
    expect(items.filter((i) => i.kind === 'content').map((i) => i.id)).toEqual([1, 2, 3, 7, 8]);
    const genreSpecific = items.filter((i) => i.kind === 'genre-specific');
    expect(genreSpecific.map((i) => i.id)).toEqual([4, 5, 6]);
    // id 4 = 对比表来源列 -> G2 pages only; ids 5/6 = 时间线来源/行动项五要素 -> G1 pages only.
    expect(items[3].appliesTo).toEqual(['G2']);
    expect(items[4].appliesTo).toEqual(['G1']);
    expect(items[5].appliesTo).toEqual(['G1']);
    for (const item of items) {
      expect(item.label.length).toBeGreaterThan(10);
      expect(['content', 'post-write', 'genre-specific']).toContain(item.kind);
      if (item.kind === 'genre-specific') {
        expect(Array.isArray(item.appliesTo)).toBe(true);
        for (const g of item.appliesTo as readonly Genre[]) {
          expect(GENRES).toContain(g);
        }
        expect((item.appliesTo as readonly Genre[]).length).toBeGreaterThan(0);
      } else {
        expect(item.appliesTo).toBe('all');
      }
    }
  });

  it('rejects an unknown genre instead of returning a partial gate', () => {
    expect(() => selfReviewChecklist('G9' as Genre)).toThrow(/unknown genre/);
  });
});

// --- G5 current-state ledger ---------------------------------------------------

describe('genreSkeleton G5', () => {
  it('zh: ledger tables with per-row last-verified, verification commands, change log, invalidation policy', () => {
    const zh = genreSkeleton('G5', 'zh');
    expect(zh).toContain('| 组件 | 版本 | 端口/路径 | 端点 | 依赖 | 上次核实于 |');
    expect(zh).toContain('## 部署物清单');
    expect(zh).toContain('## 依赖与集成');
    expect(zh).toContain('## 失效策略');
    expect(zh).toContain('## 验证方法');
    expect(zh).toContain('`curl -s http://example.com:8000/health`');
    expect(zh).toContain('| 日期 | 变更 | 依据 |');
    // Machine-parseable lifecycle line: Active / Superseded-by:<path> / Deprecated.
    expect(zh).toContain('Superseded-by: <path>');
    expect(zh).toContain('Deprecated');
  });
  it('en: section-for-section twin of the zh ledger', () => {
    const en = genreSkeleton('G5', 'en');
    expect(en).toContain('| Component | Version | Port/Path | Endpoint | Depends on | Last verified |');
    expect(en).toContain('## Deployed Components');
    expect(en).toContain('## Dependencies and Integration');
    expect(en).toContain('## Invalidation Policy');
    expect(en).toContain('## Verification');
    expect(en).toContain('## Change Log');
    expect(en).toContain('Superseded-by: <path>');
  });
  it('both langs carry only generic example values (privacy red-line)', () => {
    for (const lang of LANGS) {
      const s = genreSkeleton('G5', lang);
      expect(s).not.toMatch(/\/home\/lab/);
      expect(s).not.toMatch(/localhost/);
      expect(s).toContain('example.com');
      expect(s).toContain('8000');
    }
  });
});

describe('selfReviewChecklist G5 ledger variants', () => {
  it('G5 swaps items 4-6 to ledger gates (appliesTo [G5]); 1-3/7-10 shared', () => {
    const items = selfReviewChecklist('G5');
    expect(items).toHaveLength(10);
    expect(items.map((i) => i.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(items[3].label).toContain('上次核实于');
    expect(items[4].label).toContain('验证方法');
    expect(items[5].label).toContain('叙事');
    for (const i of [3, 4, 5]) {
      expect(items[i].kind).toBe('genre-specific');
      expect(items[i].appliesTo).toEqual(['G5']);
    }
    // Base gate items 1-3, 7-10 keep the shared labels for G5 pages too.
    const g1 = selfReviewChecklist('G1');
    for (const id of [1, 2, 3, 7, 8, 9, 10]) {
      expect(items[id - 1]!.label).toBe(g1[id - 1]!.label);
    }
  });

  it('G1-G4 base gate items 4-6 never include G5 (ledger gates are opt-in per genre)', () => {
    for (const genre of ['G1', 'G2', 'G3', 'G4'] as const) {
      for (const item of selfReviewChecklist(genre).slice(3, 6)) {
        expect(item.appliesTo).not.toContain('G5');
      }
    }
  });

  it('G5 gate passes its own skeleton in both languages (items 1-8 pass, 9-10 deferred)', () => {
    for (const lang of LANGS) {
      const verdicts = scoreChecklist('G5', genreSkeleton('G5', lang));
      expect(verdicts).toHaveLength(10);
      for (const v of verdicts) {
        if (v.id <= 8) {
          expect([lang, v.id, v.verdict, v.note ?? '']).toEqual([lang, v.id, 'pass', '']);
        } else {
          expect(v.verdict).toBe('deferred');
        }
      }
    }
  });
});

describe('scoreChecklist G5 ledger scorers catch non-conformant pages', () => {
  const item = (genre: Genre, draft: string, id: number) =>
    scoreChecklist(genre, draft).find((v) => v.id === id)!;

  it('item 4: component×version table without a last-verified column fails; with one passes', () => {
    const bad = '## 部署物清单\n\n| 组件 | 版本 | 端口/路径 |\n| --- | --- | --- |\n| api | 1.0 | 8000 |\n';
    const good = bad.replace('| 组件 | 版本 | 端口/路径 |', '| 组件 | 版本 | 端口/路径 | 上次核实于 |')
      .replace('| --- | --- | --- |', '| --- | --- | --- | --- |');
    expect(item('G5', bad, 4).verdict).toBe('fail');
    expect(item('G5', good, 4).verdict).toBe('pass');
    // An en ledger passes too.
    const enGood = '| Component | Version | Last verified |\n| --- | --- | --- |\n| api | 1.0 | 2026-09-01 |\n';
    expect(item('G5', enGood, 4).verdict).toBe('pass');
  });

  it('item 5: missing verification section fails; executable command passes', () => {
    const noSection = '## 部署物清单\n\n| 组件 | 版本 | 上次核实于 |\n| --- | --- | --- |\n| api | 1.0 | 2026-09-01 |\n';
    const withCmd = `${noSection}\n## 验证方法\n\n\`curl -s http://example.com:8000/health\` 返回 HTTP 200。\n`;
    expect(item('G5', noSection, 5).verdict).toBe('fail');
    expect(item('G5', withCmd, 5).verdict).toBe('pass');
    const noCmd = `${noSection}\n## 验证方法\n\n登录机器检查服务状态即可。\n`;
    expect(item('G5', noCmd, 5).verdict).toBe('fail');
  });

  it('item 6: narrative-heavy body fails, table+status page passes', () => {
    const ledger = '## 部署物清单\n\n| 组件 | 版本 | 上次核实于 |\n| --- | --- | --- |\n| api | 1.0 | 2026-09-01 |\n';
    const essay = `${ledger}\n${'这是一段讲部署往事的叙述文字，记录了当时的心路历程和背景。\n'.repeat(10)}`;
    expect(item('G5', essay, 6).verdict).toBe('fail');
    expect(item('G5', ledger, 6).verdict).toBe('pass');
  });

  it('non-G5 genres keep the base scorers (G1 gate on the same drafts is na/pass, not ledger-scored)', () => {
    const ledger = '## 部署物清单\n\n| 组件 | 版本 | 上次核实于 |\n| --- | --- | --- |\n| api | 1.0 | 2026-09-01 |\n';
    expect(item('G1', ledger, 4).verdict).toBe('na');
    expect(item('G2', ledger, 5).verdict).toBe('na');
    expect(item('G4', ledger, 6).verdict).toBe('na');
  });
});
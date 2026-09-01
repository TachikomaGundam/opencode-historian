import { describe, it, expect } from 'vitest';
import {
  GENRES,
  G1_ZH,
  classifyGenre,
  genreSkeleton,
  selfReviewChecklist,
} from '../src/templates/genres.js';
import type { Genre, Confidence, ClassifyInput } from '../src/templates/genres.js';

// Unit surface of the todo-9 page-genre system: bilingual G1–G4 skeletons (the
// harness rubric-C anatomy + wiki.js expression pieces), deterministic genre
// classification, and the 10-item self-review gate. Everything is pure string
// logic — no network, no fs, no time.

const LANGS = ['en', 'zh'] as const;

// --- classifyGenre: 16 deterministic cases ----------------------------------

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
];

describe('classifyGenre', () => {
  for (const c of CLASSIFY_CASES) {
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
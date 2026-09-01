/**
 * Page-genre system: bilingual G1–G4 templates, deterministic genre
 * classification, and the 10-item self-review gate (plan todo 9).
 *
 * The four genres (digest "Genre templates", cross-cultural-wiki-writing):
 *   G1 事件/复盘页  — incident postmortem (summary → metadata → background →
 *                    timeline → impact → root cause → remediation → action
 *                    items → lessons → appendix)
 *   G2 对比/选型页  — comparison / selection (conclusion first → dimensions →
 *                    object overview → comparison table → methodology →
 *                    recommendation)
 *   G3 清单/参考页  — inventory / reference (scope statement → structure
 *                    mirror → entry table → maintenance note)
 *   G4 概念/原理页  — concept / explanation (definition+rationale →
 *                    importance-ordered aspects → how it works →
 *                    attribution/opinion)
 *
 * Every skeleton embeds the harness rubric dimension-C anatomy (status block,
 * one-line scope, Related Pages tail) and wiki.js expression pieces only —
 * see skeletons.ts for the raw strings. Consumers (tools.ts, todo 14/15 pilot)
 * import everything from this barrel.
 */

import {
  G1_EN,
  G1_ZH,
  G2_EN,
  G2_ZH,
  G3_EN,
  G3_ZH,
  G4_EN,
  G4_ZH,
} from './skeletons.js';

// Contract re-exports: raw skeleton data stays reachable through the barrel
// (todo 13 renders these double-checked strings into skill references).
export {
  G1_EN,
  G1_ZH,
  G2_EN,
  G2_ZH,
  G3_EN,
  G3_ZH,
  G4_EN,
  G4_ZH,
} from './skeletons.js';

// --- Public types -----------------------------------------------------------

export type Genre = 'G1' | 'G2' | 'G3' | 'G4';
export type GenreLang = 'en' | 'zh';
export type Confidence = 'high' | 'medium' | 'low';

export const GENRES: readonly Genre[] = ['G1', 'G2', 'G3', 'G4'];

export interface ClassifyInput {
  readonly title: string;
  readonly body: string;
}

export interface ClassifyResult {
  readonly genre: Genre;
  readonly confidence: Confidence;
  /** The keyword cues that were matched (deterministic order, no duplicates). */
  readonly signals: readonly string[];
}

/** One gate item of the 10-item self-review checklist (plan todo 9). */
export interface ChecklistItem {
  /** 1..10 — items are always returned as the full contiguous gate. */
  readonly id: number;
  readonly label: string;
  /** kind='genre-specific' items are scored N/A=PASS when the page's genre is
   *  not in `appliesTo` (pilot scoring, todo 14/15). */
  readonly kind: 'content' | 'post-write' | 'genre-specific';
  readonly appliesTo: readonly Genre[] | 'all';
}

// --- genreSkeleton ----------------------------------------------------------

const SKELETONS: Readonly<Record<Genre, Readonly<Record<GenreLang, string>>>> = {
  G1: { en: G1_EN, zh: G1_ZH },
  G2: { en: G2_EN, zh: G2_ZH },
  G3: { en: G3_EN, zh: G3_ZH },
  G4: { en: G4_EN, zh: G4_ZH },
};

/** Full markdown skeleton for a genre × language pair. Pure string data —
 *  the author copies it, replaces placeholders, and fills the commented slots. */
export function genreSkeleton(genre: Genre, lang: GenreLang): string {
  return SKELETONS[genre][lang];
}

// --- classifyGenre ----------------------------------------------------------

/** Title hits weigh TITLE_WEIGHT× a body hit: a title naming the genre (e.g.
 *  "Postmortem") is the strongest signal; body cues still move the needle. */
const TITLE_WEIGHT = 3;
const BODY_WEIGHT = 1;
/** Never scan more than this many chars of body (truncation guard). */
const BODY_TRUNCATE_CHARS = 200_000;

/** Keyword vocabulary, one set per genre. Latin cues are matched on word
 *  boundaries (case-insensitive) so "vs" never fires inside "moves"/"versus".
 *  Keep this table in sync with skills references when it changes. */
const GENRE_KEYWORDS: Readonly<Record<Genre, readonly string[]>> = {
  G1: ['故障', '复盘', '事故', 'incident', 'postmortem', 'outage'],
  G2: ['对比', '选型', 'vs', 'versus', 'compare', 'benchmark', 'alternatives'],
  G3: ['清单', '列表', 'inventory', 'checklist', 'catalog', '命令速查'],
  G4: ['原理', '为什么', 'how it works', '概念', '机制'],
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Occurrence count of one keyword in a haystack: word-boundary regex for
 *  latin cues, plain substring scan for CJK (non-overlapping). */
function countMatches(haystack: string, keyword: string): number {
  if (/[A-Za-z]/.test(keyword)) {
    return (haystack.match(new RegExp(`\\b${escapeRegex(keyword)}\\b`, 'gi')) ?? []).length;
  }
  let count = 0;
  let idx = haystack.indexOf(keyword);
  while (idx !== -1) {
    count += 1;
    idx = haystack.indexOf(keyword, idx + keyword.length);
  }
  return count;
}

/** Deterministic keyword scoring. No randomness, no state:
 *  - each genre scores Σ(title hits × 3 + body hits × 1) over its vocabulary;
 *  - body is truncated to the first 200_000 chars (guard), latin keywords are
 *    word-boundary matched;
 *  - all-zero scores → G4/low (garbage fallback);
 *  - a tie between the two top scores (both > 0) → G4/medium (generalist
 *    genre wins the ambiguous case);
 *  - otherwise the top genre wins; confidence = margin ≥ 3 → high, else medium.
 *  `signals` names the matched cues (used by the pilot engine, todo 14/15). */
export function classifyGenre(input: ClassifyInput): ClassifyResult {
  const title = input.title.toLowerCase();
  const rawBody = input.body;
  const body = (
    rawBody.length > BODY_TRUNCATE_CHARS ? rawBody.slice(0, BODY_TRUNCATE_CHARS) : rawBody
  ).toLowerCase();

  const scores = new Map<Genre, number>();
  const signals: string[] = [];
  for (const genre of GENRES) {
    let score = 0;
    for (const keyword of GENRE_KEYWORDS[genre]) {
      const titleHits = countMatches(title, keyword);
      const bodyHits = countMatches(body, keyword);
      if (titleHits > 0 || bodyHits > 0) signals.push(keyword);
      score += titleHits * TITLE_WEIGHT + bodyHits * BODY_WEIGHT;
    }
    scores.set(genre, score);
  }

  const [top, second] = [...GENRES].sort(
    (a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0),
  );
  const topScore = scores.get(top) ?? 0;
  const secondScore = scores.get(second) ?? 0;

  if (topScore === 0) return { genre: 'G4', confidence: 'low', signals: [] };
  const margin = topScore - secondScore;
  if (margin === 0) {
    // Ambiguous: two genres scored equally — the generalist G4 wins the tie.
    return { genre: 'G4', confidence: 'medium', signals };
  }
  return { genre: top, confidence: margin >= TITLE_WEIGHT ? 'high' : 'medium', signals };
}

// --- selfReviewChecklist ----------------------------------------------------

/**
 * The 10-item self-review gate (plan todo 9). The FULL gate is always
 * returned (ids 1..10 contiguous); the pilot engine (todo 15) applies items
 * via the kind/appliesTo contract:
 *  - content items (1–3, 7, 8)     — scored on the rewritten draft (dry-run);
 *  - genre-specific items (4–6)    — N/A=PASS when the page's genre is not in
 *    appliesTo (G2 pages only have a source column; only G1 pages have
 *    timeline sources and the action-item five essentials);
 *  - post-write items (9, 10)      — scored after apply + written into the
 *    pilot report (never scored pre-write, where they are FAIL by
 *    construction).
 * `genre` is validated (unknown values throw) so callers cannot silently
 * score against a partial gate.
 */
export function selfReviewChecklist(genre: Genre): readonly ChecklistItem[] {
  if (!GENRES.includes(genre)) {
    throw new Error(`unknown genre: ${genre}`);
  }
  return [
    {
      id: 1,
      label: '导言占比 10–15%：导言 ≈ 正文的 10–15%，每个重要小节在导言至少占一句（lead ≈10–15% of body; every major section ≥1 sentence in lead）',
      kind: 'content',
      appliesTo: 'all',
    },
    {
      id: 2,
      label: '句长上限：中文句 ≤20 字、英文句 ≤25 词（sentence cap: zh ≤20 chars, en ≤25 words）',
      kind: 'content',
      appliesTo: 'all',
    },
    {
      id: 3,
      label: '表格判据：≥3 字段的结构化枚举入表，成对数据用描述列表（≥3 fields → table; pairs → description list）',
      kind: 'content',
      appliesTo: 'all',
    },
    {
      id: 4,
      label: '对比表/枚举表每行有来源列，行序固定、无合并单元格（comparison/enumeration table has a source column）',
      kind: 'genre-specific',
      appliesTo: ['G2'],
    },
    {
      id: 5,
      label: '时间线每行有来源列，仅日志可证事实（timeline rows carry sources; log-verifiable facts only）',
      kind: 'genre-specific',
      appliesTo: ['G1'],
    },
    {
      id: 6,
      label: '行动项五要素 = 类型|负责人|期限|验证|状态 五列，措施是行内容（action items: five essentials as columns）',
      kind: 'genre-specific',
      appliesTo: ['G1'],
    },
    {
      id: 7,
      label: '无杂项筐：除 参见/附录 之外没有 "其他/杂项" 类 catch-all 小节（no catch-all sections outside See-Also/Appendix）',
      kind: 'content',
      appliesTo: 'all',
    },
    {
      id: 8,
      label: '无溢美词：领先/强大/灵活/高效 等 bare claim 改事实或删除（no unbacked praise: 领先/强大/灵活/高效 without evidence）',
      kind: 'content',
      appliesTo: 'all',
    },
    {
      id: 9,
      label: '双语 URL 已回报：报告含 /en/ 与 /zh/ 两个可访问 URL（post-write: report carries both /en/ and /zh/ URLs）',
      kind: 'post-write',
      appliesTo: 'all',
    },
    {
      id: 10,
      label: '孪生页已建 或 zh_status:pending 已记录并在报告中声明（twin created OR zh_status pending recorded and declared in report）',
      kind: 'post-write',
      appliesTo: 'all',
    },
  ];
}
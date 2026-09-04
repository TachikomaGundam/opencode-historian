/**
 * Deterministic self-review checklist scoring (plan todo 14/15): the 10-item
 * gate is scored by CODE on the reformatted draft — the LLM only restyles,
 * it never scores (an auditable gate). Verdict contract:
 *   - items 1-8 (content)   → 'pass' | 'fail' by the checks below
 *   - items 4-6 are 'na'    → when the page genre is not in appliesTo
 *   - items 9-10 (post-write) → 'deferred' until after apply (they are FAIL
 *     by construction pre-write; todo 15 writes them into the pilot report)
 *
 * Every threshold below is tolerant-but-real: it catches egregious
 * violations, never bikesheds a conformant page. Measured values ride in the
 * verdict note so a reviewer sees exactly what was counted.
 */

import type { ChecklistItem, Genre } from './templates/genres.js';
import { selfReviewChecklist } from './templates/genres.js';

// --- Verdict types ----------------------------------------------------------

export type Verdict = 'pass' | 'fail' | 'na' | 'deferred';

export interface ChecklistVerdict {
  readonly id: number;
  readonly verdict: Verdict;
  readonly note?: string;
}

// --- Text preprocessing (prose extraction for sentence metrics) -------------

const FENCED = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`]+`/g;
const TABLE_LINE = /^\s*\|.*\|.*\|/;
const HEADING_LINE = /^\s{0,3}#{1,6}\s/;
const QUOTE_LINE = /^\s{0,3}>\s?/;
const HR_LINE = /^\s{0,3}(---|\*\*\*|___)\s*$/;

/** Prose-only view of a draft: code blocks, inline code, table rows, headings
 *  and blockquotes are not sentence prose (tables are scored by items 4-6). */
function proseOf(markdown: string): string {
  return markdown
    .replace(FENCED, ' ')
    .replace(INLINE_CODE, ' ')
    .split('\n')
    .filter((l) => !TABLE_LINE.test(l) && !HEADING_LINE.test(l) && !QUOTE_LINE.test(l) && !HR_LINE.test(l))
    .join('\n');
}

const SENTENCE_BREAK = /[。！？!?]+/;
const CJK_RE = /[\u4e00-\u9fff]/g;

function sentencesOf(prose: string): readonly string[] {
  return prose
    .split(SENTENCE_BREAK)
    .map((s) => s.replace(/[|*_`#>-]/g, '').trim())
    .filter((s) => s.length > 0)
    .slice(0, 30);
}

/** zh: ≤20 chars (CJK chars + latin tokens); en: ≤25 words. A sentence with
 *  any CJK char is judged by the zh rule. */
function sentenceTooLong(sentence: string): boolean {
  const tokens = sentence.match(/[A-Za-z0-9][\w-]*/g) ?? [];
  const cjkChars = (sentence.match(CJK_RE) ?? []).length;
  const effectiveLength = cjkChars > 0 ? cjkChars + tokens.length : tokens.length;
  return cjkChars > 0 ? effectiveLength > 20 : effectiveLength > 25;
}

// --- Markdown table parsing -------------------------------------------------

interface MdTable {
  readonly header: readonly string[];
}

/** Tables = a header row (`| a | b |`) followed by a separator row. Cells are
 *  de-fenced and lowercased for the header checks. */
function tablesOf(markdown: string): readonly MdTable[] {
  const lines = markdown.split('\n');
  const tables: MdTable[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const next = lines[i + 1];
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(next)) {
      const cells = lines[i].split('|').map((c) => c.trim().replace(/`/g, '').toLowerCase()).filter((c) => c.length > 0);
      if (cells.length >= 3) tables.push({ header: cells });
    }
  }
  return tables;
}

// --- Scoring ----------------------------------------------------------------

function leadRatio(draft: string): number {
  const firstH2 = draft.search(/\n#{2,3}\s/);
  if (firstH2 === -1) return 1;
  const lead = draft.slice(0, firstH2);
  const total = Math.max(draft.length, 1);
  return lead.length / total;
}

function scoreItem1(draft: string): ChecklistVerdict {
  const measured = leadRatio(draft);
  const pass = measured >= 0.04 && measured <= 0.45;
  return { id: 1, verdict: pass ? 'pass' : 'fail', note: pass ? undefined : `lead=${(measured * 100).toFixed(1)}% of body (tol 4-45%)` };
}

function scoreItem2(draft: string): ChecklistVerdict {
  const sentences = sentencesOf(proseOf(draft));
  if (sentences.length === 0) return { id: 2, verdict: 'pass', note: 'no prose sentences sampled' };
  const overflow = sentences.filter(sentenceTooLong).length;
  const allowance = Math.max(1, Math.floor(sentences.length / 10));
  const pass = overflow <= allowance;
  return {
    id: 2,
    verdict: pass ? 'pass' : 'fail',
    note: pass ? undefined : `${overflow}/${sentences.length} sampled sentences exceed the cap (zh ≤20 chars, en ≤25 words)`,
  };
}

function scoreItem3(draft: string): ChecklistVerdict {
  const hasTable = tablesOf(draft).length > 0;
  return { id: 3, verdict: hasTable ? 'pass' : 'fail', note: hasTable ? undefined : 'no ≥3-column markdown table found' };
}

function scoreItem4(draft: string): ChecklistVerdict {
  const offenders = tablesOf(draft).filter((t) => !t.header.some((c) => /来源|source|reference/.test(c)));
  return {
    id: 4,
    verdict: offenders.length === 0 ? 'pass' : 'fail',
    note: offenders.length === 0 ? undefined : `${offenders.length} table(s) lack a source column`,
  };
}

function scoreItem5(draft: string): ChecklistVerdict {
  const timeline = tablesOf(draft).find((t) => t.header.some((c) => /时间|time/.test(c)));
  if (timeline === undefined) return { id: 5, verdict: 'fail', note: 'no timeline table (时间|事件|来源) found' };
  const hasSource = timeline.header.some((c) => /来源|source/.test(c));
  return { id: 5, verdict: hasSource ? 'pass' : 'fail', note: hasSource ? undefined : 'timeline table has no source column' };
}

const FIVE_ESSENTIALS_ZH = ['类型', '负责人', '期限', '验证', '状态'];
const FIVE_ESSENTIALS_EN: ReadonlyArray<readonly string[]> = [
  ['type'],
  ['owner'],
  ['due', 'deadline'],
  ['verif'],
  ['status', 'state'],
];

function scoreItem6(draft: string): ChecklistVerdict {
  const actionTable = tablesOf(draft).find((t) => {
    if (t.header.length < 5) return false;
    const five = FIVE_ESSENTIALS_ZH.every((k) => t.header.some((c) => c.includes(k)))
      ? FIVE_ESSENTIALS_ZH
      : FIVE_ESSENTIALS_EN.every((k) => k.some((pre) => t.header.some((c) => c.startsWith(pre))))
        ? 'en'
        : null;
    return five !== null;
  });
  return {
    id: 6,
    verdict: actionTable !== undefined ? 'pass' : 'fail',
    note: actionTable !== undefined ? undefined : 'no action-item table with the five essentials (类型|负责人|期限|验证|状态) as columns',
  };
}

const CATCH_ALL = ['其他', '杂项', 'miscellaneous', 'misc', 'other'];
const EXEMPT_TAILS = ['附录', 'appendix', '参见', 'see also', 'see-also', '参考'];

function scoreItem7(draft: string): ChecklistVerdict {
  const headings = draft.split('\n').filter((l) => /^\s{0,3}##{1,3}\s/.test(l));
  const h = (line: string): string => line.replace(/^\s{0,3}#+/, '').replace(/[#*`]/g, '').trim().toLowerCase();
  const banned = headings.map(h).find((t) => CATCH_ALL.some((w) => t.includes(w)) && !EXEMPT_TAILS.some((w) => t.includes(w)));
  return {
    id: 7,
    verdict: banned === undefined ? 'pass' : 'fail',
    note: banned === undefined ? undefined : `catch-all section heading: "${banned}"`,
  };
}

const MARKETING: ReadonlyArray<readonly string[]> = [
  ['robust', 'streamline', 'leverage', 'utilize', 'world-class', 'cutting-edge', 'delve'],
  ['强大的', '领先的', '先进的', '赋能'],
];

function scoreItem8(draft: string): ChecklistVerdict {
  const body = draft.replace(FENCED, ' ');
  const hit = MARKETING[0].find((w) => new RegExp(`\\b${w}`, 'i').test(body)) ?? MARKETING[1].find((w) => body.includes(w));
  return { id: 8, verdict: hit === undefined ? 'pass' : 'fail', note: hit === undefined ? undefined : `unbacked praise term: "${hit}"` };
}

// --- G5 ledger scorers (selfReviewChecklist G5 variants of items 4-6) --------

const G5_LEDGER_COL = /(组件|component)/;
const G5_VERSION_COL = /(版本|version)/;
const G5_VERIFIED_COL = /(核实|verif)/;
const COMMENT_ONLY_LINE = /^\s*<!--.*-->\s*$/;

function scoreG5Item4(draft: string): ChecklistVerdict {
  const ledgers = tablesOf(draft).filter(
    (t) => t.header.some((c) => G5_LEDGER_COL.test(c)) && t.header.some((c) => G5_VERSION_COL.test(c)),
  );
  if (ledgers.length === 0) {
    return { id: 4, verdict: 'fail', note: 'no component ledger table (组件|版本|…|上次核实于) found' };
  }
  const missing = ledgers.filter((t) => !t.header.some((c) => G5_VERIFIED_COL.test(c)));
  return {
    id: 4,
    verdict: missing.length === 0 ? 'pass' : 'fail',
    note: missing.length === 0 ? undefined : `${missing.length} ledger table(s) lack a last-verified (上次核实于) column`,
  };
}

function scoreG5Item5(draft: string): ChecklistVerdict {
  const lines = draft.split('\n');
  const start = lines.findIndex((l) => /^#{2,3}\s/.test(l) && /验证方法|verification/i.test(l));
  if (start === -1) {
    return { id: 5, verdict: 'fail', note: 'no 验证方法/Verification section' };
  }
  const end = lines.findIndex((l, i) => i > start && /^#{1,3}\s/.test(l));
  const section = lines.slice(start + 1, end === -1 ? lines.length : end).join('\n');
  const hasCommand = /`[^`\n]+`/.test(section) || /```/.test(section);
  return {
    id: 5,
    verdict: hasCommand ? 'pass' : 'fail',
    note: hasCommand ? undefined : '验证方法 section carries no executable command (inline code or fenced block)',
  };
}

function scoreG5Item6(draft: string): ChecklistVerdict {
  const tableLines = draft.split('\n').filter((l) => TABLE_LINE.test(l)).length;
  const narrative = proseOf(draft)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !COMMENT_ONLY_LINE.test(l)).length;
  const pass = tablesOf(draft).length > 0 && narrative <= Math.max(tableLines, 6);
  return {
    id: 6,
    verdict: pass ? 'pass' : 'fail',
    note: pass ? undefined : `narrative lines (${narrative}) outnumber table lines (${tableLines}) — a ledger is status + tables, not prose`,
  };
}

// --- G6 how-to scorers (selfReviewChecklist G6 variants of items 4-6) --------

const G6_GOAL_H1 = /(?:如何|怎么|怎样|how\s+to)/i;
const G6_STEPS_HEADING = /^#{2,3}\s.*(?:操作步骤|\bsteps\b)/i;

function stepsSectionOf(draft: string): string | undefined {
  const lines = draft.split('\n');
  const start = lines.findIndex((l) => /^#{2,3}\s/.test(l) && G6_STEPS_HEADING.test(l));
  if (start === -1) return undefined;
  const end = lines.findIndex((l, i) => i > start && /^#{1,3}\s/.test(l));
  return lines.slice(start + 1, end === -1 ? lines.length : end).join('\n');
}

function scoreG6Item4(draft: string): ChecklistVerdict {
  const h1 = draft.split('\n').find((l) => /^#\s/.test(l)) ?? '';
  const pass = G6_GOAL_H1.test(h1);
  return {
    id: 4,
    verdict: pass ? 'pass' : 'fail',
    note: pass ? undefined : `H1 is not goal-titled ("How to X" / "如何(怎么)做X"): "${h1.replace(/^#\s*/, '').slice(0, 40)}"`,
  };
}

function scoreG6Item5(draft: string): ChecklistVerdict {
  const section = stepsSectionOf(draft);
  if (section === undefined) {
    return { id: 5, verdict: 'fail', note: 'no 操作步骤/Steps section' };
  }
  const numbered = /^\s*1[.、]/m.test(section);
  const expected = /(预期|expected)/i.test(section);
  const failure = /(失败|on failure|fallback)/i.test(section);
  const pass = numbered && expected && failure;
  return {
    id: 5,
    verdict: pass ? 'pass' : 'fail',
    note: pass ? undefined : `steps section lacks ${numbered ? '' : 'numbered items '}${expected ? '' : 'expected-result leg '}${failure ? '' : 'on-failure leg '}`.trim(),
  };
}

function scoreG6Item6(draft: string): ChecklistVerdict {
  const verified = /(上次核实|last verified)/i.test(draft);
  const review = /(复核周期|review[- ]by|cadence)/i.test(draft);
  const pass = verified && review;
  return {
    id: 6,
    verdict: pass ? 'pass' : 'fail',
    note: pass ? undefined : `metadata table lacks ${verified ? '' : 'last-verified (上次核实) '}${review ? '' : 'review-by (复核周期)'}row(s)`,
  };
}

type ItemScorer = (draft: string) => ChecklistVerdict;
type ScorerTriple = readonly [ItemScorer, ItemScorer, ItemScorer];

/** Items 4-6 genre variants: G5 ledgers and G6 how-tos swap in their own
 *  gates; every other genre keeps the base trio. */
const GENRE_SCORERS: Readonly<Partial<Record<Genre, ScorerTriple>>> = {
  G5: [scoreG5Item4, scoreG5Item5, scoreG5Item6],
  G6: [scoreG6Item4, scoreG6Item5, scoreG6Item6],
};

const BASE_SCORERS: ScorerTriple = [scoreItem4, scoreItem5, scoreItem6];

/** Score the full 10-item gate on a draft. `genre` decides items 4-6:
 *  the base gate's item 4 applies to G2 only and items 5-6 to G1 only
 *  (G3/G4 → 'na'); G5 pages get the ledger variants of all three
 *  (last-verified column, verification commands, table-not-prose) and G6
 *  pages the how-to variants (goal-titled H1, step triples, freshness rows). */
export function scoreChecklist(genre: Genre, draft: string): readonly ChecklistVerdict[] {
  const items = selfReviewChecklist(genre);
  const na = (item: ChecklistItem): ChecklistVerdict => ({
    id: item.id,
    verdict: 'na',
    note: `N/A — genre ${genre} not in appliesTo`,
  });
  const deferred = (item: ChecklistItem): ChecklistVerdict => ({
    id: item.id,
    verdict: 'deferred',
    note: 'post-write item — score after apply and write into the pilot report',
  });
  const [score4, score5, score6] = GENRE_SCORERS[genre] ?? BASE_SCORERS;
  return items.map((item) => {
    const applies = item.appliesTo === 'all' || item.appliesTo.includes(genre);
    switch (item.id) {
      case 1: return scoreItem1(draft);
      case 2: return scoreItem2(draft);
      case 3: return scoreItem3(draft);
      case 4: return applies ? score4(draft) : na(item);
      case 5: return applies ? score5(draft) : na(item);
      case 6: return applies ? score6(draft) : na(item);
      case 7: return scoreItem7(draft);
      case 8: return scoreItem8(draft);
      default: return deferred(item);
    }
  });
}

// --- Conformance signal (todo 14 roundtrip step ③) ---------------------------

/** Whitespace-normalized equality (the strong signal); otherwise trigram
 *  Jaccard similarity ≥ 0.95. Deterministic, diff-based — never prose. */
export function contentSimilar(a: string, b: string): boolean {
  const na = normalize(a);
  if (na === normalize(b)) return true;
  return trigramSimilarity(na, normalize(b)) >= 0.95;
}

export function normalize(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

function trigramSimilarity(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const out = new Set<string>();
    if (s.length < 3) {
      if (s.length > 0) out.add(s);
      return out;
    }
    for (let i = 0; i <= s.length - 3; i++) out.add(s.slice(i, i + 3));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 && gb.size === 0) return 1;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  const union = ga.size + gb.size - inter;
  return union === 0 ? 1 : inter / union;
}
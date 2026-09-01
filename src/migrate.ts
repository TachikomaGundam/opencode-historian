/**
 * Migration engine — reformat side (plan todo 14): LLM-driven genre restyle.
 * The dry-run reads the page (en, else zh), classifies the genre (explicit
 * arg wins), reformats via the translate engine's Anthropic-compatible call
 * path (SAME-LANGUAGE restyle — the twin is translated at apply time, never
 * here), and scores the 10-item checklist deterministically on the DRAFT
 * (items 9-10 are 'deferred' pre-apply; N/A per kind contract).
 *
 * No LLM access never crashes: every failure surfaces as a structured
 * {ok:false, error} with the TranslateError/PageNotFoundError taxonomy.
 * Apply lives in migrate-apply.ts (this module stays under the LOC ceiling).
 */

import type { GqlClient } from './wiki/client.js';
import type { HistorianOptions } from './config.js';
import { callMessages } from './translate.js';
import { classifyGenre, genreSkeleton, type Confidence, type Genre, type GenreLang } from './templates/genres.js';
import { scoreChecklist, contentSimilar, type ChecklistVerdict } from './migrate-score.js';
import { PageNotFoundError } from './wiki/pages.js';
import { readPage, type Locale, type PageRecord, type TranslateFn } from './wiki/pages.read.js';
import { assertLocalePair, twinOf, PathValidationError } from './wiki/locale.js';

// --- Types ------------------------------------------------------------------

export interface MigrateDeps {
  readonly client: GqlClient;
  readonly options: HistorianOptions;
  readonly translate?: TranslateFn;
  readonly fetchImpl?: typeof fetch;
  readonly homeDir: string;
  readonly resultsDir?: string;
  readonly now?: () => Date;
}

export interface ReformatArgs {
  readonly path: string;
  readonly genre?: Genre;
  /** Pilot revise-loop seam (todo 15): corrective hints appended into the
   *  restyle user prompt when a previous draft failed checklist items. */
  readonly reviseHints?: readonly string[];
}

export type ReformatOutcome =
  | {
      ok: true;
      draft: string;
      genre: Genre;
      confidence: Confidence | 'explicit';
      signals: readonly string[];
      checklistResults: readonly ChecklistVerdict[];
      urls: { en: string; zh: string };
      alreadyConforms: boolean;
      missingTwin: boolean;
      sourceLocale: Locale;
      sourceContent: string;
      sourceTitle: string;
    }
  | { ok: false; error: Error };

/** Locale-aware URL pair for a server-reported path (mirrors tools/shared
 *  reportUrls; the engine must not import the tools layer). */
export function urlsOf(baseUrl: string, path: string, locale: Locale): { en: string; zh: string } {
  const raw = (l: Locale): string => `${baseUrl.replace(/\/+$/, '')}/${l}/${path}`;
  try {
    const pair = assertLocalePair(path, locale, baseUrl);
    return locale === 'en' ? { en: pair.url, zh: pair.twinUrl } : { en: pair.twinUrl, zh: pair.url };
  } catch (err) {
    if (!(err instanceof PathValidationError)) throw err;
    return { en: raw('en'), zh: raw('zh') };
  }
}

// --- Reformat prompt (rules.md items 1-8, embedded with machine-readable
//      markers; the LLM restyles, scoring stays deterministic code) -----------

const RULES = [
  'R1 结论先行: the lead states the conclusion/action first.',
  'R2 一页一问: the page answers exactly one question.',
  'R3 导言占比: lead ≈10-15% of the body, one sentence per major section.',
  'R4 句长约束: zh sentences ≤20 chars; en sentences ≤25 words.',
  'R5 表格判据: ≥3-field structured data → table; pairs → description list.',
  'R6 来源列: comparison/timeline tables carry a source column.',
  'R7 时间线三列: event timelines are exactly 时间|事件|来源.',
  'R8 行动项五要素: action items use the five columns 类型|负责人|期限|验证|状态.',
] as const;

export function reformatSystemFor(lang: GenreLang): string {
  return [
    `RESTYLE: ${lang}->${lang}`,
    'You restructure an existing wiki page into the target genre skeleton.',
    'RULES:',
    ...RULES,
    'PRESERVE every fact, link, and code block verbatim; restructure only.',
    'Return the full page as Markdown. Do NOT wrap the output in code fences and do not add commentary outside the Markdown.',
  ].join('\n');
}

export function reformatPromptFor(genre: Genre, lang: GenreLang, original: string): string {
  return [
    `TARGET GENRE SKELETON (${genre}, ${lang}):`,
    genreSkeleton(genre, lang),
    '',
    'ORIGINAL CONTENT TO RESTRUCTURE:',
    original,
  ].join('\n');
}

/** Append pilot revise-loop hints to the restyle user prompt (todo 15 seam);
 *  absent hints leave the prompt byte-identical to the pre-seam form. */
function appendReviseHints(prompt: string, hints: readonly string[] | undefined): string {
  if (hints === undefined || hints.length === 0) return prompt;
  return [
    prompt,
    '',
    'REVISE HINTS (the restructure MUST satisfy every hint):',
    ...hints.map((h) => `- ${h}`),
  ].join('\n');
}

// --- reformatPageDraft ------------------------------------------------------

/** Dry-run engine: read → classify (explicit genre wins) → LLM restyle →
 *  deterministic checklist on the draft → conformance signal vs stored
 *  content. Never writes (the tool, not this module, owns the envelope). */
export async function reformatPageDraft(deps: MigrateDeps, args: ReformatArgs): Promise<ReformatOutcome> {
  const en = await readPage(deps.client, args.path, 'en');
  const source = en ?? (await readPage(deps.client, args.path, 'zh'));
  if (source === null) {
    return { ok: false, error: new PageNotFoundError(`page '${args.path}' does not exist (checked en and zh locales)`) };
  }
  const classified = classifyGenre({ title: source.title, body: source.content });
  const genre = args.genre ?? classified.genre;
  const user = appendReviseHints(reformatPromptFor(genre, source.locale, source.content), args.reviseHints);
  let draft: string;
  try {
    draft = await callMessages(
      deps.options,
      { fetchImpl: deps.fetchImpl },
      { system: reformatSystemFor(source.locale), user },
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
  const twin = await readPage(deps.client, args.path, twinOf(source.locale));
  return {
    ok: true,
    draft,
    genre,
    confidence: args.genre !== undefined ? 'explicit' : classified.confidence,
    signals: args.genre !== undefined ? [] : classified.signals,
    checklistResults: scoreChecklist(genre, draft),
    urls: urlsOf(deps.options.baseUrl, source.path, source.locale),
    alreadyConforms: contentSimilar(draft, source.content),
    missingTwin: twin === null,
    sourceLocale: source.locale,
    sourceContent: source.content,
    sourceTitle: source.title,
  };
}
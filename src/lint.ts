/**
 * Body lint: one fence-aware pass over a page body producing the structural
 * facts every hard gate and surface detector reuses (plan v0.5.0 #6).
 * Pure functions, zero wiki I/O — the deep scanner injects bodies, the write
 * tools lint drafts before they hit the API. This is the module the
 * architecture-page audit (HANDOFF Issue #6) forced into existence: nothing
 * here was optional before, which is exactly how a page with five empty
 * sections shipped for three days claiming `状态: Active`.
 */

import type { Locale } from './wiki/pages.read.js';

// --- finding + verdict shapes -------------------------------------------------

/** Machine rule keys; the human report renders zh labels from these. */
export type GateViolation =
  | 'redirect-stub-no-exit' // Issue #5.1: stub a reader cannot follow
  | 'active-with-unfinished-skeleton'; // Issue #6.5:谎报 Active

export interface LintFinding {
  readonly key:
    | 'todo-markers'
    | 'empty-sections'
    | 'intro-empty'
    | 'no-related-pages'
    | 'no-state-block'
    | 'h1-mismatch'
    | 'zh-english-dominant'
    | 'claims-without-stamp';
  readonly detail: string;
}

export interface PageLink {
  /** Normalized wiki path (locale prefix stripped, leading `/` removed, no anchor/query). */
  readonly path: string;
  readonly locale: Locale;
  /** True when the raw target was a same-page anchor (`#…`) — never resolved. */
  readonly anchor: boolean;
}

export interface ClaimCounts {
  readonly ports: number;
  readonly paths: number;
  readonly commands: number;
}

export interface BodyLint {
  readonly isRedirectStub: boolean;
  readonly redirectTarget: string | null;
  readonly stubHasLink: boolean;
  readonly hasStateBlock: boolean;
  readonly state: 'active' | 'draft' | 'superseded' | 'deprecated' | null;
  readonly todoMarkers: number;
  /** Heading text of sections whose body (before the next heading ≤ level) is empty. */
  readonly emptySections: readonly string[];
  readonly introEmpty: boolean;
  readonly hasRelatedPages: boolean;
  readonly h1: string | null;
  /** All heading spans in document order (twin-parity + structure checks). */
  readonly headings: readonly HeadingSpan[];
  readonly links: readonly PageLink[];
  readonly hasStamp: boolean;
  readonly claims: ClaimCounts;
  readonly claimTotal: number;
  /** CJK chars / non-whitespace chars, zh body only meaningful; 0..1. */
  readonly cjkRatio: number;
}

// --- fence + comment masking ----------------------------------------------------

/** Blank out fenced code-block interiors (keep line structure) so markers,
 *  headings and links inside code fences never count (SYN fence rule). */
function maskFences(body: string): string {
  const lines = body.split('\n');
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const m = /^(`{3,}|~{3,})/.exec(line.trimStart());
    if (fence === null && m !== null) {
      fence = (m[1] as string)[0] as string;
      continue;
    }
    if (fence !== null) {
      if (line.trimStart().startsWith(fence.repeat(3))) {
        fence = null;
      } else {
        lines[i] = '';
      }
    }
  }
  return lines.join('\n');
}

const COMMENT_RE = /<!--[\s\S]*?-->/g;

// --- redirect stub --------------------------------------------------------------

const REDIRECT_LINE_RE = /^>\s*Redirect:\s*(\S.*?)\s*$/im;

function redirectTarget(masked: string): string | null {
  const m = REDIRECT_LINE_RE.exec(masked);
  return m !== null ? (m[1] as string) : null;
}

/** Clickable exit (Issue #5.1): a stub only lives if it carries at least one
 *  real internal link — a bare `<code>` path or an in-page anchor is a dead
 *  end for the reader who lands here. Wrong-target links belong to the
 *  dead-link scanner, not this gate. */
function hasClickableExit(visibleNoAnchors: number): boolean {
  return visibleNoAnchors > 0;
}

// --- status block -----------------------------------------------------------------

const STATE_LINE_RE =
  /(?:^|\n)\s*\*{0,2}\s*(?:状态\s*\/\s*Status|状态|Status)\s*\*{0,2}\s*[:：]\s*([A-Za-z\u4e00-\u9fff][^\n·|<]*)/i;

function parseState(maskedNoComments: string): { has: boolean; state: BodyLint['state'] } {
  const m = STATE_LINE_RE.exec(maskedNoComments);
  if (m === null) return { has: false, state: null };
  const v = (m[1] as string).trim().toLowerCase();
  if (v.startsWith('active')) return { has: true, state: 'active' };
  if (v.startsWith('draft')) return { has: true, state: 'draft' };
  if (v.startsWith('superseded')) return { has: true, state: 'superseded' };
  if (v.startsWith('deprecated')) return { has: true, state: 'deprecated' };
  return { has: true, state: null };
}

// --- markers, headings, intro -------------------------------------------------------

const TODO_COMMENT_RE = /(TODO|TBD|PLACEHOLDER|占位)/i;
const LITERAL_TODO_RE = /\bTODO:/g;

function countTodoMarkers(masked: string): number {
  let n = 0;
  for (const m of masked.matchAll(COMMENT_RE)) {
    if (TODO_COMMENT_RE.test(m[0])) n++;
  }
  // literal TODO: outside comments (comments already masked to '' for this pass)
  const noComments = masked.replace(COMMENT_RE, '');
  n += (noComments.match(LITERAL_TODO_RE) ?? []).length;
  return n;
}

export interface HeadingSpan {
  readonly level: number;
  readonly heading: string;
  /** Body between this heading and the next heading ≤ level (masked+comment-free), weighted length. */
  readonly bodyChars: number;
}

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*$/;
const STATUS_BOILERPLATE_RE = /状态\s*\/\s*Status|日期\s*\/\s*Date|本页回答|This page answers/i;

/** Parse headings + emptiness over masked, comment-stripped text. Also returns
 *  the intro span (before the first heading) for the 导言占比 detector. */
function parseStructure(masked: string): { headings: HeadingSpan[]; introEmpty: boolean; h1: string | null } {
  const noComments = masked.replace(COMMENT_RE, '');
  const lines = noComments.split('\n');
  const headings: HeadingSpan[] = [];
  let h1: string | null = null;
  let intro = 0;
  let cur: { level: number; heading: string; chars: number } | null = null;
  // CJK glyphs carry ~3x the visual weight of a latin char per cell — count
  // weight, not raw chars, so a terse Chinese intro is not flagged empty.
  const weight = (s: string): number => {
    const stripped = s.replace(/\s/g, '');
    const cjk = (stripped.match(CJK_WEIGHT_RE) ?? []).length;
    return cjk * 3 + (stripped.length - cjk);
  };
  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m !== null) {
      const level = (m[1] as string).length;
      if (cur !== null) headings.push({ level: cur.level, heading: cur.heading, bodyChars: cur.chars });
      if (level === 1 && h1 === null) h1 = (m[2] as string).trim();
      cur = { level, heading: (m[2] as string).trim(), chars: 0 };
      continue;
    }
    if (cur === null) {
      if (!STATUS_BOILERPLATE_RE.test(line)) intro += weight(line);
    } else if (!STATUS_BOILERPLATE_RE.test(line)) {
      cur.chars += weight(line);
    }
  }
  if (cur !== null) headings.push({ level: cur.level, heading: cur.heading, bodyChars: cur.chars });
  // The intro is the H1 section's own span (real pages all open with `# 标题`);
  // the pre-heading accumulator only carries weight on heading-less bodies.
  const firstH1 = headings.find((h) => h.level === 1);
  const introWeight = firstH1 !== undefined ? firstH1.bodyChars : intro;
  return { headings, introEmpty: introWeight < 40, h1 };
}

/** Section headings (##+) whose own span holds no content; deeper non-empty
 *  subsections do NOT rescue an empty parent only when the parent span itself
 *  is empty — a heading immediately followed by a deeper heading with content
 *  counts as structural grouping and is still empty prose at that level. */
export function emptySectionsOf(headings: readonly HeadingSpan[]): readonly string[] {
  return headings.filter((h) => h.level >= 2 && h.bodyChars === 0).map((h) => h.heading);
}

// --- links -----------------------------------------------------------------------

const LINK_MD_RE = /\]\(([^)\s]+)[^)]*\)/g;
const LINK_HREF_RE = /href="([^"]+)"/gi;

export interface LinkScanOpts {
  readonly baseUrl: string;
}

/** Extract internal page links (relative wiki paths + same-host absolute URLs). */
export function extractLinks(masked: string, opts: LinkScanOpts): readonly PageLink[] {
  const out: PageLink[] = [];
  const host = opts.baseUrl.replace(/\/+$/, '');
  const seen = new Set<string>();
  const push = (raw: string): void => {
    let target = raw.trim();
    if (target === '' || target.startsWith('#')) {
      if (target.startsWith('#')) out.push({ path: target.slice(1), locale: 'en', anchor: true });
      return;
    }
    if (/^(mailto:|javascript:)/i.test(target)) return;
    let locale: Locale = 'en';
    if (/^https?:\/\//i.test(target)) {
      if (!target.toLowerCase().startsWith(host.toLowerCase())) return; // external
      target = target.slice(host.length);
    }
    if (/\.(png|jpe?g|gif|svg|webp|pdf|zip|css|js)\b/i.test(target)) return;
    target = target.split('#')[0] as string;
    target = target.split('?')[0] as string;
    target = target.replace(/^\/+/, '');
    if (target === '') return;
    if (target.startsWith('zh/')) {
      locale = 'zh';
      target = target.slice(3);
    } else if (target.startsWith('en/')) {
      target = target.slice(3);
    }
    const key = `${locale}\u0000${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ path: target, locale, anchor: false });
  };
  for (const re of [LINK_MD_RE, LINK_HREF_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(masked)) !== null) push((m[1] as string) ?? '');
  }
  return out;
}

// --- claims + stamps + language -----------------------------------------------------

const STAMP_RE = /上次核实|上次验证|last verified/i;
const PORT_RE = /:\d{4,5}\b/g;
const FS_PATH_RE = /\/(?:opt|var|etc|usr|srv)\/[\w./-]+/g;
const CMD_RE = /\b(?:systemctl|journalctl|docker|curl|nc|wget|iptables|nginx|caddy)\b/gi;
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/g;
const CJK_WEIGHT_RE = /[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff]/g;

function distinct(text: string, re: RegExp): number {
  return new Set(text.match(re) ?? []).size;
}

export interface LintOpts {
  readonly locale: Locale;
  readonly baseUrl: string;
  /** Page title for the h1-mismatch check. */
  readonly title?: string;
}

// --- main entry ---------------------------------------------------------------------

export function lintBody(body: string, opts: LintOpts): BodyLint {
  const masked = maskFences(body);
  const visible = masked.replace(COMMENT_RE, '');
  const target = redirectTarget(masked);
  const isRedirectStub = /^\s*>\s*Redirect:/im.test(masked);
  const { headings, introEmpty, h1 } = parseStructure(masked);
  const links = extractLinks(visible, { baseUrl: opts.baseUrl }).filter((l) => !l.anchor);
  const nonSpace = (visible.match(/\S/g) ?? []).length;
  const cjk = (visible.match(CJK_RE) ?? []).length;
  const claims: ClaimCounts = {
    ports: distinct(visible, PORT_RE),
    paths: distinct(visible, FS_PATH_RE),
    commands: distinct(visible, CMD_RE),
  };
  const stateInfo = parseState(visible);
  return {
    isRedirectStub,
    redirectTarget: target,
    stubHasLink: !isRedirectStub || hasClickableExit(links.length),
    hasStateBlock: stateInfo.has,
    state: stateInfo.state,
    todoMarkers: countTodoMarkers(masked),
    emptySections: emptySectionsOf(headings),
    introEmpty,
    hasRelatedPages: /^#{1,6}\s+.*(相关页面|Related Pages)/im.test(masked),
    h1,
    headings,
    links,
    hasStamp: STAMP_RE.test(visible),
    claims,
    claimTotal: claims.ports + claims.paths + claims.commands,
    cjkRatio: nonSpace === 0 ? 0 : cjk / nonSpace,
  };
}

/** Structural h1≠title flag (kept out of BodyLint's hot fields on purpose). */
export function h1TitleMismatch(lint: BodyLint, title: string | undefined): boolean {
  if (title === undefined || lint.h1 === null) return false;
  return lint.h1.trim().toLowerCase() !== title.trim().toLowerCase();
}

/** The two hard publish-gate rules (shared.ts refuses the write on a hit). */
export function publishGateViolations(lint: BodyLint): readonly GateViolation[] {
  const out: GateViolation[] = [];
  if (lint.isRedirectStub && !lint.stubHasLink) out.push('redirect-stub-no-exit');
  if (lint.state === 'active' && (lint.todoMarkers > 0 || lint.emptySections.length > 0)) {
    out.push('active-with-unfinished-skeleton');
  }
  return out;
}

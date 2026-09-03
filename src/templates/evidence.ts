/**
 * Machine-tier evidence page skeleton (v3 todo 5).
 *
 * Evidence pages live under the internal namespaces (`_meta/`, `_evidence/`),
 * are hidden and monolingual — the wiki is their only store (no local mirror,
 * no bilingual twin machinery). They are deliberately NOT genre-templated:
 * the G1–G5 anatomy rubric targets human front pages, while an evidence page
 * is a verbatim capture plus provenance, and nothing else.
 *
 * The shape mirrors the `_meta/page-map` cache precedent (src/map.ts): header
 * blockquote with source/captured/context metadata, an empty fenced block the
 * caller fills with the raw material verbatim, and a capture-context section
 * whose three placeholder lines the caller replaces at capture time.
 */

export interface EvidenceSkeletonInput {
  /** Path of the human page this evidence backs (placeholder hint when unknown). */
  readonly sourcePath: string;
  /** URL of that human page. */
  readonly sourceUrl: string;
  /** ISO-8601 capture timestamp, supplied by the caller (pure function: no clock reads). */
  readonly capturedAt: string;
  /** One-line context for why this material was captured. */
  readonly context: string;
}

/** Full markdown skeleton for one machine-tier evidence page. Pure string
 *  transform — deterministic, no state, no I/O; empty inputs degrade to
 *  visible placeholders, never `undefined` leakage. */
export function evidenceSkeleton(o: EvidenceSkeletonInput): string {
  return [
    `> 机器层证据页 (machine-tier evidence). 来源页 (source): [${o.sourcePath}](${o.sourceUrl})` +
      ` · 采集 (captured): ${o.capturedAt} · 上下文 (context): ${o.context}`,
    '',
    '## 原文 (verbatim)',
    '',
    '```',
    '```',
    '',
    '## 采集环境 (capture context)',
    '',
    '- 命令 (command): `<the exact command as executed>`',
    '- 目录 (cwd): `<working directory at capture time>`',
    '- 时间 (time): `<capture timestamp>`',
  ].join('\n');
}

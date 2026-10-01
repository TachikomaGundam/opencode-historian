/**
 * historian_anchor — seal a human order/approval from the engine session store
 * into an _evidence/anchors wiki page, and verify a sealed anchor later.
 * Core logic (store reads, hashing, verdicts) lives in ../anchor.ts; this
 * wrapper only adds the wiki persistence leg. Evidence tier ⇒ monolingual en,
 * unpublished-friendly, per the G1 appendix contract.
 */
import { tool, type ToolDefinition } from '@opencode-ai/plugin';
import { readPage } from '../wiki/pages.read.js';
import { createPage } from '../wiki/pages.write.js';
import { errEnvelope, okJson, pageDeps, URL_MANDATE, type ToolDeps } from './shared.js';
import { defaultDbPath, renderSealPage, sealAnchor, verifyAnchor, type SealReceipt } from '../anchor.js';

const s = tool.schema;

const ARGS = {
  action: s.enum(['seal', 'verify']),
  slug: s.string().optional().describe('Evidence page name under _evidence/anchors/<slug> (default: canon-sha prefix).'),
  session_id: s.string().optional().describe('Engine session id (ses_...).'),
  session_title: s.string().optional().describe('Unique substring of the session title when the id is unknown.'),
  index: s.number().int().optional().describe("Message ordinal — 1-based (matches receipt ordinal); negative counts from the end."),
  body: s.string().optional().describe('Claimed exact body text — located by unique canonical match; repeated bodies come back body-ambiguous on purpose.'),
  label: s.string().optional().describe('Free-form label for the seal page heading.'),
} as const;

function extractReceipt(content: string): SealReceipt | undefined {
  const m = content.match(/```json historian-anchor\n([\s\S]*?)\n```/);
  if (m === null) return undefined;
  try {
    return JSON.parse(m[1]!) as SealReceipt;
  } catch {
    return undefined;
  }
}

export function makeAnchorTool(deps: ToolDeps): ToolDefinition {
  return tool({
    description:
      'Historian anchor (g12b-3 in the memory seat): action:"seal" locates a human order/approval message in the engine session store ' +
      '(by session_id/session_title + index or unique body match), hashes it (raw + canonical, closed normalization list) and writes an ' +
      '_evidence/anchors/<slug> receipt page; action:"verify" re-reads the store against a sealed page and returns MATCH/MISMATCH/ABSENT with drift fields. ' +
      'Read-only against the store; the wiki page is the durable receipt. ' + URL_MANDATE,
    args: ARGS,
    execute: async (raw) => {
      const a = raw as {
        action: 'seal' | 'verify';
        slug?: string | undefined;
        session_id?: string | undefined;
        session_title?: string | undefined;
        index?: number | undefined;
        body?: string | undefined;
        label?: string | undefined;
      };
      const dbPath = defaultDbPath(deps.homeDir);
      const now = new Date().toISOString();
      const pd = pageDeps(deps);
      try {
        if (a.action === 'seal') {
          const r = sealAnchor({
            dbPath,
            sessionId: a.session_id,
            sessionTitle: a.session_title,
            index: a.index,
            body: a.body,
            now,
          });
          if ('ok' in r) return errEnvelope(new Error(`anchor: ${r.error}${r.detail !== undefined ? ` — ${r.detail}` : ''}`));
          const slug = a.slug ?? r.canon_sha256.slice(0, 12);
          const path = `_evidence/anchors/${slug}`;
          const created = await createPage(pd, {
            path,
            locale: 'en',
            title: `Anchor seal ${slug}${a.label !== undefined ? ` — ${a.label}` : ''}`,
            content: renderSealPage(r, a.label),
            tags: ['anchor-seal', 'g12b-3'],
            isPublished: true,
            twin: false,
          });
          return okJson({ verdict: 'SEALED', slug, receipt: r, page: { path, pageId: created.pageId } });
        }
        // verify
        if (a.slug === undefined) return errEnvelope(new Error('anchor: verify needs the sealed slug'));
        const page = await readPage(pd.client, `_evidence/anchors/${a.slug}`, 'en');
        if (page === null) return errEnvelope(new Error(`anchor: seal page absent — ${a.slug}`));
        const stored = extractReceipt(page.content);
        if (stored === undefined) return errEnvelope(new Error(`anchor: seal page unparseable — ${a.slug}`));
        const v = verifyAnchor(stored, { dbPath, now });
        if ('ok' in v) return errEnvelope(new Error(`anchor: ${v.error}${v.detail !== undefined ? ` — ${v.detail}` : ''}`));
        return okJson({ verdict: v.verdict, drift: v.drift, stored: v.stored, current: v.current ?? null, page: { path: `_evidence/anchors/${a.slug}` } });
      } catch (e) {
        return errEnvelope(e instanceof Error ? e : new Error(String(e).slice(0, 300)));
      }
    },
  });
}

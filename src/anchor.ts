/**
 * Anchor sealing core (g12b-3 merged into the historian per owner order
 * 2026-10-01T16:24): a human order/approval message living in the engine's own
 * session store is located by (session, ordinal) or by unique exact body match,
 * hashed two ways (raw + canonical), and the receipt is written as an
 * _evidence/anchors page. `verify` re-reads the store and re-computes: MATCH /
 * MISMATCH / ABSENT — never a silent repair.
 *
 * The canonical-text rule is a CLOSED list (mirrors L-ORACLE-INTEGRITY's
 * normalization discipline): trailing <dcp-message-id ...>...</dcp-message-id>
 * block and surrounding whitespace. Anything else — including the engine
 * merging several user turns into one message while the agent is busy — is
 * NOT normalized away: a seal is only as atomic as the store row it names, and
 * the receipt says which row that was.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const DCP_STRIP_CLOSED_LIST = ['trailing <dcp-message-id…</dcp-message-id> block', 'outer whitespace'] as const;

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function canonicalText(raw: string): string {
  return raw.replace(/\s*<dcp-message-id[^>]*>[\s\S]*?<\/dcp-message-id>\s*$/g, '').trim();
}

export type StoreRow = {
  readonly messageId: string;
  readonly ordinal: number; // 1-based over message ids ordered by id (matches live probes)
  readonly role: string;
  readonly rawText: string;
};

export type SealReceipt = {
  readonly kind: 'historian-anchor';
  readonly action: 'seal';
  readonly sessionId: string;
  readonly messageId: string;
  readonly ordinal: number;
  readonly role: string;
  readonly dbPath: string;
  readonly raw_sha256: string;
  readonly canon_sha256: string;
  readonly canon_len: number;
  readonly normalization: readonly string[];
  readonly sealed_at: string;
};

export type AnchorError = { readonly ok: false; readonly error: string; readonly detail?: string };

export function defaultDbPath(homeDir: string): string {
  return process.env['OPENCODE_DB'] ?? `${homeDir}/.local/share/opencode/opencode.db`;
}

/** Minimal seam so the test environment (vitest cannot resolve node:sqlite)
 * injects a fake store while production keeps the real read-only DatabaseSync. */
export interface DbLike {
  prepare(sql: string): { all(...a: unknown[]): unknown[]; get(...a: unknown[]): unknown };
  close(): void;
}
export type DbOpener = (dbPath: string) => DbLike | AnchorError;

function productionOpener(dbPath: string): DbLike | AnchorError {
  try {
    // createRequire('node:sqlite') keeps the module out of vite's static graph
    // (its loader cannot resolve node:sqlite); tests inject `open` and never reach here.
    const req = createRequire(fileURLToPath(import.meta.url));
    const mod = req('node:sqlite') as { DatabaseSync: new (p: string, o: { readOnly: boolean }) => DbLike };
    return new mod.DatabaseSync(dbPath, { readOnly: true });
  } catch (e) {
    return { ok: false, error: 'store-unreadable', detail: String(e).slice(0, 200) };
  }
};

function openRo(dbPath: string, open: DbOpener = productionOpener): DbLike | AnchorError {
  return open(dbPath);
}

function messagesOf(db: DbLike, sessionId: string): StoreRow[] {
  const rows = db
    .prepare('select id, data from message where session_id = ? order by id')
    .all(sessionId) as { id: string; data: string }[];
  const out: StoreRow[] = [];
  rows.forEach((r, i) => {
    let role = '';
    try {
      role = (JSON.parse(r.data) as { role?: string }).role ?? '';
    } catch {
      role = '';
    }
    const parts = db.prepare('select data from part where message_id = ? order by id').all(r.id) as { data: string }[];
    const texts: string[] = [];
    for (const p of parts) {
      try {
        const d = JSON.parse(p.data) as { type?: string; text?: string };
        if (d.type === 'text' && typeof d.text === 'string') texts.push(d.text);
      } catch {
        /* part shapes we do not read are skipped, not fatal */
      }
    }
    out.push({ messageId: r.id, ordinal: i + 1, role, rawText: texts.join('\n') });
  });
  return out;
}

export function resolveSessionId(db: DbLike, sessionId: string | undefined, titleLike: string | undefined): string | AnchorError {
  if (sessionId !== undefined) {
    const hit = db.prepare('select id from session where id = ?').get(sessionId) as { id: string } | undefined;
    return hit === undefined ? { ok: false, error: 'session-absent', detail: sessionId } : hit.id;
  }
  if (titleLike === undefined) return { ok: false, error: 'no-locator', detail: 'pass session_id or session_title' };
  const hits = db.prepare('select id from session where title like ? order by time_updated desc').all(`%${titleLike}%`) as { id: string }[];
  if (hits.length === 0) return { ok: false, error: 'session-absent', detail: titleLike };
  if (hits.length > 1) return { ok: false, error: 'session-ambiguous', detail: `${hits.length} sessions match "${titleLike}"` };
  return hits[0]!.id;
}

/** Locate the anchor message: by ordinal (1-based; negative counts from end) or by UNIQUE exact canonical-body match. */
export function locateMessage(db: DbLike, sessionId: string, index: number | undefined, body: string | undefined): StoreRow | AnchorError {
  const rows = messagesOf(db, sessionId);
  if (rows.length === 0) return { ok: false, error: 'session-empty', detail: sessionId };
  if (index !== undefined) {
    // locator convention = the receipt's 1-based ordinal; negative counts from the end.
    const i = index > 0 ? index - 1 : rows.length + index;
    const row = i < 0 ? undefined : rows[i];
    return row === undefined ? { ok: false, error: 'index-absent', detail: `index ${index} of ${rows.length}` } : row;
  }
  if (body !== undefined) {
    const want = canonicalText(body);
    const hits = rows.filter((r) => canonicalText(r.rawText) === want);
    if (hits.length === 0) return { ok: false, error: 'body-absent', detail: `no single message equals the claimed body (scanned ${rows.length})` };
    if (hits.length > 1) {
      // A repeated short order ("同意" x2) is deliberately NOT auto-picked: ambiguity names the ordinals.
      return { ok: false, error: 'body-ambiguous', detail: `body found at ordinals ${hits.map((h) => h.ordinal).join(',')} — re-seal with explicit index` };
    }
    return hits[0]!;
  }
  return { ok: false, error: 'no-locator', detail: 'pass index or body' };
}

export function sealAnchor(opts: {
  dbPath: string;
  sessionId?: string | undefined;
  sessionTitle?: string | undefined;
  index?: number | undefined;
  body?: string | undefined;
  now: string;
  open?: DbOpener | undefined;
}): SealReceipt | AnchorError {
  const db = openRo(opts.dbPath, opts.open);
  if ('ok' in db) return db;
  try {
    const sid = resolveSessionId(db, opts.sessionId, opts.sessionTitle);
    if (typeof sid !== 'string') return sid;
    const row = locateMessage(db, sid, opts.index, opts.body);
    if ('ok' in row) return row;
    return {
      kind: 'historian-anchor',
      action: 'seal',
      sessionId: sid,
      messageId: row.messageId,
      ordinal: row.ordinal,
      role: row.role,
      dbPath: opts.dbPath,
      raw_sha256: sha256(row.rawText),
      canon_sha256: sha256(canonicalText(row.rawText)),
      canon_len: canonicalText(row.rawText).length,
      normalization: DCP_STRIP_CLOSED_LIST,
      sealed_at: opts.now,
    };
  } finally {
    db.close();
  }
}

export type VerifyVerdict = { readonly verdict: 'MATCH' | 'MISMATCH' | 'ABSENT'; readonly stored: SealReceipt; readonly current?: SealReceipt; readonly drift: readonly string[] };

export function verifyAnchor(stored: SealReceipt, opts: { dbPath: string; now: string; open?: DbOpener | undefined }): VerifyVerdict | AnchorError {
  const db = openRo(opts.dbPath, opts.open);
  if ('ok' in db) return db;
  try {
    const rows = messagesOf(db, stored.sessionId);
    const row = rows.find((r) => r.messageId === stored.messageId);
    if (row === undefined) return { verdict: 'ABSENT', stored, drift: ['message row gone'] };
    const current: SealReceipt = {
      ...stored,
      dbPath: opts.dbPath,
      raw_sha256: sha256(row.rawText),
      canon_sha256: sha256(canonicalText(row.rawText)),
      canon_len: canonicalText(row.rawText).length,
      sealed_at: opts.now,
    };
    const drift = (['raw_sha256', 'canon_sha256'] as const).filter((k) => current[k] !== stored[k]);
    return { verdict: drift.length === 0 ? 'MATCH' : 'MISMATCH', stored, current, drift };
  } finally {
    db.close();
  }
}

export function renderSealPage(r: SealReceipt, label?: string): string {
  return [
    `# Anchor seal: ${label ?? r.messageId}`,
    '',
    '| field | value |',
    '|---|---|',
    `| session | \`${r.sessionId}\` |`,
    `| message | \`${r.messageId}\` (ordinal ${r.ordinal}, role ${r.role}) |`,
    `| raw sha256 | \`${r.raw_sha256}\` |`,
    `| canonical sha256 | \`${r.canon_sha256}\` (len ${r.canon_len}) |`,
    `| normalization | ${r.normalization.join('; ')} |`,
    `| store | \`${r.dbPath}\` |`,
    `| sealed at | ${r.sealed_at} |`,
    '',
    '```json historian-anchor',
    JSON.stringify(r),
    '```',
    '',
    'Verify via historian_anchor action:"verify" — stored JSON above is the claim; the engine store is the truth.',
  ].join('\n');
}

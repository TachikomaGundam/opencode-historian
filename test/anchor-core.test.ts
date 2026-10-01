/** g12b-3 anchor core tests — injected fake store (vitest cannot resolve node:sqlite;
 * production opener is exercised separately at live-fire). */
import { describe, it, expect } from 'vitest';
import { canonicalText, sealAnchor, verifyAnchor, sha256, type DbLike } from '../src/anchor.js';

type Row = { role: string; text: string; gone?: boolean };

function mk(rows: Record<string, Row>): { dbPath: string; open: () => DbLike; rows: Record<string, Row> } {
  const order = Object.keys(rows);
  const dbPath = 'fake://anchor';
  const open = (): DbLike => ({
    prepare(sql: string) {
      return {
        all: (...a: unknown[]) => {
          if (sql.startsWith('select id, data from message')) {
            return order.filter((id) => !rows[id]?.gone).map((id) => ({ id, data: JSON.stringify({ role: rows[id]?.role }) }));
          }
          if (sql.includes('from session where title like')) {
            return String(a[0]).includes('西比拉') ? [{ id: 'ses_x' }] : [];
          }
          if (sql.startsWith('select data from part')) {
            const mid = String(a[0]);
            return rows[mid]?.gone ? [] : [{ data: JSON.stringify({ type: 'text', text: rows[mid]?.text ?? '' }) }];
          }
          return [];
        },
        get: (...a: unknown[]) => {
          if (sql.includes('where id = ?')) return String(a[0]) === 'ses_x' ? { id: 'ses_x' } : undefined;
          if (sql.includes('title like')) return String(a[0]).includes('西比拉') ? { id: 'ses_x' } : undefined;
          return undefined;
        },
      };
    },
    close: () => undefined,
  });
  return { dbPath, open: open as DbLike extends never ? never : () => DbLike, rows };
}

const base = () => ({
  msg_a: { role: 'user', text: '同意' },
  msg_b: { role: 'assistant', text: '收到' },
  msg_c: { role: 'user', text: '同意' },
  msg_d: { role: 'user', text: 'Opencode已重启\n\n<dcp-message-id tokens="1" type="text">m9</dcp-message-id>' },
});

describe('canonicalText', () => {
  it('strips trailing dcp block and outer whitespace only', () => {
    expect(canonicalText('同意\n\n<dcp-message-id tokens="1" type="text">m1</dcp-message-id>')).toBe('同意');
    expect(canonicalText(' 同意 ')).toBe('同意');
    expect(canonicalText('a<dcp-message-id x>y</dcp-message-id>b')).toBe('a<dcp-message-id x>y</dcp-message-id>b');
  });
});

describe('sealAnchor', () => {
  it('locates by unique ordinal and hashes raw vs canonical distinctly', () => {
    const f = mk(base());
    const r = sealAnchor({ dbPath: f.dbPath, open: f.open, sessionId: 'ses_x', index: -1, now: 't0' });
    expect('ok' in r).toBe(false);
    const s = r as { role: string; raw_sha256: string; canon_sha256: string };
    expect(s.role).toBe('user');
    expect(s.canon_sha256).toBe(sha256('Opencode已重启'));
    expect(s.raw_sha256).not.toBe(s.canon_sha256);
  });
  it('repeated short order => body-ambiguous naming ordinals, never auto-pick', () => {
    const f = mk(base());
    const r = sealAnchor({ dbPath: f.dbPath, open: f.open, sessionId: 'ses_x', body: '同意', now: 't0' }) as { error: string; detail: string };
    expect(r.error).toBe('body-ambiguous');
    expect(r.detail).toContain('1');
    expect(r.detail).toContain('3');
  });
  it('unique body match seals', () => {
    const f = mk(base());
    const r = sealAnchor({ dbPath: f.dbPath, open: f.open, sessionTitle: '西比拉', body: '收到', now: 't0' }) as { ordinal: number };
    expect(r.ordinal).toBe(2);
  });
  it('absent body / bad session honest errors', () => {
    const f = mk(base());
    expect((sealAnchor({ dbPath: f.dbPath, open: f.open, sessionId: 'ses_x', body: '没说过', now: 't0' }) as { error: string }).error).toBe('body-absent');
    expect((sealAnchor({ dbPath: f.dbPath, open: f.open, sessionId: 'ses_nope', index: 0, now: 't0' }) as { error: string }).error).toBe('session-absent');
  });
});

describe('verifyAnchor', () => {
  it('MATCH on untouched store', () => {
    const f = mk(base());
    const seal = sealAnchor({ dbPath: f.dbPath, open: f.open, sessionId: 'ses_x', index: 1, now: 't0' }) as never;
    const v = verifyAnchor(seal, { dbPath: f.dbPath, open: f.open, now: 't1' }) as { verdict: string };
    expect(v.verdict).toBe('MATCH');
  });
  it('MISMATCH after the row was rewritten behind the seal', () => {
    const f = mk(base());
    const seal = sealAnchor({ dbPath: f.dbPath, open: f.open, sessionId: 'ses_x', index: 1, now: 't0' }) as never;
    f.rows.msg_a = { role: 'user', text: '不同意' };
    const v = verifyAnchor(seal, { dbPath: f.dbPath, open: f.open, now: 't1' }) as { verdict: string; drift: string[] };
    expect(v.verdict).toBe('MISMATCH');
    expect(v.drift).toContain('canon_sha256');
  });
  it('ABSENT when the row is deleted', () => {
    const f = mk(base());
    const seal = sealAnchor({ dbPath: f.dbPath, open: f.open, sessionId: 'ses_x', index: 1, now: 't0' }) as never;
    f.rows.msg_a = { role: 'user', text: '', gone: true };
    const v = verifyAnchor(seal, { dbPath: f.dbPath, open: f.open, now: 't1' }) as { verdict: string };
    expect(v.verdict).toBe('ABSENT');
  });
});

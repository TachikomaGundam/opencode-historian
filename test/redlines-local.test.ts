import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Pins the owner-handle-email red-line semantics (owner ruling 2026-10-05, option b):
// the handle is forbidden AS CONTACT (handle@… email shapes), NOT as canonical
// repository identity — OIDC provenance publishes the GitHub owner regardless,
// so a bare-handle ban could not honestly hold. File is machine-local (gitignored):
// the suite self-skips on fresh clones where the local policy list is absent.
const LOCAL_FILE = join(__dirname, '..', 'tools', 'redlines.local.json');
const hasLocal = existsSync(LOCAL_FILE);

interface Rule { name: string; pattern: string; flags?: string }

const rules = (): Rule[] =>
  JSON.parse(readFileSync(LOCAL_FILE, 'utf8')) as Rule[];

const re = (r: Rule): RegExp => new RegExp(r.pattern, r.flags ?? 'i');

describe.skipIf(!hasLocal)('owner-handle-email red line (contact-shape predicate)', () => {
  const owner = rules().find((r) => r.name === 'owner-handle-email');
  it('rule exists', () => expect(owner).toBeDefined());

  it('fires on handle used as contact email', () => {
    expect(re(owner!).test('TachikomaGundam@users.noreply.github.com')).toBe(true);
    expect(re(owner!).test('mail tachikomagundam@gmail.com')).toBe(true);
  });

  it('does not fire on the canonical repository URL identity', () => {
    expect(re(owner!).test('git+https://github.com/TachikomaGundam/opencode-historian.git')).toBe(false);
  });

  it('shipped repository field stays clean against the WHOLE local list', () => {
    const repo: string = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ).repository.url;
    for (const r of rules()) {
      expect(re(r).test(repo), `rule ${r.name} must not fire on repository field`).toBe(false);
    }
  });
});

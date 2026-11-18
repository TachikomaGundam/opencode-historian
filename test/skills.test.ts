/**
 * Skill-package discovery tests (V2 skill.transform供货面, see src/skills.ts).
 * The repo's own skills/ directory doubles as the real-layout fixture.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { collectSkillEntries, parseFrontmatter } from '../src/skills.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'hist-skills-'));
  const a = join(root, 'alpha');
  mkdirSync(a, { recursive: true });
  writeFileSync(
    join(a, 'SKILL.md'),
    '---\nname: alpha\ndescription: "Alpha skill: does α things."\n---\n\n# Alpha\n\nbody text here\n',
  );
  const b = join(root, 'beta');
  mkdirSync(b, { recursive: true });
  writeFileSync(join(b, 'SKILL.md'), 'no frontmatter at all\njust body\n');
  mkdirSync(join(root, 'not-a-skill'), { recursive: true }); // no SKILL.md → skipped
  writeFileSync(join(root, 'SKILL.md'), '---\nname: root-skill\ndescription: root pkg\n---\nroot body\n');
  return root;
}

describe('parseFrontmatter', () => {
  it('parses flat quoted fields and returns the body after the block', () => {
    const { fields, body } = parseFrontmatter('---\nname: x\ndescription: "q: with colon"\n---\nBODY\n');
    expect(fields.name).toBe('x');
    expect(fields.description).toBe('q: with colon');
    expect(body.trim()).toBe('BODY');
  });

  it('returns raw as body and no fields when there is no frontmatter', () => {
    const { fields, body } = parseFrontmatter('just text');
    expect(Object.keys(fields).length).toBe(0);
    expect(body).toBe('just text');
  });
});

describe('collectSkillEntries', () => {
  it('finds root + nested SKILL.md, guarantees id/name/description/content, skips junk', () => {
    const logs: string[] = [];
    const entries = collectSkillEntries(fixture(), { log: (m) => logs.push(m) });
    const ids = entries.map((e) => e.id).sort();
    expect(ids).toEqual(['alpha', 'beta', 'root-skill']);
    const alpha = entries.find((e) => e.id === 'alpha')!;
    expect(alpha.description).toBe('Alpha skill: does α things.');
    expect(alpha.content).toContain('body text here');
    // fallbacks: no frontmatter → dir-name id/name, generated description
    const beta = entries.find((e) => e.id === 'beta')!;
    expect(beta.name).toBe('beta');
    expect(beta.content).toContain('just body');
    expect(beta.description.length).toBeGreaterThan(0);
    expect(logs.length).toBe(0);
  });

  it('missing root yields empty list, not a crash', () => {
    expect(collectSkillEntries(join(tmpdir(), 'definitely-not-here-' + Date.now()))).toEqual([]);
  });

  it('the shipped skills/ layout registers at least the historian package with host-required fields', () => {
    const entries = collectSkillEntries(new URL('../skills/', import.meta.url).pathname);
    expect(entries.some((e) => e.id === 'historian' && e.content.includes('史官'))).toBe(true);
  });
});

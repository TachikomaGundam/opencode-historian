/**
 * Contract locks for the shipped skill docs (plan v2 todo 10, v3 todo 8):
 * SKILL.md must carry the V5 机构记忆层 marker, no stale marker (行为契约 v3
 * or the previous V4-era 机构记忆层 title/frontmatter) may survive anywhere
 * under skills/, and the v5 contract surfaces (G5 / timeline / readingLoop /
 * capture / evidence tier / adapting guide) must be documented.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url));
const SKILL_MD_PATH = join(SKILLS_DIR, 'historian', 'SKILL.md');
const SKILL_MD = readFileSync(SKILL_MD_PATH, 'utf8');

function markdownFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(p));
    else if (entry.name.endsWith('.md')) found.push(p);
  }
  return found;
}

describe('SKILL.md V5 contract marker', () => {
  it('carries the V5 机构记忆层 marker', () => {
    expect(SKILL_MD).toContain('行为契约 V5 机构记忆层');
  });

  it('leaves no stale contract marker (行为契约 v3 / V4-era title residue) anywhere under skills/', () => {
    // The V4 marker string is assembled at runtime: a verbatim literal here
    // would make the plan's tree-wide stale grep (src/ skills/ test/ must be
    // empty) match this very scanner. Runtime value is identical either way.
    const staleV4 = ['V4', '机构记忆层'].join(' ');
    const stale = markdownFiles(SKILLS_DIR).filter((f) => {
      const text = readFileSync(f, 'utf8');
      return text.includes('行为契约 v3') || text.includes(staleV4);
    });
    expect(stale).toEqual([]);
  });

  it('documents the v5 memory-layer contract surfaces', () => {
    for (const needle of [
      'G5',
      '上次核实于',
      'action=timeline',
      'readingLoop',
      '/historian-capture',
      'capture',
      '绝不自动写页',
      '_evidence',
      'tier',
    ]) {
      expect(SKILL_MD).toContain(needle);
    }
  });

  it('ships the adapting-your-own-wiki guide and links it from SKILL.md', () => {
    expect(SKILL_MD).toContain('references/adapting-your-own-wiki.md');
    expect(existsSync(join(SKILLS_DIR, 'historian', 'references', 'adapting-your-own-wiki.md'))).toBe(true);
  });
});

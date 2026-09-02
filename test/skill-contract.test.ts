/**
 * Contract locks for the shipped skill docs (plan v2 todo 10):
 * SKILL.md must carry the V4 机构记忆层 marker, no stale 行为契约 v3 marker
 * may survive anywhere under skills/, and the v4 contract surfaces
 * (G5 / timeline / readingLoop / capture / adapting guide) must be documented.
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

describe('SKILL.md V4 contract marker', () => {
  it('carries the V4 机构记忆层 marker', () => {
    expect(SKILL_MD).toContain('行为契约 V4 机构记忆层');
  });

  it('leaves no stale 行为契约 v3 marker anywhere under skills/', () => {
    const stale = markdownFiles(SKILLS_DIR).filter(
      (f) => readFileSync(f, 'utf8').includes('行为契约 v3'),
    );
    expect(stale).toEqual([]);
  });

  it('documents the v4 memory-layer contract surfaces', () => {
    for (const needle of [
      'G5',
      '上次核实于',
      'action=timeline',
      'readingLoop',
      '/historian-capture',
      'capture',
      '绝不自动写页',
    ]) {
      expect(SKILL_MD).toContain(needle);
    }
  });

  it('ships the adapting-your-own-wiki guide and links it from SKILL.md', () => {
    expect(SKILL_MD).toContain('references/adapting-your-own-wiki.md');
    expect(existsSync(join(SKILLS_DIR, 'historian', 'references', 'adapting-your-own-wiki.md'))).toBe(true);
  });
});

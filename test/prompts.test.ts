/**
 * prompts.ts single-source pins: the text contract that ships in the tarball
 * must survive the extraction from index.ts verbatim, and both plugin
 * generations must consume this module (drift = the bug class it消灭s → see
 * header; test asserts structural invariants, not the whole prose).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  READING_LOOP_ADVISORY,
  CAPTURE_COMMAND_DESCRIPTION,
  CAPTURE_COMMAND_TEMPLATE,
  CAPTURE_TOAST_MESSAGE,
} from '../src/prompts.js';

describe('prompts single source', () => {
  it('reading-loop advisory keeps its contract markers and ≤8-line budget', () => {
    expect(READING_LOOP_ADVISORY).toContain('historian_search');
    expect(READING_LOOP_ADVISORY).toContain('PREFER UPDATE over CREATE');
    expect(READING_LOOP_ADVISORY.split('\n').length).toBeLessThanOrEqual(8);
  });

  it('capture command template keeps the G1 evidence-chain contract markers', () => {
    for (const marker of ['historian_map', 'historian_page_create', 'tier:"evidence"', '_evidence/', '四段式', '十项自检', '状态:draft']) {
      expect(CAPTURE_COMMAND_TEMPLATE).toContain(marker);
    }
    expect(CAPTURE_COMMAND_DESCRIPTION).toContain('historian');
  });

  it('capture reminder names the command it nudges toward', () => {
    expect(CAPTURE_TOAST_MESSAGE).toContain('/historian-capture');
  });

  it('index.ts and v2.ts import from prompts.js (no re-inlined copies)', () => {
    for (const f of ['src/index.ts', 'src/v2.ts']) {
      const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
      expect(src).toContain("from './prompts.js'");
      expect(src).not.toContain("PREFER UPDATE over CREATE: if a page");
    }
  });
});

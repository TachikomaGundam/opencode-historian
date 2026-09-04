/**
 * Contract locks for the shipped skill docs (plan v2 todo 10, v3 todo 8,
 * v4 todo 11): SKILL.md must carry the V6 进化驱动 marker, no stale marker
 * (行为契约 v3 / V4-era 机构记忆层 title / bare V5) may survive anywhere
 * under skills/, the v6 three-loop contract (capture triggers + 四段式
 * evidence chain + maintain protocol + reorg freeze) must be documented, and
 * the retired v2 four-part wording must be gone from SKILL.md (char-level) and
 * from every shipped doc (README + all skills markdown, joined-string level).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const SKILLS_DIR = fileURLToPath(new URL('../skills/', import.meta.url));
const SKILL_MD_PATH = join(SKILLS_DIR, 'historian', 'SKILL.md');
const SKILL_MD = readFileSync(SKILL_MD_PATH, 'utf8');
const README_MD_PATH = fileURLToPath(new URL('../README.md', import.meta.url));

function markdownFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(p));
    else if (entry.name.endsWith('.md')) found.push(p);
  }
  return found;
}

describe('SKILL.md V6 contract marker', () => {
  it('carries the V6 进化驱动 marker in title and frontmatter', () => {
    expect(SKILL_MD).toContain('行为契约 V6 进化驱动');
    const frontmatter = SKILL_MD.slice(0, SKILL_MD.indexOf('---', 4));
    expect(frontmatter).toContain('V6');
    expect(frontmatter).toContain('G1-G6');
  });

  it('leaves no stale contract marker (行为契约 v3 / V4-era title / V5) anywhere under skills/', () => {
    // The stale version literals are assembled at runtime: a verbatim literal
    // here would make the plan's tree-wide stale grep (src/ skills/ test/ must
    // be empty) match this very scanner. Runtime values are identical either way.
    const staleV4 = ['V4', '机构记忆层'].join(' ');
    const staleV5 = ['V', '5'].join('');
    const stale = markdownFiles(SKILLS_DIR).filter((f) => {
      const text = readFileSync(f, 'utf8');
      return (
        text.includes('行为契约 v3') ||
        text.includes(staleV4) ||
        text.includes(staleV5)
      );
    });
    expect(stale).toEqual([]);
  });
});

describe('SKILL.md v6 three-loop contract', () => {
  it('documents the 三回路总览 (capture / curate / gate)', () => {
    for (const needle of ['三回路', '捕获回路', '策展回路', '闸门回路', '/historian-capture']) {
      expect(SKILL_MD).toContain(needle);
    }
  });

  it('lists all five capture triggers exactly as CAPTURE_COMMAND_TEMPLATE', () => {
    for (const needle of ['事故闭环', '部署完成', 'bug修复合入', '探针结论', '被否决方案', '否决理由']) {
      expect(SKILL_MD).toContain(needle);
    }
  });

  it('documents the new 四段式 evidence-chain body contract', () => {
    for (const needle of ['四段式', '证据链', '方法/Method', '修复手段', '函数级实现']) {
      expect(SKILL_MD).toContain(needle);
    }
  });

  it('documents SRE metadata rows and the evidence split + draft→Active flow', () => {
    for (const needle of ['来源类型', '后续动作', '影响/负责人', 'tier:"evidence"', '_evidence', '状态:draft', 'draft→Active', '十项自检']) {
      expect(SKILL_MD).toContain(needle);
    }
  });

  it('drops the retired v2 four-part 过程/原因/后果/改进 wording entirely', () => {
    for (const dead of ['过程', '原因', '后果', '改进']) {
      expect(SKILL_MD).not.toContain(dead);
    }
  });

  it('keeps the retired v2 four-part joined strings out of every shipped doc', () => {
    // Root-cause lock: the char-level SKILL.md scan above let README.md ship
    // the retired label; this scans README + all skills markdown (incl.
    // references/) for the joined legacy strings (assembled at runtime, like
    // the stale-marker scanner, so the tree-wide needle grep stays clean).
    const deadJoined = [
      ['过程', '原因', '后果', '改进'].join('/'),
      ['过程', '原因', '结果', '改进'].join('/'),
    ];
    const shipped = [README_MD_PATH, ...markdownFiles(SKILLS_DIR)];
    const offenders = shipped.filter((f) =>
      deadJoined.some((d) => readFileSync(f, 'utf8').includes(d)),
    );
    expect(offenders).toEqual([]);
  });
});

describe('SKILL.md curate loop: maintain protocol + refresh cadence', () => {
  it('documents the maintain light/deep cadence', () => {
    for (const needle of ['maintain', 'light', 'deep', '批量写后必跑', '每周至多一次']) {
      expect(SKILL_MD).toContain(needle);
    }
  });

  it('maps every maintain report row to a disposition', () => {
    for (const needle of ['补孪生', 'bold-merge', 'mark/refresh', '归架', '词表映射']) {
      expect(SKILL_MD).toContain(needle);
    }
  });

  it('locks the refresh-after-write-batch rhythm', () => {
    expect(SKILL_MD).toContain('写批后即');
    expect(SKILL_MD).toContain("action:'refresh'");
  });
});

describe('SKILL.md v6 discipline: freeze protocol + opportunistic backfill', () => {
  it('documents the 重构冻结协议 (K2 six handoff lessons)', () => {
    for (const needle of ['重构冻结协议', '只读不写', 'PageNotFound', 'preimage', 'Redirect 存根', '> Redirect:', '机械改动']) {
      expect(SKILL_MD).toContain(needle);
    }
  });

  it('documents opportunistic backfill (touch=顺手 migrate, no dedicated sweep)', () => {
    expect(SKILL_MD).toContain('Opportunistic backfill');
    expect(SKILL_MD).toContain('顺手 migrate');
    expect(SKILL_MD).toContain('尾部页');
  });
});

describe('SKILL.md inherited v5/v4 surfaces still documented', () => {
  it('covers G1-G6 genres incl. G6 操作手册 and G5 stamps', () => {
    for (const needle of ['G1-G6', 'G6 操作手册', 'G5', '上次核实于', 'action=timeline']) {
      expect(SKILL_MD).toContain(needle);
    }
  });

  it('documents the reading loop / capture gates and evidence tier', () => {
    for (const needle of ['readingLoop', '/historian-capture', 'capture', '绝不自动写页', '_evidence', 'tier', 'sections']) {
      expect(SKILL_MD).toContain(needle);
    }
  });

  it('ships the adapting-your-own-wiki guide and links it from SKILL.md', () => {
    expect(SKILL_MD).toContain('references/adapting-your-own-wiki.md');
    expect(existsSync(join(SKILLS_DIR, 'historian', 'references', 'adapting-your-own-wiki.md'))).toBe(true);
  });
});

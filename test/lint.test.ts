/**
 * lint.ts unit tests — the architecture-page audit (HANDOFF #6) and the
 * deepseek stub audit (#5) reproduced as fixtures: every regression the live
 * wiki taught us gets a failing-shape test here.
 */

import { describe, it, expect } from 'vitest';
import { lintBody, publishGateViolations, h1TitleMismatch, type LintOpts } from '../src/lint.js';

const BASE: LintOpts = { locale: 'en', baseUrl: 'http://localhost:3000', title: 'Architecture' };

describe('lintBody — publish-gate rules', () => {
  it('flags Active + TODO comments + empty sections (architecture-page shape)', () => {
    const body = [
      '# Architecture Diagram',
      '',
      '**状态/Status**: Active <!-- or Superseded-by: <path> --> · **日期/Date**: 2026-09-04',
      '',
      '## Definition and Rationale',
      '<!-- TODO: fill -->',
      '## How It Works',
      '<!-- placeholder -->',
      '## Attribution and Opinion',
      '',
      '## Related Pages',
      '<!-- placeholder -->',
    ].join('\n');
    const l = lintBody(body, BASE);
    expect(l.state).toBe('active');
    expect(l.todoMarkers).toBeGreaterThanOrEqual(3);
    expect(l.emptySections).toEqual(
      expect.arrayContaining(['Definition and Rationale', 'How It Works', 'Related Pages']),
    );
    expect(publishGateViolations(l)).toContain('active-with-unfinished-skeleton');
  });

  it('lets a clean Active page pass', () => {
    const body = [
      '# Architecture Diagram',
      '',
      '**状态/Status**: Active · **日期/Date**: 2026-09-07',
      '',
      '这是一段足够长的导言，覆盖系统分层与调用链路，并说明本页的适用范围与边界条件。',
      '',
      '## 系统组成',
      '网关、认证、数据与推理四层，各层职责见下表与相关页面。',
      '',
      '## 相关页面',
      '- [服务台账](/infra/services)',
    ].join('\n');
    const l = lintBody(body, { ...BASE, title: 'Architecture Diagram' });
    expect(l.state).toBe('active');
    expect(l.introEmpty).toBe(false);
    expect(l.emptySections).toEqual([]);
    expect(l.hasRelatedPages).toBe(true);
    expect(publishGateViolations(l)).toEqual([]);
  });

  it('draft state tolerates unfinished skeleton (capture-loop flow)', () => {
    const body = '# X\n\n**状态/Status**: draft\n\n## 空节\n<!-- TODO -->\n';
    const l = lintBody(body, { ...BASE, title: 'X' });
    expect(l.state).toBe('draft');
    expect(l.emptySections).toEqual(['空节']);
    expect(publishGateViolations(l)).toEqual([]);
  });

  it('redirect stub without a clickable exit is refused; with <a>/md link it passes (#5.1)', () => {
    const dead = [
      '> Redirect: /zh/llm-eval/deepseek-v4-pro-0813-comparison',
      '',
      '**已并入 / 已整合至：** `/llm-eval/deepseek/deepseek-v4-pro-0813-comparison`。',
    ].join('\n');
    const l1 = lintBody(dead, BASE);
    expect(l1.isRedirectStub).toBe(true);
    expect(l1.stubHasLink).toBe(false);
    expect(publishGateViolations(l1)).toContain('redirect-stub-no-exit');

    const live = dead + '\n\n- 转往目标页：[对比评测](/zh/llm-eval/deepseek/deepseek-v4-pro-0813-comparison)\n';
    const l2 = lintBody(live, BASE);
    expect(l2.stubHasLink).toBe(true);
    expect(publishGateViolations(l2)).toEqual([]);
  });

  it('markers inside fenced code blocks never count', () => {
    const body = [
      '# X',
      '',
      '**状态/Status**: Active',
      '',
      '## 用法',
      '```bash',
      '# TODO: this is example output, not a page defect',
      '## Heading Inside Fence',
      '```',
      '真正的正文内容在这里，长度足够通过导言判定检查。',
    ].join('\n');
    const l = lintBody(body, { ...BASE, title: 'X' });
    expect(l.todoMarkers).toBe(0);
    expect(l.emptySections).toEqual([]);
    expect(publishGateViolations(l)).toEqual([]);
  });
});

describe('lintBody — structural facts', () => {
  it('intro-empty when only the status block precedes the first heading', () => {
    const l = lintBody('# T\n\n**状态/Status**: Active · **日期/Date**: 2026-01-01\n\n## A\n\n正文内容。', {
      ...BASE,
      title: 'T',
    });
    expect(l.introEmpty).toBe(true);
  });

  it('h1 mismatch against the page title', () => {
    const l = lintBody('# Architecture Diagram\n\n内容内容内容内容内容内容内容内容内容内容内容内容内容内容内容。', BASE);
    expect(l.h1).toBe('Architecture Diagram');
    expect(h1TitleMismatch(l, 'Architecture')).toBe(true);
    expect(h1TitleMismatch(l, 'Architecture Diagram')).toBe(false);
    expect(h1TitleMismatch(l, undefined)).toBe(false);
  });

  it('claims + stamp surface machine facts needing re-verification', () => {
    const body = [
      '# 服务台账',
      '',
      'llama-server 监听 :8000，wiki 在 :3000，Grafana 在 :3001。',
      '脚本 /opt/llm-monitor/parse-stats.py 每 1s 轮询，systemctl status llm-monitor。',
      '数据源 http://127.0.0.1:8081/metrics。',
    ].join('\n');
    const l = lintBody(body, { ...BASE, title: '服务台账' });
    expect(l.claims.ports).toBeGreaterThanOrEqual(4);
    expect(l.claims.paths).toBe(1);
    expect(l.claims.commands).toBeGreaterThanOrEqual(1);
    expect(l.hasStamp).toBe(false);
    const stamped = l; // reuse
    expect(stamped.claimTotal).toBeGreaterThanOrEqual(6);
  });

  it('上次核实于 flips hasStamp', () => {
    const l = lintBody('# A\n\n端口 :3000。上次核实于 2026-09-07。', { ...BASE, title: 'A' });
    expect(l.hasStamp).toBe(true);
  });

  it('cjkRatio separates Chinese-led bodies from English-only twins (#6.16)', () => {
    const zh = lintBody('# 架构\n\n这是中文为主的正文，描述系统分层与调用链路。', {
      locale: 'zh',
      baseUrl: BASE.baseUrl,
      title: '架构',
    });
    expect(zh.cjkRatio).toBeGreaterThan(0.3);
    const enOnly = lintBody(
      '# Architecture\n\nThis body is entirely English prose describing the stack in detail.',
      { locale: 'zh', baseUrl: BASE.baseUrl, title: 'Architecture' },
    );
    expect(enOnly.cjkRatio).toBeLessThan(0.06);
  });
});

describe('lintBody — link extraction', () => {
  const body = [
    '# T',
    '',
    '- [rel en](/llm-eval/foo)',
    '- [rel zh](/zh/llm-eval/foo)',
    '- [absolute](http://localhost:3000/infra/services)',
    '- [abs zh](http://localhost:3000/zh/infra/network)',
    '- [external](https://example.com/x)',
    '- [anchor](#section)',
    '- [dup](/llm-eval/foo)',
    '- <a href="/eda/kicad">html</a>',
    '- [asset](/files/img.png)',
    '<!-- [hidden comment link](/nope) -->',
  ].join('\n');
  const l = lintBody(body, { ...BASE, title: 'T' });

  it('normalizes internal targets, keeps locale, drops anchors/external/assets/comments', () => {
    const paths = l.links.map((k) => `${k.locale}:${k.path}`);
    expect(paths).toEqual(
      expect.arrayContaining(['en:llm-eval/foo', 'zh:llm-eval/foo', 'en:infra/services', 'zh:infra/network', 'en:eda/kicad']),
    );
    expect(paths).not.toContain('en:nope');
    expect(paths).not.toContain('en:files/img.png');
    expect(l.links.some((k) => k.path.includes('example.com'))).toBe(false);
    expect(l.links.filter((k) => k.locale === 'en' && k.path === 'llm-eval/foo')).toHaveLength(1); // dedup
  });
});

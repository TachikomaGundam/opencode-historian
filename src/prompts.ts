/**
 * Single source for every agent-facing text the plugin injects or registers
 * (reading-loop advisory, /historian-capture command contract, capture
 * reminder). Both plugin generations (V1 server() in index.ts, V2 setup() in
 * v2.ts) import from here — text drift between the two surfaces is the bug
 * class this module eliminates. Generic wording only: privacy-audit scans
 * dist/ and these strings ship in the tarball.
 */

/** Reading-loop advisory: the machine wiki is the
 *  authoritative institutional memory; consult it index-first before acting,
 *  prefer updating over duplicating, cite pages+dates, mark staleness.
 *  Hard budget ≤8 lines (context-rot). */
export const READING_LOOP_ADVISORY = [
  'You have a historian: a wiki.js knowledge base acting as this machine\'s authoritative institutional memory.',
  'Before doing work that touches this machine\'s deployments, history, pitfalls, or decisions, consult it index-first:',
  '- Read the curated map before blind search: historian_read wiki-index or historian_map action:"show", then historian_search by topic;',
  '- PREFER UPDATE over CREATE: if a page may already exist, historian_read it first, then historian_page_update rather than creating a duplicate;',
  '- CITE evidence: name the wiki page URL and its date whenever you quote it;',
  '- MARK stale rows instead of silently overwriting: supersede or review-stamp contradictions (G5 ledger: check each row\'s verified date).',
  'If you learn something new worth keeping, offer to record it as a page.',
].join('\n');

/** /historian-capture command:
 *  the always-available manual path from "notable session" to "G1 event page".
 *  Registered regardless of capture.enabled; the enabled-gated reminder only
 *  nudges toward it. Context-rot budget ≤~30 lines. */
export const CAPTURE_COMMAND_DESCRIPTION = '把本次会话记为史官事件页 / record this session as a historian event page';

export const CAPTURE_COMMAND_TEMPLATE = [
  'Summarize the current session as a historian G1 event page — only if it produced capture-worthy knowledge.',
  '',
  '0. Capture triggers — proceed only if at least one matches, else say so and skip writing:',
  '   事故闭环 incident closed with a root cause | 部署完成 deployment completed | bug修复合入 bugfix merged',
  '   | 探针结论 probe/eval conclusion | 被否决方案 rejected option (record the 否决理由 veto reason).',
  '1. Draft the body in the 四段式 evidence-chain order: 证据链/Evidence (what was observed, artifacts first)',
  '   → 方法/Method (how it was proven) → 修复手段/Fix (what changed, or the decision) → 函数级实现/Implementation (file:symbol detail).',
  "2. Run historian_map action:'show' to see existing sections, then choose a short factual path under one.",
  '3. Evidence split (G1 appendix contract): store the full 四段 material via historian_page_create with tier:"evidence"',
  '   under `_evidence/`; the main page body stays the cited/summarized form linking to those evidence pages.',
  '4. Carry SRE discipline in the 元数据表 metadata table rows: 影响/impact | 负责人/owner',
  '   | 后续动作/action items (owner + 优先级/priority + verifiable done-state) | 来源类型/source type.',
  '5. Pre-write self-check: create the page (genre "G1", 状态:draft, content included) so the 十项自检 scoring',
  '   advisory runs on the draft; fix its FAIL items via historian_page_update before publishing.',
  '6. Publish flow capture→review→Active: the page starts 状态:draft; once the self-check passes,',
  '   historian_page_update it to Active. The zh twin is auto-created.',
  '7. Echo both page URLs (en + zh) back to the user.',
].join('\n');

export const CAPTURE_TOAST_MESSAGE =
  '会话空闲：有值得留存的决定/修复/踩坑就跑 /historian-capture。Session idle — run /historian-capture if it produced decisions, fixes, or pitfalls worth keeping.';

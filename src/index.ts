/**
 * opencode-historian plugin entry (todo 12).
 *
 * Exports the V1 plugin object shape verified by the oracle:
 *   export default { id: string, server: (input, options?) => Promise<Hooks> }
 *
 * The server() hook resolves plugin options and returns:
 *   - config: mutates cfg.skills.paths to ship the bundled skills/ directory
 *     and registers the /historian-capture command (todo 9)
 *   - tool: 10 historian_* tools wired by buildTools(opts)
 *   - experimental.chat.system.transform: merges the historian-first reading
 *     loop advisory into the LAST system block (single-block-safe append — a
 *     second entry is never added). v3 double gate: 默认 false，true 需配置+哨兵双确认.
 *     Both the readingLoop option and the on-machine confirmation sentinel
 *     (src/loop-state.ts, re-read per request, never cached) must pass.
 *   - event: on session.idle emits ONE capture reminder toast per session
 *     (gated by opts.capture.enabled; reminder-only — the page write happens
 *     through /historian-capture -> historian_page_create, never here)
 *
 * Defensive: if resolveOptions throws (e.g. missing translate key), we catch
 * at the server() boundary, log once to console.error, and return hooks with
 * empty tools. The plugin registration itself must not crash opencode startup;
 * individual tool calls will fail with a clear error if invoked without valid
 * options. This matches the plan's "fail with clear one-time console.error"
 * contract.
 */

import { fileURLToPath } from 'url';
import { homedir } from 'node:os';
import { resolveOptions, type HistorianOptions } from './config.js';
import { isReadingLoopConfirmed, loopStatePath } from './loop-state.js';
import { buildTools } from './tools.js';
import type { PluginInput, PluginOptions, Hooks, Config } from '@opencode-ai/plugin';

/** The SDK's Config type does not declare a `skills` field, but opencode's
 *  runtime config object does support it (observed at runtime in v1.18.25).
 *  We intersect Config with a structural type that adds the skills field so
 *  we can mutate it without `any`. This is the narrowest documented cast
 *  point — the SDK type is authoritative for everything else. */
type ConfigWithSkills = Config & {
  skills?: { paths?: string[] };
};

type ServerFn = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>;

interface PluginExport {
  readonly id: string;
  readonly server: ServerFn;
}

/** Resolve the absolute path to the bundled skills/ directory. Uses
 *  import.meta.url so it works whether loaded from dist/ (compiled) or src/
 *  (dev). The skills/ directory may not exist yet (todo 13 creates it) — that
 *  is plan-sanctioned; the config hook must not throw on a nonexistent dir,
 *  opencode will simply skip it. */
const skillsDir: string = fileURLToPath(new URL('../skills/', import.meta.url));

/** Deduplicate an array of strings preserving first-occurrence order. Small
 *  local helper — no reason to pull a dependency for a 3-liner. */
function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/** Reading-loop advisory (plan v4 todo 8 / D6): the machine wiki is the
 *  authoritative institutional memory; consult it index-first before acting,
 *  prefer updating over duplicating, cite pages+dates, mark staleness.
 *  Hard budget ≤8 lines (context-rot). Shipped text — generic wording only
 *  (privacy-audit scans dist). */
const READING_LOOP_ADVISORY = [
  'You have a historian: a wiki.js knowledge base acting as this machine\'s authoritative institutional memory.',
  'Before doing work that touches this machine\'s deployments, history, pitfalls, or decisions, consult it index-first:',
  '- Read the curated map before blind search: historian_read wiki-index or historian_map action:"show", then historian_search by topic;',
  '- PREFER UPDATE over CREATE: if a page may already exist, historian_read it first, then historian_page_update rather than creating a duplicate;',
  '- CITE evidence: name the wiki page URL and its date whenever you quote it;',
  '- MARK stale rows instead of silently overwriting: supersede or review-stamp contradictions (G5 ledger: check each row\'s verified date).',
  'If you learn something new worth keeping, offer to record it as a page.',
].join('\n');

/** /historian-capture command (plan v2 todo 9, upgraded by v4 todo-10 / D2+D3):
 *  the always-available manual path from "notable session" to "G1 event page" —
 *  trigger list, 四段式 evidence-chain body contract, evidence split, and the
 *  draft→review→Active publish flow are the drive surface (idle toast is
 *  non-observable; this template text is the contract). Registered regardless
 *  of capture.enabled; the enabled-gated toast only nudges toward it.
 *  Agent-facing instruction text, generic wording only (ships in the tarball).
 *  Context-rot budget ≤~30 lines. */
const CAPTURE_COMMAND_DESCRIPTION = '把本次会话记为史官事件页 / record this session as a historian event page';

const CAPTURE_COMMAND_TEMPLATE = [
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

const CAPTURE_TOAST_MESSAGE =
  '会话空闲：有值得留存的决定/修复/踩坑就跑 /historian-capture。Session idle — run /historian-capture if it produced decisions, fixes, or pitfalls worth keeping.';

async function server(input: PluginInput, options?: PluginOptions): Promise<Hooks> {
  let opts: HistorianOptions;
  try {
    opts = resolveOptions((options ?? {}) as Parameters<typeof resolveOptions>[0]);
  } catch (err) {
    // Defensive: log once and return empty hooks. The plugin must not crash
    // opencode startup if configuration is incomplete. Individual tool calls
    // would fail here anyway since buildTools requires full HistorianOptions.
    console.error(
      '[opencode-historian] Failed to resolve plugin options; tools disabled.',
      err instanceof Error ? err.message : err,
    );
    return {};
  }

  // Once per plugin load (never in the per-request hot path): a config-only
  // opt-in leaves the loop dark because this machine has not confirmed it —
  // point at the missing second signal instead of silently no-oping forever.
  if (opts.readingLoop === true && !isReadingLoopConfirmed(homedir())) {
    console.error(
      '[opencode-historian] readingLoop enabled in config but not confirmed on this machine; to activate, create ' +
        loopStatePath(homedir()) +
        ' with {"version":1,"confirmed":true}',
    );
  }

  const captureReminded = new Set<string>();

  const hooks: Hooks = {
    config: async (cfg: Config) => {
      const cfgWithSkills = cfg as ConfigWithSkills;
      cfgWithSkills.skills ??= {};
      cfgWithSkills.skills.paths = unique([...(cfgWithSkills.skills.paths ?? []), skillsDir]);
      cfg.command ??= {};
      // ??= — a user-defined /historian-capture in their own config wins;
      // the plugin only supplies the default.
      cfg.command['historian-capture'] ??= {
        description: CAPTURE_COMMAND_DESCRIPTION,
        template: CAPTURE_COMMAND_TEMPLATE,
      };
    },
    tool: buildTools(opts),
    'experimental.chat.system.transform': async (_input, output) => {
      try {
        if (opts.readingLoop !== true) return;
        if (!isReadingLoopConfirmed(homedir())) return;
        if (output.system.some((block) => block.includes('historian_search'))) return;
        if (output.system.length === 0) {
          output.system.push(READING_LOOP_ADVISORY);
        } else {
          // Single-block-safe merge: a second system entry makes strict chat
          // templates (e.g. vLLM) reject the request with HTTP 400.
          const last = output.system.length - 1;
          output.system[last] += '\n\n' + READING_LOOP_ADVISORY;
        }
      } catch (err) {
        // A broken inject must never crash a chat request (plan v2 todo 8).
        console.error(
          '[opencode-historian] reading-loop advisory skipped:',
          err instanceof Error ? err.message : err,
        );
      }
    },
    event: async ({ event }) => {
      try {
        if (opts.capture.enabled !== true) return;
        if (event.type !== 'session.idle') return;
        // Feature-detect recordable work: session.idle only fires on a
        // busy→idle transition (a session that never ran a prompt never goes
        // idle), and each session is reminded at most once per plugin load.
        const sessionID = event.properties.sessionID;
        if (captureReminded.has(sessionID)) return;
        captureReminded.add(sessionID);
        await input.client.tui.showToast({
          body: {
            title: '史官 / historian',
            message: CAPTURE_TOAST_MESSAGE,
            variant: 'info',
            duration: 15000,
          },
        });
      } catch (err) {
        // A failed reminder must never break the event stream (plan v2 todo 9).
        console.error(
          '[opencode-historian] capture reminder skipped:',
          err instanceof Error ? err.message : err,
        );
      }
    },
  };
  return hooks;
}

const plugin: PluginExport = {
  id: 'opencode-historian',
  server,
};

export default plugin;

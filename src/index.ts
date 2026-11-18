/**
 * opencode-historian plugin entry (V1 host + V2 plugin-API port).
 *
 * Dual-generation default export (billion-context precedent):
 *   export default { id, setup(ctx), server(input, options?) }
 * The V2 host (engine >= 2.2) consumes `setup` (src/v2.ts — the whole plugin
 * must expose {id, effect|setup} or it is rejected with "Plugin must export
 * a default definition..."); the V1 host consumes `server`. The id matches
 * the npm package name (single source).
 *
 * The server() hook resolves plugin options and returns:
 *   - config: mutates cfg.skills.paths to ship the bundled skills/ directory
 *     and registers the /historian-capture command
 *   - tool: 11 historian_* tools wired by buildTools(opts)
 *   - experimental.chat.system.transform: merges the historian-first reading
 *     loop advisory into the LAST system block (single-block-safe append — a
 *     second entry is never added). v3 double gate: 默认 false，true 需配置+哨兵双确认.
 *     Both the readingLoop option and the on-machine confirmation sentinel
 *     (src/loop-state.ts, re-read per request, never cached) must pass.
 *   - event: on session.idle emits ONE capture reminder toast per session
 *     (gated by opts.capture.enabled; reminder-only — the page write happens
 *     through /historian-capture -> historian_page_create, never here)
 *
 * Agent-facing text constants are single-sourced in src/prompts.ts.
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
import { setup } from './v2.js';
import {
  READING_LOOP_ADVISORY,
  CAPTURE_COMMAND_DESCRIPTION,
  CAPTURE_COMMAND_TEMPLATE,
  CAPTURE_TOAST_MESSAGE,
} from './prompts.js';
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
  /** V2 host entry (engine >= 2.2): default export needs {id, setup|effect}. */
  readonly setup: (ctx: import('./v2.js').V2Ctx, deps?: import('./v2.js').SetupDeps) => Promise<void>;
  /** V1 host entry: {id, server(input, options) => Hooks}. Kept for hosts
   *  still loading plugins through the legacy `plugin` config key. */
  readonly server: ServerFn;
}

/** Resolve the absolute path to the bundled skills/ directory. Uses
 *  import.meta.url so it works whether loaded from dist/ (compiled) or src/
 *  (dev). The skills/ directory may not exist yet (the skills package creates it)
 *  — that is expected; the config hook must not throw on a nonexistent dir,
 *  opencode will simply skip it. */
const skillsDir: string = fileURLToPath(new URL('../skills/', import.meta.url));

/** Deduplicate an array of strings preserving first-occurrence order. Small
 *  local helper — no reason to pull a dependency for a 3-liner. */
function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

// Agent-facing text constants (reading-loop advisory, capture command contract,
// capture reminder) live in src/prompts.ts — single source for both plugin
// generations (this V1 server() and the V2 setup() in v2.ts).


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
        // A broken inject must never crash a chat request.
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
        // A failed reminder must never break the event stream.
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
  id: 'opencode-wiki-historian',
  setup,
  server,
};

export default plugin;

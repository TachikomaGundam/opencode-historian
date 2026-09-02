/**
 * opencode-historian plugin entry (todo 12).
 *
 * Exports the V1 plugin object shape verified by the oracle:
 *   export default { id: string, server: (input, options?) => Promise<Hooks> }
 *
 * The server() hook resolves plugin options and returns:
 *   - config: mutates cfg.skills.paths to ship the bundled skills/ directory
 *   - tool: 10 historian_* tools wired by buildTools(opts)
 *   - experimental.chat.system.transform: pushes the historian-first reading
 *     loop advisory onto output.system[] (gated by opts.readingLoop)
 *
 * Defensive: if resolveOptions throws (e.g. missing translate key), we catch
 * at the server() boundary, log once to console.error, and return hooks with
 * empty tools. The plugin registration itself must not crash opencode startup;
 * individual tool calls will fail with a clear error if invoked without valid
 * options. This matches the plan's "fail with clear one-time console.error"
 * contract.
 */

import { fileURLToPath } from 'url';
import { resolveOptions, type HistorianOptions } from './config.js';
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

/** Reading-loop advisory (plan v2 todo 8): the machine wiki is the
 *  authoritative institutional memory; consult it before acting, cite URLs.
 *  Shipped text — generic wording only (privacy-audit scans dist). */
const READING_LOOP_ADVISORY = [
  'You have a historian: a wiki.js knowledge base acting as this machine\'s authoritative institutional memory.',
  'Before doing work that touches this machine\'s deployments, history, pitfalls, or decisions, consult it first:',
  '- historian_search by topic for relevant pages; historian_map action:"timeline" for what changed recently;',
  '- G5 current-state ledger pages answer "what is deployed/running now" — check each row\'s verified date before trusting it.',
  'Cite the wiki page URLs you relied on. If you learn something new worth keeping, offer to record it as a page.',
].join('\n');

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

  const hooks: Hooks = {
    config: async (cfg: Config) => {
      const cfgWithSkills = cfg as ConfigWithSkills;
      cfgWithSkills.skills ??= {};
      cfgWithSkills.skills.paths = unique([...(cfgWithSkills.skills.paths ?? []), skillsDir]);
    },
    tool: buildTools(opts),
    'experimental.chat.system.transform': async (_input, output) => {
      try {
        if (opts.readingLoop !== true) return;
        if (output.system.some((block) => block.includes('historian_search'))) return;
        output.system.push(READING_LOOP_ADVISORY);
      } catch (err) {
        // A broken inject must never crash a chat request (plan v2 todo 8).
        console.error(
          '[opencode-historian] reading-loop advisory skipped:',
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

/**
 * V2 plugin generation: `setup(ctx)` adapter for the opencode v2 host
 * (engine >= 2.2, default export `{id, setup, server}`).
 *
 * Ground truth for every host call below was probed against the installed
 * engine binary (2.2.7/2.3.0), not against the v1-shaped public SDK:
 *   - ctx.tool.transform(editor => editor.add({name, description, input:
 *     <JSON Schema>, execute: async (args) => ({content})})) — registered and
 *     model-invocable (smoke-verified 11/11).
 *   - ctx.command.transform: editor exposes add() only; same-name add would
 *     shadow a user command, so the list-first check preserves the V1 ??=
 *     semantics (user-defined /historian-capture wins).
 *   - ctx.skill.transform: editor.add requires {id,name,description,path,
 *     content} (host throws SchemaError Missing key ["id"] otherwise).
 *   - ctx.session.hook('context', ev => ev.system is an array of typed
 *     parts): the advisory is merged into the LAST text part — the block
 *     count never grows, keeping strict chat templates (vLLM) happy, same
 *     invariant as the V1 system.transform hook.
 *   - ctx.event.subscribe({types}) returns an async iterable.
 *
 * Named gaps vs V1 (failures are logged, never silent):
 *   - Capture reminder: the v2 server surface has no toast channel (ctx.rpc
 *     is a definition factory, not a caller; there is no ctx.tui/client), so
 *     the idle reminder degrades to a one-time console.error per session.
 *     `session.idle` fires on busy→idle transitions (TUI sessions); headless
 *     `opencode run` streams do not emit it — same limitation class as V1.
 *   - skills.paths has no v2 config hook; skills ship through skill.transform
 *     instead (probe-verified surface).
 *
 * Options fail-closed: invalid/missing options log once and register
 * NOTHING (no half-wired tool surface aimed at an unresolvable wiki key) —
 * matching the sibling sibyl-system plugin's v2 precedent and stricter than
 * V1's empty-hooks return.
 */

import { fileURLToPath } from 'url';
import { homedir } from 'node:os';
import { tool } from '@opencode-ai/plugin';
import { resolveOptions, type HistorianOptions } from './config.js';
import { isReadingLoopConfirmed, loopStatePath } from './loop-state.js';
import { buildTools, type BuildDeps } from './tools.js';
import { collectSkillEntries } from './skills.js';
import {
  READING_LOOP_ADVISORY,
  CAPTURE_COMMAND_DESCRIPTION,
  CAPTURE_COMMAND_TEMPLATE,
  CAPTURE_TOAST_MESSAGE,
} from './prompts.js';

const PLUGIN_ID = 'opencode-wiki-historian';
const CAPTURE_COMMAND_NAME = 'historian-capture';
const skillsDir: string = fileURLToPath(new URL('../skills/', import.meta.url));

/** Minimal structural surface of the v2 plugin context actually consumed.
 *  Deliberately local (no @opencode/plugin dependency — its published types
 *  lag the host): every access is still feature-detected at runtime, so an
 *  older/newer host without a given sub-surface degrades with a log line
 *  instead of a setup crash. */
export interface V2ToolCtx {
  readonly sessionID: string;
  readonly messageID?: string;
  readonly abort?: AbortSignal;
}

export interface V2Ctx {
  readonly options?: unknown;
  readonly tool?: {
    transform(fn: (editor: {
      add: (def: {
        name: string;
        description: string;
        input: Record<string, unknown>;
        execute: (args: Record<string, unknown>, ctx: V2ToolCtx) => Promise<{ content: string }>;
      }) => unknown;
    }) => unknown | Promise<unknown>): unknown;
  };
  readonly command?: {
    list(): Promise<ReadonlyArray<{ name: string }> | null | undefined>;
    transform(fn: (editor: {
      add: (def: { name: string; description: string; template: string }) => unknown;
    }) => unknown | Promise<unknown>): unknown;
  };
  readonly skill?: {
    transform(fn: (editor: {
      add: (def: { id: string; name: string; description: string; path: string; content: string }) => unknown;
    }) => unknown | Promise<unknown>): unknown;
  };
  readonly session?: {
    hook(
      name: 'context',
      handler: (ev: { system?: Array<Record<string, unknown>> }) => void | Promise<void>,
    ): unknown;
  };
  readonly event?: {
    subscribe(filter: { types?: string[] }): AsyncIterable<{ type?: string; properties?: Record<string, unknown> }>;
  };
}

export interface SetupDeps {
  /** Test seam: where the reading-loop confirmation sentinel lives (V1 uses
   *  homedir()). */
  readonly homeDir?: string;
  /** Test seam: env source forwarded to resolveOptions (defaults process.env). */
  readonly env?: NodeJS.ProcessEnv;
  /** Test seam: dependency bag forwarded to buildTools (client/translator
   *  injection). Production stays `{}` — buildTools resolves lazily. */
  readonly buildDeps?: BuildDeps;
  readonly log?: (message: string) => void;
}

/** Convert a V1 tool's zod raw arg shape to JSON Schema through the SDK's
 *  nested zod (tool.schema) — single source, no per-tool schema duplicates.
 *  On conversion failure, a permissive object schema is registered and
 *  logged; execute still validates with the strict zod parse inside the V1
 *  tool body, so a loose registration can never corrupt inputs. */
export function argsToJsonSchema(args: Record<string, unknown> | undefined): Record<string, unknown> {
  try {
    return tool.schema.toJSONSchema(tool.schema.object(args ?? {}), { io: 'input' }) as Record<string, unknown>;
  } catch (err) {
    return {
      __permissive: true,
      __reason: err instanceof Error ? err.message : String(err),
      type: 'object',
      additionalProperties: true,
    } as Record<string, unknown>;
  }
}

export async function setup(ctx: V2Ctx, deps: SetupDeps = {}): Promise<void> {
  const log = deps.log ?? ((m: string) => console.error(m));
  const homeDir = deps.homeDir ?? homedir();

  let opts: HistorianOptions;
  try {
    opts = resolveOptions(
      (ctx.options ?? {}) as Parameters<typeof resolveOptions>[0],
      deps.env ?? process.env,
      homeDir,
    );
  } catch (err) {
    log(
      `[${PLUGIN_ID}] V2 setup: invalid plugin options; plugin disabled. ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // Tool surface.
  if (!ctx.tool?.transform) {
    log(`[${PLUGIN_ID}] V2 host exposes no tool.transform; tools NOT registered.`);
  } else {
    const tools = buildTools(opts, deps.buildDeps ?? {});
    try {
      await ctx.tool.transform((editor) => {
        for (const [name, def] of Object.entries(tools)) {
          let input: Record<string, unknown>;
          try {
            input = argsToJsonSchema((def as { args?: Record<string, unknown> }).args);
          } catch (err) {
            log(`[${PLUGIN_ID}] schema conversion skipped ${name}: ${err instanceof Error ? err.message : String(err)}`);
            continue;
          }
          if ((input as { __permissive?: boolean }).__permissive) {
            log(`[${PLUGIN_ID}] tool ${name}: zod→JSON Schema failed (${String((input as { __reason?: string }).__reason)}); permissive registration, execute still strict-parses.`);
          }
          editor.add({
            name,
            description: def.description,
            input,
            execute: async (args, tctx) => {
              try {
                const res = await def.execute(
                  args as never,
                  { sessionID: tctx?.sessionID ?? '', abort: tctx?.abort } as never,
                );
                // V1 tools return plain JSON-string envelopes (not v1
                // ToolResult objects): strings pass through untouched;
                // anything else is serialized for the host channel.
                const out =
                  typeof res === 'string'
                    ? res
                    : (res as { output?: unknown } | undefined)?.output;
                return { content: typeof out === 'string' ? out : JSON.stringify(res ?? null) };
              } catch (err) {
                // Tools are engineered to envelope their errors; this net is
                // for host-shape surprises — a throw must never kill the run.
                return { content: `[${PLUGIN_ID}] ${name} failed: ${err instanceof Error ? err.stack ?? err.message : String(err)}` };
              }
            },
          });
        }
      });
    } catch (err) {
      log(`[${PLUGIN_ID}] tool.transform failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Command surface — ??= semantics: a user-defined command of the same name
  // wins (editor only offers add(), so check list() first).
  if (!ctx.command?.transform) {
    log(`[${PLUGIN_ID}] V2 host exposes no command.transform; /${CAPTURE_COMMAND_NAME} NOT registered.`);
  } else {
    try {
      const existing = await ctx.command.list?.();
      if (existing?.some((c) => c.name === CAPTURE_COMMAND_NAME)) {
        log(`[${PLUGIN_ID}] /${CAPTURE_COMMAND_NAME} already defined by user config; plugin default NOT registered.`);
      } else {
        await ctx.command.transform((editor) => {
          editor.add({
            name: CAPTURE_COMMAND_NAME,
            description: CAPTURE_COMMAND_DESCRIPTION,
            template: CAPTURE_COMMAND_TEMPLATE,
          });
        });
      }
    } catch (err) {
      log(`[${PLUGIN_ID}] command registration failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Skill surface — bundled SKILL.md packages registered individually (V2 has
  // no config hook for skills.paths).
  if (!ctx.skill?.transform) {
    log(`[${PLUGIN_ID}] V2 host exposes no skill.transform; bundled skills NOT registered.`);
  } else {
    try {
      const entries = collectSkillEntries(skillsDir, { log });
      if (entries.length > 0) {
        await ctx.skill.transform((editor) => {
          for (const entry of entries) {
            try {
              editor.add(entry);
            } catch (err) {
              log(`[${PLUGIN_ID}] skill ${entry.id} rejected by host: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
        });
      }
    } catch (err) {
      log(`[${PLUGIN_ID}] skill collection failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Reading-loop advisory — same double gate as V1 (option AND per-request
  // sentinel re-read), merged into the LAST text part so the system block
  // count never grows (strict chat templates).
  if (opts.readingLoop === true && !isReadingLoopConfirmed(homeDir)) {
    log(
      `[${PLUGIN_ID}] readingLoop enabled in config but not confirmed on this machine; to activate, create ` +
        loopStatePath(homeDir) +
        ' with {"version":1,"confirmed":true}',
    );
  }
  if (!ctx.session?.hook) {
    if (opts.readingLoop === true) {
      log(`[${PLUGIN_ID}] V2 host exposes no session.hook; readingLoop advisory NOT wired.`);
    }
  } else {
    try {
      ctx.session.hook('context', (ev) => {
        try {
          if (opts.readingLoop !== true) return;
          if (!isReadingLoopConfirmed(homeDir)) return;
          const parts = ev?.system;
          if (!Array.isArray(parts)) return;
          const textOf = (p: Record<string, unknown>): string => (typeof p?.text === 'string' ? p.text : '');
          if (parts.some((p) => textOf(p).includes('historian_search'))) return;
          for (let i = parts.length - 1; i >= 0; i--) {
            if (parts[i]?.type === 'text' && typeof parts[i].text === 'string') {
              parts[i].text = textOf(parts[i]) + '\n\n' + READING_LOOP_ADVISORY;
              return;
            }
          }
        } catch (err) {
          log(`[${PLUGIN_ID}] reading-loop advisory skipped: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    } catch (err) {
      log(`[${PLUGIN_ID}] session.hook('context') registration failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Capture reminder — session.idle subscription; NO toast channel on the v2
  // server surface (named gap), so this logs once per session. Mirrors V1's
  // once-per-session-per-load discipline.
  if (opts.capture.enabled === true) {
    const eventApi = ctx.event;
    if (!eventApi?.subscribe) {
      log(`[${PLUGIN_ID}] V2 host exposes no event.subscribe; capture reminder NOT wired.`);
    } else {
      const reminded = new Set<string>();
      void (async () => {
        const stream = eventApi.subscribe({ types: ['session.idle'] });
        for await (const ev of stream) {
          try {
            if (ev?.type !== 'session.idle') continue;
            const sessionID = (ev.properties as { sessionID?: string } | undefined)?.sessionID;
            if (!sessionID || reminded.has(sessionID)) continue;
            reminded.add(sessionID);
            // Named gap: v2 server surface has no toast API — console is the
            // honest fallback; the /historian-capture command remains the
            // contract surface either way.
            log(`[${PLUGIN_ID}] capture reminder: ${CAPTURE_TOAST_MESSAGE}`);
          } catch (err) {
            log(`[${PLUGIN_ID}] capture reminder skipped: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      })().catch((err) => log(`[${PLUGIN_ID}] event stream ended: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
}

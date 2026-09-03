/**
 * Sentinel state for the v3 reading loop (double gate, config + machine).
 *
 * The reading loop activates only when BOTH signals agree: the plugin option
 * `readingLoop: true` (see src/config.ts) and a confirmation sentinel written
 * BY HAND on this machine at '<home>/.config/opencode/historian-reading-loop.json'
 * holding {"version":1,"confirmed":true}. Agent self-enablement is forbidden by
 * design, so the reader here is deliberately tolerant: a missing file, bad
 * JSON, wrong shape, mismatched version, or any read error yields false.
 * This function NEVER throws.
 *
 * The home directory is an injectable parameter so unit tests drive fixtures
 * under tmp dirs; the real ~/.config is never touched (same discipline as
 * src/config.ts / test/config.test.ts).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseJsonc, isRecord } from './jsonc.js';

/** Sentinel schema version accepted by the reader (strict equality, not truthy). */
export const LOOP_STATE_VERSION = 1;

/** Path of the human-written reading-loop confirmation sentinel under a home dir. */
export function loopStatePath(home: string): string {
  return join(home, '.config', 'opencode', 'historian-reading-loop.json');
}

/**
 * True only when the sentinel exists and parses to an object with
 * version === LOOP_STATE_VERSION and confirmed === true (both strict).
 * Parsed via parseJsonc, so comments in the sentinel are a bonus feature.
 *
 * Pure-sync and intentionally NOT cached: callers re-check per request so a
 * mid-session sentinel write or removal takes effect immediately.
 */
export function isReadingLoopConfirmed(home: string): boolean {
  const path = loopStatePath(home);
  let parsed: unknown;
  try {
    parsed = parseJsonc(readFileSync(path, 'utf8'), path);
  } catch {
    return false; // missing file, unreadable, or malformed JSONC — all mean "not confirmed"
  }
  if (!isRecord(parsed)) {
    return false; // top-level array / string / number / null — wrong shape
  }
  return parsed.version === LOOP_STATE_VERSION && parsed.confirmed === true;
}

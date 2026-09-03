/**
 * C1 dist-harness probe for the v3 double-signal reading-loop gate (plan todo 3).
 *
 * Exercises the BUILT bundle (dist/index.js) — never src — through the real
 * plugin entry exactly the way OpenCode loads it: default export { id, server },
 * server(input, options) returning hooks, then invoking the
 * 'experimental.chat.system.transform' hook with a mutable { system } output.
 *
 * Three states of the double gate (config option AND on-machine sentinel at
 * <HOME>/.config/opencode/historian-reading-loop.json):
 *   S1  readingLoop absent / false        -> zero injection, zero hint
 *   S2  readingLoop true,  NO sentinel    -> zero injection, startup hint ONCE
 *   S3  readingLoop true,  sentinel OK    -> injection merged into the LAST
 *        system block: output.system.length stays 1, advisory text present
 *   S3b sentinel + pre-existing advisory  -> dedupe guard: no second append
 *   S3c sentinel + empty system array     -> push path: length 1
 *
 * HOME is pointed at a throwaway fake home so the plugin's homedir() reads
 * resolve there; the real ~/.config is never touched. Mechanical asserts only;
 * prints a PASS/FAIL table; exit code = number of FAIL rows.
 *
 * Run: node scripts/v3-loop-probe.mjs   (from the repo root, after npm run build)
 */

import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const FAKE_HOME = '/tmp/v3c1/probehome';
rmSync(FAKE_HOME, { recursive: true, force: true });
mkdirSync(join(FAKE_HOME, '.config', 'opencode'), { recursive: true });
// os.homedir() honors $HOME on POSIX at call time — set it BEFORE importing dist.
process.env.HOME = FAKE_HOME;

const plugin = (await import('../dist/index.js')).default;
if (plugin?.id !== 'opencode-historian' || typeof plugin.server !== 'function') {
  console.error('FATAL: dist/index.js does not export the plugin shape { id, server }');
  process.exit(1);
}

/** PluginInput stand-in: only the event hook would touch input.client, and the
 *  probe never fires events. Options carry an explicit translate.apiKey so
 *  resolveOptions succeeds without reading the real jsonc (priority leg 1). */
const makeInput = () => ({
  directory: FAKE_HOME,
  worktree: FAKE_HOME,
  client: { tui: { showToast: async () => ({}) } },
});
const makeOptions = (readingLoop) => ({
  baseUrl: 'http://127.0.0.1:9', // port 9 (discard) — probe never issues a request
  apiKeyPath: join(FAKE_HOME, 'unused-wiki-key'),
  translate: { apiKey: 'probe-dummy-key', endpoint: 'http://127.0.0.1:9' },
  ...(readingLoop === undefined ? {} : { readingLoop }),
});

const TRANSFORM = 'experimental.chat.system.transform';
const BASELINE = 'You are a helpful test assistant.'; // no 'historian_search' substring
const SENTINEL_PATH = join(FAKE_HOME, '.config', 'opencode', 'historian-reading-loop.json');

/** Run one scenario: optionally place/remove the sentinel, load the plugin
 *  (capturing console.error), call the transform hook on a fresh system array. */
async function scenario({ readingLoop, sentinel, system }) {
  rmSync(SENTINEL_PATH, { force: true });
  if (sentinel !== null) writeFileSync(SENTINEL_PATH, sentinel);
  const hints = [];
  const realError = console.error;
  console.error = (...args) => hints.push(args.join(' '));
  try {
    const hooks = await plugin.server(makeInput(), makeOptions(readingLoop));
    const transform = hooks[TRANSFORM];
    if (typeof transform !== 'function') throw new Error('transform hook missing');
    const output = { system: [...system] };
    await transform({}, output);
    return { output, hints };
  } finally {
    console.error = realError;
  }
}

const rows = [];
function check(name, expected, actual, pass) {
  rows.push({ name, expected, actual, result: pass ? 'PASS' : 'FAIL' });
}

// --- S1: config signal absent / false (sentinel irrelevant to outcome, but
//     planted WITH a valid sentinel to prove config alone can NOT open the gate)
{
  const noOpt = await scenario({ readingLoop: undefined, sentinel: '{"version":1,"confirmed":true}', system: [BASELINE] });
  check('S1a readingLoop absent: no injection',
    'system unchanged, no advisory',
    `len=${noOpt.output.system.length} hasAdvisory=${noOpt.output.system.join('\n').includes('historian_search')}`,
    noOpt.output.system.length === 1 && noOpt.output.system[0] === BASELINE);
  check('S1a readingLoop absent: no hint', '0 hints', `${noOpt.hints.length} hints`, noOpt.hints.length === 0);

  const falseOpt = await scenario({ readingLoop: false, sentinel: '{"version":1,"confirmed":true}', system: [BASELINE] });
  check('S1b readingLoop false: no injection',
    'system unchanged, no advisory',
    `len=${falseOpt.output.system.length} hasAdvisory=${falseOpt.output.system.join('\n').includes('historian_search')}`,
    falseOpt.output.system.length === 1 && falseOpt.output.system[0] === BASELINE);
  check('S1b readingLoop false: no hint', '0 hints', `${falseOpt.hints.length} hints`, falseOpt.hints.length === 0);
}

// --- S2: config true, NO sentinel -> machine signal alone gates it shut
{
  const s2 = await scenario({ readingLoop: true, sentinel: null, system: [BASELINE] });
  check('S2 config true + no sentinel: no injection',
    'system unchanged, no advisory',
    `len=${s2.output.system.length} hasAdvisory=${s2.output.system.join('\n').includes('historian_search')}`,
    s2.output.system.length === 1 && s2.output.system[0] === BASELINE);
  check('S2 config true + no sentinel: one-time hint on stderr',
    '1 hint naming sentinel path + {"version":1,"confirmed":true}',
    `${s2.hints.length} hint(s): ${JSON.stringify(s2.hints[0] ?? null).slice(0, 160)}`,
    s2.hints.length === 1 &&
      s2.hints[0].includes('historian-reading-loop.json') &&
      s2.hints[0].includes('confirmed":true'));
}

// --- S3: both signals -> inject via single-block-safe append
{
  const OK = '{"version":1,"confirmed":true}';
  const s3 = await scenario({ readingLoop: true, sentinel: OK, system: [BASELINE] });
  const joined = s3.output.system.join('\n');
  check('S3 both signals: injection present',
    "contains 'historian_search'",
    `hasAdvisory=${joined.includes('historian_search')}`,
    joined.includes('historian_search'));
  check('S3 both signals: output.system.length === 1 (merged into last block)',
    'len=1',
    `len=${s3.output.system.length}`,
    s3.output.system.length === 1);
  check('S3 both signals: baseline preserved at head of merged block',
    `starts with baseline`,
    `startsWith=${s3.output.system[0].startsWith(BASELINE)}`,
    s3.output.system[0].startsWith(BASELINE));
  check('S3 both signals: no hint (sentinel confirms)',
    '0 hints', `${s3.hints.length} hints`, s3.hints.length === 0);

  // S3b: dedupe guard — advisory already in system -> untouched
  const withAdvisory = [BASELINE, 'earlier block mentioning historian_search only'];
  const s3b = await scenario({ readingLoop: true, sentinel: OK, system: withAdvisory });
  check('S3b dedupe guard: pre-existing advisory -> no double append',
    'system deep-equal to input',
    `len=${s3b.output.system.length} same=${JSON.stringify(s3b.output.system) === JSON.stringify(withAdvisory)}`,
    JSON.stringify(s3b.output.system) === JSON.stringify(withAdvisory));

  // S3c: empty system array -> push path, still exactly one block
  const s3c = await scenario({ readingLoop: true, sentinel: OK, system: [] });
  check('S3c empty system: push path -> length 1 with advisory',
    'len=1 + historian_search',
    `len=${s3c.output.system.length} hasAdvisory=${s3c.output.system.join('\n').includes('historian_search')}`,
    s3c.output.system.length === 1 && s3c.output.system[0].includes('historian_search'));

  // S3d: malformed / wrong-shape sentinels must read false (tolerant reader)
  for (const [label, bad] of [
    ['bad JSON', '{version:1,confirmed:true'],
    ['wrong version', '{"version":2,"confirmed":true}'],
    ['confirmed truthy-not-true', '{"version":1,"confirmed":"yes"}'],
    ['top-level array', '[1,2]'],
  ]) {
    const s3d = await scenario({ readingLoop: true, sentinel: bad, system: [BASELINE] });
    check(`S3d sentinel rejected (${label}): no injection`,
      'system unchanged',
      `len=${s3d.output.system.length} hasAdvisory=${s3d.output.system.join('\n').includes('historian_search')}`,
      s3d.output.system.length === 1 && s3d.output.system[0] === BASELINE);
  }
}

rmSync(FAKE_HOME, { recursive: true, force: true });

// --- report
const widths = { name: 0, expected: 0, actual: 0, result: 4 };
for (const r of rows) {
  widths.name = Math.max(widths.name, r.name.length);
  widths.expected = Math.max(widths.expected, r.expected.length);
  widths.actual = Math.max(widths.actual, r.actual.length);
}
const line = '─'.repeat(widths.name + widths.expected + widths.actual + 22);
console.log(line);
console.log(
  `PROBE (dist bundle, double-signal reading-loop gate)  built-from HEAD  fakeHome=${FAKE_HOME}`,
);
console.log(line);
console.log(
  `STATE  ${'CHECK'.padEnd(widths.name)}  ${'EXPECTED'.padEnd(widths.expected)}  ACTUAL`,
);
console.log(line);
for (const r of rows) {
  console.log(
    `[${r.result}]  ${r.name.padEnd(widths.name)}  ${r.expected.padEnd(widths.expected)}  ${r.actual}`,
  );
}
const fails = rows.filter((r) => r.result === 'FAIL').length;
console.log(line);
console.log(`TOTAL ${rows.length}  PASS ${rows.length - fails}  FAIL ${fails}`);
process.exit(fails);

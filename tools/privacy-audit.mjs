#!/usr/bin/env node

// Release-blocking privacy red-line audit.
// Reads the `npm pack --dry-run --json` file list and scans every would-be-shipped
// file (README.md / package.json / LICENSE are auto-included by npm) for the
// red-line regex set. Any hit exits non-zero with file:line:snippet(<=60 chars).
// An empty or unreadable pack list is a hard failure too — silence is not trust.
//
// Red lines come in two layers:
//   1. BASE_RED_LINES — machine-independent shapes (credential patterns) that
//      apply to every release of this package, committed.
//   2. tools/redlines.local.json — OPTIONAL, gitignored. Maintainer-local list of
//      machine-specific literals (private hostnames, personal emails, local paths,
//      private taxonomy words). Absent on fresh clones → generic layer only.
// Local entries are JSON: [{ "name": "...", "pattern": "<regex source>", "flags": "i"? }]

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(new URL('.', import.meta.url).pathname, '..');

const BASE_RED_LINES = [
  ['npm-granular-token', /npm_[A-Za-z0-9]{24,}/],
  ['github-token', /gh[pousr]_[A-Za-z0-9]{20,}/],
  ['api-key-shape', /\bsk-[A-Za-z0-9]{16,}/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private-key-block', /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
];

const LOCAL_FILE = join(ROOT, 'tools', 'redlines.local.json');
const extra = [];
if (existsSync(LOCAL_FILE)) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(LOCAL_FILE, 'utf8'));
  } catch (err) {
    console.error(`privacy audit: ${LOCAL_FILE} exists but is unparseable (${err.message}) — refusing to pass`);
    process.exit(1);
  }
  if (!Array.isArray(parsed)) {
    console.error('privacy audit: redlines.local.json must be a JSON array of {name, pattern, flags?}');
    process.exit(1);
  }
  for (const item of parsed) {
    if (typeof item?.name !== 'string' || typeof item?.pattern !== 'string') {
      console.error('privacy audit: every local red line needs string name and pattern');
      process.exit(1);
    }
    try {
      extra.push([item.name, new RegExp(item.pattern, item.flags ?? 'i')]);
    } catch (err) {
      console.error(`privacy audit: local red line ${item.name} has invalid regex: ${err.message}`);
      process.exit(1);
    }
  }
}

const RED_LINES = [...BASE_RED_LINES, ...extra];

// Allowlist: generic placeholders and exact product names that legitimately
// appear in distributed content. Stripped from a line before matching so a
// neighbouring red-line on the same line is still caught.
const ALLOWLIST = ['opencode-wiki-historian', 'opencode-historian', 'sk-<keychar>', 'npm_<token>'];

const die = (msg) => {
  console.error(`privacy audit: ${msg}`);
  process.exit(1);
};

const stripAllows = (line) => {
  let out = line;
  for (const allow of ALLOWLIST) out = out.split(allow).join('');
  return out;
};

const snippet = (line) => line.trim().slice(0, 60);

let packJson;
try {
  packJson = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  die(`npm pack --dry-run --json failed: ${err.message.split('\n')[0]}`);
}

let pack;
try {
  pack = JSON.parse(packJson);
} catch {
  die('npm pack --json returned unparseable output');
}

const files = Array.isArray(pack) ? pack[0]?.files : undefined;
if (!Array.isArray(files) || files.length === 0) {
  die('pack file list is empty or unreadable — cannot audit, refusing to pass');
}

const hits = [];
let scanned = 0;

for (const entry of files) {
  const rel = entry.path;
  if (typeof rel !== 'string' || rel.length === 0) {
    die(`pack entry without a usable path: ${JSON.stringify(entry).slice(0, 120)}`);
  }
  let content;
  try {
    content = readFileSync(join(ROOT, rel), 'utf8');
  } catch (err) {
    die(`shipped file listed by pack but unreadable: ${rel} (${err.code ?? err.message})`);
  }
  scanned += 1;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const scrubbed = stripAllows(lines[i]);
    for (const [name, re] of RED_LINES) {
      if (re.test(scrubbed)) {
        hits.push(`${rel}:${i + 1}: [${name}] ${snippet(lines[i])}`);
      }
    }
  }
}

if (hits.length > 0) {
  console.error(`privacy audit FAILED — ${hits.length} red-line hit(s) across ${scanned} shipped file(s):`);
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}

console.log(`privacy audit passed — ${scanned} shipped file(s) clean (${RED_LINES.length} red lines active).`);

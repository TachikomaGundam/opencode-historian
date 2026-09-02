#!/usr/bin/env node

// Fallback installer: copies skills/historian/ → ~/.config/opencode/skills/historian/
// Used when the plugin config-hook skill injection doesn't resolve.

import { cpSync, existsSync, readFileSync, statSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const help = args.includes('--help') || args.includes('-h');

if (help) {
  console.log(`Usage: node tools/install-skill.mjs [--dry-run] [--force]

Copies skills/historian/ to ~/.config/opencode/skills/historian/

Options:
  --dry-run   Show what would be done without making changes
  --force     Overwrite existing skill even if modified
  --help      Show this help`);
  process.exit(0);
}

const src = resolve(new URL('.', import.meta.url).pathname, '..', 'skills', 'historian');
const dest = join(homedir(), '.config', 'opencode', 'skills', 'historian');

if (!existsSync(src)) {
  console.error(`ERROR: source not found: ${src}`);
  console.error('Run this script from the opencode-historian package root.');
  process.exit(1);
}

// Check for existing destination
if (existsSync(dest)) {
  // Check if it's a plain file (legacy v2 skill) vs directory
  const stat = statSync(dest);
  if (stat.isFile()) {
    // Legacy flat skill file exists (e.g., historian.md renamed back)
    if (!force) {
      console.error(`ERROR: legacy skill file exists at ${dest}`);
      console.error('Use --force to replace it, or rename it first.');
      process.exit(1);
    }
    if (!dryRun) {
      rmSync(dest);
    }
    console.log(`[force] would remove legacy file: ${dest}`);
  } else if (stat.isDirectory()) {
    // Already installed as directory; idempotent re-copy
    console.log(`Destination exists: ${dest}`);
    if (!force) {
      console.log('Destination already exists. Use --force to overwrite.');
      process.exit(0);
    }
  }
}

// Ensure parent directory exists
const destParent = join(homedir(), '.config', 'opencode', 'skills');

if (dryRun) {
  console.log(`[dry-run] Would copy:`);
  console.log(`  from: ${src}`);
  console.log(`  to:   ${dest}`);
  console.log(`[dry-run] No changes made.`);
  process.exit(0);
}

// Perform the copy
try {
  if (!existsSync(destParent)) {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(destParent, { recursive: true });
  }
  cpSync(src, dest, { recursive: true, force: true });
  console.log(`Installed historian skill → ${dest}`);
} catch (err) {
  console.error(`ERROR: copy failed: ${err.message}`);
  process.exit(1);
}

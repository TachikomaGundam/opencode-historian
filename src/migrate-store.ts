/**
 * Migrate persistence (plan todo 14): pre-image backup files + the
 * path-level checkpoint. Both are plain JSON under the plan's 工件根
 * (results/ in the plugin repo; ~/.config/opencode in the home dir), with
 * tolerant reads — a corrupt/missing file degrades to an empty state,
 * never a crash (the pre-image backup is the restore program of record).
 */

import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isRecord } from './jsonc.js';
import type { Locale } from './wiki/pages.read.js';

// --- Pre-image backup -------------------------------------------------------

/** Write-side field set of one pre-migration page; null = locale absent.
 *  publishStartDate/publishEndDate ride along so a replay restore via
 *  updatePage (full RMW) reproduces the exact write-side contract. */
export interface PreImageEntry {
  readonly content: string;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly isPublished: boolean;
  readonly publishStartDate: string;
  readonly publishEndDate: string;
}

export type PreImagePair = Readonly<Record<Locale, PreImageEntry | null>>;

export interface BackupFile {
  readonly section: string;
  readonly createdAt: string;
  readonly paths: Readonly<Record<string, PreImagePair>>;
}

export function sectionOf(path: string): string {
  return path.split('/')[0];
}

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function defaultResultsDir(): string {
  return fileURLToPath(new URL('../results/', import.meta.url));
}

/** Plan verbatim filename: results/pilot-backup-<section>-<date>.json */
export function backupFileFor(section: string, date: string, resultsDir: string): string {
  return join(resultsDir, `pilot-backup-${section}-${date}.json`);
}

export function readBackup(file: string): BackupFile {
  const parsed = readJsonTolerant(file, null);
  if (!isRecord(parsed) || !isRecord(parsed.paths)) {
    return { section: '', createdAt: '', paths: {} };
  }
  return { section: String(parsed.section ?? ''), createdAt: String(parsed.createdAt ?? ''), paths: parsed.paths as Readonly<Record<string, PreImagePair>> };
}

/** Atomic write: tmp file + rename, so a crash never leaves a truncated
 *  backup (the restore program of record must itself be restorable). */
export function writeBackup(file: string, backup: BackupFile): void {
  writeJsonAtomic(file, backup);
}

// --- Checkpoint -------------------------------------------------------------

export interface CheckpointEntry {
  readonly contentHash: string;
  readonly zhHash: string | null;
  readonly appliedAt: string;
  readonly genre: string;
}

export interface CheckpointFile {
  readonly version: 1;
  readonly paths: Readonly<Record<string, CheckpointEntry>>;
}

export function checkpointPath(homeDir: string): string {
  return join(homeDir, '.config', 'opencode', 'historian-migrate.json');
}

export function readCheckpoint(homeDir: string): CheckpointFile {
  const parsed = readJsonTolerant(checkpointPath(homeDir), null);
  if (!isRecord(parsed) || !isRecord(parsed.paths)) {
    return { version: 1, paths: {} };
  }
  return { version: 1, paths: parsed.paths as Readonly<Record<string, CheckpointEntry>> };
}

export function writeCheckpoint(homeDir: string, cp: CheckpointFile): void {
  writeJsonAtomic(checkpointPath(homeDir), cp);
}

// --- Hashing -----------------------------------------------------------------

/** Content hash = sha256 over whitespace-normalized text: byte-identical
 *  content with cosmetic whitespace drift still latches the checkpoint. */
export function hashText(text: string): string {
  return createHash('sha256').update(normalizeForHash(text)).digest('hex');
}

export function normalizeForHash(s: string): string {
  return s.trim().replace(/\s+/g, ' ');
}

// --- fs helpers --------------------------------------------------------------

function readJsonTolerant(file: string, fallback: unknown): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}
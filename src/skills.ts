/**
 * Skill-package discovery for the bundled skills/ directory (layout:
 * skills/<name>/SKILL.md with `---` frontmatter carrying name/description).
 *
 * V1 ships the directory itself (config hook appends skills.paths); V2 must
 * hand the host individual entries {id,name,description,path,content} via
 * skill.transform — the host schema rejects entries without an id (observed
 * SchemaError Missing key ["id"]), so id/name are guaranteed here from the
 * frontmatter or, failing that, the package directory name.
 *
 * The frontmatter parser is deliberately a strict key:value subset (single
 * line, optional surrounding quotes) — the shipped SKILL.md files use only
 * that. A malformed or unreadable package is skipped with a console.error,
 * never thrown: skill discovery must not take down plugin setup.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

export interface SkillEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly path: string;
  readonly content: string;
}

export interface CollectDeps {
  readonly log?: (message: string) => void;
}

/** Parse a leading `---` frontmatter block into flat string fields; returns
 *  the fields plus the body text after the block. No YAML dependency: lines
 *  are `key: value`, values may be wrapped in one layer of quotes. */
export function parseFrontmatter(raw: string): { fields: Record<string, string>; body: string } {
  const fields: Record<string, string> = {};
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) return { fields, body: raw };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    fields[kv[1]] = value;
  }
  return { fields, body: raw.slice(m[0].length) };
}

/** Find candidate SKILL.md files: root/SKILL.md plus one level of
 *  root/<dir>/SKILL.md. Sorted for deterministic registration order. */
function findSkillFiles(root: string): string[] {
  const found: string[] = [];
  const direct = join(root, 'SKILL.md');
  try {
    if (statSync(direct).isFile()) found.push(direct);
  } catch {
    /* root itself is not a skill package */
  }
  let names: string[] = [];
  try {
    names = readdirSync(root).sort();
  } catch {
    return found; // skills/ may not exist (dev checkout without it) — skip silently
  }
  for (const name of names) {
    const candidate = join(root, name, 'SKILL.md');
    try {
      if (statSync(candidate).isFile()) found.push(candidate);
    } catch {
      /* not a skill directory */
    }
  }
  return found;
}

export function collectSkillEntries(root: string, deps: CollectDeps = {}): SkillEntry[] {
  const log = deps.log ?? ((m: string) => console.error(m));
  const entries: SkillEntry[] = [];
  for (const file of findSkillFiles(root)) {
    try {
      const { fields, body } = parseFrontmatter(readFileSync(file, 'utf8'));
      const fallbackId = file.split(/[\\/]/).slice(-2)[0] || 'skill';
      const id = fields.id || fields.name || fallbackId;
      const name = fields.name || id;
      const description = fields.description || `historian skill package: ${name}`;
      const content = body.trim().length > 0 ? body : `# ${name}\n${description}`;
      entries.push({ id, name, description, path: file, content });
    } catch (err) {
      log(`[opencode-historian] skill package skipped (${file}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return entries;
}

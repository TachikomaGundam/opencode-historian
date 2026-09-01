/**
 * Migration engine — apply side (plan todo 14): the write pipeline. Order is
 * the safety contract: ① pre-image backup FIRST (before any write; both
 * locales, missing twin recorded null), ② per-locale upsert (present →
 * updatePage RMW; missing twin → auto-created via the translation engine,
 * isPublished/tags inherited from the source — never publishes fixtures),
 * ③ path-level checkpoint (~/.config/opencode/historian-migrate.json;
 * re-apply of the same path+pre-state contentHash is a no-op skip),
 * ④ second-pass verification: checklist re-scored on the STORED content.
 * Mid-apply failure → {ok:false}, backup left, NO checkpoint → resumable.
 */

import { reformatPageDraft, urlsOf, type MigrateDeps } from './migrate.js';
import { classifyGenre, type Genre } from './templates/genres.js';
import { makeTranslator } from './translate.js';
import { scoreChecklist, type ChecklistVerdict } from './migrate-score.js';
import {
  backupFileFor,
  dateKey,
  defaultResultsDir,
  hashText,
  readBackup,
  readCheckpoint,
  sectionOf,
  writeBackup,
  writeCheckpoint,
  type PreImageEntry,
  type PreImagePair,
} from './migrate-store.js';
import { createPage, PageNotFoundError, updatePage, type PageDeps } from './wiki/pages.js';
import { readPage, type Locale, type PageRecord, type TranslateFn } from './wiki/pages.read.js';
import { readPageState } from './wiki/pages.write.js';

export interface ApplyArgs {
  readonly path: string;
  readonly genre?: Genre;
  readonly draft?: string;
  readonly now?: Date;
}

export interface AppliedEntry {
  readonly locale: Locale;
  readonly action: 'updated' | 'created';
  readonly urls: { en: string; zh: string };
  readonly checklist: readonly ChecklistVerdict[];
}

export type ApplyOutcome =
  | { ok: true; applied: readonly AppliedEntry[]; backupPath: string; skipped?: string }
  | { ok: false; error: Error };

function resolveTranslator(deps: MigrateDeps): TranslateFn | undefined {
  if (deps.translate !== undefined) return deps.translate;
  // Production has no injected translator: fall back to the real-fetch engine.
  return deps.fetchImpl !== undefined ? makeTranslator(deps.options, { fetchImpl: deps.fetchImpl }) : makeTranslator(deps.options);
}

async function preImageOf(deps: MigrateDeps, en: PageRecord | null, zh: PageRecord | null): Promise<PreImagePair> {
  const capture = async (p: PageRecord | null): Promise<PreImageEntry | null> => {
    if (p === null) return null;
    const s = await readPageState(deps.client, p.id);
    return {
      content: s.content,
      title: s.title,
      description: s.description,
      tags: s.tags,
      isPublished: s.isPublished,
      publishStartDate: s.publishStartDate,
      publishEndDate: s.publishEndDate,
    };
  };
  return { en: await capture(en), zh: await capture(zh) };
}

export async function applyMigration(deps: MigrateDeps, args: ApplyArgs): Promise<ApplyOutcome> {
  const now = args.now ?? (deps.now !== undefined ? deps.now() : new Date());
  const resultsDir = deps.resultsDir ?? defaultResultsDir();
  const backupFile = backupFileFor(sectionOf(args.path), dateKey(now), resultsDir);

  const en = await readPage(deps.client, args.path, 'en');
  const zh = await readPage(deps.client, args.path, 'zh');
  const source = en ?? zh;
  if (source === null) {
    return { ok: false, error: new PageNotFoundError(`page '${args.path}' does not exist (checked en and zh locales)`) };
  }

  let draft: string;
  let genre: Genre;
  if (args.draft === undefined || args.genre === undefined) {
    const r = await reformatPageDraft(deps, { path: args.path, genre: args.genre });
    if (!r.ok) return { ok: false, error: r.error };
    draft = r.draft;
    genre = r.genre;
  } else {
    draft = args.draft;
    genre = args.genre;
  }

  const translator = resolveTranslator(deps);
  if (translator === undefined) {
    return { ok: false, error: new Error('translator not wired — the twin locale content must be translated; add translate config or pass a translator to buildTools') };
  }
  const pageDeps: PageDeps = { client: deps.client, options: deps.options, translate: translator };

  // Checkpoint latch: identical pre-state (path + contentHash) → no-op skip.
  const cp = readCheckpoint(deps.homeDir);
  const recorded = cp.paths[args.path];
  const curHash = hashText(source.content);
  const curZhHash = zh === null ? null : hashText(zh.content);
  if (recorded !== undefined && recorded.contentHash === curHash && recorded.zhHash === curZhHash) {
    return {
      ok: true,
      applied: [],
      backupPath: backupFile,
      skipped: `checkpoint no-op: '${args.path}' unchanged since applied at ${recorded.appliedAt} — nothing to redo`,
    };
  }

  // ① pre-image backup FIRST — before any write (restore program of record).
  const backup = readBackup(backupFile);
  if (backup.paths[args.path] === undefined) {
    const paths = { ...backup.paths, [args.path]: await preImageOf(deps, en, zh) };
    writeBackup(backupFile, { section: sectionOf(args.path), createdAt: now.toISOString(), paths });
  }

  // ② per-locale upsert (source locale gets the raw draft, twin gets the
  //    engine translation — the twin is created, never spuriously duplicating
  //    createPage's internal twin flow, which would re-parse the draft).
  try {
    const applied: AppliedEntry[] = [];
    for (const locale of ['en', 'zh'] as const) {
      const existing = locale === 'en' ? en : zh;
      const isSource = locale === source.locale;
      if (existing !== null) {
        const content = isSource ? draft : await translator(draft, source.locale, locale);
        const after = await updatePage(pageDeps, existing.id, { content });
        applied.push({
          locale,
          action: 'updated',
          urls: urlsOf(deps.options.baseUrl, existing.path, locale),
          checklist: scoreChecklist(genre, after.page.content),
        });
      } else {
        const twinTitle = await translator(source.title, source.locale, locale);
        const twinContent = await translator(draft, source.locale, locale);
        await createPage(pageDeps, {
          path: args.path,
          locale,
          title: twinTitle,
          content: twinContent,
          tags: source.tags,
          isPublished: source.isPublished,
          twin: false,
        });
        const stored = await readPage(deps.client, args.path, locale);
        if (stored === null) {
          throw new Error(`create reported success but the re-read of '${args.path}' (${locale}) returned nothing`);
        }
        applied.push({
          locale,
          action: 'created',
          urls: urlsOf(deps.options.baseUrl, source.path, locale),
          checklist: scoreChecklist(genre, stored.content),
        });
      }
    }

    // ③ checkpoint — written only after ALL writes succeeded.
    writeCheckpoint(deps.homeDir, {
      version: 1,
      paths: {
        ...cp.paths,
        [args.path]: { contentHash: curHash, zhHash: curZhHash, appliedAt: now.toISOString(), genre },
      },
    });

    return { ok: true, applied, backupPath: backupFile };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
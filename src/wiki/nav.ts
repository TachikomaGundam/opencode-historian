// Live navigation reader (v0.5.1). Issue #1's actual disease was the SIDEBAR
// mirroring the filesystem (DYNAMIC/MIXED exposing _meta/_evidence/_sandbox),
// not the existence of machine-namespace pages — those are by design. So the
// detector reads the real primary nav (mode + curated flat trees) instead of
// inferring exposure from the page tree.
//
// Shape note: this wiki.js generation REJECTS `children` on NavigationItem
// (HTTP 400, re-probed 2026-09-08) — flat `items` are the whole truth.

import { gql, type GqlClient } from './client.js';

export interface NavItem {
  readonly label: string;
  readonly targetType: string;
  readonly target: string;
}

export interface NavTree {
  readonly locale: string;
  readonly items: readonly NavItem[];
}

export interface NavSnapshot {
  readonly mode: string;
  readonly trees: readonly NavTree[];
}

const NAV_QUERY = '{ navigation { config { mode } tree { locale items { label targetType target } } } }';

/** Shape-tolerant parse: unknown/nullish shapes degrade to '' entries; a
 *  payload without `navigation` is not-a-nav (null), letting the caller mark
 *  the check unavailable instead of claiming "clean". */
export function parseNav(raw: unknown): NavSnapshot | null {
  const nav = (raw as { navigation?: { config?: { mode?: unknown }; tree?: unknown } } | null | undefined)?.navigation;
  if (nav === undefined || nav === null) return null;
  const trees: NavTree[] = [];
  for (const t of Array.isArray(nav.tree) ? nav.tree : []) {
    const row = t as { locale?: unknown; items?: unknown };
    const items: NavItem[] = [];
    for (const i of Array.isArray(row?.items) ? row.items : []) {
      const it = i as { label?: unknown; targetType?: unknown; target?: unknown };
      items.push({
        label: typeof it?.label === 'string' ? it.label : '',
        targetType: typeof it?.targetType === 'string' ? it.targetType : '',
        target: typeof it?.target === 'string' ? it.target : '',
      });
    }
    trees.push({ locale: typeof row?.locale === 'string' ? row.locale : '', items });
  }
  return { mode: typeof nav.config?.mode === 'string' ? nav.config.mode : '', trees };
}

/** Never throws: an unreadable nav (older server, token without navigation
 *  read) returns null so the scan degrades to "unavailable", not failure. */
export async function readPrimaryNav(client: GqlClient): Promise<NavSnapshot | null> {
  try {
    return parseNav(await gql<unknown>(client, NAV_QUERY, {}));
  } catch {
    return null;
  }
}

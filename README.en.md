# opencode-historian (English)

> Bilingual wiki curator as an OpenCode plugin. 中文文档见 [README.md](README.md).

## What it is
A plugin that gives an OpenCode agent a curated memory layer on top of a Wiki.js
instance: bilingual (en/zh) twin pages, genre skeletons (G1–G6), full-text
search, page map/timeline/maintenance sweeps, migration tooling, and a capture
loop. All mutations go through read-modify-write; evidence-tier pages
(`_meta/`, `_evidence/`) are machine-owned and hidden from anonymous readers.

## Tools (11)
`historian_page_create / update / append / read / search / delete / move`,
`historian_map` (show/refresh/timeline/maintain), `historian_migrate`,
`historian_translate_snippet`, and `historian_anchor` (seal/verify human
orders against the engine session store — receipts land under
`_evidence/anchors/`, g12b-3).

## Configuration (plugin options in opencode.jsonc)
| option | type | default | notes |
|---|---|---|---|
| `baseUrl` | string | `http://localhost:3000` | wiki.js root |
| `apiKeyPath` | string | `~/.wikijs-api-key` | token file path |
| `translate.endpoint` | string | unset | Anthropic-compatible messages endpoint; env leg: `HISTORIAN_TRANSLATE_ENDPOINT` |
| `translate.model` | string | unset | **no device model is shipped in the package** (L-MACHINE-LOCAL, owner ruling 2026-10-01); set your own; env leg: `HISTORIAN_TRANSLATE_MODEL`; an unset model fails loudly at first use |
| `translate.providerKey` | string | unset | jsonc fallback leg reading `provider[<key>].options.apiKey` |
| `sections` / `locales` / `readingLoop` / `capture.enabled` | — | see README.md table | mirrored in the Chinese doc |

Credential resolution order: `translate.apiKey` → `DASHSCOPE_API_KEY` →
provider leg. With the whole chain unset the translation-backed tools stay
disabled by design — the plugin never half-works.

## Behavior notes
- Path segments must not look like locale codes; page ops take path+locale, no raw ids.
- Evidence tier (`_meta/`, `_evidence/`) writes are monolingual `en`, unpublished-friendly, machine-owned.
- Every tool result carries en/zh URLs; report them to the operator verbatim.

## Development
`npm run build` → `npx vitest run` → `node tools/privacy-audit.mjs` →
`node tools/portable-binding-audit.mjs` (guards the no-device-pin rule on
portable surfaces). Releases: see `RELEASE.md` (npm trusted publishing via
GitHub Actions OIDC; no long-lived tokens).

## Provenance
Clean-room implementation per the institutional-memory contract; incident
history and rulings live in the operator wiki (`infra/*`, `_evidence/*`).

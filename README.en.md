# opencode-historian (English)

> 中文文档见 [README.md](README.md) — this is the English front page.

> A bilingual wiki.js curator as an OpenCode plugin.

## What it is

One plugin that gives an OpenCode agent a curated memory layer on a Wiki.js
instance. Pages are written as structured, genre-typed entries.
Every write reports back both the English and Chinese URLs.

## Why it exists

A machine run by one human and a fleet of AI agents forgets everything.
Sessions end; the details scroll away. Context compresses; facts are lost.

What was deployed, what broke, what was decided — months later nobody can
look it up. The historian makes machine history findable again.

Its writing rules are distilled from five wiki cultures plus SRE
postmortem practice. The full digest lives in
`docs/research/cross-cultural-wiki-writing-digest.md`.

## What it does

- 11 `historian_*` tools: create, update, append, read, search, delete, move.
- Plus map, timeline, maintenance sweeps, migration, translation, anchoring.
- Genre skeletons G1–G6: incident retros, comparisons, checklists, concepts,
  state ledgers, how-to guides.
- Bilingual twins (en/zh) translated automatically; you configure the engine.
- Every write must report two accessible URLs, en and zh.
- Migration gate: reformat old pages with a dry-run score first.
- `/historian-capture` turns the current session into an incident page.

## Quick start

1. Add the package to the `plugin` array in `opencode.jsonc`.
2. Set the wiki URL and the path to your API key file.
3. Talk naturally: "service-a OOM'd today; cache had no cap; record it."

The historian triages, picks a genre, runs its self-check, writes, and
returns both URLs.

```jsonc
["opencode-wiki-historian", {
  "baseUrl": "http://<your-wiki>:3000",
  "apiKeyPath": "~/.wiki-key"
}]
```

The translation leg is optional. Unset, twins stay pending and no network
calls are made.

## Install

**npm (recommended).** The package is `opencode-wiki-historian`. The repo and
the npm name differ on purpose.

```jsonc
{ "plugin": ["opencode-wiki-historian"] }
```

**Local path (development).** Point at a checkout; edits apply immediately.

```jsonc
{ "plugin": ["file:///home/<you>/workspace/opencode-historian"] }
```

Verify with `opencode run --command historian --message "historian_map show"`.
Eleven `historian_*` tools mean success. Upgrading from v2? Disable the old
flat skill file first; the mapping table is in [DEVELOPMENT.md](DEVELOPMENT.md).

## Configuration

| option | default | note |
|---|---|---|
| `baseUrl` | `http://localhost:3000` | your wiki.js root |
| `apiKeyPath` | `~/.wikijs-api-key` | token file path |
| `translate.endpoint` | unset | translation API address |
| `translate.model` | unset | unset fails loudly on first use |
| `translate.apiKey` | unset | three sources, first wins |
| `translate.providerKey` | unset | reads a provider leg from opencode config |
| `sections` | `[]` (no limit) | write-prefix allowlist |
| `locales` | `["en","zh"]` | enabled languages |
| `readingLoop` | `false` | "check the wiki first" nudge |
| `capture.enabled` | `false` | idle reminder only |

No device model or gateway address ships inside the package. Set your own.

`sections`, when non-empty, is enforced: out-of-section writes are rejected
before any request is sent, naming the offending first segment.

`readingLoop` needs two signals: the option set to true, and a human-written
sentinel file. Either missing, it stays off; deleting the sentinel reverts
it instantly. An agent cannot enable it itself. Key resolution chains and
degradation details: see [DEVELOPMENT.md](DEVELOPMENT.md).

## Prerequisites (Wiki.js side)

The plugin never performs admin operations for you. Before installing:

- Enable namespacing; `en` and `zh` in Active Namespaces.
- Create an API token (Admin > API Access) covering page read/write/delete.
- Put the token in the `apiKeyPath` file, or in `WIKIJS_API_KEY`.
- Group page rules must cover your `sections` prefixes.
- Comments off is recommended for a knowledge base.

## Reading the Chinese pages

Chinese pages live under `/zh/<path>`; English pages have no prefix.
Every write result carries both URLs. If the language switcher is missing,
check the namespacing settings.

## Genres and the index layer

| genre | question it answers | skeleton in one line |
|---|---|---|
| G1 incident | what happened | timeline → root cause → impact → actions |
| G2 comparison | which one | sources + table + verdict |
| G3 checklist | where to start | checkable items |
| G4 concept | what and why | definition → diagram → examples |
| G5 ledger | what runs now | one row per component, with verify date |
| G6 runbook | how to finish a task | action + expectation + failure path |

Every write passes a 10-item self-check: short sentences, enumerations as
tables, timelines with a source column, both URLs reported. Full rules:
[DEVELOPMENT.md](DEVELOPMENT.md).

## Three content tiers

| tier | where | purpose |
|---|---|---|
| human | topic sections | distilled, bilingual, indexed |
| backstage | `_meta/` plus local mirror | machine bookkeeping |
| evidence | `_evidence/` | raw logs and transcripts; hidden from anonymous readers |

An over-long code block in a human page earns a polite advisory to move it
to the evidence tier. Advisories never block a write.

## Known limitations

| fact | status |
|---|---|
| Translation tools disabled when no key resolves | by design; fill config to restore |
| Self-evolution drivers default off; not lit on the author's machine | honest state; code and tests ready, docs do not pretend |
| npm name differs from repo name | `opencode-historian` was taken by an unrelated package |

## Decoupled from any machine

- No real hosts, real taxonomies, or page data ship inside.
- Translation address ships unset; unset means pending, never a network call.
- Every shipped file passes a privacy redline scan before publish; a hit
  blocks the release.
- All examples are placeholders: `http://<your-wiki>:3000`, `team-notes/`.

## More

Development internals, release process, and the v2 migration map:
[DEVELOPMENT.md](DEVELOPMENT.md). License: MIT.

<!-- source: /home/user/workspace/harness/historian/.omo/research/wikijs-2x-capabilities-digest.md sha256:0559d7893665669d539858545ae5d4fedcb9289e9763eedfc1392776714064ad -->

# Wiki.js 2.x Feature & Customization Digest (persisted 2026-09-01)

> Condensed from librarian report (bg_286071d0), SOURCE-VERIFIED vs requarks/wiki@6f042e9 (=tag v2.5.314,
> matches live instance), requarks/wiki-docs@6a61f50, requarks/wiki-ckeditor5@4a5529d.
> Full cited report: `/tmp/opencode/librarian/...` via task bg_286071d0 output
> `~/.local/share/opencode/tool-output/tool_0593dece80013pIQ0AqqAHpAgl` (L1073-1189). Vendor into repo too.

## Authoring surface (markdown editor = what the plugin writes)

- Stack: markdown-it 11.0.1 default preset (tables, strikethrough, **definition lists** built in) +
  modules. Enabled by default: footnotes `[^1]`, task lists, emoji `:smile:` + twemoji, sub/sup `~x~`/`^x^`,
  abbr `*[HTML]: …`, imsize `![a](/x.png =100x50)`, KaTeX `$x$`/`$$x$$`, mermaid + plantuml code blocks
  (plantuml needs egress to plantuml.requarks.io — check in air-gap), tabset, blockquote-alerts, codehighlighter.
  **Off** by default: underline `_x_`→<u>, kroki, mathjax, multimd/pivot tables, asciinema.
- **Admonitions** (use for 摘要/警告/提示 boxes): `> text` + next line `{.is-info}` (or `.is-success`/`.is-warning`/`.is-danger`).
  NOT `::: warning` containers.
- **Tabs**: `# Section {.tabset}` + child headings become tabs.
- Lists `{.grid-list}`/`{.links-list}`, tables `{.dense}`.
- **TOC: no `{{toc}}`/`[[toc]]` syntax exists** — auto from headers, shown in theme sidebar;
  Admin > Theme > TOC position (left/right/off). Literal `{{ }}` in content is v-pre-escaped (renders as text).
- **No** figure/caption syntax in markdown, **no** code-block line-highlight/titles,
  **no** card/alert/accordion/form block system, "isolated pages" don't exist, visual-editor docs are a stub.
- YAML front-matter is ONLY parsed on storage (git/disk) import; **never send `---` frontmatter through
  pages.create/update** — it renders as body text. Metadata lives in DB fields (title, description, tags, isPublished…).

## Structure / i18n / admin

- Path rules: no `.`, spaces, `\`, `//`; single-char & locale-shaped (`^[A-Z]{2}(-[A-Z]{2})?$`) first segments
  & reserved words (home, login, graphql, healthz, _assets…) rejected. `home` hard-reserved per locale.
- Page identity = sha1(locale|path|privateNS); zh twin = same path, locale `zh`, URL `/zh/<path>`.
- Namespacing: Admin > Locales → enable Multilingual Namespaces + Active Namespaces (already ON on live wiki).
- Navigation: Admin > Navigation, 4 modes (Site Tree / Static / Custom / None); static tree is per-locale
  ([{locale, items}], GraphQL navigation.updateTree). Tags do NOT drive sidebar.
- Search: UI cross-locale by default with locale chips; DB engine accepts locale filter if passed.
- Theming: only `default` theme ships in 2.x; customization = Admin > Theme > Code Injection
  (injectCSS/injectHead/injectBody) + per-page extra CSS/JS (write:styles/write:scripts scopes).
  Footer edits need theme fork. Comments providers: default(内部)/Commento/Disqus/Artalk (no Discourse).

## API / bot-relevant facts (rewrite target for the TS tool layer)

- Endpoint POST /graphql, `Authorization: Bearer <key>`; enable Admin > API Access; token inherits GROUP
  permissions — bot's group needs page-rules on locale+path (e.g. `/ops/*`) or mutations fail.
- Scopes: create/update/restore/convert need `write:pages`; delete `delete:pages`; move `manage:pages`;
  render/flushCache/rebuildTree/migrateToLocale `manage:system`; reads `read:pages`; assets `write:assets`.
- Publishing: isPublished flag + scheduled window publishStartDate/publishEndDate. NO editor lock —
  server save is last-write-wins.
- **Pitfalls (bake into plugin client, all source-verified)**:
  1. `pages.update` silently wipes omitted fields (publishStart/EndDate cleared; scriptCss/Js blanked if
     token has write:styles/scripts) → ALWAYS read-modify-write full state.
  2. `tags` must be passed on update (unconditional .map → throws otherwise); auto-lowercased.
  3. Errors come back as payload `{responseResult{succeeded,errorCode}}`, NOT GraphQL errors → check succeeded.
  4. Empty content rejected (PageEmptyContent).
  5. Changing path/locale via update triggers movePage (needs write at destination) → prefer pages.move.
  6. Render happens at save; rendering-module config changes don't re-render old pages → pages.render/flushCache.
  7. Asset upload NOT GraphQL: `POST /u` multipart field `mediaUpload`, one file per request, JSON
     `{"folderId":N}`, filename sanitized (lowercase, space/,/;/# → _).
  8. pages.create id-in-response bug workaround: look up by (path, locale) after create.
  9. Always pass locale explicitly on create/singleByPath; relative links resolve inside locale namespace.

## Known wiki.js version note

All pinned to v2.5.314; live instance matches 2.5.x line. Patch-level regressions (e.g. #2602 at 2.5.159) = COMMUNITY evidence.

<!-- source: /home/user/.local/share/opencode/tool-output/tool_0593dece80013pIQ0AqqAHpAgl sha256:2d8f96086ad5a5a701be6b92cc747f452b466754162069831dc2f4a33c7241d1 -->

# Wiki.js 2.x Documentation Report

**Method & provenance.** I cloned the Wiki.js source (default branch `main` = 2.x; there is no separate `v2` branch) at HEAD `6f042e9` = tag **v2.5.314** — same minor line as the live 2.5.x instance — plus the official docs source repo `requarks/wiki-docs` (`6a61f50`, serves docs.requarks.io 1:1) and the custom CKEditor build `requarks/wiki-ckeditor5` (`4a5529d`). Every claim is labeled **SOURCE-VERIFIED** (code/docs I read), **COMMUNITY** (issue/blog), or **UNCERTAIN**.

---

## 1. Markup / Authoring

### 1.1 markdown-it stack and what's enabled by default

Wiki.js renders markdown server-side with **markdown-it 11.0.1** in a modular pipeline (`server/modules/rendering/*`). The core instantiates markdown-it with **no preset argument → the `default` preset** (html/breaks/linkify/typographer/quotes come from module config), which bundles tables, strikethrough and **definition lists** ([renderer.js#L23-L48](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/modules/rendering/markdown-core/renderer.js#L23-L48)). A rendering module is enabled-by-default unless its `definition.yml` sets `enabledDefault: false` — the loader uses `_.get(renderer,'enabledDefault', true)` ([models/renderers.js#L57-L60](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/models/renderers.js#L57-L60)).

| Feature | Syntax | Default | Evidence |
|---|---|---|---|
| Tables | GFM `\|…\|` | ✅ on | [docs editors/markdown.md](https://github.com/requarks/wiki-docs/blob/6a61f50c82b18cde7fd9e534b90d4512b1895c17/editors/markdown.md) |
| Strikethrough | `~~text~~` | ✅ on | same |
| Definition lists | `Term` ⏎ `: Definition` (compact: `~ def`) | ✅ on (md-it default preset) | **SOURCE-VERIFIED**; syntax per [markdown-it sample](https://github.com/markdown-it/markdown-it/blob/master/support/demo_template/sample.md) |
| Footnotes | `[^1]` | ✅ on (`markdown-footnotes`) | renderers list |
| Task lists | `- [x]` | ✅ on (`markdown-tasklists`) | same |
| Admonitions | **NOT `::: warning`** — blockquote + attribute: `> text` ⏎ `{.is-info}` / `.is-success` / `.is-warning` / `.is-danger` | ✅ (`markdown-it-attrs`, allowed attrs `id,class,target` + `markdown-it-decorate`) | [renderer.js#L40-L46](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/modules/rendering/markdown-core/renderer.js#L40-L46), docs markdown.md |
| Emoji | `:smile:` | ✅ on (`markdown-emoji` + `html-twemoji`) | renderers list |
| Underline | `_text_` → `<u>` | ❌ **off by default** (when on, it replaces emphasis-underscore behavior) | [renderer.js#L39-L41](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/modules/rendering/markdown-core/renderer.js#L39) |
| Sub/superscript | `~x~` / `^x^` | ✅ on (`markdown-supsub`) | renderers list |
| Abbreviations | `*[HTML]: HyperText…` | ✅ on (`markdown-abbr`) | renderers list |
| Autosize images | `![a](/p.png =100x50)` (`=100x`, `=x50`, `=100%`) | ✅ on (`markdown-imsize`) | docs markdown.md |
| Math (KaTeX) | `$inline$`, `$$block$$` (+ mhchem) | ✅ on | [katex definition.yml](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/modules/rendering/markdown-katex/definition.yml) |
| Math (MathJax) | | ❌ off | renderers list |
| Diagrams | ```mermaid``` ✅; ```plantuml``` ✅ (server default `https://plantuml.requarks.io`); ```kroki``` ❌; ```diagram``` (draw.io base64) ✅ | as stated | [renderer.js#L31-L35](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/modules/rendering/markdown-core/renderer.js#L31-L35) |
| multi-table / pivot-table / asciinema / image-prefetch | | ❌ off | renderers list |

Other attribute extras (docs markdown.md): lists `{.grid-list}` / `{.links-list}`, tables `{.dense}`, tabs via `# Section {.tabset}` + child headers (`html-tabset`, enabled since 2.4).

### 1.2 Table of contents — **there is NO `{{toc}}` / `[[toc]]` syntax in 2.x** (SOURCE-VERIFIED negative: zero matches in source+docs)

TOC is automatic: after each render, a job parses `h1–h6` with cheerio into nested `{root:[{title,anchor,children}]}` JSON stored in `pages.toc` ([server/jobs/render-page.js](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/jobs/render-page.js)); `isStrict` = page has an `h1` (else `h2` treated as top level). Anchors are `uslug`-slugified header text, honoring custom `id` attributes (allowed via markdown-it-attrs), digit-leading anchors prefixed `h-`, duplicates suffixed `-N`, plus pilcrow `.toc-anchor` links ([html-core/renderer.js#L203-L234](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/modules/rendering/html-core/renderer.js#L203-L234)). Display is theme-controlled, not content-controlled: `tocPosition` (left/right/off, default left) is set in **Admin > Theme**, and the shipped default theme adds props `sdPosition`/`showTOC` ([theme.yml](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/client/themes/default/theme.yml)). Docs: guide/intro.md — "Table of Contents – Sections of the current page. Based on the headers in the content."
**Gotcha:** literal `{{ … }}` in content is wrapped in `v-pre` so Vue doesn't interpolate ([html-core/renderer.js#L268-L295](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/modules/rendering/html-core/renderer.js#L268-L295)) — so `{{toc}}` renders as plain text.

### 1.3 Front-matter — the "newer frontmatter feature"

**YAML front-matter is a storage-sync feature, not an editor feature, and is not documented on docs.requarks.io** (SOURCE-VERIFIED negative grep). `Page.parseMetadata()` understands `---\nyaml\n---` (markdown), HTML-comment YAML, and v1-legacy `<!-- TITLE: x -->` — but it is only called from the disk/Git **import** path ([models/pages.js#L18-L21, L194-L231](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/models/pages.js#L194-L231); used at [storage/disk/common.js#L77](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/modules/storage/disk/common.js#L77)). On **export**, Wiki.js injects `title, description, published, date, tags, editor, dateCreated` ([helpers/page.js#L77-L100](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/helpers/page.js#L77-L100)) — exactly the fields seen in every wiki-docs file. Real page fields live in the DB/GraphQL model ([models/pages.js#L31-L55](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/models/pages.js#L31-L55)).

### 1.4 Figures / captions, code-block extras

- **Markdown editor: no figure/caption syntax** (SOURCE-VERIFIED negative). Captions *do* exist in the **visual editor** via CKEditor `ImageCaption` (§2). UNCERTAIN whether any community plugin adds it to markdown.
- **Code blocks:** highlight.js via `html-codehighlighter` (~185 languages per docs). **No line highlighting, no code titles/block filenames** — nothing in source or docs. Label: **undocumented/absent**.

---

## 2. Layout / Content blocks (visual editor vs markdown)

- **Visual editor = CKEditor 5** via custom build `@requarks/ckeditor5` `19.0.1-wiki.2` ([package.json#L212](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/package.json#L212)). The official docs page is a stub ("User Guide *Coming Soon*", [editors/visualeditor.md](https://github.com/requarks/wiki-docs/blob/6a61f50c82b18cde7fd9e534b90d4512b1895c17/editors/visualeditor.md)), so I read the build source. Toolbar items: `heading, fontsize, fontfamily, bold, italic, underline, strikethrough, subscript, superscript, highlight, alignment, numberedList, bulletedList, todoList, specialCharacters, linkToPage, link, blockquote, insertAsset, insertTable, code, codeBlock, mediaEmbed, horizontalLine …` plus plugins incl. `Table(+Properties), Image(+Caption,Resize,Style,Upload), Essentials, PasteFromOffice, WordCount`. Two **Wiki.js-specific buttons**: `LinkToPage` and `InsertAsset` (asset/media modal) ([src/ckeditor.js](https://github.com/requarks/wiki-ckeditor5/blob/4a5529d0dfde31fb53e23dfa067400192bfa1dcd/src/ckeditor.js#L68-L111)). Visual output is stored as **HTML** (`contentType: html`).
- **No "Cards"/"Alerts"/"Accordion"/"Form" block system in 2.x**, and these are **not markdown-it container directives** — admonitions are the blockquote+`{.is-*}` pattern, tabs are the `{.tabset}` heading trick (`html-tabset` emits a `<tabset>` Vue component, [renderer.js#L20-L21](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/modules/rendering/html-tabset/renderer.js#L20-L21)), TOC is automatic, image/video = markdown / `insertAsset` / `mediaEmbed`. **Raw-markdown-usable:** admonitions, tabset, grid/links lists, dense tables, emoji, diagrams, KaTeX. **Visual-editor-only:** real image captions, table cell properties, font size/family, highlight, alignment.
- A "blocks" picker (List Children Pages / Tabs) exists but is **dormant**: its only entry point is a **disabled** button in the code editor ([editor-modal-blocks.vue#L36-L52](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/client/components/editor/editor-modal-blocks.vue#L36-L52), [editor-code.vue#L17](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/client/components/editor/editor-code.vue#L17)); "List Children Pages" has no renderer implementation → unreleased feature.

---

## 3. Structure: tags, navigation, home

- **Tags** are flat labels (`/ops/foo` needs no folder creation — folders are inferred from paths; [guide/structure.md](https://github.com/requarks/wiki-docs/blob/6a61f50c82b18cde7fd9e534b90d4512b1895c17/guide/structure.md)). Browse via the `/t` route; filter via GraphQL `pages.list(tags:[...])`. **Tags do NOT drive the sidebar** (SOURCE-VERIFIED negative: nothing in the navigation module consumes tags).
- **Navigation** = **Admin > Navigation**, exactly **4 modes**: Site Tree (auto from paths) / Static (headers, links, dividers, per-group visibility) / Custom (both, the default) / None ([navigation.md](https://github.com/requarks/wiki-docs/blob/6a61f50c82b18cde7fd9e534b90d4512b1895c17/navigation.md)). Static nav **is per-locale**: tree stored as `[{locale, items}]` with copy-from-locale; GraphQL `navigation.updateTree(tree:[NavigationTreeInput]!, mode)` ([admin-navigation.vue#L320-L395](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/client/components/admin/admin-navigation.vue#L320-L395)).
- **"Isolated pages" do not exist in Wiki.js 2.x** — zero matches for *isolated/orphan* in code and docs (SOURCE-VERIFIED negative). The premise likely comes from another product.
- **Home page**: path `home` is **hard-reserved per locale**; an empty URL resolves to `home` ([helpers/page.js#L27-L37](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/helpers/page.js#L27-L37)). **No admin setting to point home elsewhere** in 2.5.314. Under namespacing, each locale gets its own `/{locale}/home` ([page.vue#L656-L657](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/client/themes/default/components/page.vue#L656)).

---

## 4. I18N / Multilingual

- **Admin > Locales**: download locale packs (☁ icon), set **Site Locale**, enable **Multilingual Namespaces**, select **Active Namespaces** ([locales.md](https://github.com/requarks/wiki-docs/blob/6a61f50c82b18cde7fd9e534b90d4512b1895c17/locales.md)); config keys `localization.locale|autoUpdate|namespacing|namespaces` ([admin-locale.vue#L46-L88](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/client/components/admin/admin-locale.vue#L46)). RTL locales mirror the site (code blocks stay LTR).
- **Locale switcher**: top-bar "Language" menu, shown when at least one alternative locale exists (`siteLangs`) ([nav-header.vue#L95-L116](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/client/components/common/nav-header.vue#L95)). The docs' "Writing an alternate locale version" section is literally *TODO* — undocumented. Mechanic: page identity is `sha1(locale|path|privateNS)`; a first path segment matching `^[A-Z]{2}(-[A-Z]{2})?$` is the locale ([helpers/page.js#L29-L67](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/helpers/page.js#L29-L67)).
- **Per-locale navigation**: yes (§3). **Per-locale search**: engine stores/filters `locale` (`pages.search(query,path,locale)`; DB engine `andWhere('localeCode')`), but the **UI sends no locale by default** — cross-locale results with locale chips + client toggles `searchRestrictLocale`/`searchRestrictPath` (default off) ([search-results.vue#L84-L85](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/client/components/common/search-results.vue#L84), [db/engine.js#L31-L32](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/modules/search/db/engine.js#L31)). Bulk move: `pages.migrateToLocale` (manage:system).

---

## 5. Theming / Customization

- **Only one theme ships: `default`** (light+dark). Downloading/switching themes is *not yet possible* in 2.x; custom themes require forking/building — copy `client/themes/default` (components/js/scss/`theme.yml`/thumbnail); the header (top bar) is **not** themeable; activation requires editing the `theming` row in the DB ([dev/themes.md](https://github.com/requarks/wiki-docs/blob/6a61f50c82b18cde7fd9e534b90d4512b1895c17/dev/themes.md); [client/themes/ contains only `default`](https://github.com/requarks/wiki/tree/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/client/themes) — SOURCE-VERIFIED). Source bug worth knowing: `theme.yml` defines `showTags` **three times** (tags/author-date/rating) — YAML duplicate keys, last wins.
- **Injection**: **Admin > Theme > Code Injection** = `injectCSS` (CleanCSS-processed), **`injectHead`**, **`injectBody`** ([admin-theme.vue#L97-L126](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/client/components/admin/admin-theme.vue#L97), [resolvers/theming.js#L28-L49](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/graph/resolvers/theming.js#L28)). Per-page CSS/JS via `scriptCss`/`scriptJs` (guarded by `write:styles`/`write:scripts`). Footer edits require a custom theme (`nav-footer.vue`); no admin UI.
- **Comments**: enable globally in **Admin > General**, pick a provider in **Admin > Comments**. Shipped in 2.5.314: **`default` (internal), Commento, Disqus, Artalk** ([server/modules/comments/](https://github.com/requarks/wiki/tree/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/modules/comments)) — **Discourse is NOT supported** (docs list default/commento/disqus; Artalk newer than docs). Permissions `read:comments`/`write:comments`/`manage:comments`; external providers still need `read:comments` to display; site-wide toggle only ([comments.md](https://github.com/requarks/wiki-docs/blob/6a61f50c82b18cde7fd9e534b90d4512b1895c17/comments.md)).

---

## 6. Access / API

- **Endpoint** `POST /graphql`; enable **Admin > API Access** (`api.isEnabled`); token created via `system.createApiKey(name, expiration, fullAccess, group)` — the token **inherits the chosen group's global permissions** (or admin if `fullAccess`); pass as `Authorization: Bearer …` ([dev/api.md](https://github.com/requarks/wiki-docs/blob/6a61f50c82b18cde7fd9e534b90d4512b1895c17/dev/api.md), [auth.js#L179-L203](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/core/auth.js#L179)). "Scopes" = permission names enforced per resolver via `@auth(requires:[...])`.
- **Page mutations** ([page.graphql#L86-L165](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/graph/schemas/page.graphql#L86)):

| Mutation | Required scopes (any of) |
|---|---|
| `pages.create` / `pages.update` / `pages.restore` / `pages.convert` | `write:pages`, `manage:pages`, `manage:system` |
| `pages.delete` | `delete:pages`, `manage:system` |
| `pages.move` | `manage:pages`, `manage:system` |
| `pages.render` / `flushCache` / `rebuildTree` / tag mgmt / `migrateToLocale` | `manage:system` |
| reads (`single`, `singleByPath`, `list`, `search`, `history`) | `read:pages` (+`manage:system` bypass) |
| assets | `read:assets`, `write:assets` (uploads), `manage:system` |

Page access is additionally constrained by **group page-rules on locale+path** at every mutation — a bot token's group needs a rule covering e.g. `/ops/*`.
- **Publishing workflow**: `isPublished` (draft = unpublished) + **scheduled window** `publishStartDate`/`publishEndDate`. **No editor locking**: concurrency is a client-side **conflict check** (`pages.conflictLatest` + modal); server save is last-write-wins ([resolvers/page.js#L372](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/graph/resolvers/page.js#L372), [editor-modal-conflict.vue#L158](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/client/components/editor/editor-modal-conflict.vue#L158)). Editor is immutable via `update`; change it only with `pages.convert(id, editor)`.

---

## 7. Known pitfalls for programmatic authoring (2.x / 2.5.x)

1. **`pages.update` silently wipes omitted fields**: the patch always writes `publishStartDate/publishEndDate = opts.* || ''` (clears scheduled publish), and if the token group has `write:styles`/`write:scripts`, omitted `scriptCss/scriptJs` **blank per-page CSS/JS** ([models/pages.js#L403-L448](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/models/pages.js#L425)). Read-modify-write with full state.
2. **`tags` is effectively required on update**: `associateTags` does `tags.map(...)` on `opts.tags` unconditionally → update without `tags` throws ([models/pages.js#L443](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/models/pages.js#L443), [models/tags.js#L53-L58](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/models/tags.js#L53)). Tags lowercased/trimmed automatically.
3. **Errors are payloads, not GraphQL errors**: every mutation returns `{responseResult{succeeded,errorCode,slug,message}}` — bots must check `succeeded`.
4. **Empty content rejected** (`PageEmptyContent`) — cannot blank a page via `update`.
5. **Renaming = moving**: a different `path`/`locale` in `pages.update` triggers `movePage`, requiring `write:pages` **at the destination** or failing mid-save with `PageMoveForbidden`. Prefer `pages.move`.
6. **Render happens at save; module toggles don't re-render old pages.** Rendered HTML + TOC persisted (`pages.render`, `pages.toc`, cache `data/cache/{hash}.bin`). After config changes call `pages.render(id)` / `pages.flushCache` (manage:system). Community: mermaid/plantuml "in preview but not on page" fixed by re-save ([#1839](https://github.com/requarks/wiki/issues/1839), CLOSED; also [#2602](https://github.com/requarks/wiki/issues/2602) 2.5.159 regression).
7. **Asset upload is NOT GraphQL** (`GraphQLUpload` commented out, [graph/index.js#L10](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/graph/index.js#L10)). It's **`POST /u`** multipart, field **`mediaUpload`**, **one file per request**, form JSON `mediaUpload='{"folderId":N}'`, `Authorization: Bearer <token>`, needs `write:assets`; filenames sanitized (lowercase; space/`,`/`;`/`#` → `_`) ([upload.js#L13-L97](https://github.com/requarks/wiki/blob/6f042e97cc2d3acda6b6ff611de8e0faacce91c1/server/controllers/upload.js#L13)).
8. **Front-matter in API-created content renders as body text** — `parseMetadata` only runs on storage import; don't ship `---` YAML through `pages.create`.
9. **Path validation**: no `.`, spaces, `\`, `//`; single-char and locale-shaped first segments and reserved words (`home,login,register,graphql,healthz,_assets,favicon…`) rejected ([guide/pages.md](https://github.com/requarks/wiki-docs/blob/6a61f50c82b18cde7fd9e534b90d4512b1895c17/guide/pages.md)).
10. **Locale pitfalls**: pass `locale` explicitly on create / `singleByPath`; relative links resolve under the locale namespace. Storage-sync collision: same path across locales could overwrite in local-disk export ([#1000](https://github.com/requarks/wiki/issues/1000), COMMUNITY/closed).
11. **External diagram services need egress**: PlantUML defaults to `https://plantuml.requarks.io` — air-gapped/Docker instances show raw code unless self-hosted or Kroki used ([#2796](https://github.com/requarks/wiki/issues/2796), COMMUNITY).

**Explicitly-undocumented / wrong-premise items:** `{{toc}}` syntax (doesn't exist), "isolated pages" (doesn't exist), Discourse comments (unsupported), figure/caption markdown syntax (absent), code-block line-highlight/titles (absent), visual-editor user guide (docs stub).

**Scope note:** all source citations are pinned to v2.5.314; behaviors confirmed there match the 2.5.x series your localhost:3000 instance runs, though patch-level differences within 2.5.x (e.g., the 2.5.159 rendering regression) may exist — treat version-specific bug reports as COMMUNITY evidence tied to their stated versions.
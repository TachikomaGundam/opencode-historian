# Release process (v0.5.4+) — npm Trusted Publishing (OIDC), no tokens

## One-time npm-site config (package owner, browser — this is the human key)
1. npmjs.com → Sign in → My Packages → **opencode-historian** → Settings → **Trusted Publisher** → choose **GitHub Actions**.
2. Fields (case-sensitive, exact):
   - Organization or user: `TachikomaGundam`
   - Repository: `opencode-historian`
   - Workflow filename: `publish.yml`   ← filename only, must exist under `.github/workflows/`
   - Environment name: (leave empty)
   - Allowed actions: tick **Allow npm publish** — new configs default to stage-only; without the tick the CI run fails closed (correct, not a bug).
3. Save — npm does NOT validate on save; errors surface only at first real publish, so the next tag is the verification.
4. Hardening after first green run: Settings → Publishing access → “Require two-factor authentication and disallow tokens”; then revoke old automation tokens (npmjs.com → Access Tokens).

## GitHub side
- The workflow file must be IN the commit that gets tagged (workflows load from the built ref, not the default branch).
- Keep the repo public — provenance is not generated from private source repos.

## Cutting a release
1. bump `package.json` + lock (CI pin gate refuses tag != package version);
2. local: border check PASS → receipt `.omo/release/<ver>.md`;
3. `git tag v<X.Y.Z> <bump-commit>`; push branch, then tag;
4. Actions publishes via OIDC with provenance automatically; verify `npm view <pkg> version`.

## Gates before any publish (CI mirrors prepublishOnly, explicit for legible logs)
`npm run build` → `npx vitest run` → `node tools/privacy-audit.mjs` → tag/version pin.

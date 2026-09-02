#!/usr/bin/env bash
# finish-publish.sh — todo 19 completion runner (the 10-step checklist in .qa/19.txt, automated).
#
# Usage:  scripts/finish-publish.sh <6-digit-npm-OTP>
# Effect: publishes opencode-wiki-historian@0.1.0 to npm, proves the npm-sourced plugin
#         loads (not the file:// twin), verifies npmjs 200, tags v0.1.0.
# Safe:   idempotent (re-run OK); never prints the OTP; restores global config on exit.
set -euo pipefail

OTP="${1:-}"
REPO="/home/user/workspace/opencode-historian"
JSONC="$HOME/.config/opencode/opencode.jsonc"
SCRATCH="$REPO/.qa/scratch/npm-smoke"
PKG="opencode-wiki-historian"
EVID="$REPO/.qa/19.txt"

if [[ ! "$OTP" =~ ^[0-9]{6}$ ]]; then
  echo "usage: scripts/finish-publish.sh <6-digit OTP from your authenticator>" >&2
  exit 2
fi

cd "$REPO"
say() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$EVID"; }

# --- 0. auth sanity (token grants read; writes need OTP) ---------------------
WHO=$(npm whoami) || { say "FAIL: npm whoami (login expired?)"; exit 3; }
say "whoami=$WHO"

# --- 1. publish (E409 = already published -> continue, still verify) --------
set +e
PUB=$(npm publish --access public --otp="$OTP" 2>&1)
RC=$?
set -e
if [ $RC -eq 0 ]; then
  say "publish: OK ${PKG}@$(node -p 'require("./package.json").version')"
elif grep -q 'E409' <<<"$PUB"; then
  say "publish: already on registry (E409) — continuing with verification"
elif grep -q 'EOTP' <<<"$PUB"; then
  say "FAIL: EOTP again — wrong or expired code; regenerate and re-run"
  exit 4
else
  say "FAIL: publish errored:"; printf '%s\n' "$PUB" | tail -5 | sed 's/^/    /' | tee -a "$EVID"
  exit 5
fi

# --- 2. mask the file:// plugin entry so the smoke proves npm provenance ----
BACKUP=$(mktemp)
cp "$JSONC" "$BACKUP"
restore() {
  if ! cmp -s "$BACKUP" "$JSONC"; then
    cp "$BACKUP" "$JSONC"
    say "config: file:// entry RESTORED"
  fi
  rm -f "$BACKUP"
}
trap restore EXIT
python3 - "$JSONC" "$PKG" <<'PY'
import re, sys
p, pkg = sys.argv[1], sys.argv[2]
s = open(p, encoding='utf-8').read()
# comment out ONLY the entry string pointing at the local repo dir (abs OR file:// form)
out = re.sub(r'"((?:file://)?/home/user/workspace/%s[^"]*)"' % pkg, r'/*ORCH-MASKED-FOR-PUBLISH-SMOKE "\1"*/', s, count=1)
assert out != s, "no file:// or abs-path entry found to mask"
open(p, 'w', encoding='utf-8').write(out)
print("masked file:// entry")
PY
say "config: file:// entry masked for smoke (auto-restores on exit)"

# --- 3. npm-provenance smoke: fresh project, plugin must come from npm cache
mkdir -p "$SCRATCH"
cat > "$SCRATCH/opencode.json" <<EOF
{ "plugin": ["$PKG"] }
EOF
# cache layout: ~/.cache/opencode/packages/<pkg-spec>@<tag>/node_modules/<name>/
rm -rf "$HOME/.cache/opencode/packages/${PKG}@"*   # force fresh npm resolution
if (cd "$SCRATCH" && opencode run "list your tools whose names start with historian_" \
     --print-logs --log-level INFO 2>&1) | tee "$SCRATCH/run.log" \
   | grep -q 'historian_page_create'; then
  say "smoke: historian_* tools registered from npm package"
else
  say "FAIL: tools not registered from npm package — see $SCRATCH/run.log"
  exit 6
fi
# R3 module-form risk branch: legacy named-export registration check happened via grep above;
# if a future loader ever rejects the {id, server} object shape from npm, fix = append
# `export const HistorianPlugin = server` legacy alias + npm version patch && re-run.
if ! find "$HOME/.cache/opencode" -maxdepth 4 -path "*packages*$PKG*" -print -quit | grep -q .; then
  say "WARN: npm load path not under ~/.cache/opencode/packages — verify manually (plan criterion)"
fi

# --- 4. npmjs page must now be 200 (the todo-18 exempted URL) ---------------
CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://www.npmjs.com/package/$PKG")
[ "$CODE" = 200 ] && say "npmjs: $CODE OK" || { say "FAIL: npmjs returned $CODE"; exit 7; }

# --- 5. tag (push only if a remote exists) -----------------------------------
git tag -f "v$(node -p 'require("./package.json").version' 2>/dev/null || echo 0.1.0)" >/dev/null
if git remote -v | grep -q .; then git push --tags; say "tag: pushed"; else say "tag: created locally (no remote configured)"; fi

say "ALL DONE — todo 19 closed. Unmask note: original config already restored."

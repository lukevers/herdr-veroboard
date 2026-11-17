#!/usr/bin/env bash
# install.sh in a throwaway HOME: bash tests/install.test.sh. Never touches your real home.
set -euo pipefail
PKG="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HOME="$T"
APP="$HOME/.config/herdr-app"
mkdir -p "$APP"
printf '{"global":{"cmd-t":"tab.new"},"layout:veroboard":{"cmd-f":"something.else"}}' > "$APP/keys.json"
fail=0; check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
out="$("$PKG/install.sh" 2>&1)"
check "claude scripts installed" '[ -f "$HOME/.claude/veroboard/facts.js" ] && [ -x "$HOME/.claude/veroboard/tap.js" ] && [ -x "$HOME/.claude/veroboard/ping.sh" ]'
check "rules file created" '[ -f "$HOME/.config/veroboard/config.json" ]'
check "layout, mods, theme installed" '[ -f "$APP/layouts/veroboard.json" ] && [ -f "$APP/mods/veroboard/main.js" ] && [ -f "$APP/mods/veroboard-menu/main.js" ] && [ -f "$APP/mods/veroboard/card.js" ] && [ -f "$APP/mods/veroboard/topbar.js" ] && [ -f "$APP/mods/veroboard/cables.js" ] && [ -f "$APP/mods/veroboard/settings.js" ] && [ -f "$APP/themes/dusk.json" ]'
check "your keys kept" 'node -e "const k=require(\"$APP/keys.json\");process.exit(k.global[\"cmd-t\"]===\"tab.new\"&&k[\"layout:veroboard\"][\"cmd-f\"]===\"something.else\"&&k[\"layout:veroboard\"][\"cmd-9\"]===\"veroboard.space8\"?0:1)"'
check "key conflict reported" 'grep -q "Kept your own binding for: cmd-f" <<<"$out"'
check "keys.json backed up" 'ls "$APP"/keys.json.bak-* >/dev/null 2>&1'
check "second run succeeds" '"$PKG/install.sh" >/dev/null 2>&1'
echo '{"names":["mine"]}' > "$HOME/.config/veroboard/config.json"
check "second run keeps your rules file" '"$PKG/install.sh" >/dev/null 2>&1 && grep -q mine "$HOME/.config/veroboard/config.json"'
echo "// my edit" >> "$APP/mods/veroboard/main.js"
check "refuses to overwrite your changed mod" '! "$PKG/install.sh" >/dev/null 2>&1 && grep -q "my edit" "$APP/mods/veroboard/main.js"'
check "--force moves it aside and installs" '"$PKG/install.sh" --force >/dev/null 2>&1 && ls -d "$APP"/mods/veroboard.bak-* >/dev/null 2>&1 && ! grep -q "my edit" "$APP/mods/veroboard/main.js"'
check "tap.js writes facts and passes output through" 'out2=$(echo "{\"workspace\":{\"current_dir\":\"$HOME\"}}" | HC_TERMINAL_ID=tt1 node "$HOME/.claude/veroboard/tap.js" -- "echo hello") && [ "$out2" = hello ] && [ -f "$HOME/.claude/herdr/sessions/tt1.json" ]'
check "facts.js records where node is" '[ "$(cat "$HOME/.claude/herdr/node-path")" = "$(command -v node)" ] || [ -x "$(cat "$HOME/.claude/herdr/node-path")" ]'
check "classify.js answers" '[ "$(node "$HOME/.claude/veroboard/classify.js" "Done. Tell me which." | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>console.log(JSON.parse(s).result.rule))")" = tell-me ]'
check "ping.sh writes a ping" 'HC_TERMINAL_ID=tt1 sh "$HOME/.claude/veroboard/ping.sh" && [ -f "$HOME/.claude/herdr/pings/tt1.json" ]'
[ $fail -eq 0 ] && echo "all passed" || { echo "some failed"; exit 1; }

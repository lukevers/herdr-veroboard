#!/usr/bin/env bash
# install.sh in a throwaway HOME: bash tests/install.test.sh. Never touches your real home.
# The agents' hook lines are added from the board's settings (agents.js; tests/agents.test.js), not here.
set -euo pipefail
PKG="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
export HOME="$T"
unset HERDR_APP_HOME
APP="$HOME/.config/herdr-app"
AG="$APP/mods/veroboard/agent"
mkdir -p "$APP"
printf '{"global":{"cmd-t":"tab.new"},"layout:veroboard":{"cmd-f":"something.else"}}' > "$APP/keys.json"
fail=0; check() { if eval "$2"; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi; }
out="$("$PKG/install.sh" 2>&1)"
check "layout and mods installed" '[ -f "$APP/layouts/veroboard.json" ] && [ -f "$APP/mods/veroboard/main.js" ] && [ -f "$APP/mods/veroboard-menu/main.js" ] && [ -f "$APP/mods/veroboard-toast/main.js" ] && [ -f "$APP/mods/veroboard-decisions/main.js" ]'
check "the agent scripts come inside the board mod" '[ -f "$AG/core/rules.js" ] && [ -f "$AG/core/launch-guard.sh" ] && [ -f "$AG/adapters/claude/tap.js" ] && [ -f "$AG/adapters/codex/hook.js" ]'
check "nothing written outside Herdr's home" '[ ! -e "$HOME/.config/veroboard" ] && [ ! -e "$HOME/.claude" ] && [ ! -e "$HOME/.codex" ]'
check "points to the Agents tab" 'grep -q "Agents → Connect" <<<"$out"'
check "your keys kept" 'node -e "const k=require(\"$APP/keys.json\");process.exit(k.global[\"cmd-t\"]===\"tab.new\"&&k[\"layout:veroboard\"][\"cmd-f\"]===\"something.else\"&&k[\"layout:veroboard\"][\"cmd-1\"]?0:1)"'
check "key conflict reported" 'grep -q "Kept your own binding for: cmd-f" <<<"$out"'
check "keys.json backed up" 'ls "$APP"/keys.json.bak-* >/dev/null 2>&1'
check "second run succeeds" '"$PKG/install.sh" >/dev/null 2>&1'
check "files Herdr adds to a mod folder are not a conflict" 'touch "$APP/mods/veroboard/gpui-kit.d.ts" "$APP/mods/veroboard-menu/jsconfig.json" && "$PKG/install.sh" >/dev/null 2>&1'
echo "// my edit" >> "$APP/mods/veroboard/main.js"
check "refuses to overwrite your changed mod" '! "$PKG/install.sh" >/dev/null 2>&1 && grep -q "my edit" "$APP/mods/veroboard/main.js"'
check "--force moves it aside and installs" '"$PKG/install.sh" --force >/dev/null 2>&1 && ls -d "$APP"/mods/veroboard.bak-* >/dev/null 2>&1 && ! grep -q "my edit" "$APP/mods/veroboard/main.js"'
out3="$("$PKG/install.sh" --codex 2>&1)"
check "--codex points to the Agents tab" 'grep -q "Agents → Connect" <<<"$out3" && [ ! -e "$HOME/.codex" ]'
# The scripts run from where Herdr put them; what they write still goes to ~/.config/veroboard/state.
check "tap.js writes facts and passes output through" 'out2=$(echo "{\"workspace\":{\"current_dir\":\"$HOME\"}}" | HC_TERMINAL_ID=tt1 node "$AG/adapters/claude/tap.js" -- "echo hello") && [ "$out2" = "hello" ] && [ -f "$HOME/.config/veroboard/state/sessions/tt1.json" ]'
check "facts.js records where node is" '[ "$(cat "$HOME/.config/veroboard/state/node-path")" = "$(command -v node)" ] || [ -x "$(cat "$HOME/.config/veroboard/state/node-path")" ]'
check "classify.js answers, with the defaults beside it" '[ "$(node "$AG/core/classify.js" "Done. Tell me which." | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>console.log(JSON.parse(s).result.to))")" = "you" ] && node "$AG/core/classify.js" --info | grep -q "mods/veroboard/agent/core/defaults.json"'
check "ping.sh writes a ping" 'HC_TERMINAL_ID=tt1 sh "$AG/adapters/claude/ping.sh" && [ -f "$HOME/.config/veroboard/state/pings/tt1.json" ]'
check "the launch guard runs from there" 'echo "{\"tool_input\":{\"command\":\"ls\"}}" | sh "$AG/core/launch-guard.sh" claude'
[ $fail -eq 0 ] && echo "all passed" || { echo "some failed"; exit 1; }

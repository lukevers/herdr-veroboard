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
check "launch guard installed executable" '[ -x "$HOME/.config/veroboard/core/launch-guard.sh" ] && [ -f "$HOME/.config/veroboard/core/launch-guard.js" ] && [ -f "$HOME/.config/veroboard/adapters/codex/terminal.js" ]'
check "Claude launch guard snippet printed" 'grep -Fq "sh ~/.config/veroboard/core/launch-guard.sh claude" <<<"$out" && grep -Fq "PreToolUse" <<<"$out"'
check "claude scripts installed" '[ -f "$HOME/.config/veroboard/adapters/claude/facts.js" ] && [ -x "$HOME/.config/veroboard/adapters/claude/tap.js" ] && [ -x "$HOME/.config/veroboard/adapters/claude/ping.sh" ]'
check "rules file created" '[ -f "$HOME/.config/veroboard/config.json" ]'
check "layout and mods installed" '[ -f "$APP/layouts/veroboard.json" ] && [ -f "$APP/mods/veroboard/main.js" ] && [ -f "$APP/mods/veroboard-menu/main.js" ] && [ -f "$APP/mods/veroboard-toast/main.js" ] && [ -f "$APP/mods/veroboard/card.js" ] && [ -f "$APP/mods/veroboard/topbar.js" ] && [ -f "$APP/mods/veroboard/cables.js" ] && [ -f "$APP/mods/veroboard/settings.js" ]'
check "your keys kept" 'node -e "const k=require(\"$APP/keys.json\");process.exit(k.global[\"cmd-t\"]===\"tab.new\"&&k[\"layout:veroboard\"][\"cmd-f\"]===\"something.else\"&&k[\"layout:veroboard\"][\"cmd-9\"]===\"veroboard.space8\"?0:1)"'
check "key conflict reported" 'grep -q "Kept your own binding for: cmd-f" <<<"$out"'
check "keys.json backed up" 'ls "$APP"/keys.json.bak-* >/dev/null 2>&1'
check "second run succeeds" '"$PKG/install.sh" >/dev/null 2>&1'
echo '{"names":["mine"]}' > "$HOME/.config/veroboard/config.json"
check "second run keeps your rules file" '"$PKG/install.sh" >/dev/null 2>&1 && grep -q mine "$HOME/.config/veroboard/config.json"'
check "files Herdr adds to a mod folder are not a conflict" 'touch "$APP/mods/veroboard/gpui-kit.d.ts" "$APP/mods/veroboard-menu/jsconfig.json" && "$PKG/install.sh" >/dev/null 2>&1'
echo "// my edit" >> "$APP/mods/veroboard/main.js"
check "refuses to overwrite your changed mod" '! "$PKG/install.sh" >/dev/null 2>&1 && grep -q "my edit" "$APP/mods/veroboard/main.js"'
check "--force moves it aside and installs" '"$PKG/install.sh" --force >/dev/null 2>&1 && ls -d "$APP"/mods/veroboard.bak-* >/dev/null 2>&1 && ! grep -q "my edit" "$APP/mods/veroboard/main.js"'
check "tap.js writes facts and passes output through" 'out2=$(echo "{\"workspace\":{\"current_dir\":\"$HOME\"}}" | HC_TERMINAL_ID=tt1 node "$HOME/.config/veroboard/adapters/claude/tap.js" -- "echo hello") && [ "$out2" = hello ] && [ -f "$HOME/.config/veroboard/state/sessions/tt1.json" ]'
check "Claude facts keep all board keys" 'node -e '\''const f=require(process.env.HOME+"/.config/veroboard/state/sessions/tt1.json"); const keys="pct,tokens,window,model,effort,shells,shellList,monitorList,launched,git,worktree,lastPrompt,awaiting,at".split(","); process.exit(keys.every(k=>Object.hasOwn(f,k))?0:1)'\'''
check "facts.js records where node is" '[ "$(cat "$HOME/.config/veroboard/state/node-path")" = "$(command -v node)" ] || [ -x "$(cat "$HOME/.config/veroboard/state/node-path")" ]'
check "classify.js answers" '[ "$(node "$HOME/.config/veroboard/core/classify.js" "Done. Tell me which." | node -e "let s=\"\";process.stdin.on(\"data\",d=>s+=d).on(\"end\",()=>console.log(JSON.parse(s).result.rule))")" = tell-me ]'
check "ping.sh writes a ping" 'HC_TERMINAL_ID=tt1 sh "$HOME/.config/veroboard/adapters/claude/ping.sh" && [ -f "$HOME/.config/veroboard/state/pings/tt1.json" ]'
check "--help documents --codex" '"$PKG/install.sh" --help | grep -q -- --codex'
check "no Codex config created without --codex" '[ ! -e "$HOME/.codex" ]'
check "--codex installs hooks" '"$PKG/install.sh" --codex >/dev/null 2>&1 && [ -x "$HOME/.config/veroboard/adapters/codex/hook.js" ]'
check "Codex hooks contain all six events" 'node -e '\''const h=require(process.env.HOME+"/.codex/hooks.json").hooks; const events=["SessionStart","UserPromptSubmit","PostToolUse","PermissionRequest","Stop","Interrupt"]; process.exit(events.every(e=>h[e].length===1&&h[e][0].hooks.length===1&&h[e][0].hooks[0].type==="command"&&h[e][0].hooks[0].command==="node ~/.config/veroboard/adapters/codex/hook.js"&&h[e][0].hooks[0].timeout===5)?0:1)'\'''
guard_once() {
  node <<'NODE'
const assert = require('assert');
const hooks = require(process.env.HOME + '/.codex/hooks.json').hooks;
assert.deepStrictEqual(hooks.PreToolUse, [{ matcher: 'Bash', hooks: [{ type: 'command',
  command: 'sh ~/.config/veroboard/core/launch-guard.sh codex', timeout: 5 }] }]);
NODE
}
check "--codex adds PreToolUse launch guard once" 'guard_once'
cp "$HOME/.codex/hooks.json" "$HOME/hooks-first.json"
check "second --codex run adds nothing" '"$PKG/install.sh" --codex >/dev/null 2>&1 && cmp -s "$HOME/hooks-first.json" "$HOME/.codex/hooks.json" && ! ls "$HOME/.codex/"hooks.json.bak-* >/dev/null 2>&1'
check "second --codex run keeps one launch guard" 'guard_once'
cat > "$HOME/.codex/hooks.json" <<'JSON'
{"other":"keep","hooks":{"PreToolUse":[{"matcher":"OtherTool","hooks":[{"type":"command","command":"foreign-pre-hook","timeout":42}]}],"Stop":[{"matcher":"*","hooks":[{"type":"command","command":"herdr-foreign-hook","timeout":42}]}],"OtherEvent":[{"hooks":[{"type":"command","command":"another-hook"}]}]}}
JSON
cp "$HOME/.codex/hooks.json" "$HOME/hooks-foreign.json"
check "--codex merges with foreign hooks" '"$PKG/install.sh" --codex >/dev/null 2>&1'
foreign_pre_kept() {
  node <<'NODE'
const assert = require('assert');
const before = require(process.env.HOME + '/hooks-foreign.json').hooks.PreToolUse;
const after = require(process.env.HOME + '/.codex/hooks.json').hooks.PreToolUse;
assert.deepStrictEqual(after[0], before[0]);
assert.strictEqual(after.length, 2);
assert.strictEqual(after[1].hooks[0].command, 'sh ~/.config/veroboard/core/launch-guard.sh codex');
NODE
}
check "foreign PreToolUse entry is unchanged and first" 'foreign_pre_kept'
check "foreign hook entries are unchanged and first" 'node -e '\''const fs=require("fs"),a=JSON.parse(fs.readFileSync(process.env.HOME+"/hooks-foreign.json")),b=require(process.env.HOME+"/.codex/hooks.json"); process.exit(b.other===a.other&&JSON.stringify(a.hooks.Stop[0])===JSON.stringify(b.hooks.Stop[0])&&b.hooks.Stop.length===2&&JSON.stringify(a.hooks.OtherEvent)===JSON.stringify(b.hooks.OtherEvent)?0:1)'\'''
check "existing hooks.json backed up before merge" 'cmp -s "$HOME/hooks-foreign.json" "$HOME/.codex/"hooks.json.bak-*'
out3="$("$PKG/install.sh" --codex 2>&1)"
check "Codex feature reminder printed without changing config.toml" 'grep -Fq "[features] hooks = true" <<<"$out3" && [ ! -e "$HOME/.codex/config.toml" ]'
out4="$("$PKG/install.sh" 2>&1)"
check "normal install hints when .codex exists" 'grep -Fq "./install.sh --codex adds the Codex hooks" <<<"$out4"'
cat > "$HOME/.codex/hooks.json" <<'JSON'
{"hooks":{"PreToolUse":[{"matcher":"Custom","hooks":[{"type":"command","command":"foreign"},{"type":"command","command":"custom-wrapper ~/.config/veroboard/core/launch-guard.sh codex","timeout":42}]}]}}
JSON
cp "$HOME/.codex/hooks.json" "$HOME/hooks-custom.json"
custom_guard_kept() {
  "$PKG/install.sh" --codex >/dev/null 2>&1 && node <<'NODE'
const assert = require('assert');
const before = require(process.env.HOME + '/hooks-custom.json');
const after = require(process.env.HOME + '/.codex/hooks.json');
assert.deepStrictEqual(after.hooks.PreToolUse, before.hooks.PreToolUse);
NODE
}
check "--codex preserves a launch guard anywhere in the event" 'custom_guard_kept'
[ $fail -eq 0 ] && echo "all passed" || { echo "some failed"; exit 1; }

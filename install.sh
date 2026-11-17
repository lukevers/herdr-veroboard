#!/usr/bin/env bash
# Installs Veroboard: its layout and mods into ~/.config/herdr-app, its Claude Code scripts into
# ~/.claude/veroboard, a personal rules file at ~/.config/veroboard/config.json (kept if it exists), and the
# board's keys into keys.json (added, never replacing yours). It does not edit ~/.claude/settings.json: it prints
# what to add. Conflicts are checked first, so a refused install changes nothing.
#   ./install.sh           install; stop if a board file of yours differs
#   ./install.sh --force   install; move differing files aside as <name>.bak-<time> first
set -euo pipefail
cd "$(dirname "$0")"
PKG="$(pwd)"
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

APP="$HOME/.config/herdr-app"
CLAUDE="$HOME/.claude/veroboard"
CONF_DIR="$HOME/.config/veroboard"
STAMP="$(date +%Y%m%d-%H%M%S)"

command -v node >/dev/null 2>&1 || { echo "Node.js is required (node not found)." >&2; exit 1; }
[ -d "$APP" ] || { echo "Herdr's home ($APP) not found. Install and open the Herdr app first." >&2; exit 1; }

# The Herdr files: package path → installed path (relative to herdr/ and $APP).
ITEMS=(layouts/veroboard.json mods/veroboard mods/veroboard-menu)
differs() { [ -e "$APP/$1" ] && ! diff -rq "herdr/$1" "$APP/$1" >/dev/null 2>&1; }
conflicts=()
for it in "${ITEMS[@]}"; do differs "$it" && conflicts+=("$it"); done
if [ ${#conflicts[@]} -gt 0 ] && [ $FORCE -eq 0 ]; then
  echo "These already exist in $APP and differ from the package:" >&2
  for c in "${conflicts[@]}"; do echo "  $c" >&2; done
  echo "Nothing was changed. Rerun with --force to move them aside (as <name>.bak-$STAMP) and install." >&2
  exit 1
fi

# 1. Claude Code scripts.
mkdir -p "$CLAUDE"
cp claude/* "$CLAUDE/"
chmod +x "$CLAUDE/tap.js" "$CLAUDE/facts.js" "$CLAUDE/ping.sh" "$CLAUDE/classify.js"
echo "Claude Code scripts → $CLAUDE"

# 2. Your rules file, only if you don't have one.
mkdir -p "$CONF_DIR"
if [ -e "$CONF_DIR/config.json" ]; then echo "Kept your rules file: $CONF_DIR/config.json"
else cp config.example.json "$CONF_DIR/config.json"; echo "Rules file → $CONF_DIR/config.json"; fi

# 3. Herdr layout, mods and theme.
changed=0
for it in "${ITEMS[@]}"; do
  if [ -e "$APP/$it" ] && ! differs "$it"; then continue; fi
  if [ -e "$APP/$it" ]; then mv "$APP/$it" "$APP/$it.bak-$STAMP"; echo "Moved aside: $APP/$it.bak-$STAMP"; fi
  mkdir -p "$(dirname "$APP/$it")"
  cp -R "herdr/$it" "$APP/$it"
  echo "Installed: $APP/$it"; changed=1
done
[ $changed -eq 1 ] || echo "Herdr files: already up to date."

# 4. Keys: add the board's, keep yours.
node - "$APP/keys.json" "$PKG/herdr/keys.veroboard.json" "$STAMP" <<'NODE'
const fs = require('fs');
const [file, pkgFile, stamp] = process.argv.slice(2);
const add = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))['layout:veroboard'] || {};
let keys = {};
const exists = fs.existsSync(file);
if (exists) keys = JSON.parse(fs.readFileSync(file, 'utf8'));
const section = keys['layout:veroboard'] || {};
const added = [], kept = [];
for (const [k, v] of Object.entries(add)) {
  if (!(k in section)) { section[k] = v; added.push(k); }
  else if (section[k] !== v) kept.push(`${k} (yours: ${section[k]}; board: ${v})`);
}
if (added.length) {
  if (exists) fs.copyFileSync(file, `${file}.bak-${stamp}`);
  keys['layout:veroboard'] = section;
  fs.writeFileSync(file, JSON.stringify(keys, null, 2) + '\n');
  console.log(`Keys added to ${file}: ${added.join(', ')}`);
} else console.log('Keys: already there.');
if (kept.length) console.log(`Kept your own binding for: ${kept.join('; ')}`);
NODE

cat <<'EOF'

Last step, by hand: add this to ~/.claude/settings.json (merge into your existing "hooks" arrays; don't replace
them). Put your current status line command after "--", or nothing after it if you have none.

{
  "statusLine": { "type": "command", "command": "node ~/.claude/veroboard/tap.js -- <your status line command, or nothing>", "padding": 0 },
  "subagentStatusLine": { "type": "command", "command": "node ~/.claude/veroboard/subagents.js" },
  "hooks": {
    "Stop": [ { "hooks": [ { "type": "command", "command": "sh ~/.claude/veroboard/ping.sh", "timeout": 5 } ] } ],
    "Notification": [ { "hooks": [ { "type": "command", "command": "sh ~/.claude/veroboard/ping.sh", "timeout": 5 } ] } ]
  }
}

Then:
  herdr-app check ~/.config/herdr-app/mods/veroboard
  herdr-app do layout.switch --name veroboard        (or ctrl-shift-l to cycle layouts)
EOF

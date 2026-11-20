#!/usr/bin/env bash
# Installs Veroboard into Herdr from this folder: the layout and its mods (the board's agent scripts come inside
# mods/veroboard/agent) into ~/.config/herdr-app, and the board's keys into keys.json (added, never replacing yours).
# The same as asking an agent in Herdr to add the layout (herdr.dev/layouts/lukevers/veroboard), for people who'd rather
# run a script. Then connect your agents in the board's settings (the gear → Agents): that adds their hook lines.
# Conflicts are checked first, so a refused install changes nothing.
#   ./install.sh           install; stop if a board file of yours differs
#   ./install.sh --force   install; move differing files aside as <name>.bak-<time> first
set -euo pipefail
cd "$(dirname "$0")"
PKG="$(pwd)"
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --codex) echo "Codex is connected from the board now: the gear → Agents → Connect." ;;
    -h|--help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

APP="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
STAMP="$(date +%Y%m%d-%H%M%S)"

command -v node >/dev/null 2>&1 || { echo "Node.js is required (node not found): the board's agent scripts run on it." >&2; exit 1; }
[ -d "$APP" ] || { echo "Herdr's home ($APP) not found. Install and open the Herdr app first." >&2; exit 1; }

# The Herdr files: package path → installed path (relative to veroboard/ and $APP).
ITEMS=(layouts/veroboard.json mods/veroboard mods/veroboard-menu mods/veroboard-toast mods/veroboard-decisions)
# Files only on your side (Herdr adds gpui-kit.d.ts and jsconfig.json to mod folders) don't count.
differs() { [ -e "$APP/$1" ] || return 1; local out; out="$(diff -rq "veroboard/$1" "$APP/$1" 2>&1 | grep -v "^Only in $APP/" || true)"; [ -n "$out" ]; }
conflicts=()
for it in "${ITEMS[@]}"; do differs "$it" && conflicts+=("$it"); done
if [ ${#conflicts[@]} -gt 0 ] && [ $FORCE -eq 0 ]; then
  echo "These already exist in $APP and differ from the package:" >&2
  for c in "${conflicts[@]}"; do echo "  $c" >&2; done
  echo "Nothing was changed. Rerun with --force to move them aside (as <name>.bak-$STAMP) and install." >&2
  exit 1
fi

# 1. The layout and mods.
changed=0
for it in "${ITEMS[@]}"; do
  if [ -e "$APP/$it" ] && ! differs "$it"; then continue; fi
  if [ -e "$APP/$it" ]; then mv "$APP/$it" "$APP/$it.bak-$STAMP"; echo "Moved aside: $APP/$it.bak-$STAMP"; fi
  mkdir -p "$(dirname "$APP/$it")"
  cp -R "veroboard/$it" "$APP/$it"
  echo "Installed: $APP/$it"; changed=1
done
[ $changed -eq 1 ] || echo "Herdr files: already up to date."

# 2. Keys: add the board's, keep yours.
node - "$APP/keys.json" "$PKG/veroboard/keys.json" "$STAMP" <<'NODE'
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

Next:
  1. Switch to the board: ctrl-shift-l (cycles layouts), or herdr-app do layout.switch --name veroboard
  2. Connect your agents: the gear (top left of the board) → Agents → Connect, for Claude Code and/or Codex.
     It shows what it will add to their settings before it does.
EOF

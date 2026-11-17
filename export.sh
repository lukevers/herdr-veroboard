#!/usr/bin/env bash
# For the maintainer: copy the live board setup on this machine into this package.
set -euo pipefail
cd "$(dirname "$0")"
CLAUDE="$HOME/.claude/veroboard"
APP="$HOME/.config/herdr-app"
rm -rf claude herdr
mkdir -p claude herdr/layouts herdr/mods/veroboard herdr/mods/veroboard-menu herdr/themes
cp "$CLAUDE"/{rules.js,defaults.json,facts.js,tap.js,subagents.js,ping.sh,classify.js} claude/
cp "$APP/layouts/veroboard.json" herdr/layouts/
cp "$APP"/mods/veroboard/{main.js,card.js,topbar.js,cables.js,settings.js,names.js,mod.json,launched-by.svg,launched.svg,preview.svg,question.svg} herdr/mods/veroboard/
cp "$APP"/mods/veroboard-menu/{main.js,mod.json} herdr/mods/veroboard-menu/
cp "$APP/themes/dusk.json" herdr/themes/
node -e '
const k = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
require("fs").writeFileSync("herdr/keys.veroboard.json", JSON.stringify({ "layout:veroboard": k["layout:veroboard"] || {} }, null, 2) + "\n");
' "$APP/keys.json"
echo "Exported:"; find claude herdr -type f | sort | sed 's/^/  /'

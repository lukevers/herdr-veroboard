#!/usr/bin/env bash
# For the maintainer: copy the live board setup on this machine into this package.
set -euo pipefail
cd "$(dirname "$0")"
CLAUDE="$HOME/.claude/veroboard"
APP="$HOME/.config/herdr-app"
# veroboard/ also holds RECIPE.md and preview.png, so only its copied parts are replaced.
rm -rf claude veroboard/layouts veroboard/mods veroboard/keys.json
mkdir -p claude veroboard/layouts veroboard/mods/veroboard veroboard/mods/veroboard-menu
cp "$CLAUDE"/{rules.js,defaults.json,facts.js,tap.js,subagents.js,ping.sh,classify.js} claude/
cp "$APP/layouts/veroboard.json" veroboard/layouts/
cp "$APP"/mods/veroboard/{main.js,card.js,topbar.js,cables.js,settings.js,names.js,mod.json,launched-by.svg,launched.svg,preview.svg,question.svg} veroboard/mods/veroboard/
cp "$APP"/mods/veroboard-menu/{main.js,mod.json} veroboard/mods/veroboard-menu/
node -e '
const k = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
require("fs").writeFileSync("veroboard/keys.json", JSON.stringify({ "layout:veroboard": k["layout:veroboard"] || {} }, null, 2) + "\n");
' "$APP/keys.json"
echo "Exported:"; find claude veroboard -type f | sort | sed 's/^/  /'

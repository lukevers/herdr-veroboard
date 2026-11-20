#!/usr/bin/env bash
# For the maintainer: copy the live board setup on this machine into this package.
# The mods are copied whole (the board's agent scripts are inside mods/veroboard/agent), minus what Herdr adds to a mod
# folder (gpui-kit.d.ts, jsconfig.json).
set -euo pipefail
cd "$(dirname "$0")"
APP="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
# veroboard/ also holds RECIPE.md and preview.png, so only its copied parts are replaced.
rm -rf veroboard/layouts veroboard/mods veroboard/keys.json
mkdir -p veroboard/layouts veroboard/mods
cp "$APP/layouts/veroboard.json" veroboard/layouts/
for m in veroboard veroboard-menu veroboard-toast veroboard-decisions; do
  rsync -a --exclude gpui-kit.d.ts --exclude jsconfig.json --exclude '*.bak-*' "$APP/mods/$m/" "veroboard/mods/$m/"
done
node -e '
const k = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
require("fs").writeFileSync("veroboard/keys.json", JSON.stringify({ "layout:veroboard": k["layout:veroboard"] || {} }, null, 2) + "\n");
' "$APP/keys.json"
echo "Exported:"; find veroboard -type f -not -name RECIPE.md -not -name preview.png | sort | sed 's/^/  /'

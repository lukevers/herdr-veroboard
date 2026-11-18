#!/bin/sh
input=$(cat)
case "$input" in
  *tab.new*) ;;
  *) exit 0 ;;
esac
printf '%s' "$input" | node "$(dirname "$0")/launch-guard.js" "$1"
exit $?

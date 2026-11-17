#!/bin/sh
# Claude Code Stop and Notification hook for the Herdr board: notes when this agent last made a sound
# (~/.claude/herdr/pings/<herdr terminal>.json). The card glows with it, and the Blocked and Done clocks use it.
# Prints nothing and plays nothing: add your own sound after it in the hook command if you want one.
[ -n "${HC_TERMINAL_ID:-}" ] || exit 0
case "$HC_TERMINAL_ID" in *[!A-Za-z0-9_-]*) exit 0 ;; esac
mkdir -p "$HOME/.claude/herdr/pings" && printf '{"at":%s}' "$(date +%s)000" > "$HOME/.claude/herdr/pings/$HC_TERMINAL_ID.json"
exit 0

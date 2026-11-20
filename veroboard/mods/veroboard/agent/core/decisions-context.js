#!/usr/bin/env node
'use strict';

// SessionStart hook for Claude Code and Codex (Veroboard settings → Agents → Connect; user, 2026-11-20): adds the
// decision rules (decisions.md, next to this file) to the session's context, so every agent in Herdr queues decisions
// with decide.js instead of asking in prose. Inside Herdr only (HC_TERMINAL_ID set); elsewhere it prints nothing.
// It also fires on resume and after compaction, so a long-running agent picks up a changed rule then.
// The rules name decide.js by this install's real path, so they never drift from the copy that runs.
// Any failure prints nothing and exits 0: a SessionStart hook must never stop a session from starting.
try { main(); } catch (_) {}
process.exitCode = 0;

function main() {
  const fs = require('fs'), path = require('path'), os = require('os');
  try { fs.readFileSync(0); } catch (_) {} // drain the hook input; nothing in it is needed
  if (!process.env.HC_TERMINAL_ID) return;
  const home = os.homedir();
  const decide = path.join(__dirname, 'decide.js');
  // ~/… when it's under your home: shorter in the context, the same on every machine with the default Herdr home.
  const shown = decide.startsWith(`${home}/`) ? `~${decide.slice(home.length)}` : decide;
  const rules = fs.readFileSync(path.join(__dirname, 'decisions.md'), 'utf8').replaceAll('{{decide}}', `node ${shown}`).trim();
  if (!rules) return;
  // Both agents read the same shape: hookSpecificOutput.additionalContext for SessionStart.
  // The argument (claude | codex) only labels the hook line in each agent's config.
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: rules } }) + '\n');
}

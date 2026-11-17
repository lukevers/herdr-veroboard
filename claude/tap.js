#!/usr/bin/env node
'use strict';
/*
 * Claude Code statusLine wrapper for the Herdr board. It writes this session's board facts (facts.js), and runs
 * your own status line, if any, with the same input, printing what it prints:
 *
 *   "statusLine": { "type": "command", "command": "node ~/.claude/veroboard/tap.js -- node ~/.claude/statusline.js" }
 *
 * After --: your status line command. One argument is run by the shell (pipes work: -- "my-line | tr a b");
 * several are run as they are. Nothing after --: prints nothing, only the facts are written.
 */
const fs = require('fs');
const { spawn } = require('child_process');

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch (_) {}
let data = {};
try { data = JSON.parse(raw || '{}'); } catch (_) {}

const at = process.argv.indexOf('--');
const cmd = at >= 0 ? process.argv.slice(at + 1) : [];
// Your status line runs while the facts are worked out, so the wrapper adds little to its time.
const child = cmd.length ? spawn(cmd[0], cmd.slice(1), { shell: cmd.length === 1, stdio: ['pipe', 'inherit', 'inherit'] }) : null;
if (child) {
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  child.stdin.end(raw);
}
try { require('./facts.js')(data); } catch (_) {}
if (child) child.on('close', (code) => { process.exitCode = code ?? 0; });

'use strict';

function parse(line) {
  try { return JSON.parse(line); } catch (_) { return null; }
}

function readSessionMeta(file) {
  const fs = require('fs');
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(4096);
    const parts = [];
    let length;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      const end = buffer.subarray(0, length).indexOf(10);
      parts.push(Buffer.from(buffer.subarray(0, end < 0 ? length : end)));
      if (end >= 0) break;
    }
    const first = parse(Buffer.concat(parts).toString('utf8'));
    return first && first.type === 'session_meta' ? first.payload : null;
  } catch (_) { return null; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} }
}

function terminalId(sessionId, cwd) {
  const fs = require('fs');
  const { execFileSync } = require('child_process');
  const realpath = (value) => {
    try { return fs.realpathSync(value); } catch (_) { return value; }
  };
  if (typeof cwd !== 'string' || !cwd) return;

  // hc ls --json gives {terminals: [{address, agent, cwd, status: "idle"}]}; hc get <address> adds the title and
  // the foreground program's cwd ({status: {app, state}, foreground: {cwd}, title}). Only Codex terminals are looked up.
  let terminals, hc;
  const run = (args) => parse(execFileSync(hc, args, { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }));
  for (const executable of ['hc', `${process.env.HOME}/.local/bin/hc`]) {
    try {
      hc = executable;
      const value = run(['ls', '--json']);
      const list = Array.isArray(value) ? value : value && Array.isArray(value.terminals) ? value.terminals : null;
      if (list) { terminals = list; break; }
    } catch (_) {}
  }
  if (!terminals) return;
  terminals = terminals.filter((t) => t && typeof t === 'object' && typeof t.address === 'string'
    && (t.agent === 'codex' || (t.status && t.status.app === 'codex')))
    .map((t) => { try { return { ...t, ...(run(['get', t.address]) || {}) }; } catch (_) { return t; } });

  const candidates = terminals.filter((terminal) => terminal && typeof terminal === 'object'
    && terminal.status && terminal.status.app === 'codex'
    && realpath((terminal.foreground && terminal.foreground.cwd) || terminal.cwd) === realpath(cwd));
  const inherited = candidates.find((terminal) => terminal.address === process.env.HC_TERMINAL_ID);
  if (inherited) return inherited.address;
  if (candidates.length === 1) return candidates[0].address;
  if (!candidates.length || typeof sessionId !== 'string' || !sessionId) return;

  // Each facts file names the Codex session that wrote it (codexSession). A tab this session already owns wins; tabs
  // another session owns are skipped, so a new Codex tab is found on its first turn, before its thread has a name.
  const owner = (terminal) => {
    try { return JSON.parse(fs.readFileSync(`${require('../../core/session.js').stateDir()}/sessions/${terminal.address}.json`, 'utf8')).codexSession; }
    catch (_) { return undefined; }
  };
  const owned = candidates.filter((terminal) => owner(terminal) === sessionId);
  if (owned.length === 1) return owned[0].address;
  const free = candidates.filter((terminal) => !owner(terminal));
  if (free.length === 1 && !owned.length) return free[0].address;

  let threadName;
  try {
    const index = fs.readFileSync(`${process.env.HOME}/.codex/session_index.jsonl`, 'utf8');
    for (const line of index.split('\n')) {
      const entry = parse(line);
      if (entry && entry.id === sessionId) threadName = entry.thread_name;
    }
  } catch (_) { return; }
  if (typeof threadName !== 'string' || !threadName) return;

  // While Codex works its title starts with a spinner ("⠴ Thread name | folder"): compare without leading symbols.
  const bare = (text) => text.replace(/^[^\p{L}\p{N}]+/u, '');
  const name = bare(threadName);
  const matches = candidates.filter((terminal) => typeof terminal.title === 'string'
    && (bare(terminal.title) === name || bare(terminal.title).startsWith(`${name} |`)));
  if (matches.length === 1) return matches[0].address;
}

function codexTerminal(input) {
  const meta = readSessionMeta(input.transcript_path);
  if (!meta || meta.originator !== 'codex-tui') return;
  return terminalId(meta.id, meta.cwd || input.cwd);
}

module.exports = { readSessionMeta, terminalId, codexTerminal };

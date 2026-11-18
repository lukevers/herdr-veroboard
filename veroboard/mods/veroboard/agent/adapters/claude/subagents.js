#!/usr/bin/env node
/*
 * Claude Code subagentStatusLine -> Herdr board.
 * Counts this session's running sub-agents and saves the count where the Herdr
 * board mod reads it: ~/.config/veroboard/state/subagents/<herdr terminal>.json.
 * Prints nothing, so Claude Code keeps its own sub-agent rows unchanged.
 */

'use strict';

const fs = require('fs');

// Herdr sets HC_TERMINAL_ID (e.g. "t19") in every terminal it runs.
const id = process.env.HC_TERMINAL_ID || '';
if (!/^[A-Za-z0-9_-]+$/.test(id)) process.exit(0);

let data = {};
try { data = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (_) {}
const tasks = Array.isArray(data.tasks) ? data.tasks : [];
// The running ones, with what the board shows for each: type, name, description, progress label.
const str = (v) => (typeof v === 'string' ? v.slice(0, 200) : '');
const list = tasks.filter((t) => t && t.status === 'running').map((t) => ({
  id: str(t.id), type: str(t.agentType), name: str(t.name), description: str(t.description), label: str(t.label),
  startTime: Number.isFinite(t.startTime) ? t.startTime : null,
}));
const running = list.length;

// Write when anything shown changes, or every 10s so the board can tell fresh from stale.
try {
  const dir = `${process.env.HOME}/.config/veroboard/state/subagents`;
  const file = `${dir}/${id}.json`;
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
  const same = prev && JSON.stringify(prev.tasks || []) === JSON.stringify(list);
  if (!same || Date.now() - (prev.at || 0) > 10 * 1000) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ running, tasks: list, at: Date.now() }));
    fs.renameSync(`${file}.tmp`, file);
  }
} catch (_) {}

#!/usr/bin/env node
'use strict';

// Hooks must stay silent: Codex can interpret stdout as a decision.
try {
  main();
} catch (_) {}
process.exitCode = 0;

function main() {
  const fs = require('fs');
  const session = require('../../core/session.js');
  const { readSessionMeta, terminalId } = require('./terminal.js');
  const input = JSON.parse(fs.readFileSync(0, 'utf8')) || {};
  const meta = readSessionMeta(input.transcript_path);
  if (!meta || meta.originator !== 'codex-tui') return;
  const cwd = meta.cwd || input.cwd;
  const id = terminalId(meta.id, cwd);
  if (!session.validId(id)) return;

  let rules;
  try { rules = require('../../core/rules.js'); }
  catch (e) { rules = { classify: () => null, awaitsAfterSend: () => false, errors: [`rules.js: ${e.message}`] }; }

  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(`${session.stateDir()}/sessions/${id}.json`, 'utf8')) || {}; } catch (_) {}
  const latest = readLatest(input.transcript_path);
  const now = Date.now();
  const window = latest.window ?? previous.window ?? 0;
  const tokens = latest.tokens ?? 0;
  const git = session.gitInfo(cwd);
  let awaiting = null;
  if (input.hook_event_name === 'Stop') {
    const text = input.last_assistant_message || latest.complete || latest.assistant || '';
    const sent = /(?:^|[;&|\n(])\s*hc\s+send\s+(?:--\S+\s+)*([A-Za-z0-9_-]+)/.exec(latest.command || '');
    if (sent && !/--wait\b/.test(latest.command) && rules.awaitsAfterSend(text)) {
      awaiting = { to: sent[1], rule: 'send-wait', at: now };
    } else {
      const who = rules.classify(text);
      if (who) awaiting = { to: who.to, rule: who.rule, at: now };
    }
  }

  const facts = {
    pct: window ? Math.min(100, Math.round(tokens / window * 100)) : 0,
    tokens, window,
    model: latest.model ? latest.model.split('-').map((part) => part === 'gpt' ? 'GPT' : part.charAt(0).toUpperCase() + part.slice(1)).join('-') : 'Codex',
    effort: latest.effort || '',
    shells: 0, shellList: [], monitorList: [],
    launched: mergeLaunched(previous.codexSession === meta.id ? previous.launched : [], listLaunched(input.transcript_path), launchedNow(input)),
    git: session.gitFacts(git), worktree: (git && git.linked) || '',
    lastPrompt: input.hook_event_name === 'UserPromptSubmit' ? now : previous.lastPrompt ?? latest.lastPrompt ?? null,
    awaiting,
    rulesErrors: rules.errors.length ? rules.errors : undefined,
    codexSession: meta.id,
  };
  session.noteNode();
  if (input.hook_event_name === 'Stop' || input.hook_event_name === 'PermissionRequest') session.ping(id);
  session.writeSession(id, facts);
}

// Codex runs PostToolUse before the tool's output reaches the session log, so the newest launch is read from the
// hook input (tool_input.command, tool_response) and kept, with this session's earlier ones, until the log has it.
function addresses(text) {
  const found = [];
  const clean = String(text || '').replace(/\\+"/g, '"');
  for (const m of clean.matchAll(/"terminal"\s*:\s*"([A-Za-z0-9_\/-]+)"/g)) found.push(m[1]);
  for (const m of clean.matchAll(/^\s*((?:[A-Za-z0-9_-]+\/)?t[0-9a-z]{1,4})\s*$/gm)) found.push(m[1]);
  return found;
}
function launchedNow(input) {
  if (input.hook_event_name !== 'PostToolUse') return [];
  let toolInput = input.tool_input;
  if (typeof toolInput === 'string') toolInput = parse(toolInput) || toolInput;
  const command = typeof toolInput === 'string' ? toolInput : toolInput && (toolInput.command || toolInput.cmd);
  if (typeof command !== 'string' || !/herdr-app\s+do\s+(tab\.new|space\.new|terminal\.open|pane\.split)\b/.test(command)) return [];
  const response = input.tool_response;
  return addresses(typeof response === 'string' ? response : JSON.stringify(response || ''));
}
function mergeLaunched(...lists) {
  const all = [];
  for (const list of lists) for (const a of Array.isArray(list) ? list : []) if (typeof a === 'string' && !all.includes(a)) all.push(a);
  return all.slice(-200);
}

function parse(line) {
  try { return JSON.parse(line); } catch (_) { return null; }
}

function messageText(content) {
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c && (c.type === 'input_text' || c.type === 'output_text') && typeof c.text === 'string')
    .map((c) => c.text).join('\n');
}

function isPrompt(text) {
  return text && !/^\s*(# AGENTS\.md instructions|<environment_context|<user_instructions|<permissions|<turn_aborted)/.test(text);
}

function commandText(payload) {
  const raw = typeof payload.input === 'string' ? payload.input : payload.arguments;
  if (typeof raw !== 'string') return '';
  const value = parse(raw);
  if (value && typeof value === 'object') return value.cmd || value.command || raw;

  // functions.exec can wrap a shell command in JavaScript rather than JSON.
  const commands = [...raw.matchAll(/\b(?:cmd|command)\s*:\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)/g)]
    .map((m) => m[1][0] === '"' ? parse(m[1]) : m[1].slice(1, -1).replace(/\\([\\'"`])/g, '$1'));
  return commands.length ? commands.join('\n') : raw;
}

function argvCommand(argv) {
  if (/(?:^|\/)(?:ba|z|da|k)?sh$/.test(argv[0] || '')) {
    const flag = argv.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg));
    if (flag >= 0) return argv[flag + 1] || '';
  }
  return argv.join(' ');
}

function readLatest(file) {
  const fs = require('fs');
  const latest = {};
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - 4 * 1024 * 1024);
    const buffer = Buffer.alloc(size - start);
    const length = fs.readSync(fd, buffer, 0, buffer.length, start);
    const text = buffer.toString('utf8', 0, length);
    const firstNewline = text.indexOf('\n');
    const tail = start ? (firstNewline >= 0 ? text.slice(firstNewline + 1) : '') : text;
    for (const line of tail.split('\n')) {
      const e = parse(line);
      if (!e || !e.payload) continue;
      const p = e.payload;
      if (e.type === 'turn_context') {
        latest.model = typeof p.model === 'string' ? p.model : '';
        latest.effort = typeof p.effort === 'string' ? p.effort : '';
        latest.cwd = p.cwd;
        latest.command = latest.complete = latest.assistant = '';
      } else if (e.type === 'event_msg') {
        if (p.type === 'token_count' && p.info) {
          if (Number.isFinite(p.info.model_context_window)) latest.window = p.info.model_context_window;
          const u = p.info.last_token_usage;
          if (u) latest.tokens = Number.isFinite(u.total_tokens) ? u.total_tokens : (u.input_tokens || 0) + (u.output_tokens || 0);
        } else if (p.type === 'task_complete' && typeof p.last_agent_message === 'string') {
          latest.complete = p.last_agent_message;
        } else if (p.type === 'task_started') {
          latest.command = latest.complete = latest.assistant = '';
        } else if (p.type === 'item_completed' && p.item && p.item.type === 'CommandExecution' && Array.isArray(p.item.command)) {
          latest.command = argvCommand(p.item.command);
        }
      } else if (e.type === 'response_item') {
        if (p.type === 'message') {
          const text = messageText(p.content);
          if (p.role === 'assistant') latest.assistant = text;
          if (p.role === 'user' && isPrompt(text)) {
            const at = Date.parse(e.timestamp);
            if (Number.isFinite(at)) latest.lastPrompt = at;
            latest.command = latest.complete = latest.assistant = '';
          }
        } else if (p.type === 'custom_tool_call' || p.type === 'function_call') {
          latest.command = commandText(p);
        }
      }
    }
  } catch (_) {}
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} }
  return latest;
}

function listLaunched(file) {
  const fs = require('fs');
  const pending = new Set();
  const found = new Set();
  let fd;
  const visit = (line) => {
    // Parse only launch calls and outputs for calls still waiting for a result.
    if (!line.includes('herdr-app') && ![...pending].some((id) => line.includes(id))) return;
    const e = parse(line);
    if (!e || e.type !== 'response_item' || !e.payload) return;
    const p = e.payload;
    if ((p.type === 'custom_tool_call' || p.type === 'function_call') && typeof p.call_id === 'string'
      && /herdr-app\s+do\s+(tab\.new|space\.new|terminal\.open|pane\.split)\b/.test(commandText(p))) {
      pending.add(p.call_id);
    } else if ((p.type === 'custom_tool_call_output' || p.type === 'function_call_output') && pending.has(p.call_id)) {
      pending.delete(p.call_id);
      const output = typeof p.output === 'string' ? p.output : Array.isArray(p.output)
        ? p.output.filter((c) => c && /^(input_|output_)?text$/.test(c.type) && typeof c.text === 'string').map((c) => c.text).join('\n') : '';
      const text = output.replace(/\\+"/g, '"');
      for (const m of text.matchAll(/"terminal"\s*:\s*"([A-Za-z0-9_\/-]+)"/g)) found.add(m[1]);
      for (const m of text.matchAll(/^\s*((?:[A-Za-z0-9_-]+\/)?t[0-9a-z]{1,4})\s*$/gm)) found.add(m[1]);
    }
  };
  try {
    fd = fs.openSync(file, 'r');
    const buffer = Buffer.alloc(256 * 1024);
    const decoder = new (require('string_decoder').StringDecoder)('utf8');
    let parts = [], length;
    while ((length = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      const text = decoder.write(buffer.subarray(0, length));
      let start = 0, end;
      while ((end = text.indexOf('\n', start)) !== -1) {
        const line = text.slice(start, end);
        visit(parts.length ? parts.join('') + line : line);
        parts = [];
        start = end + 1;
      }
      if (start < text.length) parts.push(text.slice(start));
    }
    visit(parts.join('') + decoder.end());
  } catch (_) {}
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {} }
  return [...found].slice(-200);
}

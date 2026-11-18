#!/usr/bin/env node
'use strict';
/*
 * Herdr board facts: what the board shows on a Claude Code session's card, written to
 * ~/.config/veroboard/state/sessions/<herdr terminal>.json (only when something changed; atomic).
 *
 *   context: pct, tokens, window; model, effort; git counts and worktree
 *   shellList / monitorList: background shells and monitors still running (from the transcript)
 *   launched: Herdr terminals this session opened (herdr-app do tab.new …), for the patch cables
 *   lastPrompt: when you last typed to it; awaiting: who its last message waits on (rules.js)
 *
 * Fed Claude Code's status-line JSON. Run it through tap.js (the statusLine wrapper), or call it from your own
 * status line: require('<board mod>/agent/adapters/claude/facts.js')(data). Herdr sets HC_TERMINAL_ID in its terminals;
 * elsewhere this does nothing.
 */
const fs = require('fs');
const { execSync } = require('child_process');

const { noteNode, gitInfo, gitFacts, writeSession, validId } = require('../../core/session.js');

module.exports = function writeFacts(data = {}) {
noteNode();
const herdrId = process.env.HC_TERMINAL_ID || '';
if (!validId(herdrId)) return;
const cwd = (data.workspace && data.workspace.current_dir) || data.cwd || process.cwd();
const modelName = (data.model && data.model.display_name) || (data.model && data.model.id) || 'Claude';
const modelId = (data.model && data.model.id) || '';
const transcriptPath = data.transcript_path || '';
const effort = (data.effort && data.effort.level) || '';
// Each transcript is read once and split once per run: a coordinator's runs to 80 MB, and four passes read it.
const texts = new Map();
const linesOf = (file) => { if (!texts.has(file)) texts.set(file, fs.readFileSync(file, 'utf8').split('\n')); return texts.get(file); };

// ---------- git: counts for the card's second line ----------
const git = gitInfo(cwd);

// The latest context size from the transcript, for Claude Code versions without context_window.used_percentage.
function transcriptTokens() {
  let used = 0;
  try {
    const lines = linesOf(transcriptPath).filter(Boolean).slice(-1200);
    for (const line of lines) {
      let e;
      try { e = JSON.parse(line); } catch (_) { continue; }
      if (e.type === 'assistant' && e.message && e.message.usage && !e.isSidechain) {
        const u = e.message.usage;
        const total = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        if (total > 0) used = total;
      }
    }
  } catch (_) {}
  return used;
}
const usedTokens = typeof (data.context_window || {}).used_percentage === 'number' ? 0 : transcriptTokens();

// ---------- context ----------
const cw = data.context_window || {};
const num = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
let pct, ctxTokens;
if (typeof cw.used_percentage === 'number') {
  pct = Math.min(100, Math.max(0, Math.round(cw.used_percentage)));
  // derive token count numerically (current_usage can be an object); prefer
  // size * pct so it always matches the displayed percentage
  const size = num(cw.context_window_size);
  ctxTokens =
    size != null ? Math.round((size * cw.used_percentage) / 100)
    : num(cw.total_input_tokens) != null ? cw.total_input_tokens
    : usedTokens || 0;
} else {
  const limit = /\[1m\]|1m/i.test(modelId) || data.exceeds_200k_tokens ? 1000000 : 200000;
  pct = limit ? Math.min(100, Math.round((usedTokens / limit) * 100)) : 0;
  ctxTokens = usedTokens;
}

// ---------- the board's session facts ----------
// Background shells and monitors this session started and hasn't seen end, from the whole transcript
// (a dev server may have started long ago). Only lines with a marker phrase are parsed.
// Returns [{ id, kind: 'shell' | 'monitor', description, command, startTime, expiresAt?, event? }]; the
// Bash/Monitor call that started each one (description, command, its timestamp) is looked up only for
// those still running. A monitor also carries when it expires and the last event it reported.
// When this status line's claude process started (ms), found by walking up the process tree; null if unknown.
function claudeStart() {
  try {
    let pid = process.ppid;
    for (let i = 0; i < 4 && pid > 1; i++) {
      const out = execSync(`ps -o ppid=,lstart=,comm= -p ${pid}`, { stdio: ['ignore', 'pipe', 'ignore'], timeout: 500 }).toString().trim();
      const m = out.match(/^(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/);
      if (!m) return null;
      if (/(^|\/)claude$/.test(m[3].trim())) { const t = Date.parse(m[2]); return Number.isFinite(t) ? t : null; }
      pid = Number(m[1]);
    }
  } catch (_) {}
  return null;
}
function listBackground(path) {
  if (!path) return [];
  try {
    const started = new Map(); // shell id -> { toolUseId, at }
    const ended = new Set();
    const events = new Map(); // monitor id -> { text: its last event's first line, at: when it arrived }
    const markers = ['in background with ID:', 'moved to the background (ID:', '<task-notification>', 'Successfully stopped task:', 'Monitor started (task'];
    // Sub-agents keep their own transcripts (<session>/subagents/agent-*.jsonl), and a shell a sub-agent puts in the
    // background is logged only there (a codex-rescue agent's "Forward task to Codex companion", t2w 2026-11-04).
    // Read those too, but only ones written since this claude process started: older shells died with it.
    const since = claudeStart();
    const subDir = path.replace(/\.jsonl$/, '') + '/subagents';
    let subFiles = [];
    try {
      subFiles = fs.readdirSync(subDir).filter((f) => /^agent-.*\.jsonl$/.test(f)).map((f) => `${subDir}/${f}`)
        .filter((f) => { try { return fs.statSync(f).mtimeMs >= (since || Date.now() - 6 * 3600000); } catch (_) { return false; } });
    } catch (_) {}
    const lines = [path, ...subFiles].flatMap((f) => { try { return linesOf(f); } catch (_) { return []; } });
    const at = (e) => { const t = Date.parse(e.timestamp || ''); return Number.isFinite(t) ? t : null; };
    for (const line of lines) {
      if (!markers.some((m) => line.includes(m))) continue;
      let e;
      try { e = JSON.parse(line); } catch (_) { continue; }
      // A finished shell's notice: <task-notification><task-id>ID</task-id>…<status>completed</status>.
      // It arrives as a plain user message or as a queued command (queue-operation / attachment entries).
      // Only those count: the same text quoted in assistant replies, tool output or request snapshots doesn't.
      const notice = e.type === 'queue-operation' || e.type === 'attachment'
        || (e.type === 'user' && e.message && typeof e.message.content === 'string');
      if (notice && line.includes('<task-notification>')) {
        for (const note of line.split('<task-notification>').slice(1)) {
          const body = note.split('</task-notification>')[0];
          const id = (body.match(/<task-id>([A-Za-z0-9]+)<\/task-id>/) || [])[1];
          const status = (body.match(/<status>([a-z_]+)<\/status>/) || [])[1];
          if (id && status && status !== 'running') ended.add(id);
        }
        // A monitor's events are notices with an <event> and no <status>; keep the latest one's first line.
        const text = e.type === 'queue-operation' ? e.content : e.type === 'attachment' ? e.attachment && e.attachment.prompt : e.message.content;
        if (typeof text === 'string') {
          for (const note of text.split('<task-notification>').slice(1)) {
            const id = (note.match(/<task-id>([A-Za-z0-9]+)<\/task-id>/) || [])[1];
            const ev = (note.match(/<event>([\s\S]*?)<\/event>/) || [])[1];
            if (id && ev && ev.trim()) events.set(id, { text: ev.trim().split('\n')[0], at: at(e) });
          }
        }
      }
      if (e.type !== 'user' || !e.message) continue;
      const content = e.message.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (!c || c.type !== 'tool_result' || typeof c.content !== 'string') continue;
        const s = c.content;
        let m;
        if ((m = s.match(/^Command running in background with ID: ([A-Za-z0-9]+)/))
          || (m = s.match(/was moved to the background \(ID: ([A-Za-z0-9]+)\)/))) started.set(m[1], { toolUseId: c.tool_use_id, at: at(e), kind: 'shell' });
        else if ((m = s.match(/^Monitor started \(task ([A-Za-z0-9]+)/))) started.set(m[1], { toolUseId: c.tool_use_id, at: at(e), kind: 'monitor' });
        else if ((m = s.match(/Successfully stopped task:\s*([A-Za-z0-9]+)/))) ended.add(m[1]);
      }
    }
    const running = [...started].filter(([id]) => !ended.has(id)).slice(0, 8);
    if (!running.length) return [];
    // The assistant's Bash tool_use for each running shell: its description, command and start time.
    const calls = new Map(running.map(([, s]) => [s.toolUseId, null]));
    for (const line of lines) {
      if (![...calls.keys()].some((k) => k && line.includes(k))) continue;
      let e;
      try { e = JSON.parse(line); } catch (_) { continue; }
      if (e.type !== 'assistant' || !e.message || !Array.isArray(e.message.content)) continue;
      for (const c of e.message.content) {
        if (c && c.type === 'tool_use' && calls.has(c.id)) calls.set(c.id, { input: c.input || {}, at: at(e) });
      }
    }
    const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
    // Background shells and monitors die with the claude process that started them, so one from before
    // this process started (an earlier run of a resumed session) is gone even if no notice says so.
    // A shell the agent waits on (Waiting, not Done): one that finishes and wakes the agent. That is a wait
    // loop or blocking wait command, or a one-shot job (reset, deploy, migrate, build, install, tests…), by its
    // command or its description. A server or watcher never finishes, so SERVES overrides: dev servers,
    // --watch, tail -f, log follows. Test cases: scratchpad waits-test.js.
    // Does the agent wait on this background shell? Yes by default: nearly every background shell Claude starts is
    // a finite job it comes back for (572 past shells checked 2026-11-03: none of the 316 the old word list missed
    // was a server). No only for things that never end on their own: servers, watchers, log tails, tunnels.
    // A wrongly-waiting shell still shows: its time turns pink on the board after 15 min.
    const JOB = /\b(re)?(deploy|build|install|seed|sync|generate|launch)\w*\b|\b(resets?|migrat\w*|provision\w*|bootstrap\w*|compil\w*|tests?|lint\w*|typecheck\w*|review\w*|backfill\w*|refresh\w*|setup|set up|spin\w* up|boot\w*)\b/i;
    const WAITS = [/\buntil\b/, /\b(while|for)\b[\s\S]*\bsleep\b/, /(^|[;&|\n(]\s*)wait(\s|;|$)/, /\bhc\s+wait\b/,
      /\bgh\s+run\s+watch\b/, /\bgh\s+pr\s+checks\b[\s\S]*--watch\b/, /--wait\b/];
    const SERVES = [/--watch\b/, /\b(tsc|webpack|rollup|esbuild|jest|vitest|mocha|sass|tailwindcss|babel)\b[^;&|\n]*\s-w(\s|$)/,
      /\b(pnpm|npm|yarn|bun)\s+(run\s+)?(dev|serve|start|preview|storybook)(\s|$)/, /\bnpx\s+serve\b/,
      /\b(next|nuxt|astro|remix|vite|storybook)\s+(dev|start|preview)\b/, /\btail\s+-[fF]\b/, /\blogs?\s+(-f|--follow)\b/,
      /\b(nodemon|ngrok|cloudflared|http\.server|uvicorn|gunicorn|waitress-serve|flask\s+run|rails\s+s(erver)?|jupyter|mitmproxy|caffeinate)\b/,
      /\bport-forward\b/, /\bssh\b[^;&|\n]*\s-[A-Za-z]*[NLRD]/, /\bdocker\s+compose\s+up\b(?![\s\S]*\s-d\b)/];
    const SERVES_DESC = /\b(dev server|server|watch(er|ing)?|watch mode|tail\w*|tunnel|follow\w* logs?|stream\w* logs?|port[- ]forward\w*|proxy|daemon|emulator)\b/i;
    const waits = (input) => {
      const cmd = typeof input.command === 'string' ? input.command : '';
      const desc = typeof input.description === 'string' ? input.description : '';
      // 1. An explicit wait loop, or a description that starts "Wait…": yes.
      if (WAITS.some((r) => r.test(cmd)) || /^\s*wait(s|ing)?\b/i.test(desc)) return true;
      // 2. A server or watcher command: no.
      if (SERVES.some((r) => r.test(cmd))) return false;
      // 3. "… and wait until ready", or a job verb ("Redeploy the application server"): yes, even if it names a server.
      if (/\bwait(s|ing)?\s+(until|till|for)\b/i.test(desc) || JOB.test(desc)) return true;
      // 4. A description that names a server, watcher or tail: no. 5. Anything else: yes.
      return !SERVES_DESC.test(desc);
    };
    // A monitor is killed at its timeout (Monitor's default 5 min, capped at 30 min).
    const expiry = (call, t) => {
      const ms = Number(call && call.input.timeout_ms);
      return t ? t + Math.min(Number.isFinite(ms) && ms > 0 ? ms : 300000, 1800000) : null;
    };
    return running.filter(([, s]) => {
      const call = calls.get(s.toolUseId);
      const t = (call && call.at) || s.at;
      if (s.kind === 'monitor' && expiry(call, t) && expiry(call, t) < Date.now()) return false;
      return !since || !t || t >= since - 2000;
    }).map(([id, s]) => {
      const call = calls.get(s.toolUseId);
      const startTime = (call && call.at) || s.at;
      return {
        id,
        kind: s.kind,
        description: str(call && call.input.description, 120),
        command: str(call && call.input.command, 120).split('\n')[0],
        startTime,
        ...(s.kind === 'monitor' ? { expiresAt: expiry(call, startTime), event: str(events.has(id) ? events.get(id).text : '', 120), eventAt: events.has(id) ? events.get(id).at : null } : {}),
        ...(s.kind === 'shell' && call && waits(call.input) ? { waits: true } : {}),
      };
    });
  } catch (_) { return []; }
}
// Herdr terminals this session opened as separate tabs/spaces/panes (herdr-app do tab.new, space.new,
// terminal.open, pane.split): each call prints {"terminal": "t28", ...}. Herdr records no parent for
// these (unlike hc run), so the board learns who launched whom from here. Returns addresses, oldest first.
function listLaunched(path) {
  if (!path) return [];
  try {
    const calls = new Set();
    const found = [];
    for (const line of linesOf(path)) {
      // A bare-address result ("t4s") has neither word: also read lines that carry a launch call's id.
      if (!line.includes('herdr-app') && !line.includes('terminal') && ![...calls].some((id) => line.includes(id))) continue;
      let e;
      try { e = JSON.parse(line); } catch (_) { continue; }
      const content = e.message && Array.isArray(e.message.content) ? e.message.content : [];
      for (const c of content) {
        if (e.type === 'assistant' && c && c.type === 'tool_use' && c.input && typeof c.input.command === 'string'
          && /herdr-app\s+do\s+(tab\.new|space\.new|terminal\.open|pane\.split)\b/.test(c.input.command)) calls.add(c.id);
        if (e.type === 'user' && c && c.type === 'tool_result' && calls.has(c.tool_use_id)) {
          calls.delete(c.tool_use_id); // read once: keeps the id scan above to calls still waiting for output
          const text = typeof c.content === 'string' ? c.content : JSON.stringify(c.content || '');
          for (const m of text.matchAll(/"terminal"\s*:\s*"([A-Za-z0-9_\/-]+)"/g)) if (!found.includes(m[1])) found.push(m[1]);
          // A launch piped through jq -r .terminal or python (t22 opened t4s..t4x in a loop, 2026-11-10) prints
          // only the address, one per line: take lines that are nothing but an address ("t4s", "vps/t7").
          const lines = typeof c.content === 'string' ? c.content : (Array.isArray(c.content) ? c.content.filter((x) => x && x.type === 'text').map((x) => x.text).join('\n') : '');
          for (const m of lines.matchAll(/^\s*((?:[A-Za-z0-9_-]+\/)?t[0-9a-z]{1,4})\s*$/gm)) if (!found.includes(m[1])) found.push(m[1]);
        }
      }
    }
    // Up to 200: a coordinator like t22 opens 20+ over days, and a cap of 20 cut its oldest cables (t29, 2026-11-05).
    return found.slice(-200);
  } catch (_) { return []; }
}
// When you last typed a prompt to this session (ms), for the board: a card you moved to Blocked by hand stays
// there until then. Not a prompt: tool results, meta entries, compaction summaries, task notifications, slash
// commands and their output, so an auto-compact or a finished background job doesn't count as you coming back.
function lastPrompt(path) {
  if (!path) return null;
  try {
    const lines = linesOf(path);
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"user"')) continue;
      let e;
      try { e = JSON.parse(lines[i]); } catch (_) { continue; }
      if (e.type !== 'user' || e.isMeta || e.isCompactSummary || e.isSidechain || !e.message) continue;
      const m = e.message.content;
      const text = typeof m === 'string' ? m
        : Array.isArray(m) && !m.some((c) => c && c.type === 'tool_result') ? m.filter((c) => c && c.type === 'text').map((c) => c.text).join(' ') : null;
      if (text === null || /^\s*<(task-notification|command-name|command-message|local-command-|system-reminder)/.test(text)) continue;
      const t = Date.parse(e.timestamp);
      if (Number.isFinite(t)) return t;
    }
  } catch (_) {}
  return null;
}
// awaiting: { to, at } when this agent's turn ended waiting on someone. The board puts it in Blocked unless it still
// has background work, and the next real prompt (yours, or another agent's <hc from=...> reply) clears it.
//  - to: "tNN" when its last tool call was a non --wait `hc send tNN` and its final message opens by saying it waits
//    ("I'm waiting for the go-ahead", "paused on one decision", "blocked on t28"). The wording is required: most turns
//    that end on an hc send are reports (mined 2026-11-04: 156 such turns, 7 real waits).
//  - to: a person or agent its closing lines say it waits for ("Next: wait for Luke's replies"), else
//  - to: "you" when its final message ends asking you something: a question near the end, or "tell me…", "say "go"",
//    "reply with…", "your call", "on hold until…", "approve … and I'll …", "paste …". "Next: nothing needed" never counts.
//    Mined 2026-11-04: 1049 of 1925 past turns end this way (scratchpad asks-test2.js).
// The rules themselves (and your own additions) live in agent/core/rules.js and defaults.json (the board mod's folder), and
// ~/.config/veroboard/config.json. awaiting.rule names the rule that decided it, for the board.
let rules;
try { rules = require('../../core/rules.js'); }
catch (e) { rules = { classify: () => null, awaitsAfterSend: () => false, errors: [`rules.js: ${e.message}`] }; }
function awaitingReply(path) {
  if (!path) return null;
  try {
    const lines = linesOf(path);
    let text = null, at = null;
    for (let i = lines.length - 1; i >= 0; i--) {
      let e;
      try { e = JSON.parse(lines[i]); } catch (_) { continue; }
      if (!e || e.isSidechain || !e.message) continue;
      const m = e.message.content;
      if (e.type === 'user' && !e.isMeta && !e.isCompactSummary) {
        const prompt = typeof m === 'string' ? m
          : Array.isArray(m) && !m.some((c) => c && c.type === 'tool_result') ? m.filter((c) => c && c.type === 'text').map((c) => c.text).join(' ') : null;
        if (prompt !== null && !/^\s*<(task-notification|command-name|command-message|local-command-|system-reminder)/.test(prompt)) break;
      }
      if (e.type !== 'assistant' || !Array.isArray(m)) continue;
      for (let k = m.length - 1; k >= 0; k--) {
        const c = m[k];
        if (c && c.type === 'text' && c.text.trim() && text === null) { text = c.text; at = Date.parse(e.timestamp); }
        if (c && c.type === 'tool_use') {
          if (text === null) return null; // the turn ended on a tool call: still going
          const cmd = c.name === 'Bash' && c.input && typeof c.input.command === 'string' ? c.input.command : '';
          const sent = /(^|[;&|\n(]\s*)hc\s+send\s+(?:--\S+\s+)*([A-Za-z0-9_-]+)/.exec(cmd);
          if (sent && !/--wait\b/.test(cmd) && rules.awaitsAfterSend(text)) {
            const sentAt = Date.parse(e.timestamp);
            return { to: sent[2], rule: 'send-wait', at: Number.isFinite(sentAt) ? sentAt : null };
          }
          i = -1; // only the last tool call matters
          break;
        }
      }
    }
    const who = text === null ? null : rules.classify(text);
    if (who) return { to: who.to, rule: who.rule, at: Number.isFinite(at) ? at : null };
  } catch (_) {}
  return null;
}
if (validId(herdrId)) {
  try {
    // window: the context window's size in tokens (Claude Code's, else the 1M/200k guess above)
    const window = num(cw.context_window_size)
      ?? (/\[1m\]|1m/i.test(modelId) || data.exceeds_200k_tokens ? 1000000 : 200000);
    // gitFacts: the git segment's counts (as one string, so the change check stays a plain compare);
    // worktree: the linked worktree's name (Claude Code's, else git's), '' in a main checkout.
    const worktree = (data.workspace && data.workspace.git_worktree) || (git && git.linked) || '';
    const background = listBackground(transcriptPath);
    const shellList = background.filter((b) => b.kind === 'shell').map(({ kind, ...b }) => b);
    const monitorList = background.filter((b) => b.kind === 'monitor').map(({ kind, ...b }) => b);
    const launched = listLaunched(transcriptPath);
    const facts = { pct, tokens: ctxTokens, window, model: modelName, effort, shells: shellList.length, shellList, monitorList, launched, git: gitFacts(git), worktree, lastPrompt: lastPrompt(transcriptPath), awaiting: awaitingReply(transcriptPath), rulesErrors: rules.errors.length ? rules.errors : undefined };
    writeSession(herdrId, facts);
  } catch (_) {}
}

};

// Run directly: node facts.js < status-line.json
if (require.main === module) {
  let raw = '';
  try { raw = fs.readFileSync(0, 'utf8'); } catch (_) {}
  let data = {};
  try { data = JSON.parse(raw || '{}'); } catch (_) {}
  module.exports(data);
}

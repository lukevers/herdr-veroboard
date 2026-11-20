// Connecting the agents to the board (Veroboard settings → Agents; user, 2026-11-18): the hook lines Claude Code and
// Codex need, read from and written into their own config files. Herdr's install copies this mod with its scripts
// (agent/), so the only thing left was adding these lines by hand; this does it on a click, shows what it changes first,
// and takes them out again. Plain functions on file text, no UI and no files (the settings dialog reads and writes, and
// tests/agents.test.js runs these on their own).
//
// A command is ours when it runs one of the board's scripts: its name, under a folder named veroboard/ (the old install,
// ~/.config/veroboard/…) or …/mods/veroboard/agent/ (this mod's folder: "current").

const SCRIPTS = {
  tap: "adapters/claude/tap.js", subagents: "adapters/claude/subagents.js", ping: "adapters/claude/ping.sh",
  guard: "core/launch-guard.sh", codex: "adapters/codex/hook.js",
  // The decision rules, added to every Herdr session's context at its start (user, 2026-11-20).
  decisions: "core/decisions-context.js",
};
const ours = (cmd, script) => typeof cmd === "string" && cmd.includes(script) && /veroboard\//.test(cmd);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
// Our script's path in a command, wherever it was installed (a word ending in veroboard/…/<script>).
const pathRe = (script) => new RegExp(`\\S*veroboard\\/\\S*?${esc(script)}`);
// The command with our script's path pointed at `root`, the rest as it was (a hook may run more after it: a sound).
const repoint = (cmd, script, root) => cmd.replace(pathRe(script), `${root}/${script}`);
// The command without our part (the program that runs our script, its argument, and a ; or && after it), or "".
const strip = (cmd, script) => cmd.replace(new RegExp(`(?:node|sh|bash)?\\s*${pathRe(script).source}(?:\\s+(?:claude|codex|--))?\\s*(?:;|&&)?\\s*`), "").trim().replace(/^(?:;|&&)\s*/, "").trim();
const current = (cmd, root) => typeof cmd === "string" && cmd.includes(`${root}/`);
// One piece's state: "missing", "current" (runs this mod's copy), "old" (runs another copy, the old install's), or
// "foreign" (the slot holds someone else's command: a status line of your own is kept, wrapped; see claudeConnect).
const pieceState = (cmd, script, root) => (!cmd ? "missing" : !ours(cmd, script) ? "foreign" : current(cmd, root) ? "current" : "old");

// Where the scripts are, for the commands: this mod's agent/ folder, as ~/… when it's under your home (shorter, and the
// same on every machine with the default Herdr home).
const agentRoot = (appHome, home) => {
  const root = `${appHome}/mods/veroboard/agent`;
  return home && root.startsWith(`${home}/`) ? `~${root.slice(home.length)}` : root;
};

const parse = (text) => {
  if (text == null || !String(text).trim()) return {};
  const v = JSON.parse(text);
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not a JSON object");
  return v;
};
const dump = (v) => JSON.stringify(v, null, 2) + "\n";
const clone = (v) => JSON.parse(JSON.stringify(v));

// Every hook command in a hooks map ({ Event: [{ matcher?, hooks: [{ command }] }] }), with its event.
const hookCommands = (hooks) => Object.entries(hooks && typeof hooks === "object" ? hooks : {})
  .flatMap(([event, groups]) => (Array.isArray(groups) ? groups : []).flatMap((g) => (Array.isArray(g?.hooks) ? g.hooks : []).map((h) => ({ event, command: h?.command }))));
// The state of our hook for one event and script.
const hookState = (hooks, event, script, root) => {
  const mine = hookCommands(hooks).filter((h) => h.event === event && ours(h.command, script));
  return !mine.length ? "missing" : mine.some((h) => current(h.command, root)) ? "current" : "old";
};
// Adds our hook for an event (when it has none), or points an old one at this copy. Returns what it did, or null.
const putHook = (hooks, event, script, command, matcher, root) => {
  const groups = Array.isArray(hooks[event]) ? hooks[event] : (hooks[event] = []);
  for (const g of groups) for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
    if (!ours(h?.command, script)) continue;
    const next = repoint(h.command, script, root);
    if (next === h.command) return null;
    h.command = next;
    return `${event}: point the hook at this copy (${next})`;
  }
  groups.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: "command", command, timeout: 5 }] });
  return `${event}: add the hook ${command}`;
};
// Takes every one of our hooks out (for the given scripts); drops groups and events left empty. Returns the events.
const dropHooks = (hooks, scripts) => {
  const touched = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    let hit = false;
    const kept = groups.map((g) => {
      if (!Array.isArray(g?.hooks)) return g;
      // A command that also runs something else (a sound after the ping) keeps that part.
      const left = g.hooks.map((h) => {
        const s = scripts.find((x) => ours(h?.command, x));
        if (!s) return h;
        hit = true;
        const rest = strip(h.command, s);
        return rest ? { ...h, command: rest } : null;
      }).filter(Boolean);
      return { ...g, hooks: left };
    }).filter((g) => !Array.isArray(g?.hooks) || g.hooks.length > 0);
    if (!hit) continue;
    touched.push(event);
    if (kept.length) hooks[event] = kept; else delete hooks[event];
  }
  return touched;
};

// ---------- Claude Code: ~/.claude/settings.json ----------
// The status line feeds the board (model, context, tokens, why it's blocked) and runs yours after "--"; the sub-agent
// status line gives the sub-agent rows; Stop and Notification ping the card (its glow, the Blocked and Done clocks);
// the launch guard keeps agents an agent opens in its own space; SessionStart teaches it the decision queue.
// [event, script, matcher, label]
const CLAUDE_HOOKS = [["PreToolUse", "guard", "Bash"], ["Stop", "ping"], ["Notification", "ping"], ["SessionStart", "decisions", undefined, "Decision rules"]];
const claudeCommands = (root) => ({
  tap: `node ${root}/${SCRIPTS.tap} --`, subagents: `node ${root}/${SCRIPTS.subagents}`,
  ping: `sh ${root}/${SCRIPTS.ping}`, guard: `sh ${root}/${SCRIPTS.guard} claude`, decisions: `node ${root}/${SCRIPTS.decisions} claude`,
});
// What runs after "--" in our status line: your own status line, or "". Every layer of ours is peeled off, so a status
// line wrapped twice by mistake (ours -- ours -- yours) comes back as one (user, 2026-11-18: never "tap -- tap -- …").
const afterTap = (cmd) => {
  let rest = cmd;
  while (ours(rest, SCRIPTS.tap)) { const i = rest.indexOf(" -- "); rest = i < 0 ? "" : rest.slice(i + 4).trim(); }
  return rest;
};

const claudeStatus = (text, root) => {
  const s = parse(text);
  const pieces = [
    { key: "statusLine", label: "Status line", state: pieceState(s.statusLine?.command, SCRIPTS.tap, root) },
    { key: "subagentStatusLine", label: "Sub-agent status line", state: pieceState(s.subagentStatusLine?.command, SCRIPTS.subagents, root) },
    ...CLAUDE_HOOKS.map(([event, script, , label]) => ({ key: event, label: label ?? `${event} hook`, state: hookState(s.hooks, event, SCRIPTS[script], root) })),
  ];
  // A status line of your own (foreign) means the board's isn't there yet: connecting wraps yours.
  for (const p of pieces) if (p.key === "statusLine" && p.state === "foreign") p.state = "missing";
  return summarize(pieces);
};
const claudeConnect = (text, root) => {
  const s = clone(parse(text)), c = claudeCommands(root), changes = [];
  // The status line: ours (yours after "--"), keeping yours if you have one, and its other settings (padding).
  const was = s.statusLine?.command;
  const yours = !was ? "" : ours(was, SCRIPTS.tap) ? afterTap(was) : was;
  const tap = yours ? `${c.tap} ${yours}` : c.tap;
  if (was !== tap) {
    s.statusLine = s.statusLine && typeof s.statusLine === "object" ? { ...s.statusLine, command: tap } : { type: "command", command: tap, padding: 0 };
    changes.push(!was ? `statusLine: ${tap}` : ours(was, SCRIPTS.tap) ? `statusLine: point it at this copy (keeps ${yours || "no status line of yours"} after "--")` : `statusLine: the board's, with yours after "--" (${yours})`);
  }
  // The sub-agent status line: ours, unless you have your own (then kept, and said).
  const sub = s.subagentStatusLine?.command;
  const subNext = !sub ? c.subagents : ours(sub, SCRIPTS.subagents) ? repoint(sub, SCRIPTS.subagents, root) : sub;
  if (subNext !== sub) {
    s.subagentStatusLine = s.subagentStatusLine && typeof s.subagentStatusLine === "object" ? { ...s.subagentStatusLine, command: subNext } : { type: "command", command: subNext };
    changes.push(`subagentStatusLine: ${subNext}`);
  } else if (!ours(sub, SCRIPTS.subagents)) changes.push(`subagentStatusLine: kept yours (${sub}); the board's sub-agent rows need its own`);
  s.hooks = s.hooks && typeof s.hooks === "object" ? s.hooks : {};
  for (const [event, script, matcher] of CLAUDE_HOOKS) { const d = putHook(s.hooks, event, SCRIPTS[script], c[script], matcher, root); if (d) changes.push(d); }
  return { text: dump(s), changes };
};
const claudeDisconnect = (text) => {
  const s = clone(parse(text)), changes = [];
  const was = s.statusLine?.command;
  if (ours(was, SCRIPTS.tap)) {
    const yours = afterTap(was);
    if (yours) { s.statusLine = { ...s.statusLine, command: yours }; changes.push(`statusLine: back to yours (${yours})`); }
    else { delete s.statusLine; changes.push("statusLine: removed"); }
  }
  if (ours(s.subagentStatusLine?.command, SCRIPTS.subagents)) { delete s.subagentStatusLine; changes.push("subagentStatusLine: removed"); }
  if (s.hooks && typeof s.hooks === "object") {
    for (const e of dropHooks(s.hooks, [SCRIPTS.guard, SCRIPTS.ping, SCRIPTS.decisions])) changes.push(`${e}: removed the board's hook`);
    if (!Object.keys(s.hooks).length) delete s.hooks;
  }
  return { text: dump(s), changes };
};

// ---------- Codex: ~/.codex/hooks.json, and hooks switched on in ~/.codex/config.toml ----------
const CODEX_EVENTS = ["SessionStart", "UserPromptSubmit", "PostToolUse", "PermissionRequest", "Stop", "Interrupt"];
const codexCommands = (root) => ({ codex: `node ${root}/${SCRIPTS.codex}`, guard: `sh ${root}/${SCRIPTS.guard} codex`,
  decisions: `node ${root}/${SCRIPTS.decisions} codex` });
const codexStatus = (text, root) => {
  const h = parse(text).hooks;
  return summarize([
    ...CODEX_EVENTS.map((e) => ({ key: e, label: `${e} hook`, state: hookState(h, e, SCRIPTS.codex, root) })),
    { key: "PreToolUse", label: "PreToolUse hook", state: hookState(h, "PreToolUse", SCRIPTS.guard, root) },
    // Its own SessionStart hook, beside the board's silent one: this one prints the rules for the session's context.
    { key: "decisions", label: "Decision rules", state: hookState(h, "SessionStart", SCRIPTS.decisions, root) },
  ]);
};
const codexConnect = (text, root) => {
  const s = clone(parse(text)), c = codexCommands(root), changes = [];
  s.hooks = s.hooks && typeof s.hooks === "object" ? s.hooks : {};
  for (const e of CODEX_EVENTS) { const d = putHook(s.hooks, e, SCRIPTS.codex, c.codex, undefined, root); if (d) changes.push(d); }
  const d = putHook(s.hooks, "PreToolUse", SCRIPTS.guard, c.guard, "Bash", root); if (d) changes.push(d);
  const r = putHook(s.hooks, "SessionStart", SCRIPTS.decisions, c.decisions, undefined, root); if (r) changes.push(r);
  return { text: dump(s), changes };
};
const codexDisconnect = (text) => {
  const s = clone(parse(text)), changes = [];
  if (s.hooks && typeof s.hooks === "object") for (const e of dropHooks(s.hooks, [SCRIPTS.codex, SCRIPTS.guard, SCRIPTS.decisions])) changes.push(`${e}: removed the board's hook`);
  return { text: dump(s), changes };
};
// Codex runs hooks only with [features] hooks = true in its config.toml.
const codexHooksOn = (toml) => {
  let section = "";
  for (const raw of String(toml ?? "").split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    const m = line.match(/^\[(.+)\]$/);
    if (m) { section = m[1].trim(); continue; }
    if (section === "features" && /^hooks\s*=\s*true\s*$/.test(line)) return true;
  }
  return false;
};
// Switches them on: hooks = true under [features] (added, or changed from false), else a [features] section at the end.
const codexHooksEnable = (toml) => {
  const text = String(toml ?? "");
  if (codexHooksOn(text)) return text;
  const lines = text.split("\n");
  let section = "", at = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/#.*/, "").trim(), m = line.match(/^\[(.+)\]$/);
    if (m) { section = m[1].trim(); if (section === "features") at = i; continue; }
    if (section === "features" && /^hooks\s*=/.test(line)) { lines[i] = "hooks = true"; return lines.join("\n"); }
  }
  if (at >= 0) { lines.splice(at + 1, 0, "hooks = true"); return lines.join("\n"); }
  return `${text}${text && !text.endsWith("\n") ? "\n" : ""}${text ? "\n" : ""}[features]\nhooks = true\n`;
};

// All current: "connected"; any old and none missing: "old" (works, runs an older copy: Update); some there: "partial";
// none: "off". A slot of yours we keep (foreign: your own sub-agent status line) doesn't count either way.
const summarize = (pieces) => {
  const own = pieces.filter((p) => p.state !== "foreign"), n = (st) => own.filter((p) => p.state === st).length;
  const state = n("current") === own.length ? "connected" : n("missing") === own.length ? "off" : n("missing") === 0 ? "old" : "partial";
  return { state, pieces };
};

export { SCRIPTS, agentRoot, claudeStatus, claudeConnect, claudeDisconnect, codexStatus, codexConnect, codexDisconnect, codexHooksOn, codexHooksEnable };

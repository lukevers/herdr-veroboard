#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { diffText } = require("./decision-diff.cjs");

const usage = `Usage:
  decide.js add --id <id> --title <text> [--short <label>] [--context <text>] [--body <text> | --body-file <path> | --body -] [--before <text> | --before-file <path>] [--option <label>]... [--terminal <t>]
  decide.js reply <id> --text <text> | --text-file <path> | --text - [--terminal <t>]
  decide.js drop <id> [--terminal <t>]
  decide.js drop --all [--terminal <t>]
  decide.js resolve <id> [--terminal <t>] --outcome answered|dismissed|withdrawn [--option <label>] [--note <text>]
  decide.js archive list [--all] [--terminal <t>]
  decide.js archive clear [--terminal <t>]
  decide.js archive remove <file>
  decide.js note --terminal <t> --id <id> --text <text>
  decide.js list [--all] [--terminal <t>]

Terminal defaults to $HC_TERMINAL_ID. Options default to Yes and No.
--short is a tab label of at most 18 characters; defaults to the title's ticket, PR, or id.
Replies accept at most 16 KiB of text.
drop archives a decision as withdrawn.
archive remove uses the stable file returned by archive list; clear defaults to everything.
Example:
  decide.js add --terminal t42 --id post-update --title "Post this update?" --context "Release channel" --body "The release is ready." --option Yes --option No

The body, context and replies are markdown. Code goes in a fenced block with its language (\`\`\`ts, \`\`\`sql, \`\`\`json, \`\`\`diff …). Never unfenced, never without a language.
Any other diff goes in a \`\`\`diff fenced block in unified format (@@, +, -, space).
Put the exact text you would post in the body, so the person approves what they can read. Re-run add with the same --id to update; drop it when it no longer matters.
When you change existing text (a PR body, a ticket), pass the current text with --before-file and the full new text as --body-file; the dialog shows the diff. Don't hand-write diffs into the body.
Before accepts at most 64 KiB. Re-running add without a before source keeps the stored before; --before "" (or an empty --before-file) clears it.
When the person asks about a decision (a message starting \`About decision\`), answer with \`reply\`, not in chat. If the answer changes the proposal, re-run \`add\` with the same --id and the new body.`;
const slug = id => id.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 80);
// A long id is cut at its last "-" or "_" within 18 characters, not mid-word ("open-shared-interl"; user, 2026-11-20).
const cut = (x) => (x.length <= 18 ? x : (x.slice(0, 19).match(/^(.+)[-_.]/)?.[1] ?? x.slice(0, 18)));
const shortOf = (title, id) => (title.match(/[A-Z][A-Z0-9]+-\d+/)?.[0] ?? title.match(/#\d+/)?.[0])?.slice(0, 18) ?? cut(id);
const outcomes = ["answered", "dismissed", "withdrawn"];
const fail = message => { throw new Error(message); };
const read = file => {
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!d || d.v !== 1 || typeof d.id !== "string" || typeof d.terminal !== "string" || typeof d.title !== "string"
    || typeof d.context !== "string" || typeof d.body !== "string" || !Array.isArray(d.options)
    || (d.before !== undefined && (typeof d.before !== "string" || Buffer.byteLength(d.before, "utf8") > 64 * 1024))
    || d.options.length < 1 || d.options.length > 4 || !d.options.every(x => typeof x === "string" && x.trim())
    || !Number.isFinite(d.at) || !Number.isFinite(d.updated)
    || (d.outcome !== undefined && (!d.outcome || !outcomes.includes(d.outcome.kind) || !Number.isFinite(d.outcome.at)
      || (d.outcome.option !== undefined && typeof d.outcome.option !== "string")
      || (d.outcome.note !== undefined && typeof d.outcome.note !== "string")))
    || (d.short !== undefined && (typeof d.short !== "string" || !d.short.trim() || d.short.length > 18))
    || (d.thread !== undefined && (!Array.isArray(d.thread) || !d.thread.every(x => x && typeof x.text === "string"
      && Number.isFinite(x.at) && (x.from === "you" && x.kind === "ask" || x.from === "agent" && ["reply", "update"].includes(x.kind)))))
    || (d.thread === undefined && d.replied != null && (!Number.isFinite(d.replied.at) || typeof d.replied.text !== "string"))) fail("Invalid decision file");

  // Keep v1's question as the first turn, and retire its old field on the next write (user, 2026-11-20).
  // A label cut mid-word by the first build (the id's first 18 characters) is derived again.
  if (d.short === undefined || (typeof d.id === "string" && d.id.length > 18 && d.short === d.id.slice(0, 18))) d.short = shortOf(d.title, d.id);
  d.thread ??= d.replied ? [{ from: "you", kind: "ask", text: d.replied.text, at: d.replied.at }] : [];
  delete d.replied;

  return d;
};
const write = (file, value) => {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n");
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
};

function main() {
  if (!process.env.HOME) fail("HOME is required");
  const dir = path.join(process.env.HOME, ".config/veroboard/state/decisions");
  fs.mkdirSync(dir, { recursive: true });
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help") { console.log(usage); return; }
  const archive = path.join(dir, "archive");
  const action = command === "archive" ? args.shift() : null;
  if (command === "archive" && !["list", "clear", "remove"].includes(action)) fail("Use archive list, clear or remove");
  const allowed = {
    add: ["id", "title", "short", "context", "body", "body-file", "before", "before-file", "option", "terminal"],
    reply: ["text", "text-file", "terminal"],
    resolve: ["terminal", "outcome", "option", "note"],
    archive: action === "list" ? ["all", "terminal"] : action === "clear" ? ["terminal"] : [],
    drop: ["all", "terminal"], note: ["terminal", "id", "text"], list: ["all", "terminal"],
  }[command];
  if (!allowed) fail(`Unknown command: ${command}`);
  const opts = {}, labels = [], positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const key = arg.slice(2);
    if (!allowed.includes(key)) fail(`Unknown option: ${arg}`);
    if (key !== "option" && Object.hasOwn(opts, key)) fail(`Repeated option: ${arg}`);
    if (key === "all") { opts.all = true; continue; }
    if (i + 1 >= args.length || args[i + 1].startsWith("--")) fail(`Missing value for ${arg}`);
    const value = args[++i];
    if (key === "option") labels.push(value);
    else opts[key] = value;
  }
  if (positional.length > (["reply", "resolve"].includes(command) || command === "archive" && action === "remove" || command === "drop" && !opts.all ? 1 : 0)) fail("Unexpected argument");
  const terminal = opts.terminal ?? process.env.HC_TERMINAL_ID;
  if (!(command === "list" && opts.all || command === "archive" && (action !== "list" || opts.all)) && !terminal?.trim()) fail("Set --terminal or HC_TERMINAL_ID");
  if (opts.terminal !== undefined && !opts.terminal.trim()) fail("--terminal must be nonempty");
  if (command === "note" && !opts.terminal?.trim()) fail("note requires --terminal");
  const id = ["drop", "reply", "resolve"].includes(command) ? positional[0] : opts.id;
  if ((["add", "note", "reply", "resolve"].includes(command) || (command === "drop" && !opts.all)) && !id?.trim()) fail("A decision id is required");
  // Keep machine-qualified addresses in one filename, without turning their slash into a directory.
  const file = id ? path.join(dir, `${encodeURIComponent(terminal)}--${slug(id)}.json`) : null;
  const all = (folder = dir) => (fs.existsSync(folder) ? fs.readdirSync(folder) : []).filter(name => name.endsWith(".json")).flatMap(name => {
    try { return [{ file: path.join(folder, name), data: read(path.join(folder, name)) }]; } catch { return []; }
  });
  const archived = () => all(archive).filter(x => x.data.outcome).sort((a, b) => b.data.outcome.at - a.data.outcome.at);
  // Each update that kept the body it replaced gets the diff to the body after it (the next such update's `previous`,
  // or the current body); the stored copy itself stays out of the output.
  const versions = d => {
    const ups = d.thread.map((x, i) => [x, i]).filter(([x]) => x.kind === "update" && typeof x.previous === "string");
    return d.thread.map((x, i) => {
      if (x.kind !== "update" || typeof x.previous !== "string") return x;
      const { previous, ...rest } = x, after = ups.find(([, j]) => j > i)?.[0].previous ?? d.body;
      return previous === after ? rest : { ...rest, ...diffText(previous, after) };
    });
  };
  const derived = d => ({ ...d, ...(d.before !== undefined ? diffText(d.before, d.body) : {}), thread: versions(d),
    waiting: d.thread.at(-1)?.from === "you" ? "agent" : "you" });
  const now = Date.now();
  if (command === "archive") {
    if (action === "list") {
      console.log(JSON.stringify(archived().filter(x => opts.all || x.data.terminal === terminal)
        .map(x => ({ ...derived(x.data), file: path.basename(x.file) })), null, 2));
    } else if (action === "remove") {
      const name = positional[0];
      if (!name || path.basename(name) !== name || !name.endsWith(".json")) fail("An archived filename is required");
      fs.rmSync(path.join(archive, name), { force: true });
      console.log(`removed ${name} from archive`);
    } else {
      const files = opts.terminal ? all(archive).filter(x => x.data.terminal === opts.terminal).map(x => x.file)
        : (fs.existsSync(archive) ? fs.readdirSync(archive) : []).filter(name => name.endsWith(".json")).map(name => path.join(archive, name));
      for (const target of files) fs.unlinkSync(target);
      console.log(`cleared ${files.length} archived decisions`);
    }
  } else if (command === "add") {
    if (!opts.title?.trim()) fail("--title is required");
    if (opts.title.length > 120) fail("Title exceeds 120 characters");
    const short = opts.short ?? shortOf(opts.title, id);
    if (!short.trim() || short.length > 18) fail("Short label must be nonempty, at most 18 characters");
    const context = opts.context ?? "";
    if (context.length > 300 || /[\r\n\u2028\u2029]/.test(context)) fail("Context must be one line, at most 300 characters");
    if (Object.hasOwn(opts, "body") && Object.hasOwn(opts, "body-file")) fail("Use --body or --body-file, not both");
    const body = opts["body-file"] !== undefined ? fs.readFileSync(opts["body-file"], "utf8")
      : opts.body === "-" ? fs.readFileSync(0, "utf8") : opts.body ?? "";
    if (Buffer.byteLength(body, "utf8") > 64 * 1024) fail("Body exceeds 64 KiB");
    if (labels.length > 4 || labels.some(x => !x.trim())) fail("Provide 1–4 nonempty option labels");
    const previous = fs.existsSync(file) ? read(file) : null;
    if (previous && (previous.id !== id || previous.terminal !== terminal)) fail("Decision filename conflicts with another id");
    if (Object.hasOwn(opts, "before") && Object.hasOwn(opts, "before-file")) fail("Use --before or --before-file, not both");
    const before = opts["before-file"] !== undefined ? fs.readFileSync(opts["before-file"], "utf8") : opts.before ?? previous?.before;
    if (before !== undefined && Buffer.byteLength(before, "utf8") > 64 * 1024) fail("Before exceeds 64 KiB");
    write(file, { v: 1, id, terminal, title: opts.title, short, context, body, ...(before ? { before } : {}), options: labels.length ? labels : ["Yes", "No"],
      at: previous?.at ?? now, updated: now,
      // An update keeps the body it replaced (`previous`), so the dialog can show what changed (user, 2026-11-20).
      thread: previous ? [...previous.thread, { from: "agent", kind: "update", text: "Updated the proposal", at: now,
        ...(typeof previous.body === "string" && previous.body !== body ? { previous: previous.body } : {}) }] : [] });
    console.log(`queued ${id} for ${terminal}`);
  } else if (command === "list") {
    console.log(JSON.stringify(all().map(x => derived(x.data))
      .filter(d => opts.all || d.terminal === terminal).sort((a, b) => a.at - b.at), null, 2));
  } else if (command === "drop" || command === "resolve") {
    const kind = command === "drop" ? "withdrawn" : opts.outcome;
    if (!outcomes.includes(kind)) fail("--outcome must be answered, dismissed or withdrawn");
    if (labels.length > 1 || labels.some(x => !x.trim())) fail("Provide one nonempty option label");
    if (!opts.all && fs.existsSync(file)) {
      const d = read(file);
      if (d.id !== id || d.terminal !== terminal) fail("Decision id does not match");
    }
    const files = opts.all ? all().filter(x => x.data.terminal === terminal).map(x => x.file) : [file];
    let removed = 0;
    for (const target of files) {
      if (!fs.existsSync(target)) continue;
      const d = read(target), name = path.basename(target);
      fs.mkdirSync(archive, { recursive: true });
      let destination = path.join(archive, name), suffix = now;
      while (fs.existsSync(destination)) destination = path.join(archive, `${name.slice(0, -5)}-${suffix++}.json`);
      // Write the outcome before removing the open copy, so a failed write cannot lose it (user, 2026-11-20).
      write(destination, { ...d, outcome: { kind, ...(labels.length ? { option: labels[0] } : {}),
        ...(opts.note !== undefined ? { note: opts.note } : {}), at: now } });
      fs.unlinkSync(target);
      removed++;
      for (const old of archived().slice(200)) fs.unlinkSync(old.file);
    }
    console.log(removed ? `${command === "drop" ? "dropped" : "resolved"} ${opts.all ? removed : id} for ${terminal}` : `no decision ${id ?? "found"} for ${terminal}`);
  } else {
    if (!Object.hasOwn(opts, "text") && !Object.hasOwn(opts, "text-file")) fail("--text is required");
    if (Object.hasOwn(opts, "text") && Object.hasOwn(opts, "text-file")) fail("Use --text or --text-file, not both");
    const text = command === "note" ? opts.text : opts["text-file"] !== undefined ? fs.readFileSync(opts["text-file"], "utf8")
      : opts.text === "-" ? fs.readFileSync(0, "utf8") : opts.text;
    if (command === "reply" && Buffer.byteLength(text, "utf8") > 16 * 1024) fail("Reply exceeds 16 KiB");
    const d = read(file);
    if (d.id !== id || d.terminal !== terminal) fail("Decision id does not match");
    const reply = command === "reply";
    write(file, { ...d, updated: reply ? now : d.updated,
      thread: [...d.thread, { from: reply ? "agent" : "you", kind: reply ? "reply" : "ask", text, at: now }] });
    console.log(`${reply ? "replied on" : "noted"} ${id} for ${terminal}`);
  }
}

try { main(); } catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}

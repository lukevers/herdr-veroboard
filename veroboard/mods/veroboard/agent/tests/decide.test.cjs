"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { diffText } = require("../core/decision-diff.cjs");

const cli = path.resolve(__dirname, "../core/decide.js");
const testHome = fs.mkdtempSync(path.join(__dirname, ".decide-home-"));
const dir = path.join(testHome, ".config/veroboard/state/decisions");
const env = { ...process.env, HOME: testHome, HC_TERMINAL_ID: "t42" };
let passed = 0;
const call = (args, options = {}) => spawnSync(process.execPath, [cli, ...args], { env, encoding: "utf8", ...options });
const ok = (args, options) => {
  const r = call(args, options);
  assert.equal(r.status, 0, r.stderr);

  return r.stdout.trim();
};
const bad = (args, match, options) => {
  const r = call(args, options);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, match);
};
const add = (id, ...args) => ok(["add", "--id", id, "--title", "Ship the proposal?", ...args]);
const list = (...args) => JSON.parse(ok(["list", ...args]));
const archive = (...args) => JSON.parse(ok(["archive", "list", ...args]));
const get = id => list("--all").find(d => d.id === id);
const file = (id, terminal = "t42") => path.join(dir, `${encodeURIComponent(terminal)}--${id}.json`);
const save = (id, d) => fs.writeFileSync(file(id), JSON.stringify(d));
const test = (label, body) => { body(); passed++; console.log(`PASS ${label}`); };

try {
  test("v1: default terminal, Yes/No, full body and context", () => {
    assert.equal(add("base", "--body", "Line one\n  Line two", "--context", "Release channel"), "queued base for t42");
    const d = get("base");
    assert.equal(d.terminal, "t42");
    assert.deepEqual(d.options, ["Yes", "No"]);
    assert.equal(d.body, "Line one\n  Line two");
    assert.equal(d.context, "Release channel");
    assert.equal(d.at, d.updated);
  });
  test("v1: custom options, body-file and stdin", () => {
    const bodyFile = path.join(testHome, "body.txt");
    fs.writeFileSync(bodyFile, "File\nbody");
    add("file", "--body-file", bodyFile, "--option", "Ship", "--option", "Wait");
    assert.equal(get("file").body, "File\nbody");
    assert.deepEqual(get("file").options, ["Ship", "Wait"]);
    ok(["add", "--id", "stdin", "--title", "stdin", "--body", "-"], { input: "Stdin\nbody" });
    assert.equal(get("stdin").body, "Stdin\nbody");
  });
  test("v1: terminal scoping, --all, machine-qualified filenames and oldest order", () => {
    add("remote", "--terminal", "machine/t8");
    assert.ok(fs.existsSync(file("remote", "machine/t8")));
    assert.deepEqual(list("--terminal", "machine/t8").map(d => d.id), ["remote"]);
    assert.ok(!list().some(d => d.id === "remote"));
    const d = get("base"); save("base", { ...d, at: 1 });
    assert.equal(list("--all")[0].id, "base");
  });
  test("v1: required fields, unknown/repeated flags and positional validation", () => {
    bad(["add", "--id", "x"], /--title is required/);
    bad(["add", "--title", "x"], /id is required/);
    bad(["add", "--id", "x", "--title", "x"], /Set --terminal/, { env: { ...env, HC_TERMINAL_ID: "" } });
    bad(["list", "--wat"], /Unknown option/);
    bad(["list", "--terminal", "a", "--terminal", "b"], /Repeated option/);
    bad(["list", "--terminal"], /Missing value/);
    bad(["list", "extra"], /Unexpected argument/);
    bad(["wat"], /Unknown command/);
  });
  test("v1: title/context/options/body limits and mutually exclusive body sources", () => {
    bad(["add", "--id", "x", "--title", "a".repeat(121)], /120/);
    for (const context of ["a".repeat(301), "two\nlines", "two\u2028lines"])
      bad(["add", "--id", "x", "--title", "x", "--context", context], /Context/);
    bad(["add", "--id", "x", "--title", "x", "--option", " "], /nonempty/);
    bad(["add", "--id", "x", "--title", "x", ...Array(5).fill(["--option", "x"]).flat()], /1–4/);
    bad(["add", "--id", "x", "--title", "x", "--body", "x", "--body-file", "x"], /not both/);
    bad(["add", "--id", "x", "--title", "x", "--body", "-"], /64 KiB/, { input: "é".repeat(32769) });
    ok(["add", "--id", "boundary", "--title", "x", "--body", "-"], { input: "x".repeat(65536) });
    assert.equal(get("boundary").body.length, 65536);
  });
  test("v1: slug collision protection and malformed files skipped", () => {
    add("collision/a");
    bad(["add", "--id", "collision?a", "--title", "x"], /conflicts/);
    bad(["drop", "collision?a"], /does not match/);
    fs.writeFileSync(path.join(dir, "broken.json"), "{");
    save("invalid", { ...get("base"), options: [] });
    assert.ok(list("--all").every(d => d.options.length));
  });
  test("v2: short given, ticket, PR, id fallback and 18-character derivation", () => {
    add("short", "--short", "Review");
    assert.equal(get("short").short, "Review");
    ok(["add", "--id", "ticket", "--title", "Review #123 and KOV-13930 then KOV-1"]);
    assert.equal(get("ticket").short, "KOV-13930");
    ok(["add", "--id", "pr", "--title", "Review #4697"]);
    assert.equal(get("pr").short, "#4697");
    add("fallback-label-more-than-18");
    assert.equal(get("fallback-label-more-than-18").short, "fallback-label");
    ok(["add", "--id", "long-ticket", "--title", "LONGTICKET-1234567890123"]);
    assert.equal(get("long-ticket").short, "LONGTICKET-1234567");
  });
  test("v2: explicit short accepts 18, rejects overlong and empty", () => {
    add("short18", "--short", "a".repeat(18));
    assert.equal(get("short18").short.length, 18);
    for (const short of ["a".repeat(19), " "])
      bad(["add", "--id", "x", "--title", "x", "--short", short], /Short label/);
  });
  test("v2: note appends twice, preserves updated, waiting becomes agent", () => {
    add("thread");
    const before = get("thread");
    assert.deepEqual(before.thread, []);
    assert.equal(before.waiting, "you");
    assert.equal(ok(["note", "--terminal", "t42", "--id", "thread", "--text", "Why?"]), "noted thread for t42");
    ok(["note", "--terminal", "t42", "--id", "thread", "--text", "Also this?"]);
    const d = get("thread");
    assert.equal(d.updated, before.updated);
    assert.deepEqual(d.thread.map(x => [x.from, x.kind, x.text]), [["you", "ask", "Why?"], ["you", "ask", "Also this?"]]);
    assert.ok(d.thread.every(x => Number.isFinite(x.at)));
    assert.equal(d.waiting, "agent");
    bad(["note", "--id", "thread", "--text", "x"], /requires --terminal/);
  });
  test("v2: reply appends, bumps updated, preserves at, waiting becomes you", () => {
    const before = get("thread"); save("thread", { ...before, updated: 1 });
    assert.equal(ok(["reply", "thread", "--text", "Because.\nMore detail."]), "replied on thread for t42");
    const d = get("thread");
    assert.equal(d.at, before.at);
    assert.deepEqual(d.thread.slice(0, 2), before.thread);
    assert.deepEqual(d.thread.at(-1), { from: "agent", kind: "reply", text: "Because.\nMore detail.", at: d.updated });
    assert.ok(d.updated > 1);
    assert.equal(d.waiting, "you");
  });
  test("v2: reply text-file, stdin, explicit terminal and 16-KiB byte limit", () => {
    const textFile = path.join(testHome, "reply.txt"); fs.writeFileSync(textFile, "From file\nwith lines");
    ok(["reply", "remote", "--terminal", "machine/t8", "--text-file", textFile]);
    assert.equal(get("remote").thread.at(-1).text, "From file\nwith lines");
    ok(["reply", "thread", "--text", "-"], { input: "é".repeat(8192) });
    assert.equal(Buffer.byteLength(get("thread").thread.at(-1).text), 16384);
    const before = fs.readFileSync(file("thread"), "utf8");
    bad(["reply", "thread", "--text", "-"], /16 KiB/, { input: "é".repeat(8193) });
    assert.equal(fs.readFileSync(file("thread"), "utf8"), before);
    bad(["reply", "thread", "--text", "x", "--text-file", textFile], /not both/);
    bad(["reply", "thread"], /--text is required/);
    bad(["reply", "--text", "x"], /id is required/);
    bad(["reply", "missing", "--text", "x"], /ENOENT/);
  });
  test("v2: add-on-existing keeps at/thread and appends update", () => {
    const before = get("thread");
    add("thread", "--body", "Revised proposal", "--short", "Revised");
    const d = get("thread");
    assert.equal(d.at, before.at);
    assert.equal(d.body, "Revised proposal");
    assert.deepEqual(d.thread.slice(0, -1), before.thread);
    // The update carries the diff from the body it replaced to the new one; the stored old body stays out of list.
    const { diff, diffStats, ...update } = d.thread.at(-1);
    assert.deepEqual(update, { from: "agent", kind: "update", text: "Updated the proposal", at: d.updated });
    assert.ok(diff.length && diffStats.added >= 1);
    assert.ok(diff.flatMap(h => h.lines).some(l => l.type === "add" && l.text === "Revised proposal"));
    assert.ok(!("previous" in d.thread.at(-1)));
    assert.ok("previous" in JSON.parse(fs.readFileSync(file("thread"), "utf8")).thread.at(-1), "kept on disk");
    assert.equal(d.waiting, "you");
  });
  test("v6: each update diffs against the body after it; same body twice gives no diff", () => {
    add("versions", "--body", "a\nb\nc");
    add("versions", "--body", "a\nB\nc\nd");
    add("versions", "--body", "a\nB\nc\nd");
    add("versions", "--body", "z");
    const ups = get("versions").thread.filter(x => x.kind === "update");
    assert.equal(ups.length, 3);
    assert.deepEqual(ups[0].diffStats, { added: 2, removed: 1 });
    assert.equal(ups[1].diff, undefined, "unchanged body: no diff");
    assert.deepEqual(ups[2].diffStats, { added: 1, removed: 4 });
  });
  test("v2: legacy replied migration is read-only until next write", () => {
    const legacy = { ...get("base"), id: "legacy", title: "Review KOV-13930", replied: { text: "Old question", at: 5 } };
    delete legacy.thread; delete legacy.short; delete legacy.waiting;
    save("legacy", legacy);
    const before = fs.readFileSync(file("legacy"), "utf8");
    const d = get("legacy");
    assert.deepEqual(d.thread, [{ from: "you", kind: "ask", text: "Old question", at: 5 }]);
    assert.equal(d.short, "KOV-13930");
    assert.equal(d.waiting, "agent");
    assert.ok(!Object.hasOwn(d, "replied"));
    assert.equal(fs.readFileSync(file("legacy"), "utf8"), before);
    ok(["note", "--terminal", "t42", "--id", "legacy", "--text", "New question"]);
    const written = JSON.parse(fs.readFileSync(file("legacy")));
    assert.ok(!Object.hasOwn(written, "replied"));
    assert.equal(written.thread.length, 2);
    assert.equal(written.updated, legacy.updated);
  });
  test("v2: migration also survives reply/add, existing thread wins, null legacy is empty", () => {
    const legacy = { ...get("base"), id: "migrate", replied: { text: "Question", at: 5 } };
    delete legacy.thread; delete legacy.short;
    for (const action of ["reply", "add"]) {
      save("migrate", legacy);
      if (action === "reply") ok(["reply", "migrate", "--text", "Answer"]); else add("migrate");
      const d = get("migrate");
      assert.equal(d.thread[0].text, "Question");
      assert.equal(d.thread.length, 2);
      assert.ok(!Object.hasOwn(JSON.parse(fs.readFileSync(file("migrate"))), "replied"));
    }
    save("migrate", { ...legacy, thread: [] });
    assert.deepEqual(get("migrate").thread, []);
    save("migrate", { ...legacy, replied: null });
    assert.equal(get("migrate").waiting, "you");
  });
  test("v2: malformed thread rejected without hiding other decisions", () => {
    save("bad-thread", { ...get("base"), id: "bad-thread", thread: [{ from: "agent", kind: "ask", text: "x", at: 1 }] });
    assert.ok(!get("bad-thread"));
    assert.ok(get("base"));
    bad(["reply", "bad-thread", "--text", "x"], /Invalid decision/);
  });
  test("v1: drop one, absent drop, drop --all remains terminal-scoped", () => {
    assert.equal(ok(["drop", "base"]), "dropped base for t42");
    assert.match(ok(["drop", "base"]), /no decision/);
    assert.match(ok(["drop", "--all"]), /dropped/);
    assert.deepEqual(list(), []);
    assert.deepEqual(list("--all").map(d => d.id), ["remote"]);
  });
  test("v3: drop archives withdrawn decisions and open list excludes archive", () => {
    const entries = archive();
    assert.ok(entries.length > 1);
    assert.ok(entries.every(d => d.outcome.kind === "withdrawn" && Number.isFinite(d.outcome.at)));
    assert.equal(entries.find(d => d.id === "base").body, "Line one\n  Line two");
    assert.deepEqual(list(), []);
    assert.deepEqual(archive("--terminal", "machine/t8"), []);
  });
  test("v3: resolve preserves body/thread, outcome, derived fields and newest order", () => {
    add("answered", "--body", "Exact\n  proposal");
    ok(["note", "--terminal", "t42", "--id", "answered", "--text", "Question"]);
    const before = get("answered"), now = Date.now();
    ok(["resolve", "answered", "--outcome", "answered", "--option", "Yes", "--note", "With a note"]);
    const d = archive()[0];
    assert.equal(d.id, "answered");
    assert.equal(d.body, before.body);
    assert.deepEqual(d.thread, before.thread);
    assert.equal(d.short, before.short);
    assert.equal(d.waiting, "agent");
    assert.ok(d.outcome.at >= now);
    assert.deepEqual({ ...d.outcome, at: 0 }, { kind: "answered", option: "Yes", note: "With a note", at: 0 });
    assert.ok(!get("answered"));
    assert.equal(d.file, "t42--answered.json");
    ok(["resolve", "remote", "--terminal", "machine/t8", "--outcome", "dismissed"]);
    assert.equal(archive("--terminal", "machine/t8")[0].outcome.kind, "dismissed");
    assert.ok(archive("--all").every((d, i, ds) => !i || ds[i - 1].outcome.at >= d.outcome.at));
  });
  test("v3: repeated resolutions keep stable unique filenames and remove only one", () => {
    add("answered");
    ok(["resolve", "answered", "--outcome", "withdrawn"]);
    const entries = archive().filter(d => d.id === "answered");
    assert.equal(entries.length, 2);
    assert.match(entries[0].file, /^t42--answered-\d+\.json$/);
    ok(["archive", "remove", entries[0].file]);
    assert.deepEqual(archive().filter(d => d.id === "answered").map(d => d.file), [entries[1].file]);
    bad(["archive", "remove", "../t42--answered.json"], /filename/);
    bad(["archive", "remove"], /filename/);
    bad(["archive", "wat"], /Use archive/);
  });
  test("v3: invalid resolve leaves open decision intact", () => {
    add("invalid-resolve");
    const before = fs.readFileSync(file("invalid-resolve"), "utf8");
    for (const args of [[], ["--outcome", "wat"]]) bad(["resolve", "invalid-resolve", ...args], /--outcome/);
    bad(["resolve", "invalid-resolve", "--outcome", "answered", "--option", "a", "--option", "b"], /one nonempty/);
    add("collision/a");
    bad(["resolve", "collision?a", "--outcome", "dismissed"], /does not match/);
    assert.equal(fs.readFileSync(file("invalid-resolve"), "utf8"), before);
  });
  test("v3: clear terminal scope, all-terminal default and empty archive", () => {
    bad(["archive", "clear", "--terminal", ""], /nonempty/);
    ok(["archive", "clear", "--terminal", "t42"]);
    assert.equal(archive().length, 0);
    assert.equal(archive("--all").length, 1);
    ok(["archive", "clear"], { env: { ...env, HC_TERMINAL_ID: "" } });
    assert.deepEqual(archive("--all"), []);
    assert.ok(get("invalid-resolve"));
  });
  test("v3: resolve prunes oldest archives globally to 200", () => {
    const base = get("invalid-resolve"), folder = path.join(dir, "archive");
    for (let i = 0; i < 201; i++) fs.writeFileSync(path.join(folder, `old-${i}.json`), JSON.stringify({
      ...base, id: `old-${i}`, terminal: i % 2 ? "other" : "t42", outcome: { kind: "withdrawn", at: i },
    }));
    ok(["resolve", "invalid-resolve", "--outcome", "dismissed"]);
    const entries = archive("--all");
    assert.equal(entries.length, 200);
    assert.equal(entries[0].id, "invalid-resolve");
    assert.equal(entries.at(-1).id, "old-2");
    assert.ok(!fs.existsSync(path.join(folder, "old-0.json")));
    assert.ok(!fs.existsSync(path.join(folder, "old-1.json")));
    assert.deepEqual(list("--all").map(d => d.id), ["collision/a"]);
  });
  test("v3: help documents resolve/archive and withdrawn guidance", () => {
    const help = ok(["--help"]);
    for (const text of ["resolve <id>", "archive list", "archive clear", "archive remove", "drop archives a decision as withdrawn."])
      assert.ok(help.includes(text));
  });
  test("v2: help documents short, reply and About decision guidance", () => {
    const help = ok(["--help"]);
    assert.match(help, /--short <label>/);
    assert.match(help, /reply <id> --text/);
    assert.ok(help.includes("When the person asks about a decision (a message starting `About decision`), answer with `reply`, not in chat. If the answer changes the proposal, re-run `add` with the same --id and the new body."));
  });
  test("v4: before-file preserves exact text, derived diff and archive parity", () => {
    const source = path.join(testHome, "before.txt");
    fs.writeFileSync(source, "first\nold\nlast");
    add("diff-file", "--before-file", source, "--body", "first\nnew\nlast");
    const d = get("diff-file");
    assert.equal(d.before, "first\nold\nlast");
    assert.deepEqual(d.diff, [{ oldStart: 1, newStart: 1, lines: [
      { type: "ctx", text: "first", old: 1, new: 1 }, { type: "del", text: "old", old: 2 },
      { type: "add", text: "new", new: 2 }, { type: "ctx", text: "last", old: 3, new: 3 },
    ] }]);
    assert.deepEqual(d.diffStats, { added: 1, removed: 1 });
    const stored = JSON.parse(fs.readFileSync(file("diff-file")));
    assert.ok(!Object.hasOwn(stored, "diff")); assert.ok(!Object.hasOwn(stored, "diffStats"));
    ok(["resolve", "diff-file", "--outcome", "dismissed"]);
    const archived = archive().find(d => d.id === "diff-file");
    assert.equal(archived.before, d.before); assert.deepEqual(archived.diff, d.diff); assert.deepEqual(archived.diffStats, d.diffStats);
  });
  test("v4: add keeps before, replaces it, and explicit empty text/file clears it", () => {
    add("keep-before", "--before", "old", "--body", "new");
    add("keep-before", "--body", "newer");
    assert.equal(get("keep-before").before, "old");
    assert.equal(get("keep-before").diff[0].lines.at(-1).text, "newer");
    add("keep-before", "--before", "new", "--body", "newer");
    assert.equal(get("keep-before").before, "new");
    add("keep-before", "--before", "", "--body", "exact\n  body");
    const cleared = get("keep-before");
    assert.equal(cleared.body, "exact\n  body");
    for (const key of ["before", "diff", "diffStats"]) assert.ok(!Object.hasOwn(cleared, key));
    const empty = path.join(testHome, "empty.txt"); fs.writeFileSync(empty, "");
    add("keep-before", "--before", "old");
    add("keep-before", "--before-file", empty);
    assert.ok(!Object.hasOwn(get("keep-before"), "before"));
  });
  test("v4: before sources are exclusive and enforce the 64-KiB byte boundary atomically", () => {
    const source = path.join(testHome, "limit.txt");
    fs.writeFileSync(source, "é".repeat(32768));
    add("limit-before", "--before-file", source);
    assert.equal(Buffer.byteLength(get("limit-before").before), 65536);
    const before = fs.readFileSync(file("limit-before"), "utf8");
    fs.appendFileSync(source, "x");
    bad(["add", "--id", "limit-before", "--title", "x", "--before-file", source], /64 KiB/);
    bad(["add", "--id", "limit-before", "--title", "x", "--before", "x", "--before-file", source], /not both/);
    assert.equal(fs.readFileSync(file("limit-before"), "utf8"), before);
    save("bad-before", { ...get("keep-before"), id: "bad-before", before: 3 });
    assert.ok(!get("bad-before"));
  });
  test("v4: context three, separated and merged hunks, correct old/new positions", () => {
    const old = Array.from({ length: 24 }, (_, i) => `line ${i + 1}`), next = [...old];
    next.splice(4, 1, "replacement", "extra"); next.splice(17, 1);
    const result = diffText(old.join("\n"), next.join("\n"));
    assert.deepEqual(result.diffStats, { added: 2, removed: 2 });
    assert.equal(result.diff.length, 2);
    assert.deepEqual(result.diff.map(h => [h.oldStart, h.newStart]), [[2, 2], [14, 15]]);
    for (const h of result.diff) {
      assert.deepEqual(h.lines.slice(0, 3).map(l => l.type), ["ctx", "ctx", "ctx"]);
      assert.deepEqual(h.lines.slice(-3).map(l => l.type), ["ctx", "ctx", "ctx"]);
    }
    const near = [...old]; near[4] = "first"; near[10] = "second";
    assert.equal(diffText(old.join("\n"), near.join("\n")).diff.length, 1);
  });
  test("v4: identical, empty before/body, CRLF and trailing newline", () => {
    assert.deepEqual(diffText("same\ntext", "same\ntext"), { diff: [], diffStats: { added: 0, removed: 0 } });
    assert.deepEqual(diffText("", ""), { diff: [], diffStats: { added: 0, removed: 0 } });
    assert.deepEqual(diffText("", "new").diff, [{ oldStart: 1, newStart: 1, lines: [{ type: "add", text: "new", new: 1 }] }]);
    assert.deepEqual(diffText("old", "").diff, [{ oldStart: 1, newStart: 1, lines: [{ type: "del", text: "old", old: 1 }] }]);
    assert.deepEqual(diffText("a\r\nb", "a\nb").diff, []);
    assert.deepEqual(diffText("a", "a\n").diffStats, { added: 1, removed: 0 });
    add("identical", "--before", "same", "--body", "same");
    assert.deepEqual(get("identical").diff, []);
    save("empty-stored", { ...get("identical"), id: "empty-stored", before: "", body: "new" });
    assert.deepEqual(get("empty-stored").diffStats, { added: 1, removed: 0 });
  });
  test("v4: LCS edits reconstruct repeated-line inputs with minimal edit counts", () => {
    let seed = 7;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
    for (let trial = 0; trial < 120; trial++) {
      const a = Array.from({ length: 1 + random() % 12 }, () => String(random() % 4));
      const b = Array.from({ length: 1 + random() % 12 }, () => String(random() % 4));
      const matrix = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
      for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
        matrix[i][j] = a[i - 1] === b[j - 1] ? matrix[i - 1][j - 1] + 1 : Math.max(matrix[i - 1][j], matrix[i][j - 1]);
      const { diff, diffStats } = diffText(a.join("\n"), b.join("\n"));
      assert.equal(diffStats.added + diffStats.removed, a.length + b.length - 2 * matrix[a.length][b.length]);
      const result = [...a];
      for (const h of [...diff].reverse()) {
        for (const line of h.lines) {
          if (line.old !== undefined) assert.equal(line.text, a[line.old - 1]);
          if (line.new !== undefined) assert.equal(line.text, b[line.new - 1]);
        }
        result.splice(h.oldStart - 1, h.lines.filter(l => l.type !== "add").length, ...h.lines.filter(l => l.type !== "del").map(l => l.text));
      }
      assert.deepEqual(result, b);
    }
  });
  test("v4: help teaches before sources, clearing and full new bodies", () => {
    const help = ok(["--help"]);
    for (const text of ["--before <text>", "--before-file <path>", '--before ""', "keeps the stored before", "Don't hand-write diffs into the body.",
      "pass the current text with --before-file and the full new text as --body-file; the dialog shows the diff."]) assert.ok(help.includes(text));
  });
  test("v5: help requires markdown, language fences and unified diffs", () => {
    const help = ok(["--help"]);
    for (const text of ["The body, context and replies are markdown.", "Code goes in a fenced block with its language",
      "```ts", "```sql", "```json", "```diff", "Never unfenced, never without a language.",
      "Any other diff goes in a ```diff fenced block in unified format (@@, +, -, space)."])
      assert.ok(help.includes(text), text);
  });
  test("v5: markdown body, context and fenced reply round-trip unchanged", () => {
    const body = "# Proposal\n```ts\nconst n = 1;\n```", context = "Review **this** proposal";
    add("markdown", "--body", body, "--context", context);
    const reply = "Updated query:\n```sql\nselect 1;\n```";
    ok(["reply", "markdown", "--text", reply]);
    const d = get("markdown");
    assert.equal(d.body, body); assert.equal(d.context, context); assert.equal(d.thread.at(-1).text, reply);
  });
  console.log(`${passed} cases passed; throwaway HOME removed.`);
} finally { fs.rmSync(testHome, { recursive: true, force: true }); }

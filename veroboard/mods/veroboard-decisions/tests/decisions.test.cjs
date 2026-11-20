"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "../..");
// Herdr writes gpui-kit.d.ts into each mod folder; the package leaves it out, so fall back to the installed copy.
const kit = [path.join(root, "veroboard/gpui-kit.d.ts"),
  path.join(process.env.HERDR_APP_HOME || path.join(require("node:os").homedir(), ".config/herdr-app"), "mods/veroboard/gpui-kit.d.ts")]
  .find(f => fs.existsSync(f));
if (!kit) { console.log("SKIP: gpui-kit.d.ts not found (open Herdr once with the board installed)"); process.exit(0); }
const declarations = fs.readFileSync(kit, "utf8");
const methods = new Set([...declarations.matchAll(/^\s+(\w+)<Self extends Element>/gm)].map(m => m[1]));
const key = d => JSON.stringify([d.terminal, d.id]);
const clone = x => JSON.parse(JSON.stringify(x));
let rendering = false, passed = 0, tasks = [], queue = [], archived = [], timers = [], execCalls = [], calls = [], notices = [], failure = null, gone = false;
const sharedState = new Map();
const sounds = [];
const handle = () => ({ requests: [], scroll_to_item(i) { this.requests.push(i); }, release() { this.released = true; }, focus() {} });
const input = options => {
  assert.ok(!rendering, "state created during render");
  return { options, text: options.value ?? "", events: {}, value() { return this.text; }, set_value(x) { this.text = x; },
    on(name, fn) { this.events[name] = fn; }, release() { this.released = true; } };
};
const element = (extra = []) => {
  const target = { childList: [], styles: {}, events: {}, editorState: null };
  let proxy;
  proxy = new Proxy(target, { get(o, name) {
    if (name in o) return o[name];
    assert.ok(methods.has(name) || extra.includes(name), `undocumented builder ${name}`);
    return (...args) => {
      if (name === "when") { if (args[0]) args[1](proxy); }
      else if (name === "child") o.childList.push(args[0]);
      else if (name === "children") o.childList.push(...args[0]);
      else if (name.startsWith("on_")) o.events[name] = args.at(-1);
      else o.styles[name] = args;
      return proxy;
    };
  } });
  return proxy;
};
const colors = Object.fromEntries(["background", "done", "popover", "canvas", "raised", "accent", "foreground", "muted", "dim", "blocked", "ansi1", "ansi2", "ansi3", "ansi4", "ansi5", "ansi6", "accent_foreground"].map(k => [k, "#123456"]));
for (let i = 2; i <= 6; i++) colors[`ansi${i}`] = `#${i}23456`;
colors.done = "#32a852"; colors.blocked = "#e25091"; colors.accent = "#967bea"; colors.idle = "#8a8f98"; colors.canvas = "#101014";
const cx = { notify() { assert.ok(!rendering); }, stop_propagation() {}, focus_handle: handle,
  timer: { every() {}, after(ms, fn) { timers.push({ ms, fn }); } }, spawn(fn) { const p = fn(cx); tasks.push(p); return p; } };
const sandbox = {
  View: class {}, div: element, svg: element, v_flex: element, h_flex: element,
  TextView: { markdown: (id, text) => element(["selectable"]).id(id).child(text) },
  EditorState: { new: input }, Editor: { new: state => { assert.ok(!state.released); const el = element(); el.editorState = state; return el; } },
  ScrollHandle: { new: handle }, TextareaState: { new: input }, Textarea: { new: state => { assert.ok(!state.released); return element(); } },
  agents: () => gone ? [] : [{ address: "t1", tab_name: "Agent", space_name: "Work" }],
  terminals: () => gone ? [] : [{ address: "t1", state: "live" }],
  theme: () => colors, props: () => ({}), checking: () => true, home: () => "/fake", appHome: () => "/fake/app",
  readTextFile: async () => "node", exec: async (program, args) => {
    execCalls.push([program, args]);
    if (program === "sh") {
      if (failure === "copy-throw") throw new Error("unavailable");
      return { code: failure === "copy" ? 1 : 0 };
    }
    assert.deepEqual(clone(args.slice(-2)), ["list", "--all"]);

    return { code: 0, stdout: JSON.stringify(queue), stderr: "" };
  },
  hc: async args => { calls.push(args); return failure === "send" ? { code: 1, stderr: "send\nfailed" } : { code: 0 }; },
  shared: k => sharedState.get(k), setShared: (k, v) => sharedState.set(k, v), notify: n => notices.push(n),
  run: () => { throw new Error("Unexpected live navigation"); }, console,
  // The board reads VIEW (card.js) for its lane switches; the decision rule reads VIEW.decisionBlocks.
  VIEW: {}, spaces: () => [], playSound: name => sounds.push(name),
};
const load = (file, name) => vm.runInNewContext(fs.readFileSync(path.join(root, file), "utf8")
  .replace(/^import[\s\S]*?;\n/gm, "").replace(`export default class ${name}`, `class ${name}`) + `\n${name}`, sandbox);
const Decisions = load("veroboard-decisions/main.js", "Decisions");
const Board = load("veroboard/main.js", "Board");
const d = (id, at, waiting = "you") => ({ id, terminal: "t1", title: `Title ${id}`, short: id, context: "Context", body: "Proposal\n".repeat(20),
  options: ["Yes", "No"], at, updated: at, thread: waiting === "agent" ? [{ from: "you", kind: "ask", text: "Why?", at: at + 1 }] : [], waiting });
const dialog = new Decisions(); dialog.init(null, cx);
dialog.command = async args => {
  calls.push(args);
  if (args[0] === "list") return JSON.stringify(queue);
  if (args[0] === "archive" && args[1] === "list") return JSON.stringify(archived);
  if (failure === "command") throw new Error("write\nfailed");
  if (args[0] === "resolve") {
    const current = queue.find(d => d.id === args[1]);
    archived.unshift({ ...clone(current), file: `${current.terminal}--${current.id}.json`, outcome: {
      kind: args[5], at: Date.now(), ...(args.includes("--option") ? { option: args[args.indexOf("--option") + 1] } : {}),
      ...(args.includes("--note") ? { note: args[args.indexOf("--note") + 1] } : {}),
    } });
    queue = queue.filter(d => d.id !== args[1]);
  }
  if (args[0] === "archive" && args[1] === "remove") archived = archived.filter(d => d.file !== args[2]);
  if (args[0] === "archive" && args[1] === "clear") archived = [];
  if (args[0] === "note") {
    const current = queue.find(d => d.id === args[4]);
    current.thread.push({ from: "you", kind: "ask", text: args[6], at: Date.now() }); current.waiting = "agent";
  }
};
const render = () => { rendering = true; try { return dialog.render(cx); } finally { rendering = false; } };
const flatten = el => typeof el === "object" ? [el, ...el.childList.flatMap(flatten)] : [el];
const test = async (name, body) => { await body(); passed++; console.log(`PASS ${name}`); };
const click = id => flatten(render()).find(x => x?.styles?.id?.[0] === id).events.on_click({}, cx);
const drain = async () => { while (tasks.length) await Promise.all(tasks.splice(0)); };

(async () => {
  await test("dialog: checking guard and empty render", () => { assert.equal(tasks.length, 0); assert.ok(flatten(render()).includes("No decisions waiting.")); });
  await test("dialog: waiting/age order, initial selection and per-decision drafts", async () => {
    queue = [d("waiting", 1, "agent"), d("newer", 3), d("oldest", 2)]; await dialog.reload();
    assert.deepEqual(Array.from(dialog.decisions, d => d.id), ["oldest", "newer", "waiting"]);
    assert.equal(dialog.selected, key(queue[2]));
    assert.equal(dialog.drafts.size, 3);
    dialog.drafts.get(dialog.selected).input.set_value("Keep this draft");
    dialog.select(dialog.decisions[1], cx); dialog.select(dialog.decisions[0], cx);
    assert.equal(dialog.drafts.get(dialog.selected).input.value(), "Keep this draft");
  });
  await test("dialog: full proposal, documented builders, tab scroll and composer render", () => {
    let nodes = flatten(render());
    assert.ok(nodes.some(x => x?.styles?.selectable && x.childList.includes(dialog.decisions[0].body)));
    assert.ok(!nodes.some(x => x?.editorState));
    click(`body-view-${dialog.selected}-raw`);
    nodes = flatten(render());
    const editor = nodes.find(x => x?.editorState);
    assert.equal(editor.editorState.value(), dialog.decisions[0].body);
    assert.deepEqual(clone(editor.editorState.options), { value: dialog.decisions[0].body, language: "text", readonly: true,
      line_numbers: false, folding: false, soft_wrap: true, font_family: "JetBrains Mono", font_size: 12,
      syntax: Object.fromEntries(["keyword", "string", "comment", "function", "type", "number", "constant", "variable",
        "operator", "punctuation", "boolean", "string.escape"].map(k => [k, colors.foreground])) });
    assert.ok(nodes.filter(x => x?.styles?.selectable).every(x => x.styles.selectable[0]));
    // The bar keeps the context to one line with the full text on hover; ⌄ shows it in full and selectable.
    assert.ok(nodes.some(x => x?.styles?.truncate && x.styles.tooltip?.[0] === "Context" && x.childList.includes("Context")));
    // ⌄ only once something is measured as cut off (user, 2026-11-20).
    const sel = dialog.selected, size = (id, width) => flatten(render()).find(x => x?.styles?.id?.[0] === id).events.on_size_change({ width }, cx);
    size(`head-context-${sel}-shown`, 300); size(`head-context-${sel}-natural`, 300);
    assert.ok(!flatten(render()).some(x => x?.styles?.id?.[0] === `head-more-${sel}`));
    size(`head-context-${sel}-natural`, 520);
    click(`head-more-${dialog.selected}`);
    assert.ok(flatten(render()).some(x => x?.styles?.selectable && x.childList.includes("Context")));
    click(`head-more-${dialog.selected}`);
    assert.ok(nodes.every(x => !x?.events?.on_mouse_down));
    // Tabs scroll by the dialog's own offset: a wheel handler on the clipped row (user, 2026-11-20).
    const tabRow = nodes.find(x => x?.styles?.id?.[0] === "decision-tabs");
    assert.ok(tabRow?.events?.on_scroll_wheel && tabRow.styles.overflow_hidden);
    assert.ok(nodes.some(x => x?.styles?.h?.[0] === 56));
    assert.ok(nodes.some(x => x?.styles?.line_height?.[0] === "19px"));
    click(`body-view-${dialog.selected}-preview`);
  });
  await test("tabs: wheel scrolls sideways within bounds, arrows show at the edges, select reveals the tab", () => {
    const items = dialog.items(), saved = [dialog.tabOff, dialog.tabW, dialog.tabsOuterW, dialog.tabsInnerW, dialog.selected];
    dialog.tabW = Object.fromEntries(items.map(x => [key(x), 150])); dialog.tabsOuterW = 200; dialog.tabsInnerW = 32 + items.length * 152;
    dialog.tabOff = 0;
    let row = flatten(render()).find(x => x?.styles?.id?.[0] === "decision-tabs");
    row.events.on_scroll_wheel({ delta: { x: 0, y: -100 } }, cx);
    assert.equal(dialog.tabOff, 100);
    row.events.on_scroll_wheel({ delta: { x: 0, y: -1e6 } }, cx);
    assert.equal(dialog.tabOff, dialog.tabMax());
    let ids = flatten(render()).map(x => x?.styles?.id?.[0]);
    assert.ok(ids.includes("decision-tabs-left") && !ids.includes("decision-tabs-right"));
    dialog.select(items[0], cx);
    assert.equal(dialog.tabOff, 0);
    ids = flatten(render()).map(x => x?.styles?.id?.[0]);
    assert.ok(!ids.includes("decision-tabs-left") && (items.length < 2 || ids.includes("decision-tabs-right")));
    [dialog.tabOff, dialog.tabW, dialog.tabsOuterW, dialog.tabsInnerW, dialog.selected] = saved;
  });
  await test("v4: settings-style segmented navigation and count badges", () => {
    const nodes = flatten(render()), byId = id => nodes.find(x => x?.styles?.id?.[0] === id);
    const group = byId("view"), open = byId("view-open"), other = byId("view-archive");
    for (const [name, value] of Object.entries({ p: 2, gap: 2, rounded: 7, bg: colors.background, border: 1 }))
      assert.equal(group.styles[name][0], value);
    // Open selected in the Decisions pink, Archive in the idle grey (user, 2026-11-20).
    for (const [name, value] of Object.entries({ h: 24, px: 12, rounded: 5, text_size: 11.5, bg: colors.blocked + "26", border_color: colors.blocked + "55" }))
      assert.equal(open.styles[name][0], value);
    assert.equal(other.styles.text_color[0], colors.muted);
    const hover = element(); other.styles.hover[0](hover);
    assert.equal(hover.styles.bg[0], colors.idle + "14");
    assert.ok(!byId("view-archive-count"));
    // On its selected segment the count is filled with the segment's color, dark text on top; the header's stays a tint.
    // The title has no count of its own any more (user, 2026-11-20); Open carries it.
    assert.ok(!byId("waiting-count"));
    for (const [id, bg, fg] of [["view-open-count", colors.blocked, colors.canvas]]) {
      const count = byId(id);
      for (const [name, value] of Object.entries({ h: 16, min_w: 16, px: 5, rounded: 8, text_size: 10, bg, text_color: fg }))
        assert.equal(count.styles[name][0], value);
      assert.ok(count.styles.font_semibold); assert.ok(count.styles.justify_center);
    }
    assert.ok(!nodes.some(x => typeof x === "string" && /^(Open|Archive) \(/.test(x)));
    click("view-archive"); assert.equal(dialog.view, "archive");
    click("view-open"); assert.equal(dialog.view, "open");
  });
  await test("v4: zero counts disappear, waiting-on-agent is muted, archive count is muted", () => {
    const decisions = dialog.decisions, archive = dialog.archive;
    dialog.decisions = []; dialog.archive = [];
    assert.ok(!flatten(render()).some(x => /^(view-(open|archive)|waiting)-count$/.test(x?.styles?.id?.[0])));
    dialog.decisions = decisions.map(d => ({ ...d, waiting: "agent" }));
    dialog.archive = [{ ...decisions[0], file: "badge.json", outcome: { kind: "withdrawn", at: 1 } }];
    const nodes = flatten(render());
    assert.ok(!nodes.some(x => x?.styles?.id?.[0] === "waiting-count"));
    // The selected segment's count is filled with its color; an unselected one stays muted.
    for (const [id, bg, fg] of [["view-open-count", colors.blocked, colors.canvas], ["view-archive-count", colors.raised, colors.muted]]) {
      const badge = nodes.find(x => x?.styles?.id?.[0] === id);
      assert.equal(badge.styles.bg[0], bg); assert.equal(badge.styles.text_color[0], fg);
    }
    click("view-archive");
    const archived = flatten(render()), tab = archived.find(x => x?.styles?.id?.[0] === "view-archive");
    assert.equal(tab.styles.bg[0], colors.idle + "26"); assert.equal(tab.styles.text_color[0], colors.idle);
    const count = archived.find(x => x?.styles?.id?.[0] === "view-archive-count");
    assert.equal(count.styles.bg[0], colors.idle); assert.equal(count.styles.text_color[0], colors.canvas);
    click("view-open");
    dialog.decisions = decisions; dialog.archive = archive;
  });
  await test("v4: Preview/Raw is per decision, survives reload, and defaults to Preview", async () => {
    const first = dialog.selected;
    click(`body-view-${first}-raw`);
    dialog.select(dialog.decisions[1], cx);
    assert.ok(!flatten(render()).some(x => x?.editorState));
    assert.equal(dialog.editors.get(dialog.selected).view, "preview");
    dialog.select(dialog.decisions.find(d => key(d) === first), cx);
    await dialog.reload();
    assert.ok(flatten(render()).some(x => x?.editorState));
    assert.equal(dialog.editors.get(first).view, "raw");
    click(`body-view-${first}-preview`);
    const nodes = flatten(render()), well = nodes.find(x => x?.styles?.id?.[0] === `well-${first}`);
    // No nested well: the text sits straight in the bubble (user, 2026-11-20).
    assert.ok(well && !well.styles.border_l && !well.styles.bg && !well.styles.p);
    assert.equal(nodes.find(x => x?.styles?.id?.[0] === `body-view-${first}-preview`).styles.h[0], 22);
  });
  await test("md: a ```markdown or ```md block renders as nested markdown with a raw Copy, not an editor", async () => {
    const current = queue.find(d => key(d) === dialog.selected), saved = [current.body, current.diff, current.before];
    current.body = "Intro\n\n```markdown\n# Description\n* one\n```\n\n```md\nplain **md**\n```";
    delete current.diff; delete current.before;
    await dialog.reload();
    const nodes = flatten(render());
    const quotes = nodes.filter(x => String(x?.styles?.id?.[0] ?? "").startsWith("md-"));
    assert.equal(quotes.length, 2);
    assert.ok(quotes.every(q => q.styles.border_l && flatten(q).some(x => x?.styles?.selectable)));
    assert.ok(nodes.some(x => x?.styles?.selectable && x.childList.includes("# Description\n* one")));
    assert.ok(!nodes.some(x => x?.editorState && ["# Description\n* one", "plain **md**"].includes(x.editorState.value?.())));
    [current.body, current.diff, current.before] = saved;
    await dialog.reload();
  });
  await test("hr: --- splits the proposal into wells; setext headings and fenced --- don't split", async () => {
    const current = queue.find(d => key(d) === dialog.selected), saved = [current.body, current.diff, current.before];
    current.body = "Intro\n\n---\n\nSecond\n\n```md\n---\n```\n\nTitle\n---\nStill second\n\n***\n\nThird";
    delete current.diff; delete current.before;
    await dialog.reload();
    const ids = flatten(render()).map(x => x?.styles?.id?.[0]).filter(Boolean), k = dialog.selected;
    assert.ok(ids.includes(`well-${k}`) && ids.includes(`well-${k}-1`) && ids.includes(`well-${k}-2`) && !ids.includes(`well-${k}-3`));
    const second = flatten(render()).find(x => x?.styles?.id?.[0] === `proposal-${k}-0-preview-1-0`);
    assert.ok(second && String(second.childList[0]).startsWith("Second"));
    [current.body, current.diff, current.before] = saved;
    await dialog.reload();
  });
  await test("v4: stacked Changes rows, stats, colored signs and numbered gutters", async () => {
    const current = queue.find(d => key(d) === dialog.selected), body = current.body;
    current.body = "# Full new body\nA **rendered** proposal.";
    current.before = "old";
    current.diff = [{ oldStart: 7, newStart: 8, lines: [
      { type: "ctx", text: "context", old: 7, new: 8 }, { type: "del", text: "old", old: 8 },
      { type: "add", text: "new", new: 9 },
    ] }];
    current.diffStats = { added: 1, removed: 1 };
    await dialog.reload();
    const id = `proposal-${dialog.selected}-0-diff`;
    // Open by default (Settings → Decisions → "Show changes open"); off folds it behind ▾ with the stats on the chip.
    const shown = flatten(render());
    assert.ok(shown.indexOf("Changes to the current text") < shown.indexOf("New text"));
    assert.ok(shown.includes("▴") && shown.includes("@@ −7 +8 @@"));
    sharedState.set("veroboard.decisionDiffOpen", false);
    const folded = flatten(render());
    assert.ok(folded.includes("▾") && folded.includes("+1") && folded.includes("−1") && !folded.includes("@@ −7 +8 @@"));
    click(`proposal-${dialog.selected}-0-toggle`);
    const nodes = flatten(render());
    sharedState.delete("veroboard.decisionDiffOpen");
    assert.ok(nodes.includes("▴")); assert.ok(nodes.includes("@@ −7 +8 @@"));
    const preview = nodes.find(x => x?.styles?.id?.[0] === `proposal-${dialog.selected}-1-preview-0`);
    assert.equal(preview.childList[0], current.body); assert.ok(preview.styles.selectable[0]);
    for (const [i, color, old, next, sign] of [[0, colors.dim, "7", "8", " "], [1, colors.blocked, "8", "", "−"], [2, colors.done, "", "9", "+"]]) {
      const row = nodes.find(x => x?.styles?.id?.[0] === `${id}-0-${i}`);
      assert.equal(row.styles.line_height[0], "19px"); assert.equal(row.styles.font_family[0], "JetBrains Mono"); assert.equal(row.styles.text_size[0], 12);
      if (i) assert.equal(row.styles.bg[0], color + "1f"); else assert.ok(!row.styles.bg);
      assert.deepEqual(row.childList.slice(0, 3).map(x => x.childList[0]), [old, next, sign]);
      for (const gutter of row.childList.slice(0, 2)) {
        assert.equal(gutter.styles.w[0], 32); assert.ok(gutter.styles.text_right); assert.equal(gutter.styles.text_color[0], color);
      }
      assert.ok(row.childList[3].styles.whitespace_normal);
    }
    click(`body-view-${dialog.selected}-raw`);
    assert.ok(flatten(render()).some(x => x?.editorState?.value() === current.body));
    assert.ok(flatten(render()).includes("Changes to the current text"));
    click(`body-view-${dialog.selected}-preview`);
    current.diff = []; current.diffStats = { added: 0, removed: 0 }; await dialog.reload();
    assert.ok(flatten(render()).includes("Proposal")); assert.ok(!flatten(render()).includes("Changes to the current text"));
    delete current.diff; delete current.diffStats; delete current.before; current.body = body;
    await dialog.reload();
  });
  await test("v5: splits prose, diff, ts, unlabelled and multiple closed fences", () => {
    const parse = text => clone(vm.runInNewContext("markdownParts", sandbox)(text));
    assert.deepEqual(parse("# Prose\nText\n"), [{ kind: "text", text: "# Prose\nText\n" }]);
    const parts = parse("Intro\n\n```diff\n-old\n+new\n```\n\nMiddle\n```ts\nconst n = 1;\n```\n```\nplain\n```\nEnd");
    assert.deepEqual(parts.map(p => p.kind), ["text", "diff", "text", "code", "code", "text"]);
    assert.equal(parts[1].language, "diff"); assert.equal(parts[1].text, "-old\n+new");
    assert.deepEqual(parts[3], { kind: "code", language: "ts", text: "const n = 1;" });
    assert.deepEqual(parts[4], { kind: "code", language: "", text: "plain" });
    assert.equal(parts.at(-1).text, "End");
    assert.deepEqual(parse("```sql\r\nselect 1;\r\n```"), [{ kind: "code", language: "sql", text: "select 1;" }]);
    assert.deepEqual(parse("````json\n```\n`````"), [{ kind: "code", language: "json", text: "```" }]);
    assert.deepEqual(parse("~~~text\ncode\n~~~"), [{ kind: "code", language: "text", text: "code" }]);
    assert.deepEqual(parse("```ts\n```"), [{ kind: "code", language: "ts", text: "" }]);
  });
  await test("v5: unterminated fences and unfenced diff-looking text stay markdown", () => {
    const parse = text => clone(vm.runInNewContext("markdownParts", sandbox)(text));
    for (const text of ["Intro\n```ts\nconst n = 1;", "```diff\n-old\n+new", "@@ -1 +1 @@\n-old\n+new", "# Proposal\n- a list\n+ another item"])
      assert.deepEqual(parse(text), [{ kind: "text", text }]);
    const parts = parse("```ts\nfirst\n```\nAfter\n```sql\nunfinished");
    assert.equal(parts.length, 2); assert.deepEqual(parts[1], { kind: "text", text: "After\n```sql\nunfinished" });
  });
  await test("v5: unified diff headers, context, file markers and default numbering", () => {
    const parse = text => clone(vm.runInNewContext("unifiedDiff", sandbox)(text));
    assert.deepEqual(parse("-old\n+new\n same"), [{ oldStart: 1, newStart: 1, lines: [
      { type: "del", text: "old", old: 1 }, { type: "add", text: "new", new: 1 }, { type: "ctx", text: "same", old: 2, new: 2 },
    ] }]);
    const hunks = parse("--- a/body\n+++ b/body\n@@ -7,2 +9,2 @@ title\n same\n-old\n+new\n\\ No newline at end of file\n@@ -20,0 +23 @@\n+added");
    assert.deepEqual(hunks, [
      { oldStart: 7, newStart: 9, file: "body", lines: [{ type: "ctx", text: "same", old: 7, new: 9 }, { type: "del", text: "old", old: 8 }, { type: "add", text: "new", new: 10 }] },
      { oldStart: 20, newStart: 23, lines: [{ type: "add", text: "added", new: 23 }] },
    ]);
    // Bare `@@` hunks have no numbers; blank lines are context; a file pair names the hunks after it (user, 2026-11-20).
    const bare = parse("--- a/x.ts\n+++ b/x.ts\n+import a;\n import z;\n\n-import old;\n@@\n+// note\n export const S = 1;");
    assert.equal(bare.length, 2); assert.equal(bare[0].file, "x.ts"); assert.equal(bare[0].lines[0].new, 1);
    assert.deepEqual(bare[0].lines.map(l => l.type), ["add", "ctx", "ctx", "del"]);
    assert.equal(bare[1].oldStart, null); assert.ok(bare[1].lines.every(l => l.old === undefined && l.new === undefined));
    assert.equal(parse("prose"), null);
    assert.equal(vm.runInNewContext("markdownParts", sandbox)("```diff\nprose\n```")[0].text, "prose");
  });
  await test("v5: code editors receive languages, theme syntax, line numbers and block Copy", async () => {
    const current = queue.find(d => key(d) === dialog.selected), original = current.body;
    const long = Array.from({ length: 13 }, (_, i) => `line ${i}`).join("\n");
    current.body = `Intro\n\n\`\`\`ts\nconst n = 1;\n\`\`\`\n\`\`\`\nplain $HOME \`code\`\n\`\`\`\n\`\`\`sql\n${long}\n\`\`\``;
    await dialog.reload();
    let nodes = flatten(render());
    const editors = nodes.filter(x => x?.editorState).map(x => x.editorState);
    assert.deepEqual(editors.map(s => s.options.language), ["js", "text", "sql"]);
    assert.deepEqual(editors.map(s => s.options.line_numbers), [false, false, true]);
    for (const state of editors) {
      assert.equal(state.options.readonly, true); assert.equal(state.options.soft_wrap, true); assert.equal(state.options.folding, false);
    }
    const syntax = editors[0].options.syntax;
    for (const [name, color] of Object.entries({ keyword: colors.ansi5, string: colors.ansi2, comment: colors.dim,
      number: colors.ansi3, function: colors.ansi4, type: colors.ansi6, constant: colors.foreground, operator: colors.foreground }))
      assert.equal(syntax[name], color);
    assert.ok(Object.values(editors[1].options.syntax).every(color => color === colors.foreground));
    for (const label of ["ts", "text", "sql"]) {
      const node = nodes.find(x => x?.childList?.includes(label));
      assert.equal(node.styles.text_size[0], 10.5); assert.equal(node.styles.text_color[0], colors.dim);
    }
    const copies = nodes.filter(x => String(x?.styles?.id?.[0]).startsWith("copy-code-"));
    assert.equal(copies.length, 3);
    execCalls = []; copies[1].events.on_click({}, cx); await drain();
    assert.deepEqual(clone(execCalls[0]), ["sh", ["-c", 'printf %s "$1" | pbcopy', "sh", "plain $HOME `code`"]]);
    assert.ok(flatten(render()).includes("Copied"));
    click(`body-view-${dialog.selected}-raw`);
    assert.equal(flatten(render()).filter(x => x?.editorState).length, 1);
    assert.equal(flatten(render()).find(x => x?.editorState).editorState.value(), current.body);
    click(`body-view-${dialog.selected}-preview`);
    await dialog.reload();
    assert.equal(flatten(render()).find(x => x?.editorState).editorState, editors[0]);
    current.body = original; await dialog.reload();
    assert.ok(editors.every(s => s.released));
  });
  await test("v5: code sizing, threshold changes, language updates and theme refresh", async () => {
    const current = queue.find(d => key(d) === dialog.selected), original = current.body, height = dialog.messagesHeight;
    current.body = "```ts\n" + "x".repeat(100) + "\n```"; await dialog.reload();
    const nodes = flatten(render()), well = nodes.find(x => String(x?.styles?.id?.[0]).startsWith("code-"));
    const editor = nodes.find(x => x?.editorState).editorState;
    dialog.messagesHeight = 1000;
    well.events.on_size_change({ width: 748 }, cx);
    const wide = flatten(render()).find(x => x?.editorState).styles.h[0];
    well.events.on_size_change({ width: 100 }, cx);
    assert.ok(flatten(render()).find(x => x?.editorState).styles.h[0] > wide);
    // Code blocks show whole: a short chat doesn't cap them (user, 2026-11-20: one scrolled inside).
    const uncapped = flatten(render()).find(x => x?.editorState).styles.h[0];
    dialog.messagesHeight = 100;
    assert.equal(flatten(render()).find(x => x?.editorState).styles.h[0], uncapped);
    current.body = "```ts\n" + Array(12).fill("line").join("\n") + "\n```"; await dialog.reload();
    assert.equal(flatten(render()).find(x => x?.editorState).editorState, editor);
    assert.equal(editor.options.line_numbers, false);
    current.body = "```json\n{}\n```"; await dialog.reload();
    assert.ok(editor.released);
    const changed = flatten(render()).find(x => x?.editorState).editorState;
    assert.equal(changed.options.language, "json");
    const color = colors.ansi5; colors.ansi5 = "#abcdef"; await dialog.reload();
    assert.ok(changed.released); assert.equal(flatten(render()).find(x => x?.editorState).editorState.options.syntax.keyword, "#abcdef");
    colors.ansi5 = color; current.body = original; dialog.messagesHeight = height; await dialog.reload();
  });
  await test("v5: replies and computed full bodies share fenced rendering and release removed replies", async () => {
    const current = queue.find(d => key(d) === dialog.selected), original = clone(current);
    current.body = "```ts\nconst n = 1;\n```"; current.before = "old";
    current.diff = [{ oldStart: 1, newStart: 1, lines: [{ type: "del", text: "old", old: 1 }] }];
    current.thread.push({ from: "agent", kind: "reply", at: 9, text: "Reply\n```diff\n@@ -7 +8 @@\n-old\n+new\n```\n```sql\nselect 1;\n```" });
    await dialog.reload();
    const nodes = flatten(render()), editors = nodes.filter(x => x?.editorState).map(x => x.editorState);
    assert.ok(nodes.includes("Changes to the current text")); assert.ok(nodes.includes("New text"));
    assert.deepEqual(editors.map(s => s.options.language), ["js", "sql"]);
    assert.ok(nodes.includes("@@ −7 +8 @@"));
    const row = nodes.find(x => x?.styles?.id?.[0]?.endsWith("-diff-0-1") && x.childList[2]?.childList?.[0] === "+");
    assert.deepEqual(row.childList.slice(0, 3).map(x => x.childList[0]), ["", "8", "+"]);
    assert.equal(row.styles.bg[0], colors.done + "1f");
    current.thread = original.thread; await dialog.reload(); assert.ok(editors[1].released);
    delete current.before; delete current.diff; Object.assign(current, original); await dialog.reload();
  });
  await test("dialog: reload preserves selection/draft; new entry scrolls, unchanged reload does not", async () => {
    const selected = dialog.selected, state = dialog.drafts.get(selected), count = dialog.scroll.requests.length;
    await dialog.reload(); assert.equal(dialog.selected, selected); assert.equal(dialog.drafts.get(selected), state);
    assert.equal(dialog.scroll.requests.length, count);
    queue.find(x => key(x) === selected).thread.push({ from: "agent", kind: "reply", text: "Answer\nDetails", at: 10 });
    await dialog.reload(); assert.equal(dialog.scroll.requests.length, count + 1);
    assert.equal(dialog.scroll.requests.at(-1), 2);
    const reply = flatten(render()).find(x => x?.childList?.includes("Answer\nDetails"));
    assert.ok(reply.styles.selectable[0]);
    assert.equal(reply.styles.text_size[0], 12.5);
  });
  await test("dialog: selected deletion falls back and releases removed input", async () => {
    const old = dialog.drafts.get(dialog.selected).input, editor = dialog.editors.get(dialog.selected).editor;
    queue = queue.filter(x => key(x) !== dialog.selected); await dialog.reload();
    assert.ok(old.released); assert.ok(editor.released); assert.equal(dialog.selected, key(dialog.decisions[0]));
  });
  await test("dialog: Ask sends one line before note, clears draft and shows waiting", async () => {
    const current = dialog.decisions.find(x => key(x) === dialog.selected), state = dialog.drafts.get(dialog.selected);
    state.input.set_value("Why?\nAnd this?\u2028More"); calls = [];
    dialog.act(current, "ask", null, cx); assert.ok(state.busy); await drain();
    assert.deepEqual(clone(calls[0]), ["send", "t1", `About decision "${current.title}" (id: ${current.id}), not decided yet: Why? / And this? / More`]);
    assert.deepEqual(clone(calls[1]), ["note", "--terminal", "t1", "--id", current.id, "--text", "Why? / And this? / More"]);
    assert.equal(state.input.value(), ""); assert.ok(!state.busy);
    assert.ok(flatten(render()).includes("Waiting on Agent…"));
  });
  await test("dialog: Cmd-Enter asks through retained textarea submit", async () => {
    const state = dialog.drafts.get(dialog.selected); state.input.set_value("Keyboard ask"); calls = [];
    state.input.events.submit({ secondary: true, shift: false }, cx); await drain();
    assert.equal(calls[0][0], "send"); assert.equal(calls[1][0], "note");
  });
  await test("dialog: plain and Shift-Enter never send; only secondary submit asks", async () => {
    const state = dialog.drafts.get(dialog.selected); state.input.set_value("Two\nlines"); calls = [];
    for (const event of [{}, { secondary: false, shift: false }, { secondary: false, shift: true }, { secondary: true, shift: true }])
      state.input.events.submit(event, cx);
    await drain();
    assert.equal(calls.length, 0);
    assert.equal(state.input.value(), "Two\nlines");
    assert.ok(!flatten(render()).some(x => x?.events?.on_key_down));
    assert.ok(!flatten(render()).some(x => typeof x === "string" && x.includes("Enter adds a line")));
    assert.equal(flatten(render()).find(x => x?.styles?.id?.[0] === `ask-${dialog.selected}`).styles.tooltip[0], "Send what you typed to Agent as a question, without deciding. The decision stays open. (⌘Enter)");
  });
  await test("dialog: editor retains exact updated body, sizes from width and caps to messages height", async () => {
    const current = queue.find(d => key(d) === dialog.selected), state = dialog.editors.get(dialog.selected), editor = state.editor;
    current.body = "  # Raw *text*\n" + "x".repeat(100);
    await dialog.reload();
    assert.equal(dialog.editors.get(dialog.selected).editor, editor);
    assert.equal(editor.value(), current.body);
    click(`body-view-${dialog.selected}-raw`);
    let nodes = flatten(render());
    nodes.find(x => x?.styles?.id?.[0] === "decision-messages").events.on_size_change({ height: 1000 }, cx);
    nodes.find(x => x?.styles?.id?.[0] === `well-${dialog.selected}`).events.on_size_change({ width: 748 }, cx);
    const wide = flatten(render()).find(x => x?.editorState).styles.h[0];
    nodes.find(x => x?.styles?.id?.[0] === `well-${dialog.selected}`).events.on_size_change({ width: 100 }, cx);
    const narrow = flatten(render()).find(x => x?.editorState).styles.h[0];
    assert.ok(narrow > wide);
    nodes.find(x => x?.styles?.id?.[0] === "decision-messages").events.on_size_change({ height: 100 }, cx);
    assert.ok(flatten(render()).find(x => x?.editorState).styles.h[0] + 32 <= 85);
    click(`body-view-${dialog.selected}-preview`);
  });
  await test("dialog: no whole-message Copy; copyText uses a raw shell argument, one-shot feedback and errors", async () => {
    assert.ok(!flatten(render()).some(x => x?.styles?.id?.[0] === `copy-${dialog.selected}`));
    const state = {}, text = 'literal $HOME `code` "quote"\nnext'; execCalls = []; timers = [];
    dialog.copyText(text, state, cx); await drain();
    assert.deepEqual(clone(execCalls[0]), ["sh", ["-c", 'printf %s "$1" | pbcopy', "sh", text]]);
    assert.ok(state.copiedUntil > Date.now()); assert.equal(timers.length, 1); assert.equal(timers[0].ms, 2000);
    for (const mode of ["copy", "copy-throw"]) {
      failure = mode; dialog.copyText(text, state, cx); await drain();
      assert.ok(state.copyError);
    }
    failure = null;
  });
  await test("dialog: failure keeps decision/draft and displays one-line error; busy prevents duplicates", async () => {
    const current = dialog.decisions.find(x => key(x) === dialog.selected), state = dialog.drafts.get(dialog.selected);
    state.input.set_value("Still here"); failure = "send"; calls = [];
    dialog.act(current, "answer", "Yes", cx); dialog.act(current, "answer", "Yes", cx); await drain();
    assert.equal(calls.filter(x => x[0] === "send").length, 1);
    assert.ok(!calls.some(x => x[0] === "resolve")); assert.equal(state.input.value(), "Still here");
    assert.equal(state.error, "send failed"); assert.ok(flatten(render()).includes("send failed"));
    failure = "command"; dialog.act(current, "ask", null, cx); await drain();
    assert.equal(state.error, "write failed"); assert.equal(state.input.value(), "Still here"); failure = null;
  });
  await test("dialog: answer joins multiline note, then archives answered outcome", async () => {
    const current = dialog.decisions.find(x => key(x) === dialog.selected); calls = [];
    dialog.drafts.get(dialog.selected).input.set_value("Still here\r\nSecond\n\nFourth");
    dialog.act(current, "answer", "Yes", cx); await drain();
    assert.equal(calls[0][2], `Decision on "${current.title}" (id: ${current.id}): YES. Note: Still here / Second /  / Fourth`);
    assert.deepEqual(clone(calls[1]), ["resolve", current.id, "--terminal", "t1", "--outcome", "answered", "--option", "Yes", "--note", "Still here / Second /  / Fourth"]);
    assert.ok(!dialog.decisions.some(x => x.id === current.id));
  });
  await test("dialog: gone agent blocks sends, exposes agent gone and permits Dismiss", async () => {
    gone = true; const current = dialog.decisions[0]; calls = [];
    assert.ok(flatten(render()).includes("agent gone"));
    dialog.act(current, "answer", "Yes", cx); await drain(); assert.equal(calls.length, 0);
    dialog.act(current, "dismiss", null, cx); await drain(); assert.deepEqual(clone(calls[0]), ["resolve", current.id, "--terminal", "t1", "--outcome", "dismissed"]);
    gone = false;
  });
  await test("dialog: archive switch, newest tabs, readonly chat, grey dots and outcome", async () => {
    archived.push({ ...d("withdrawn", 1), file: "withdrawn.json", outcome: { kind: "withdrawn", at: 1 } });
    await dialog.reload();
    flatten(render()).find(x => x?.styles?.id?.[0] === "view-archive").events.on_click({}, cx);
    assert.equal(dialog.view, "archive");
    assert.equal(dialog.selected, `archive:${dialog.archive[0].file}`);
    for (const current of dialog.archive) {
      dialog.select(current, cx);
      const nodes = flatten(render());
      assert.ok(!nodes.some(x => String(x?.styles?.id?.[0]).startsWith("composer-")));
      assert.ok(!nodes.includes("Dismiss"));
      assert.ok(nodes.some(x => x?.styles?.selectable && x.childList.includes(current.body)));
      assert.ok(!nodes.some(x => x?.editorState));
      click(`body-view-${dialog.selected}-raw`);
      assert.ok(flatten(render()).some(x => x?.editorState?.value() === current.body));
      click(`body-view-${dialog.selected}-preview`);
      // How it ended (user, 2026-11-20): your answer or dismissal as a bubble of its own; a withdrawal as a centered line.
      const outcome = flatten(nodes.find(x => x?.styles?.id?.[0] === `outcome-${dialog.selected}`)).filter(x => typeof x === "string").join(" ");
      if (current.outcome.kind === "withdrawn") assert.match(outcome, /Agent withdrew it/);
      if (current.outcome.kind === "dismissed") assert.match(outcome, /You dismissed · .*Closed without telling Agent\./);
      if (current.outcome.kind === "answered") assert.match(outcome, /You answered · .*✓ Yes Still here \/ Second/);
      for (const tab of nodes.filter(x => String(x?.styles?.id?.[0]).startsWith("tab-"))) assert.equal(tab.childList[0].styles.bg[0], colors.dim);
    }
    const selected = dialog.selected;
    dialog.switchView("open", cx); dialog.switchView("archive", cx);
    assert.equal(dialog.selected, selected);
    await dialog.reload(); assert.equal(dialog.view, "archive"); assert.equal(dialog.selected, selected);
  });
  await test("v4: archive uses the same stacked diff and read-only Preview/Raw", async () => {
    const current = archived.find(d => `archive:${d.file}` === dialog.selected), original = clone(current);
    current.body = "# Archived new body"; current.before = "old";
    current.diff = [{ oldStart: 1, newStart: 1, lines: [{ type: "del", text: "old", old: 1 }, { type: "add", text: current.body, new: 1 }] }];
    current.diffStats = { added: 1, removed: 1 };
    await dialog.reload();
    const nodes = flatten(render());
    assert.ok(nodes.includes("Changes to the current text")); assert.ok(nodes.includes("New text"));
    assert.ok(nodes.some(x => x?.styles?.selectable && x.childList.includes(current.body)));
    assert.ok(!nodes.some(x => String(x?.styles?.id?.[0]).startsWith("composer-")));
    click(`body-view-${dialog.selected}-raw`);
    assert.equal(flatten(render()).find(x => x?.editorState).editorState.options.readonly, true);
    const selected = dialog.selected;
    dialog.switchView("open", cx); dialog.switchView("archive", cx);
    assert.equal(dialog.selected, selected); assert.ok(flatten(render()).some(x => x?.editorState));
    click(`body-view-${dialog.selected}-preview`);
    delete current.before; delete current.diff; delete current.diffStats; Object.assign(current, original);
    await dialog.reload();
  });
  await test("dialog: remove one archive, clear confirm/cancel, failure and clear all", async () => {
    const old = dialog.editors.get(dialog.selected).editor, current = dialog.items().find(d => `archive:${d.file}` === dialog.selected);
    calls = []; dialog.archiveAction(["remove", current.file], cx); await drain();
    assert.deepEqual(clone(calls[0]), ["archive", "remove", current.file]); assert.ok(old.released);
    assert.equal(dialog.archive.length, 2);
    const click = id => flatten(render()).find(x => x?.styles?.id?.[0] === id).events.on_click({}, cx);
    calls = []; click("clear-archive");
    assert.ok(flatten(render()).includes("Clear all?"));
    assert.equal(flatten(render()).find(x => x?.styles?.id?.[0] === "clear-archive-count").childList[0], "2"); assert.equal(calls.length, 0);
    click("cancel-clear"); assert.ok(!dialog.clearConfirm); assert.equal(calls.length, 0);
    click("clear-archive"); failure = "command"; click("confirm-clear"); await drain();
    assert.equal(dialog.archive.length, 2); assert.ok(flatten(render()).includes("write failed"));
    failure = null; click("confirm-clear"); await drain();
    assert.equal(dialog.archive.length, 0); assert.ok(flatten(render()).includes("Nothing archived yet."));
    assert.ok(!calls.some(x => x[0] === "send"));
    dialog.switchView("open", cx);
  });
  await test("board: first load silent; only waiting-on-you counted", async () => {
    const board = new Board(); board.decisionSeen = new Map(); sandbox.board = board;
    queue = [d("ready", 1), d("asked", 2, "agent")]; notices = [];
    await board.loadDecisions(); assert.equal(notices.length, 0);
    assert.equal(sharedState.get("veroboard.decisionCount"), 1);
    assert.equal(sharedState.get("veroboard.decisionCounts").t1, 1);
  });
  await test("board: new/reply/update notify once; asks never notify", async () => {
    const board = sandbox.board;
    queue.push(d("fresh", 3)); await board.loadDecisions();
    assert.equal(notices.at(-1).title, "Agent needs a decision");
    assert.equal(notices.at(-1).body, "fresh · Title fresh");
    const current = queue[2]; current.thread.push({ from: "you", kind: "ask", text: "Question", at: 4 }); current.waiting = "agent";
    await board.loadDecisions(); assert.equal(notices.length, 1); assert.equal(sharedState.get("veroboard.decisionCount"), 1);
    current.thread.push({ from: "agent", kind: "reply", text: "Reply", at: 5 }); current.waiting = "you";
    await board.loadDecisions(); assert.equal(notices.at(-1).title, "Agent replied");
    await board.loadDecisions(); assert.equal(notices.length, 2);
    current.thread.push({ from: "agent", kind: "update", text: "Updated the proposal", at: 5 });
    await board.loadDecisions(); assert.equal(notices.at(-1).title, "Agent updated a decision");
    assert.equal(notices.at(-1).icon, "mods/veroboard/question.svg");
    assert.equal(notices.at(-1).action.args.terminal, "t1");
    const again = clone(current); queue.pop(); await board.loadDecisions(); queue.push(again); await board.loadDecisions();
    assert.equal(notices.at(-1).title, "Agent needs a decision");
  });
  await test("board: archived additions never count or notify", async () => {
    const board = sandbox.board, count = sharedState.get("veroboard.decisionCount"), total = notices.length;
    archived.push({ ...d("archive-only", 123), file: "archive-only.json", outcome: { kind: "withdrawn", at: Date.now() } });
    await board.loadDecisions();
    assert.equal(sharedState.get("veroboard.decisionCount"), count); assert.equal(notices.length, total);
    queue.pop(); await board.loadDecisions();
    assert.equal(sharedState.get("veroboard.decisionCount"), count - 1); assert.equal(notices.length, total);
  });
  await test("board: a decision waiting on you keeps an idle agent in Blocked; Working, Waiting, off and dismissed don't", () => {
    const board = sandbox.board, saved = ["veroboard.decisionSince", "veroboard.decisionCounts", "veroboard.dismissed", "veroboard.blocked"].map(k => [k, sharedState.get(k)]);
    sandbox.VIEW.decisionBlocks = undefined; board.sessions = {}; board.subs = {};
    sharedState.set("veroboard.blocked", {}); sharedState.set("veroboard.dismissed", {});
    sharedState.set("veroboard.decisionSince", { t1: 100 }); sharedState.set("veroboard.decisionCounts", { t1: 2 });
    const idle = { address: "t1", status: "idle" };
    assert.equal(board.column(idle), "blocked");
    const why = board.blockReason(idle);
    assert.equal(why.label, "Decision"); assert.equal(why.at, 100); assert.ok(why.tip.includes("2 decisions"));
    assert.equal(board.column({ address: "t1", status: "working" }), "working");
    board.sessions = { t1: { monitorList: [{ expiresAt: Date.now() + 60000 }] } };
    assert.equal(board.column(idle), "waiting"); board.sessions = {};
    sharedState.set("veroboard.decisionSince", {}); assert.equal(board.column(idle), "done");
    sharedState.set("veroboard.decisionSince", { t1: 100 });
    sandbox.VIEW.decisionBlocks = false; assert.equal(board.column(idle), "done"); assert.equal(board.blockReason(idle), null);
    sandbox.VIEW.decisionBlocks = undefined;
    sharedState.set("veroboard.dismissed", { t1: { at: Date.now() } }); assert.equal(board.column(idle), "done");
    for (const [k, v] of saved) sharedState.set(k, v);
  });
  await test("settings: toast off, sound on (once per batch), newest-first tab order", async () => {
    const board = sandbox.board, total = notices.length, before = queue.length;
    sandbox.VIEW.decisionToast = false; sandbox.VIEW.decisionSound = true; sounds.length = 0;
    queue.push(d("quiet-1", 900), d("quiet-2", 901)); await board.loadDecisions();
    assert.equal(notices.length, total); assert.deepEqual(clone(sounds), ["blocked"]);
    sandbox.VIEW.decisionToast = undefined; sandbox.VIEW.decisionSound = undefined; sounds.length = 0;
    queue.push(d("loud", 902)); await board.loadDecisions();
    assert.equal(notices.length, total + 1); assert.equal(sounds.length, 0);
    queue.splice(before); await board.loadDecisions();
    dialog.decisions = [d("a", 1), d("b", 2), d("c", 3, "agent")];
    sharedState.set("veroboard.decisionOrder", "newest");
    assert.deepEqual(clone(dialog.items().map(x => x.id)), ["b", "a", "c"]);
    sharedState.set("veroboard.decisionOrder", "oldest");
    assert.deepEqual(clone(dialog.items().map(x => x.id)), ["a", "b", "c"]);
    await dialog.reload();
  });
  await test("menu: a dialog opened on one decision starts on it and takes the request", async () => {
    const want = key(queue[queue.length - 1]);
    sharedState.set("veroboard.decisionFocus", want);
    sandbox.checking = () => false;
    const other = new Decisions();
    try { other.init(null, { ...cx, timer: { every() {} }, spawn() {} }); } finally { sandbox.checking = () => true; }
    assert.equal(other.selected, want); assert.equal(sharedState.get("veroboard.decisionFocus"), null);
    other.decisions = clone(queue); other.revealTab(other.decisions.find(x => key(x) === want));
    assert.equal(other.pendingReveal, want, "unmeasured tabs: reveal waits for their widths");
  });
  await test("updates: ▾ on 'updated the proposal' shows the diff from the version before", async () => {
    const current = queue.find(x => key(x) === dialog.selected), saved = clone(current.thread);
    current.thread = [...current.thread, { from: "agent", kind: "update", text: "Updated the proposal", at: 4242,
      diff: [{ oldStart: 1, newStart: 1, lines: [{ type: "del", text: "old line", old: 1 }, { type: "add", text: "new line", new: 1 }] }],
      diffStats: { added: 1, removed: 1 } }];
    await dialog.reload();
    const n = current.thread.length - 1, uid = `update-${dialog.selected}-4242-${n}`;
    let nodes = flatten(render());
    assert.ok(nodes.some(x => x?.styles?.id?.[0] === `${uid}-toggle`)); assert.ok(!nodes.includes("new line"));
    click(`${uid}-toggle`); nodes = flatten(render());
    assert.ok(nodes.includes("new line") && nodes.includes("old line"));
    click(`${uid}-toggle`); assert.ok(!flatten(render()).includes("new line"));
    // Same diff as the top one: shown once, behind the update's ▾.
    current.diff = current.thread.at(-1).diff; await dialog.reload();
    assert.ok(!flatten(render()).includes("Changes to the current text"));
    delete current.diff;
    current.thread = saved; await dialog.reload();
  });
  await test("dialog: close releases all retained editor and textarea states", async () => {
    await dialog.reload();
    const states = [...dialog.editors.values(), ...dialog.blocks.values()].map(s => s.editor).concat([...dialog.drafts.values()].map(s => s.input));
    await dialog.close();
    assert.ok(states.every(s => s.released));
  });
  console.log(`${passed} cases passed; all Herdr calls mocked, no sends or native layout checks.`);
})().catch(e => { console.error(e); process.exitCode = 1; });

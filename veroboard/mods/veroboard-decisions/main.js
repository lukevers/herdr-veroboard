import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea, ScrollHandle, TextView, EditorState, Editor } from "gpui-base";
import { agents, terminals, props, closeOverlay, shared, setShared, theme, run, exec, hc, home, appHome, readTextFile, watchFolder, checking } from "herdr";

// Same surfaces and badge helpers as the bell's list; mods can only import their own files.
const alpha = (hex, aa) => /^#[0-9a-fA-F]{6}$/.test(hex) ? hex + aa : hex;
const mix = (a, b, f) => {
  const h = x => /^#[0-9a-fA-F]{6}/.test(x) ? [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)) : null;
  const [p, q] = [h(a), h(b)];

  return p && q ? "#" + p.map((v, i) => Math.round(v + (q[i] - v) * f).toString(16).padStart(2, "0")).join("") : a;
};
const headBg = t => mix(mix(t.popover, t.canvas ?? "#000000", 0.5), t.accent, 0.04);
const bodyBg = t => mix(t.popover, t.raised ?? t.popover, 0.3);
const ago = ms => ms < 60000 ? "<1m" : ms < 3600000 ? `${Math.floor(ms / 60000)}m` : `${Math.floor(ms / 3600000)}h`;
const keyOf = d => d.file ? `archive:${d.file}` : JSON.stringify([d.terminal, d.id]);
const joined = text => String(text).replace(/\r\n|[\r\n\u2028\u2029]/g, " / ");
const oneLine = text => String(text).replace(/[\r\n\u2028\u2029]+/g, " ");
const live = terminal => agents().some(a => a.address === terminal) && terminals().some(t => t.address === terminal && t.state === "live");
const pill = (t, text, color = t.muted) => h_flex().h(18).px(8).gap(8).flex_none().items_center().rounded(5)
  .bg(alpha(color, "26")).text_color(color).text_size(11).child(text);
// `solid`: a badge on a tinted segment of that color is filled with it, dark text on top, so it stays readable (user,
// 2026-11-20: pink on the selected purple was hard to read).
const badge = (id, count, t, waiting = false, solid = null) => h_flex().id(id).h(16).min_w(16).px(5).rounded(8)
  .flex_none().items_center().justify_center().text_size(10).font_semibold()
  .bg(solid ?? (waiting ? alpha(t.blocked, "33") : t.raised)).text_color(solid ? (t.canvas ?? "#000000") : waiting ? t.blocked : t.muted)
  .child(String(count));
// Match settings' choice group so both levels of navigation feel familiar (user, 2026-11-20).
const segmented = (id, items, current, onPick, t) => h_flex().id(id).flex_none().p(2).gap(2).rounded(7)
  .bg(t.background).border(1).border_color(t.border).children(items.map(item => {
    // `item.color` tints a segment its own way when selected, else the accent (user, 2026-11-20): Open in the top bar's Decisions
    // pink (things still to do), Archive in the idle grey (done with).
    const active = item.value === current, c = item.color ?? t.accent;

    return h_flex().id(`${id}-${item.value}`).h(item.height ?? 24).px(12).gap(8).items_center().rounded(5)
      .cursor_pointer().text_size(11.5).border(1).border_color(active ? alpha(c, "55") : "#00000000")
      .when(active, el => el.bg(alpha(c, "26")).text_color(c))
      .when(!active, el => el.text_color(t.muted).hover(s => s.bg(alpha(c, "14")).text_color(t.foreground)))
      .when(Boolean(item.tip), el => el.tooltip(item.tip))
      .on_click((_e, cx) => { if (!active) onPick(item.value, cx); }).child(item.label)
      .when(item.count > 0, el => el.child(badge(`${id}-${item.value}-count`, item.count, t, item.waiting, active && item.color ? c : null)));
  }));
const unifiedHunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@.*$/;
const syntaxKeys = ["keyword", "string", "comment", "function", "type", "number", "constant", "variable",
  "operator", "punctuation", "boolean", "string.escape"];
// The editor's highlighter takes file-extension names, as Herdr's Files mod passes them (ts, tsx, jsx, mjs → js; toml → yaml;
// jsonc → json). Agents write fence tags, sometimes full names (```typescript), so map those too (2026-11-20).
const LANGUAGES = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", javascript: "js", typescript: "js",
  toml: "yaml", yml: "yaml", jsonc: "json", svelte: "html", vue: "html", python: "py", rust: "rs", ruby: "rb", golang: "go",
  shell: "sh", bash: "sh", zsh: "sh", markdown: "md" };
const editorLanguage = (tag) => LANGUAGES[(tag || "").toLowerCase()] ?? ((tag || "").toLowerCase() || "text");
const syntaxOf = (t, language) => ({ ...Object.fromEntries(syntaxKeys.map(k => [k, t.foreground])),
  ...(language ? { keyword: t.ansi5, string: t.ansi2, comment: t.dim, number: t.ansi3, function: t.ansi4, type: t.ansi6 } : {}) });
const blockKey = (d, source, i) => JSON.stringify([keyOf(d), source, i]);

// Unified diffs as agents and git write them (user, 2026-11-20: one with bare `@@` lines and blank context lines rendered
// as plain code): `diff --git`/`index` lines are skipped, a `--- a/x` + `+++ b/x` pair names the file of the hunks after it,
// a numbered `@@ -a,b +c,d @@` sets the line numbers, a bare `@@` starts a hunk without numbers (lines before any `@@`
// count from 1), an empty line is context.
function unifiedDiff(text) {
  const lines = text.split(/\r\n|\n|\r/), hunks = [];
  let hunk = null, old = 1, next = 1, numbered = true, file = null;
  const open = (start) => { hunk = { oldStart: start?.[0] ?? null, newStart: start?.[1] ?? null, ...(file ? { file } : {}), lines: [] }; hunks.push(hunk); file = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^(?:diff --git |index [0-9a-f]+\.\.|new file mode |deleted file mode |similarity index |rename (?:from|to) )/.test(line)) continue;
    if (/^--- /.test(line) && /^\+\+\+ /.test(lines[i + 1] ?? "")) {
      file = lines[i + 1].slice(4).replace(/^b\//, "").trim(); hunk = null; old = next = 1; numbered = true; i++; continue;
    }
    const header = line.match(unifiedHunk);
    if (header) { old = Number(header[1]); next = Number(header[2]); numbered = true; open([old, next]); continue; }
    if (/^@@(?:\s.*)?$/.test(line)) { numbered = false; open(null); continue; }
    if (line === "\\ No newline at end of file") continue;
    const type = line.startsWith("-") ? "del" : line.startsWith("+") ? "add" : line.startsWith(" ") || line === "" ? "ctx" : null;
    if (!type) return null;
    if (!hunk) open(numbered ? [old, next] : null);
    hunk.lines.push({ type, text: line.slice(1),
      ...(numbered && type !== "add" ? { old: old++ } : {}), ...(numbered && type !== "del" ? { new: next++ } : {}) });
  }
  // A trailing blank line is the fence's, not the diff's.
  for (const h of hunks) while (h.lines.length && h.lines.at(-1).type === "ctx" && h.lines.at(-1).text === "" && h === hunks.at(-1)) h.lines.pop();

  return hunks.length && hunks.every(h => h.lines.length) && hunks.some(h => h.lines.some(l => l.type !== "ctx")) ? hunks : null;
}

// Only closed fences become native blocks; unfinished fences stay readable markdown (user, 2026-11-20).
function markdownParts(body) {
  const lines = body.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g).filter(Boolean), parts = [];
  const bare = line => line.replace(/(?:\r\n|\r|\n)$/, "");
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const fence = bare(lines[i]).match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence || fence[1][0] === "`" && fence[2].includes("`")) continue;
    const close = new RegExp(`^ {0,3}${fence[1][0]}{${fence[1].length},}\\s*$`);
    let end = i + 1;
    while (end < lines.length && !close.test(bare(lines[end]))) end++;
    if (end === lines.length) break;
    const prose = lines.slice(start, i).join("");
    if (prose.trim()) parts.push({ kind: "text", text: prose });
    const text = bare(lines.slice(i + 1, end).join("")), language = fence[2].trim().split(/\s+/)[0];
    const hunks = language === "diff" ? unifiedDiff(text) : null;
    parts.push({ kind: hunks ? "diff" : "code", text, language, ...(hunks ? { hunks } : {}) });
    i = end; start = end + 1;
  }
  const text = lines.slice(start).join("");
  if (text.trim() || !parts.length) parts.push({ kind: "text", text });

  return parts;
}

// A `---` rule (or *** / ___) splits text into separate sections, each drawn on its own (user, 2026-11-20: "split those
// into different sections … more clear messaging rather than a big one"). Only a rule after a blank line (or at the
// top) counts: "Title\n---" is a heading in markdown. Rules inside fenced code don't count.
function ruleSections(text) {
  const lines = String(text).split(/\r\n|\r|\n/), out = [[]];
  let fence = null;
  lines.forEach((line, i) => {
    const f = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null; }
    else if (f) fence = f[1];
    else if (/^ {0,3}([-*_])( *\1){2,} *$/.test(line) && (i === 0 || !lines[i - 1].trim())) { out.push([]); return; }
    out.at(-1).push(line);
  });
  if (out.length === 1) return [String(text)];
  // Blank lines around a rule belong to neither side.
  const sections = out.map(l => l.join("\n").replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "")).filter(x => x.trim());
  return sections.length ? sections : [String(text)];
}

// The top diff is skipped when an update already carries the same one (its earlier proposal was the live text), so it
// shows once, behind that update's ▾ (user, 2026-11-20: "it's in both places still").
const topDiff = d => d.diff?.length && !d.thread.some(x => x.kind === "update" && x.diff && JSON.stringify(x.diff) === JSON.stringify(d.diff)) ? d.diff : null;
const sectionsOf = d => [...(topDiff(d) ? [{ kind: "diff", title: "Changes to the current text", hunks: d.diff }] : []),
  { kind: "body", title: topDiff(d) ? "New text" : "Proposal", text: d.body }];
// The first answer is filled, other answers and Ask outlined, navigation quiet (user, 2026-11-20).
// One box for every button (user, 2026-11-20: "Post" and "Skip" weren't the same size; Go to agent and Dismiss didn't look
// like buttons): 28px tall, 12px sides, a 1px border, the same text weight. The first answer is filled with the accent;
// the rest are outlined on the raised color. `small` (22px) is for controls inside a block (a code block's Copy). `tip` is
// the hover description of what a click does (shown after the usual tooltip delay).
const button = (id, label, t, action, disabled = false, primary = false, tip = "", small = false) => h_flex().id(id)
  .h(small ? 22 : 28).px(small ? 8 : 12).flex_none().items_center().justify_center().rounded(6).text_size(small ? 11 : 12).border(1)
  .when(primary, el => el.bg(t.accent).border_color(t.accent).text_color(t.accent_foreground ?? t.canvas))
  // The outline is lighter than the raised fill, so its outer edge shows: a dark one blended into the strip and the button
  // read 2px smaller than the filled one beside it (user, 2026-11-20).
  .when(!primary, el => el.bg(t.raised).border_color(mix(t.raised, t.foreground, 0.14)).text_color(t.foreground))
  .opacity(disabled ? 0.45 : 1)
  .when(Boolean(tip), el => el.tooltip(tip))
  .when(!disabled, el => el.cursor_pointer().hover(s => primary ? s.opacity(0.85) : s.bg(alpha(t.accent, "26")).border_color(alpha(t.accent, "55"))))
  .on_click((_e, cx) => { cx.stop_propagation(); if (!disabled) action(cx); }).child(label);

// Markdown prose, one view per blank-line block, our own 8px apart (user, 2026-11-20: the markdown view's paragraph spacing
// was too large, and it has no setting for it). A heading gets 6px more above it. A single block keeps the plain id.
const prose = (text, id, t) => {
  const view = (md, vid) => TextView.markdown(vid, md).selectable(true)
    .w_full().min_w(0).flex_none().text_size(12.5).line_height("19px").text_color(t.foreground);
  const blocks = text.split(/\n[ \t]*\n/).filter(b => b.trim());
  if (blocks.length <= 1) return view(text, id);
  return v_flex().w_full().min_w(0).flex_none().gap(8)
    .children(blocks.map((b, j) => view(b, `${id}-p${j}`).when(j > 0 && /^ {0,3}#{1,6}\s/.test(b), el => el.mt(6))));
};

export default class Decisions extends View {
  init(_p, cx) {
    this.decisions = [];
    this.archive = [];
    this.view = "open";
    this.selections = {};
    this.editors = new Map();
    this.blocks = new Map();
    this.messagesHeight = 400;
    this.drafts = new Map();
    // Opened from a card's right-click menu on one decision (shared "veroboard.decisionFocus"; user, 2026-11-20): start on
    // it, in Open, and take the request so the next opening starts as usual.
    const focus = checking() ? null : shared("veroboard.decisionFocus");
    this.selected = typeof focus === "string" ? focus : null;
    if (focus) setShared("veroboard.decisionFocus", null);
    this.scroll = ScrollHandle.new();
    // The tab row scrolls by our own offset (user, 2026-11-20: many tabs were cut off; a native x-scroll only answered
    // sideways trackpad swipes, not a mouse wheel). Each tab's width is measured to reveal the selected one.
    this.tabOff = 0; this.tabW = {}; this.tabsOuterW = 0; this.tabsInnerW = 0;
    this.focus = cx.focus_handle();
    if (checking()) return;
    cx.timer.every(30000, cx => cx.spawn(async cx => { await this.reload(); cx.notify(); }));
    cx.spawn(async cx => {
      await this.reload();
      cx.notify();
      for (;;) {
        try { await watchFolder(`${home()}/.config/veroboard/state/decisions`); }
        catch { await cx.sleep(5000); }
        await this.reload();
        cx.notify();
      }
    });
  }

  async close() {
    for (const s of this.drafts.values()) s.input.release();
    for (const s of [...this.editors.values(), ...this.blocks.values()]) s.editor.release();
    this.scroll.release();
    this.focus.release();
  }

  async command(args) {
    const node = await readTextFile(`${home()}/.config/veroboard/state/node-path`).then(x => x?.trim(), () => "node");
    const r = await exec(node || "node", [`${appHome()}/mods/veroboard/agent/core/decide.js`, ...args], { timeout: 10000 });
    if (r.code !== 0) throw new Error(r.stderr.trim() || `decide.js exited ${r.code}`);

    return r.stdout;
  }

  async reload() {
    if (this.loading) { this.reloadAgain = true; return; }
    this.loading = true;
    try {
      do {
        this.reloadAgain = false;
        const before = this.items().find(d => keyOf(d) === this.selected);
        this.decisions = JSON.parse(await this.command(["list", "--all"]))
          .sort((a, b) => Number(a.waiting !== "you") - Number(b.waiting !== "you") || a.at - b.at);
        this.archive = JSON.parse(await this.command(["archive", "list", "--all"])).sort((a, b) => b.outcome.at - a.outcome.at);
        this.error = null;
        const keys = new Set(this.decisions.map(keyOf));
        for (const [key, s] of this.drafts) if (!keys.has(key) && !s.busy) { s.input.release(); this.drafts.delete(key); }
        // Retained inputs must be made in a task, never render; each tab keeps its draft (user, 2026-11-20).
        for (const d of this.decisions) {
          const key = keyOf(d);
          if (this.drafts.has(key)) continue;
          const input = TextareaState.new({ placeholder: "Ask a question, or add a note to your answer…", rows: 2 });
          input.on("change", (_e, cx) => cx.notify());
          // The multiline input owns newlines; only its secondary submit asks (user, 2026-11-20).
          input.on("submit", (e, cx) => {
            const current = this.decisions.find(x => keyOf(x) === key);
            if (this.view === "open" && current && e.secondary && !e.shift) this.act(current, "ask", null, cx);
          });
          this.drafts.set(key, { input });
        }
        const entries = [...this.decisions, ...this.archive], editorKeys = new Set(entries.map(keyOf));
        for (const [key, s] of this.editors) if (!editorKeys.has(key)) { s.editor.release(); this.editors.delete(key); }
        const blockKeys = new Set(), t = theme();
        for (const d of entries) {
          const key = keyOf(d), s = this.editors.get(key);
          if (s) { if (s.editor.value() !== d.body) s.editor.set_value(d.body); }
          else this.editors.set(key, { editor: EditorState.new({ value: d.body, language: "text", readonly: true, line_numbers: false,
            folding: false, soft_wrap: true, font_family: "JetBrains Mono", font_size: 12, syntax: syntaxOf(t, "") }), width: 500, view: "preview" });
          // Native editor states belong to tasks, and must track removed or changed fences (user, 2026-11-20).
          const sources = [...ruleSections(d.body).map((text, c) => [`body:${c}`, text]),
            ...d.thread.flatMap((entry, i) => ruleSections(entry.kind === "update" ? "" : entry.text).map((text, c) => [`${i}:${c}`, text]))];
          for (const [source, text] of sources) markdownParts(text).forEach((part, i) => {
            if (part.kind !== "code") return;
            const id = blockKey(d, source, i), previous = this.blocks.get(id);
            const options = { language: editorLanguage(part.language), readonly: true, line_numbers: part.text.split(/\r\n|\n|\r/).length > 12,
              folding: false, soft_wrap: true, font_family: "JetBrains Mono", font_size: 12, syntax: syntaxOf(t, part.language) };
            const signature = JSON.stringify(options);
            blockKeys.add(id);
            if (previous?.signature === signature) {
              if (previous.editor.value() !== part.text) previous.editor.set_value(part.text);
              return;
            }
            previous?.editor.release();
            this.blocks.set(id, { editor: EditorState.new({ ...options, value: part.text }), signature, editorLineNumbers: options.line_numbers, width: previous?.width ?? 500 });
          });
        }
        for (const [key, s] of this.blocks) if (!blockKeys.has(key)) { s.editor.release(); this.blocks.delete(key); }
        if (!this.items().some(d => keyOf(d) === this.selected)) this.selected = this.items()[0] ? keyOf(this.items()[0]) : null;
        const current = this.items().find(d => keyOf(d) === this.selected);
        if (current && (!before || keyOf(before) !== this.selected || JSON.stringify(before.thread) !== JSON.stringify(current.thread))) this.scrollLatest(current);
        if (current) this.revealTab(current);
      } while (this.reloadAgain);
    } catch (e) { this.error = oneLine(e.message ?? e); }
    finally { this.loading = false; }
  }

  // Open: waiting on you first, then by when asked, oldest or newest first (Veroboard settings → Decisions; user, 2026-11-20).
  items() {
    if (this.view === "archive") return this.archive;
    const newest = shared("veroboard.decisionOrder") === "newest";
    return [...this.decisions].sort((a, b) => Number(a.waiting !== "you") - Number(b.waiting !== "you") || (newest ? b.at - a.at : a.at - b.at));
  }

  switchView(view, cx) {
    this.selections[this.view] = this.selected;
    this.view = view;
    this.clearConfirm = false;
    this.selected = this.selections[view];
    const d = this.items().find(d => keyOf(d) === this.selected) ?? this.items()[0];
    if (d) this.select(d, cx);
    else { this.selected = null; cx.notify(); }
  }

  copyText(text, s, cx) {
    if (s.copying) return;
    s.copying = true;
    cx.spawn(async cx => {
      try {
        const r = await exec("sh", ["-c", 'printf %s "$1" | pbcopy', "sh", text]);
        if (r.code !== 0) throw new Error("Copy failed");
        s.copiedUntil = Date.now() + 2000;
        s.copyError = false;
        cx.timer.after(2000, cx => cx.notify());
      } catch { s.copyError = true; s.copiedUntil = 0; }
      finally { s.copying = false; cx.notify(); }
    });
  }

  archiveAction(args, cx) {
    if (this.archiveBusy) return;
    this.archiveBusy = true;
    cx.notify();
    cx.spawn(async cx => {
      let error = null;
      try { await this.command(["archive", ...args]); this.clearConfirm = false; }
      catch (e) { error = oneLine(e.message ?? e); }
      finally {
        await this.reload();
        if (error) this.error = error;
        this.archiveBusy = false;
        cx.notify();
      }
    });
  }

  scrollLatest(d) {
    // The last direct child is a small end marker: even a reply taller than the viewport scrolls to its end.
    this.scroll.scroll_to_item(d.thread.length + 1 + Number(Boolean(d.outcome) || d.waiting === "agent"));
  }

  select(d, cx) {
    this.selected = keyOf(d);
    this.scrollLatest(d);
    this.revealTab(d);
    cx.notify();
  }

  act(d, kind, option, cx) {
    const s = this.drafts.get(keyOf(d));
    if (!s || s.busy || (kind !== "dismiss" && !live(d.terminal))) return;
    const note = joined(s.input.value().trim());
    if (kind === "ask" && !note) return;
    s.busy = true;
    s.error = null;
    cx.notify();
    cx.spawn(async cx => {
      try {
        if (kind !== "dismiss") {
          const message = kind === "ask" ? `About decision "${d.title}" (id: ${d.id}), not decided yet: ${note}`
            : `Decision on "${d.title}" (id: ${d.id}): ${option.toUpperCase()}.${note ? ` Note: ${note}` : ""}`;
          const r = await hc(["send", d.terminal, joined(message)]);
          if (r.code !== 0) throw new Error(r.stderr.trim() || `hc send exited ${r.code}`);
        }
        await this.command(kind === "ask" ? ["note", "--terminal", d.terminal, "--id", d.id, "--text", note]
          : ["resolve", d.id, "--terminal", d.terminal, "--outcome", kind === "answer" ? "answered" : "dismissed",
            ...(kind === "answer" ? ["--option", option, ...(note ? ["--note", note] : [])] : [])]);
        s.input.set_value("");
      } catch (e) { s.error = oneLine(e.message ?? e); }
      finally {
        s.busy = false;
        await this.reload();
        cx.notify();
      }
    });
  }

  tabMax() { return Math.max(0, this.tabsInnerW - this.tabsOuterW); }
  scrollTabs(by) { this.tabOff = Math.min(this.tabMax(), Math.max(0, this.tabOff + by)); }
  // Bring a tab fully into view, 28px clear of the edge arrows. Unmeasured tabs (first frame) are left alone.
  revealTab(d) {
    const items = this.items(), i = items.findIndex(x => keyOf(x) === keyOf(d));
    // Not measured yet (the first frames): try again once the tabs have their widths.
    if (i < 0 || !this.tabsOuterW || items.slice(0, i + 1).some(x => !this.tabW[keyOf(x)])) { if (i >= 0) this.pendingReveal = keyOf(d); return; }
    this.pendingReveal = null;
    const left = 16 + items.slice(0, i).reduce((n, x) => n + this.tabW[keyOf(x)] + 2, 0), right = left + this.tabW[keyOf(d)];
    if (left - 28 < this.tabOff) this.tabOff = left - 28;
    else if (right + 28 > this.tabOff + this.tabsOuterW) this.tabOff = right + 28 - this.tabsOuterW;
    this.scrollTabs(0);
  }

  tabs(t) {
    const max = this.tabMax(), off = Math.min(this.tabOff, max);
    const arrow = (side, label, by) => h_flex().id(`decision-tabs-${side}`).absolute().top(0).h(34).w(28).items_center().justify_center()
      .when(side === "left", el => el.left(0).border_r(1)).when(side === "right", el => el.right(0).border_l(1))
      .border_color(alpha(t.accent, "26")).bg(t.head).text_size(14).text_color(t.muted).cursor_pointer()
      .hover(s => s.text_color(t.foreground).bg(alpha(t.accent, "1a")))
      .tooltip(side === "left" ? "Show earlier tabs" : "Show more tabs")
      .on_click((_e, cx) => { this.scrollTabs(by); cx.notify(); }).child(label);

    return div().id("decision-tabs").relative().h(34).w_full().min_w(0).flex_none().overflow_hidden()
      .on_size_change((size, cx) => {
        if (!(size.width > 0) || size.width === this.tabsOuterW) return;
        this.tabsOuterW = size.width; this.scrollTabs(0);
        const want = this.pendingReveal && this.items().find(x => keyOf(x) === this.pendingReveal);
        if (want) this.revealTab(want);
        cx.notify();
      })
      // A mouse wheel scrolls it too: vertical wheel movement becomes sideways.
      .on_scroll_wheel((e, cx) => {
        if (!max) return;
        const d = Math.abs(e.delta.x) > Math.abs(e.delta.y) ? e.delta.x : e.delta.y;
        const before = this.tabOff;
        this.scrollTabs(-d);
        if (this.tabOff !== before) { cx.stop_propagation(); cx.notify(); }
      })
      .child(h_flex().id("decision-tabs-row").absolute().top(0).left(-off).h(34).px(16).gap(2).items_end().flex_nowrap()
        .on_size_change((size, cx) => { if (size.width > 0 && size.width !== this.tabsInnerW) { this.tabsInnerW = size.width; this.scrollTabs(0); cx.notify(); } })
        .children(this.items().map(d => {
          const key = keyOf(d), active = this.selected === key;

          return h_flex().id(`tab-${key}`).h(34).px(12).gap(8).flex_none().items_center().cursor_pointer()
            .border_b(2).border_color(active ? t.accent : "#00000000")
            .text_size(12.5).text_color(active ? t.foreground : t.muted).when(active, el => el.font_semibold())
            .hover(s => s.text_color(t.foreground)).on_click((_e, cx) => this.select(d, cx))
            .tooltip(`${d.title} — ${agents().find(a => a.address === d.terminal)?.tab_name || d.terminal} (${d.terminal})`)
            .on_size_change((size, cx) => {
              if (!(size.width > 0) || this.tabW[key] === size.width) return;
              this.tabW[key] = size.width;
              const want = this.pendingReveal && this.items().find(x => keyOf(x) === this.pendingReveal);
              if (want) this.revealTab(want);
              cx.notify();
            })
            .child(div().size(6).flex_none().rounded(5).bg(d.outcome ? t.dim : d.waiting === "you" ? t.blocked : t.dim))
            .child(div().whitespace_nowrap().when(/[A-Z][A-Z0-9]+-\d+|#\d+/.test(d.short), el => el.font_family("JetBrains Mono")).child(d.short))
            .child(div().text_size(10.5).text_color(t.dim).whitespace_nowrap().child(d.terminal));
        })))
      .when(off > 0, el => el.child(arrow("left", "‹", -240)))
      .when(off < max, el => el.child(arrow("right", "›", 240)));
  }

  diffViewer(id, hunks, t) {
    return v_flex().id(id).w_full().min_w(0).flex_none().py(8).rounded(6).bg(t.well).overflow_hidden()
      .children(hunks.flatMap((hunk, h) => [
        div().id(`${id}-hunk-${h}`).px(12).py(8).text_size(11).font_family("JetBrains Mono").text_color(t.dim)
          .child([hunk.file, hunk.oldStart != null ? `@@ −${hunk.oldStart} +${hunk.newStart} @@` : hunk.file ? "" : "⋯"].filter(Boolean).join("  ")),
        ...hunk.lines.map((line, i) => {
          const color = line.type === "add" ? t.done : line.type === "del" ? t.blocked : t.dim;
          const gutter = (side, value) => div().id(`${id}-${h}-${i}-${side}`).w(32).flex_none().text_right()
            .text_color(color).child(value === undefined ? "" : String(value));

          return h_flex().id(`${id}-${h}-${i}`).w_full().min_w(0).flex_none().items_start().gap(8).px(8)
            .font_family("JetBrains Mono").text_size(12).line_height("19px")
            .when(line.type !== "ctx", el => el.bg(alpha(color, "1f")))
            .child(gutter("old", line.old)).child(gutter("new", line.new))
            .child(div().w(12).flex_none().text_color(color).child(line.type === "add" ? "+" : line.type === "del" ? "−" : " "))
            .child(div().flex_1().min_w(0).whitespace_normal().text_color(t.foreground).child(line.text || " "));
        }),
      ]));
  }

  // Leave wrap slack for native glyph metrics (word wrap breaks early; a wrapped line keeps its indent). `cap`: stop at 85%
  // of the chat and scroll inside (the Raw view); code blocks show whole, the chat scrolls (user, 2026-11-20: one scrolled).
  editorHeight(text, s, padding = 32, cap = true) {
    const columns = Math.max(1, Math.floor((s.width - 20 - padding - (s.editorLineNumbers ? 40 : 0)) / 7.2 * 0.85));
    const lines = text.split(/\r\n|[\r\n\u2028\u2029]/).reduce((n, line) => n + Math.max(1, Math.ceil(line.length / columns)), 0);
    // Exactly the estimated lines plus a little padding: blank rows of slack read as a broken box (user, 2026-11-20).
    const h = lines * 19 + 10;

    return Math.max(19, cap ? Math.min(h, this.messagesHeight * 0.85 - padding) : h);
  }

  markdown(d, source, text, id, t) {
    const parts = markdownParts(text);
    const nodes = parts.map((part, i) => {
      const partId = parts.length === 1 ? id : `${id}-${i}`;
      if (part.kind === "text") return prose(part.text, partId, t);
      if (part.kind === "diff") return this.diffViewer(`${partId}-diff`, part.hunks, t);
      const key = blockKey(d, source, i), s = this.blocks.get(key);
      // A ```markdown block is text to post, not code: render it as markdown, nested like a blockquote (a muted rule down
      // its left, a step darker) so it still reads as a quote inside the proposal (user, 2026-11-20). Copy gives the raw text.
      // The label and Copy sit above the quote, not inside it, so the quote hugs the text (user, 2026-11-20).
      if (editorLanguage(part.language) === "md") return v_flex().id(`mdwrap-${key}`).w_full().min_w(0).flex_none().gap(4)
        .child(h_flex().w_full().justify_end().items_center().gap(8)
          .child(div().text_color(t.dim).text_size(10.5).child("markdown"))
          .child(button(`copy-code-${key}`, s.copyError ? "Copy failed" : s.copiedUntil > Date.now() ? "Copied" : "Copy",
            t, cx => this.copyText(part.text, s, cx), s.copying, false, "Copy this markdown, exactly as written, to the clipboard.", true)))
        .child(v_flex().id(`md-${key}`).w_full().min_w(0).flex_none().pl(14).pr(12).py(10)
          .rounded_r(6).bg(mix(t.well, t.canvas ?? "#000000", 0.35)).border_l(3).border_color(alpha(t.muted, "66"))
          .child(prose(part.text, `${partId}-md`, t)));

      // Tight padding, a 20px label row (user, 2026-11-20: "a bit too much"); the code shows whole, never scrolls inside.
      return v_flex().id(`code-${key}`).w_full().min_w(0).flex_none().px(10).pt(4).pb(8).gap(0).rounded(6).bg(t.well)
        .on_size_change((size, cx) => { if (size.width > 0 && s.width !== size.width) { s.width = size.width; cx.notify(); } })
        .child(h_flex().w_full().h(24).justify_end().items_center().gap(8)
          .child(div().text_color(t.dim).text_size(10.5).child(part.language || "text"))
          .child(button(`copy-code-${key}`, s.copyError ? "Copy failed" : s.copiedUntil > Date.now() ? "Copied" : "Copy",
            t, cx => this.copyText(part.text, s, cx), s.copying, false, `Copy this ${part.language || "text"} block to the clipboard.`, true)))
        .child(Editor.new(s.editor).w_full().h(this.editorHeight(part.text, s, 20, false))
          .line_height("19px").text_color(t.foreground).bg(t.well));
    });

    return nodes.length === 1 ? nodes[0] : v_flex().w_full().min_w(0).flex_none().gap(12).children(nodes);
  }

  // The proposal's content. With a --before diff, "Changes to the current text" (the live text it replaces, e.g. a PR body)
  // and "New text" are small sub-headings inside the bubble (renamed from "What changes", which read like the agent's
  // own edits; user, 2026-11-20);
  // without one there's no sub-heading at all (the bubble's header says "Proposal").
  proposal(d, t) {
    const key = keyOf(d), s = this.editors.get(key) ?? { view: "preview", width: 500 }, diff = sectionsOf(d).length > 1;
    const sub = (title) => h_flex().w_full().min_w(0).gap(8).items_center()
      .child(div().flex_none().text_size(11).font_semibold().text_color(t.muted).child(title));

    return v_flex().w_full().min_w(0).flex_none().gap(16).children(sectionsOf(d).map((part, i) => {
      const id = `proposal-${key}-${i}`;
      if (part.kind === "diff") {
        // Open or folded behind ▾ per Veroboard settings → Decisions → "Show changes open" (default open; user, 2026-11-20).
        // A click overrides it for this decision while the dialog is open.
        const open = this.updateOpen?.[id] ?? shared("veroboard.decisionDiffOpen") !== false;
        return v_flex().w_full().min_w(0).flex_none().gap(8)
          .child(sub(part.title).child(this.diffToggle(id, part.hunks, open, t, "Show the changes to the current text")))
          .when(open, el => el.child(this.diffViewer(`${id}-diff`, part.hunks, t)));
      }
      // The text sits straight in the bubble, no dark well or accent stripe (user, 2026-11-20); `---` sections are split
      // by a thin line.
      const well = (c) => v_flex().id(c ? `well-${key}-${c}` : `well-${key}`).w_full().min_w(0).flex_none()
        .when(!c, el => el.on_size_change((size, cx) => { if (size.width > 0 && s.width !== size.width) { s.width = size.width; cx.notify(); } }));
      const wells = s.view === "raw"
        ? [well(0).child(Editor.new(s.editor).w_full().h(this.editorHeight(part.text, s)).line_height("19px").text_color(t.foreground).bg(t.card))]
        : ruleSections(part.text).map((text, c) => well(c).child(this.markdown(d, `body:${c}`, text, `${id}-preview-${c}`, t)));

      return v_flex().w_full().min_w(0).flex_none().gap(8).when(diff, el => el.child(sub(part.title)))
        .child(v_flex().w_full().min_w(0).flex_none().gap(14)
          .children(wells.flatMap((w, c) => c ? [div().h(1).w_full().flex_none().bg(t.edge), w] : [w])));
    }));
  }

  // The ▾ +n −m chip that folds a diff (an update's, or the proposal's changes to the current text); `id` keys its state.
  diffToggle(id, hunks, open, t, tip) {
    const lines = hunks.flatMap(h => h.lines);
    return h_flex().id(`${id}-toggle`).h(20).px(6).gap(6).flex_none().items_center().rounded(5)
      .cursor_pointer().text_size(11).text_color(t.muted).border(1).border_color(t.edge)
      .hover(st => st.bg(alpha(t.accent, "1a")).text_color(t.foreground))
      .tooltip(open ? "Hide the changes" : tip)
      .on_click((_e, cx) => { this.updateOpen = { ...this.updateOpen, [id]: !open }; cx.notify(); })
      .child(open ? "▴" : "▾")
      .child(div().text_color(t.done).child(`+${lines.filter(l => l.type === "add").length}`))
      .child(div().text_color(t.blocked).child(`−${lines.filter(l => l.type === "del").length}`));
  }

  // One line of text cut with "…" (full text on hover), plus an invisible unwrapped copy that measures how wide it wants to
  // be; cut(id) says whether the visible one is narrower. `box` sizes it in the row, `look` styles both copies alike.
  fitText(id, text, box, look) {
    const fit = (this.fits ??= {})[id] ??= {};
    const measure = (k) => (size, cx) => { if (size.width > 0 && Math.abs((fit[k] ?? 0) - size.width) > 0.5) { fit[k] = size.width; cx.notify(); } };
    return box(div().id(id).relative().overflow_hidden())
      .child(look(div().id(`${id}-shown`).truncate().tooltip(text)).on_size_change(measure("shown")).child(text))
      .child(look(div().id(`${id}-natural`).absolute().top(0).left(0).whitespace_nowrap().opacity(0)).on_size_change(measure("natural")).child(text));
  }
  cut(id) { const f = this.fits?.[id]; return Boolean(f?.natural && f?.shown && f.natural > f.shown + 1); }

  // How a decision ended, at the bottom of its archived chat (user, 2026-11-20: the note read as a footnote; an answer is
  // its own kind of message). Your answer: a bubble on the right like your questions, in the Done green, the option as a
  // ✓ chip and your note under it. Dismissed: the same bubble in grey. Withdrawn by the agent: a centered line.
  outcome(d, name, t) {
    const o = d.outcome, key = keyOf(d), age = ago(Date.now() - o.at);
    if (o.kind !== "answered" && o.kind !== "dismissed") return TextView.markdown(`outcome-${key}`, `${name} withdrew it · ${age} ago`)
      .selectable(true).w_full().flex_none().text_center().text_size(11).text_color(t.muted);
    const c = o.kind === "answered" ? t.done : t.idle ?? t.muted;
    return h_flex().id(`outcome-${key}`).w_full().flex_none().min_w(0).justify_end()
      .child(v_flex().max_w("85%").min_w(0).flex_none().rounded(8).overflow_hidden().bg(alpha(c, "1f")).border(1).border_color(alpha(c, "55"))
        .child(h_flex().h(36).flex_none().w_full().px(12).gap(8).items_center().bg(alpha(c, "14")).border_b(1).border_color(alpha(c, "55"))
          .child(div().flex_none().text_size(12).font_semibold().text_color(c).child("You"))
          .child(div().min_w(0).truncate().text_size(11).text_color(t.dim).child(`${o.kind} · ${age} ago`)))
        .child(v_flex().w_full().min_w(0).flex_none().p(12).gap(10)
          .when(o.kind === "answered", el => el.child(h_flex().flex_none().gap(6).items_center()
            .child(h_flex().h(24).px(10).gap(6).flex_none().items_center().rounded(6).bg(alpha(c, "33")).text_color(c)
              .text_size(12.5).font_semibold().child("✓").child(o.option ?? ""))))
          .when(o.kind === "dismissed", el => el.child(div().text_size(12).text_color(t.muted).child(`Closed without telling ${name}.`)))
          .when(Boolean(o.note), el => el.child(prose(o.note, `outcome-note-${key}`, t)))));
  }

  // A message bubble with a real header (user, 2026-11-20: "make the header of the message bubble look like an actual
  // header"): a 36px band across the top, a step darker than the bubble, a line under it; who and what on the left, when
  // dim beside it, and for the proposal Preview | Raw on the right. Your bubbles tint the band with the accent.
  message(d, entry, name, t, proposal = false) {
    const age = ago(Date.now() - entry.at), you = entry.from === "you";
    const key = keyOf(d), s = this.editors.get(key) ?? { view: "preview" };
    if (entry.kind === "update") {
      // "<agent> updated the proposal" with a ▾ toggle that shows what changed from the version before (user, 2026-11-20).
      const n = d.thread.indexOf(entry), uid = `update-${key}-${entry.at}-${n}`, open = Boolean(this.updateOpen?.[uid]);
      return v_flex().w_full().flex_none().gap(8).items_center()
        .child(h_flex().gap(8).items_center()
          .child(TextView.markdown(uid, `${name} updated the proposal · ${age} ago`).selectable(true).flex_none().text_size(11).text_color(t.muted))
          .when(Boolean(entry.diff?.length), el => el.child(this.diffToggle(uid, entry.diff, open, t, "Show what changed from the version before"))))
        .when(open && Boolean(entry.diff?.length), el => el.child(this.diffViewer(`${uid}-diff`, entry.diff, t)));
    }
    const text = proposal ? this.proposal(d, t)
      : (() => {
        // A reply's `---` sections stack with a thin line between them.
        const n = d.thread.indexOf(entry), parts = ruleSections(entry.text);
        const nodes = parts.map((text, c) => this.markdown(d, `${n}:${c}`, text, `message-${key}-${entry.at}-${n}${parts.length > 1 ? `-${c}` : ""}`, t));
        return nodes.length === 1 ? nodes[0] : v_flex().w_full().min_w(0).flex_none().gap(12)
          .children(nodes.flatMap((node, c) => c ? [div().h(1).w_full().flex_none().bg(t.edge ?? t.border), node] : [node]));
      })();
    const bg = you ? alpha(t.accent, "26") : t.card, edge = you ? alpha(t.accent, "55") : t.edge;
    const header = h_flex().h(36).flex_none().w_full().min_w(0).px(12).gap(8).items_center()
      .bg(you ? alpha(t.accent, "1a") : t.strip).border_b(1).border_color(edge)
      .child(div().flex_none().text_size(12).font_semibold().text_color(you ? t.accent : t.foreground)
        .child(proposal ? "Proposal" : you ? "You" : name))
      .child(div().min_w(0).truncate().text_size(11).text_color(t.dim)
        .child(proposal ? `${name} · ${age} ago` : you ? `asked · ${age} ago` : `replied · ${age} ago`))
      .when(proposal, el => el.child(div().flex_1()).child(segmented(`body-view-${key}`, [
        { value: "preview", label: "Preview", height: 22, tip: "Show the text formatted." },
        { value: "raw", label: "Raw", height: 22, tip: "Show the exact text, to select and copy any part of it." },
      ], s.view, (view, cx) => { s.view = view; cx.notify(); }, t)));

    return h_flex().w_full().flex_none().min_w(0).when(you, el => el.justify_end())
      .child(v_flex().w(proposal ? "100%" : "85%").max_w(proposal ? "100%" : "85%").min_w(0).flex_none().rounded(8).overflow_hidden()
        .bg(bg).border(1).border_color(edge)
        .child(header)
        .child(v_flex().w_full().min_w(0).flex_none().p(12).gap(12).child(text)));
  }

  chat(d, t) {
    const key = keyOf(d), s = this.drafts.get(key) ?? {}, archived = Boolean(d.outcome), a = agents().find(a => a.address === d.terminal), gone = !live(d.terminal);
    const name = a?.tab_name || d.terminal, act = (kind, option) => cx => this.act(d, kind, option, cx);
    // One slim row (user, 2026-11-20: "big and using a lot of wasted space"): the title, its context muted beside it, then
    // who asks and the two actions. Both texts stay selectable; a long context wraps rather than hiding.
    const top = v_flex().flex_none().bg(t.bar).border_b(1).border_color(t.edge).child(h_flex().h(44).px(16).gap(12).items_center()
      // 3. Always one row (user, 2026-11-20: long titles made the bar "look terrible"): the title and its context each cut to
      // one line, the full text on hover; ⌄ opens both in full, wrapped and selectable, under the row.
      .child(h_flex().id(`head-${key}`).flex_1().min_w(0).gap(10).items_center()
        .child(this.fitText(`head-title-${key}`, d.title, el => el.flex_shrink(1).min_w(0).max_w(d.context ? "55%" : "100%"),
          el => el.text_size(14).font_semibold().text_color(t.foreground)))
        .when(Boolean(d.context), el => el.child(div().w(1).h(14).flex_none().bg(t.edge))
          .child(this.fitText(`head-context-${key}`, d.context, el => el.flex_1().min_w(0), el => el.text_size(12).text_color(t.muted))))
        // ⌄ only when something is cut off (user, 2026-11-20), or to close what it opened.
        .when(this.headOpen?.[key] || this.cut(`head-title-${key}`) || this.cut(`head-context-${key}`), el => el.child(h_flex().id(`head-more-${key}`).size(22).flex_none().items_center().justify_center().rounded(5).cursor_pointer()
          .text_size(12).text_color(t.muted).hover(st => st.bg(alpha(t.accent, "1a")).text_color(t.foreground))
          .tooltip(this.headOpen?.[key] ? "Hide the full title" : "Show the full title and context")
          .on_click((_e, cx) => { this.headOpen = { ...this.headOpen, [key]: !this.headOpen?.[key] }; cx.notify(); })
          .child(this.headOpen?.[key] ? "⌃" : "⌄"))))
      .child(h_flex().flex_none().gap(6).items_center()
        .child(div().max_w(180).truncate().text_size(12).text_color(t.muted).child(name))
        .child(pill(t, d.terminal).font_family("JetBrains Mono"))
        .when(Boolean(a?.space_name), el => el.child(pill(t, a.space_name)))
        .child(div().w(1).h(16).mx(4).flex_none().bg(t.edge))
        .child(button(`focus-${key}`, "Go to agent", t, () => run("agent.focus", { terminal: d.terminal }), s.busy || gone, false,
          gone ? `${name} has exited.` : `Switch to ${name}'s terminal (${d.terminal}).`))
        .when(!archived, el => el.child(button(`dismiss-${key}`, "Dismiss", t, act("dismiss"), s.busy, false,
          `Close this decision without telling ${name}. It moves to the archive.`)))))
      .when(Boolean(this.headOpen?.[key]), el => el.child(v_flex().px(16).pb(12).gap(6)
        .child(TextView.markdown(`title-${key}`, d.title).selectable(true).text_size(14).font_semibold())
        .when(Boolean(d.context), el => el.child(TextView.markdown(`context-${key}`, d.context).selectable(true).text_size(12).text_color(t.muted)))));
    const messages = v_flex().id("decision-messages").flex_1().min_h(0).min_w(0).w_full().px(16).py(16).gap(16).bg(t.list)
      .on_size_change((size, cx) => { if (size.height > 0 && this.messagesHeight !== size.height) { this.messagesHeight = size.height; cx.notify(); } })
      .overflow_y_scrollbar().track_scroll(this.scroll)
      .child(this.message(d, { from: "agent", text: d.body, at: d.at }, name, t, true))
      .children([...d.thread].sort((a, b) => a.at - b.at).map(entry => this.message(d, entry, name, t)))
      .when(!archived && d.waiting === "agent", el => el.child(div().flex_none().text_size(11.5).text_color(t.muted).child(`Waiting on ${name}…`)))
      .when(archived, el => el.child(this.outcome(d, name, t)))
      .child(div().h(1).flex_none());
    if (archived) {
      const strip = h_flex().flex_none().px(16).py(12).gap(8).items_center().bg(t.strip).border_t(1).border_color(t.edge)
        .child(button(`remove-${key}`, "Remove from archive", t, cx => this.archiveAction(["remove", d.file], cx), this.archiveBusy, false,
          "Delete this decision from the archive for good."))
        .child(div().flex_1())
        .when(!this.clearConfirm, el => el.child(button("clear-archive", "Clear archive", t, cx => { this.clearConfirm = true; cx.notify(); }, this.archiveBusy, false,
          "Delete every archived decision. Asks first.")))
        .when(this.clearConfirm, el => el.child(h_flex().gap(8).items_center().child("Clear all?")
          .child(badge("clear-archive-count", this.archive.length, t)))
          .child(button("confirm-clear", "Clear", t, cx => this.archiveAction(["clear"], cx), this.archiveBusy, false,
            `Delete all ${this.archive.length} archived decisions for good.`))
          .child(button("cancel-clear", "Cancel", t, cx => { this.clearConfirm = false; cx.notify(); }, this.archiveBusy, false, "Keep the archive as it is.")));

      return v_flex().flex_1().min_h(0).min_w(0).child(top).child(messages).child(strip);
    }
    const composer = v_flex().id(`composer-${key}`).flex_none().min_w(0).px(16).py(12).gap(8).bg(t.strip)
      .border_t(1).border_color(t.edge).track_focus(this.focus)
      .when(gone, el => el.child(div().text_color(t.muted).child("agent gone")))
      .when(!gone, el => el
        .child(Textarea.new(s.input).h(56).w_full().px(12).py(8).rounded(6).bg(t.well).border(1).border_color(alpha(t.accent, "55"))
          .text_size(12.5).text_color(t.foreground).disabled(Boolean(s.busy)))
        .child(h_flex().gap(8).items_center()
          .children(d.options.map((label, i) => button(`${key}-option-${i}`, label, t, act("answer", label), s.busy, i === 0,
            `Answer “${label}”: ${name} gets it as a message, with anything you typed above as a note. The decision moves to the archive.`)))
          .child(div().flex_1())
          .when(Boolean(s.busy), el => el.child(div().text_size(11.5).text_color(t.muted).child("Sending…")))
          .child(button(`ask-${key}`, "Ask", t, act("ask"), s.busy || !s.input.value().trim(), false,
            `Send what you typed to ${name} as a question, without deciding. The decision stays open. (⌘Enter)`))))
      .when(Boolean(s.error), el => el.child(div().min_w(0).truncate().text_size(11.5).text_color(t.ansi1 ?? t.blocked).child(s.error)));

    return v_flex().flex_1().min_h(0).min_w(0).child(top).child(messages).child(composer);
  }

  // The settings dialog's surfaces, 44px header and tab band (user, 2026-11-20).
  render() {
    const base = theme(), body = bodyBg(base);
    const canvas = base.canvas ?? "#000000", list = mix(body, canvas, 0.3), card = mix(body, base.raised ?? body, 0.35);
    const t = { ...base, popover: body, head: headBg(base), list, card, strip: mix(card, canvas, 0.18), bar: mix(body, canvas, 0.55), well: mix(canvas, body, 0.25),
      edge: mix(card, canvas, 0.45), border: mix(body, canvas, 0.4) };
    const n = this.decisions.filter(d => d.waiting === "you").length;
    const selected = this.items().find(d => keyOf(d) === this.selected);
    const head = h_flex().h(44).flex_none().px(16).gap(8).items_center().border_b(1).border_color(alpha(t.accent, "26"))
      .child(svg("mods/veroboard/question.svg").size(15).flex_none().text_color(n ? t.blocked : t.muted))
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Decisions"))
      // No count beside the title: Open on the right already has it (user, 2026-11-20).
      // No subtitle (user, 2026-11-20: the dialog is clear without it); the gap pushes Open / Archive to the right.
      .child(div().flex_1())
      .child(segmented("view", [
        { value: "open", label: "Open", count: this.decisions.length, waiting: n > 0, color: t.blocked, tip: "Decisions still open, waiting on you or on an agent." },
        { value: "archive", label: "Archive", count: this.archive.length, color: t.idle, tip: "Decisions you answered or dismissed, and ones agents withdrew." },
      // No × after it (user, 2026-11-20): Esc or a click outside closes the dialog.
      ], this.view, (view, cx) => this.switchView(view, cx), t));

    return v_flex().id("decisions-panel").size_full().bg(t.popover).text_color(t.foreground).text_size(11.5)
      .rounded(8).border(1).border_color(alpha(t.accent, "55")).overflow_hidden()
      .child(v_flex().flex_none().min_w(0).bg(t.head).border_b(1).border_color(alpha(t.accent, "55"))
        .child(head).when(this.items().length > 0, el => el.child(this.tabs(t))))
      .when(Boolean(this.error), el => el.child(div().mx(16).mt(12).px(12).py(8).rounded(6).bg(alpha(t.blocked, "1f")).border(1)
        .border_color(alpha(t.blocked, "55")).text_color(t.foreground).truncate().child(this.error)))
      .child(selected ? this.chat(selected, t) : v_flex().flex_1().items_center().justify_center().gap(8).px(16).py(80).bg(t.list)
        .child(div().text_size(14).font_semibold().child(this.view === "archive" ? "Nothing archived yet." : "No decisions waiting."))
        .when(this.view === "open", el => el.child(div().text_color(t.muted).child("Proposals from your agents will appear here."))));
  }
}

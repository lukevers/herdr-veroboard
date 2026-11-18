// Veroboard settings: how the board looks (Display), what's on a card and where (Card), the rules that put a card in
// Blocked, and a box to test a message. Opened by the board header's gear: run("mod.open", { name: "veroboard" }) shows
// this mod as the dialog its mod.json describes, and main.js hands an overlay copy to SettingsPanel. It lives in the
// board mod so the Card tab's example is drawn by the board's own card code (card.js); mods can only import their own files.
//
// Tabs (user, 2026-11-17: one long scroll hid the rules at the bottom): Display, Card, Test, People, Asks, Patterns, Rules.
// Display edits the config's "board" section (defaults: the package's defaults.json "board"); the board reloads it
// when the folder changes. A setting equal to the default is removed from your file rather than written.
// The rules live in ~/.config/veroboard/core (rules.js: the built-in rules, each with what it looks for, more detail and
// an example; defaults.json: the package's lists). Your own additions are ~/.config/veroboard/config.json, which
// this dialog edits: every list here is added to the defaults, and switching a built-in rule off writes its id to
// blocked.disable. Each change is saved at once (a safe write: if the file changed on disk meanwhile, it reloads
// instead). Agents pick it up on their next status-line run. The Test tab runs ~/.config/veroboard/core/classify.js,
// so it always uses the saved rules.

import { div, svg, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, TextareaState, Textarea, SliderState, Slider, SliderTrack, SliderIndicator, SliderThumb } from "gpui-base";
import { theme, exec, home, readTextFile, writeTextFile, props, closeOverlay, agents, spaces, shared, setShared } from "herdr";
import { TOAST_PLACES, CARD_ITEMS, cardLayout, renderCard, TOP_ITEMS, topLayout, topItems, badge } from "./card.js";
import { cablePalette, cableLayers, cableDash, paintAt } from "./cables.js";
import { hint, pie, chip, newSpaceButton, gearButton, dividerLine, renderTopBar, bellButton, statPill, word } from "./topbar.js";

const ELSEWHERE = "#f2bc78"; // the board's marigold: waits on another agent or a person
const MONO = "JetBrains Mono";
const alpha = (hex, aa) => (/^#[0-9a-fA-F]{6}$/.test(hex) ? hex + aa : hex);
// Every section of a tab opens with a heading like this, and from the second on a rule with air on both sides sits above
// it: the same on every tab (user, 2026-11-17).
const heading = (t, text) => div().text_size(10.5).font_semibold().text_color(t.dim).child(text.toUpperCase());
// A tab's description at its top, set apart as a callout: a tinted box with an accent edge (user, 2026-11-17).
// mb(28) + the tab's gap of 18 = 46: the same space as between two sections (28 + rule + 18), so it reads as the tab's note.
const callout = (t, text, below) => h_flex().mb(28).gap(10).items_start().px(12).py(9).rounded(6).bg(alpha(t.accent, "14")).border(1).border_color(alpha(t.accent, "33"))
  .child(div().flex_none().w(3).h_full().min_h(16).rounded(2).bg(alpha(t.accent, "aa")))
  .child(v_flex().flex_1().min_w(0).gap(7)
    .child(div().text_size(11.5).text_color(t.foreground).child(text))
    .when(Boolean(below), (el) => el.child(below)));
// The Blocked reason badge exactly as a card draws it (card.js "why"), for the examples in this dialog.
const whyBadge = (t, label, color) => badge(t).bg(alpha(color, "26")).text_color(color)
  .child(svg("mods/workspace-chrome/clock.svg").size(10).flex_none()).child(label);
const code = (t, text) => div().flex_none().px(5).rounded(4).bg(t.background).border(1).border_color(t.border).font_family(MONO).text_size(11).child(text);
const sections = (t, list) => v_flex().children(list.map((el, i) => (i === 0 ? el : div().mt(28).pt(18).border_t(1).border_color(t.border).child(el))));
const SKELETON = {
  "//": "Your Herdr board rules: added to the package's defaults. Edited by the board's Veroboard settings dialog (the gear), or by hand.",
  people: { names: [], notPeople: [] },
  blocked: { asks: [], notAsks: [], nothingForYou: [], todoLabels: [], patterns: { asks: [], notAsks: [] }, disable: [] },
};
// The board's display settings: [key, label, help, kind, slider options]. Fallbacks match the package defaults.
const VIEW_DEFAULTS = { cables: true, cablesThroughCards: 5, contextRamp: [50, 85], stuckMinutes: 15, glow: true, greyWhenSeen: true, doneTimer: true, activeRing: true, toastPlace: "top-right", toastArea: "board", noticeRead: "visit" };
// Each group says which tab shows it (user, 2026-11-17: what's about a card goes on the Card tab, under its layout).
const DISPLAY = [
  ["Patch cables", "display", [
    ["cableExample", "", "", "example"],
    ["cables", "Show patch cables", "Lines from an agent to the agents it opened.", "switch"],
    ["cablesThroughCards", "Cables through cards", "How much the cables show through the cards.", "slider", { min: 0, max: 30, step: 1, ticks: 5, unit: "%" }],
  ]],
  ["Look", "card", [
    ["activeRing", "Highlight the card shown below", "A ring and a faint wash on the agent whose terminal is on screen.", "switch"],
    ["glow", "Glow on finish or ask", "A card pulses once when its agent finishes, or asks you something.", "switch"],
    ["greyWhenSeen", "Grey Done cards once seen", "A Done card turns grey after you've looked at it, so green means new.", "switch"],
    ["doneTimer", "Time in Done", "The Time in lane badge also counts how long a card has been in Done.", "switch"],
  ]],
  ["Context bar", "card", [
    ["contextRamp", "Color ramp", "The bar is plain below the first mark, then turns from peach to red, fully red at the second.", "range", { min: 0, max: 100, step: 1, ticks: 10, unit: "%" }],
  ]],
  ["Background work", "card", [
    ["cardRows", "Show background work rows", "Sub-agents, background shells and monitors, one row each under the card.", "rows"],
    ["stuckMinutes", "Looks stuck after", "A background shell, monitor or sub-agent with no news for this long shows its time in pink.", "slider", { min: 5, max: 60, step: 1, ticks: 5, unit: " min" }],
  ]],
];
const mixHex = (a, b, f) => {
  if (![a, b].every((c) => /^#[0-9a-fA-F]{6}/.test(c))) return f < 0.5 ? a : b;
  const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * f).toString(16).padStart(2, "0")).join("");
};
const TABS = [
  // Looks, then what puts a card in Blocked (simple to advanced), then the sandbox (user, 2026-11-17).
  { key: "display", label: "Board" },
  { key: "card", label: "Card" },
  { key: "notices", label: "Notifications" },
  { key: "people", label: "People", items: [
    { key: ["people", "names"], label: "People", placeholder: "Add a name, then Enter",
      help: "If you add names, only these count as people an agent waits on. Empty: any capitalized name does. Agents like t22 always count.", example: "person" },
    { key: ["people", "notPeople"], label: "Not people", placeholder: "Add a tool or bot, then Enter",
      help: "Tools, bots and models. \"Waiting on Sonnet\" is background work, not a reason for Blocked.", example: "tool" },
  ] },
  { key: "asks", label: "Asks", items: [
    { key: ["blocked", "asks"], label: "Asks", placeholder: "Add a phrase (whole words, any case), then Enter",
      help: "Phrases near the end of an agent's message that mean it waits for you.",
      example: { add: "your thoughts", msg: "Done. Send me your thoughts.", to: "you", without: null } },
    { key: ["blocked", "notAsks"], label: "Not asks", placeholder: "Add a phrase (whole words, any case), then Enter",
      help: "A sentence with one of these is ignored when looking for an ask.",
      example: { add: "just FYI", msg: "Done. Just FYI, tell me if this breaks.", to: null, without: "you" } },
    { key: ["blocked", "nothingForYou"], label: "Nothing for you", placeholder: "Add a phrase (whole words, any case), then Enter",
      help: "Phrases near the end that say you have nothing to do: never Blocked · You.",
      example: { add: "no action needed", msg: "Merged. Tell me if you want a changelog entry. No action needed.", to: null, without: "you" } },
    { key: ["blocked", "todoLabels"], label: "To-do labels", placeholder: "Add a label, then Enter",
      help: "Labels that start a line and hand you a to-do (\"Still yours: add the key\"). \"Still\" or \"also\" in front work too.",
      example: { add: "action item", msg: "Done.\nAction item: rotate the key.", to: "you", without: null } },
  ] },
  { key: "rules", label: "Rules" },
  { key: "patterns", label: "Patterns", intro: "Advanced: JavaScript regular expressions, case-insensitive, for what plain phrases can't say.", items: [
    { key: ["blocked", "patterns", "asks"], label: "Ask patterns", placeholder: "Add a regular expression, then Enter", regex: true,
      help: "A match near the end means an ask (Blocked · You).",
      example: { add: "\\bthumbs up\\b", msg: "Done. Give it a thumbs up.", to: "you", without: null } },
    { key: ["blocked", "patterns", "notAsks"], label: "Not-ask patterns", placeholder: "Add a regular expression, then Enter", regex: true,
      help: "A sentence matching one of these is ignored.",
      example: { add: "^\\s*PS\\b", msg: "Done.\nPS tell me later.", to: null, without: "you" } },
  ] },
  { key: "test", label: "Test" },
];
const ITEMS = TABS.flatMap((tab) => tab.items ?? []);
const GROUPS = [
  ["Waits on someone", "The card goes to Blocked with that person's or agent's name."],
  ["Not blocked", "These end the check: the card isn't blocked."],
  ["Ignored sentences", "These sentences are skipped before looking for an ask."],
  ["Asks you", "Any of these near the end puts the card in Blocked · You."],
];
const get = (o, keys) => keys.reduce((v, k) => (v && typeof v === "object" ? v[k] : undefined), o);
const listAt = (o, keys) => { const v = get(o, keys); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; };
const setList = (o, keys, list) => {
  let v = o;
  for (const k of keys.slice(0, -1)) { if (!v[k] || typeof v[k] !== "object" || Array.isArray(v[k])) v[k] = {}; v = v[k]; }
  v[keys[keys.length - 1]] = list;
};
const remembered = () => { try { return localStorage.getItem("tab"); } catch { return null; } };
const remember = (tab) => { try { localStorage.setItem("tab", tab); } catch { /* fine */ } };

export class SettingsPanel {
  constructor(cx) {
    this.status = "Loading…";
    // The keyboard, for the Card tab's arrow keys: picking a badge focuses the panel (user, 2026-11-17).
    this.handle = cx.focus_handle();
    this.tab = TABS.some((x) => x.key === remembered()) ? remembered() : "display";
    // Sliders hold their own value while dragged; `release` saves. Set from the config once it's loaded.
    this.sliders = {};
    this.live = {};
    for (const [, , rows] of DISPLAY) for (const [key, , , kind, opt] of rows) {
      if (kind !== "slider" && kind !== "range") continue; // only sliders keep a state (not switches, rows or the example)
      const s = SliderState.new({ min: opt.min, max: opt.max, step: opt.step, value: VIEW_DEFAULTS[key] });
      // The state moves in whole opt.step jumps on its own: the thumb steps from tick to tick, it never slides (user, 2026-11-17).
      s.on("change", (v, cx) => { this.live[key] = v; cx.notify(); });
      s.on("release", (v, cx) => { this.live[key] = v; this.setView(key, v, cx); });
      this.sliders[key] = s;
    }
    this.open = null; // the rule whose details show on the Rules tab
    this.inputs = ITEMS.map((item) => {
      const s = InputState.new({ placeholder: item.placeholder });
      s.on("submit", (_e, cx) => { this.add(item, s.value(), s, cx); });
      return s;
    });
    this.test = TextareaState.new({ placeholder: "Paste an agent's last message to see which lane its card would go to", rows: 6 });
    this.test.set_auto_grow(6, 14);
    this.testSeq = 0;
    this.test.on("change", (_e, cx) => {
      const seq = ++this.testSeq;
      cx.timer.after(350, (cx) => { if (seq === this.testSeq) this.runTest(cx); });
    });
    cx.spawn(async (cx) => { await this.load(); cx.notify(); });
  }

  // Node's path, as the board package's facts.js recorded it: Herdr's exec doesn't see the shell's PATH (nvm, mise).
  async node() {
    if (!this.nodeBin) { try { this.nodeBin = (await readTextFile(`${home()}/.config/veroboard/state/node-path`)).trim(); } catch { this.nodeBin = "node"; } }
    return this.nodeBin || "node";
  }

  async load() {
    try {
      const r = await exec(await this.node(), [`${home()}/.config/veroboard/core/classify.js`, "--info"], { timeout: 10000 });
      this.info = JSON.parse(r.stdout);
    } catch (e) {
      this.status = `Can't run ~/.config/veroboard/core/classify.js (${e?.message ?? e}). Is the board package installed, and has an agent run since (it records where Node is)?`;
      return;
    }
    try { this.defaults = JSON.parse(await readTextFile(this.info.defaults)); } catch { this.defaults = {}; }
    try { this.userText = await readTextFile(this.info.config); } catch { this.userText = null; }
    this.parseError = null;
    try { this.user = this.userText === null ? JSON.parse(JSON.stringify(SKELETON)) : JSON.parse(this.userText); }
    catch (e) { this.user = null; this.parseError = e?.message ?? String(e); }
    for (const [key, s] of Object.entries(this.sliders)) { s.set_value(this.view(key)); delete this.live[key]; }
    this.status = "";
  }

  // Change your config and save it at once. The write only lands if the file is as we last read it.
  async save(change, cx) {
    if (!this.user || !this.info) return;
    const next = JSON.parse(JSON.stringify(this.user));
    change(next);
    const text = JSON.stringify(next, null, 2) + "\n";
    try {
      await writeTextFile(this.info.config, text, this.userText);
      this.user = next; this.userText = text; this.status = "Saved. Agents use it from their next status-line run.";
    } catch (e) {
      await this.load();
      this.status = `Not saved: the file changed on disk (or couldn't be written: ${e?.message ?? e}). Reloaded; try again.`;
    }
    cx.notify();
    this.runTest(cx);
  }

  add(item, raw, input, cx) {
    const value = String(raw ?? "").trim();
    if (!value) return;
    if (item.regex) { try { new RegExp(value, "i"); } catch (e) { this.status = `Not a valid pattern: ${e.message}`; cx.notify(); return; } }
    const mine = listAt(this.user, item.key);
    input.set_value("");
    if ([...listAt(this.defaults, item.key), ...mine].some((x) => x.toLowerCase() === value.toLowerCase())) {
      this.status = `"${value}" is already in ${item.label}.`; cx.notify(); return;
    }
    cx.spawn(async (cx) => this.save((o) => setList(o, item.key, [...mine, value]), cx));
  }

  remove(item, value, cx) {
    cx.spawn(async (cx) => this.save((o) => setList(o, item.key, listAt(o, item.key).filter((x) => x !== value)), cx));
  }

  toggleRule(id, cx) {
    cx.spawn(async (cx) => this.save((o) => {
      const off = listAt(o, ["blocked", "disable"]);
      setList(o, ["blocked", "disable"], off.includes(id) ? off.filter((x) => x !== id) : [...off, id]);
    }, cx));
  }

  // A display setting: yours, else the package default, else the built-in fallback.
  view(key) {
    if (key === "card") return cardLayout(this.user?.board?.card ?? this.defaults?.board?.card);
    if (key === "top") return topLayout(this.user?.board?.top ?? this.defaults?.board?.top);
    const ok = (x) => (key === "contextRamp" ? Array.isArray(x) && x.length === 2 && x.every(Number.isFinite) : typeof x === typeof VIEW_DEFAULTS[key]);
    const mine = this.user?.board?.[key], pkg = this.defaults?.board?.[key];
    return ok(mine) ? mine : ok(pkg) ? pkg : VIEW_DEFAULTS[key];
  }
  defaultView(key) {
    if (key === "card") return cardLayout(this.defaults?.board?.card);
    if (key === "top") return topLayout(this.defaults?.board?.top);
    const pkg = this.defaults?.board?.[key];
    return pkg !== undefined ? pkg : VIEW_DEFAULTS[key];
  }
  setView(key, value, cx) {
    const same = JSON.stringify(value) === JSON.stringify(this.defaultView(key));
    cx.spawn(async (cx) => this.save((o) => {
      if (!o.board || typeof o.board !== "object") o.board = {};
      if (same) delete o.board[key]; else o.board[key] = value;
      if (!Object.keys(o.board).length) delete o.board;
    }, cx));
  }

  // The settings groups for one tab ("display": the Board tab; "card": under the Card tab's layout).
  displayTab(t, tab = "display") {
    const fmt = (v, unit) => (Array.isArray(v) ? `${v[0]}${unit} → ${v[1]}${unit}` : `${v}${unit}`);
    const reset = (key) => h_flex().id(`reset-${key}`).flex_none().h(20).px(7).items_center().rounded(4).cursor_pointer()
      .text_size(11).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(`Back to the default (${fmt(this.defaultView(key), "")})`)
      .on_click((_e, cx) => { this.sliders[key]?.set_value(this.defaultView(key)); delete this.live[key]; this.setView(key, this.defaultView(key), cx); })
      .child("Reset");
    const changed = (key) => this.user?.board && Object.prototype.hasOwnProperty.call(this.user.board, key);
    const toggle = (key) => {
      // The rows switch lives in the card layout (board.card.rows); the rest are board settings of their own.
      const on = key === "cardRows" ? this.view("card").rows : this.view(key);
      return h_flex().id(`sw-${key}`).w(30).h(17).flex_none().rounded(9).px(2).items_center().cursor_pointer()
        .bg(on ? alpha(t.done, "66") : t.raised).border(1).border_color(on ? alpha(t.done, "99") : t.border)
        .when(on, (el) => el.justify_end())
        .on_click((_e, cx) => (key === "cardRows" ? this.setView("card", { ...this.view("card"), rows: !on }, cx) : this.setView(key, !on, cx)))
        .child(div().size(11).rounded(6).bg(on ? t.foreground : t.dim));
    };
    const slider = (key, kind, opt) => {
      const s = this.sliders[key];
      const marks = [];
      for (let v = opt.min; v <= opt.max; v += opt.ticks) marks.push(v);
      const steps = [];
      for (let v = opt.min; v <= opt.max; v += opt.step) steps.push(v);
      const thumb = (start) => SliderThumb.new(s).when(start, (el) => el.start(true)).id(`th-${key}-${start ? "a" : "b"}`).size(14).rounded(7).ml(-7).mt(-5)
        .bg(t.foreground).border(2).border_color(t.accent);
      return v_flex().gap(2)
        .child(Slider.new(s).child(SliderTrack.new(s).flex().items_center().h(22).w_full()
          .child(SliderIndicator.new(s).relative().w_full().h(4).rounded(2).bg(t.raised)
            .range_style((fill) => fill.rounded(2).bg(alpha(t.accent, "aa")))
            .when(kind === "range", (el) => el.child(thumb(true)))
            .child(thumb(false)))))
        // The bumps: a small tick at every step, a taller one with its number every opt.ticks, under the track's positions.
        .child(h_flex().mx(-1).justify_between().items_start()
          .children(steps.map((v) => div().w(2).flex().justify_center()
            .child(div().w(1).h(marks.includes(v) ? 7 : 4).bg(marks.includes(v) ? t.dim : alpha(t.dim, "77"))))))
        .child(h_flex().mx(-12).justify_between()
          .children(marks.map((v) => div().w(24).flex().justify_center().text_size(9.5).text_color(t.dim).child(String(v)))));
    };
    const rampPreview = () => {
      const [from, to] = this.live.contextRamp ?? this.view("contextRamp");
      const color = (p) => (p < from ? t.foreground : mixHex(t.ansi3, t.ansi1, to > from ? Math.min(1, (p - from) / (to - from)) : 1));
      const cells = [];
      for (let p = 0; p <= 100; p += 5) cells.push(div().flex_1().h(8).rounded(2).bg(color(p)).when(p < from, (el) => el.opacity(0.35)));
      return v_flex().gap(4)
        .child(div().text_size(10.5).text_color(t.dim).child("PREVIEW: 0% TO 100%"))
        .child(h_flex().gap(2).children(cells));
    };
    const row = ([key, label, help, kind, opt], last) => {
      if (kind === "example") return this.cableExample(t);
      const value = kind === "switch" || kind === "rows" ? null : this.live[key] ?? this.view(key);
      const dim = key === "cablesThroughCards" && !this.view("cables");
      return v_flex().gap(8).py(10).when(!last, (el) => el.border_b(1).border_color(t.border)).when(dim, (el) => el.opacity(0.5))
        .child(h_flex().gap(10).items_center()
          .child(v_flex().flex_1().min_w(0).gap(2)
            .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child(label))
            .child(div().text_size(11.5).text_color(t.muted).child(help)))
          .when(changed(key), (el) => el.child(reset(key)))
          .when(value !== null, (el) => el.child(h_flex().flex_none().min_w(76).justify_end().text_size(12.5).text_color(t.foreground).child(fmt(value, opt.unit))))
          .when(kind === "switch" || kind === "rows", (el) => el.child(toggle(key))))
        .when(kind === "slider" || kind === "range", (el) => el.child(div().px(8).child(slider(key, kind, opt))))
        .when(key === "contextRamp", (el) => el.child(div().px(8).child(rampPreview())));
    };
    return sections(t, DISPLAY.filter(([, at]) => at === tab).map(([group, , rows]) => v_flex()
      .child(heading(t, group))
      .children(rows.map((r, i) => row(r, i === rows.length - 1)))));
  }

  // ---------- Layouts: the card's (Card tab) and the top bar's (Board tab) ----------
  // Both are lines with a left and a right side, plus a Hidden tray; one editor serves both (user, 2026-11-17).
  // Where an item sits in a layout: { n, side, i } on a line, { hidden: true, i } in the tray.
  static find(L, id) {
    for (const [n, line] of L.lines.entries()) for (const side of ["left", "right"]) { const i = line[side].indexOf(id); if (i >= 0) return { n, side, i }; }
    const i = L.hidden.indexOf(id);
    return i >= 0 ? { hidden: true, i } : null;
  }
  // A move of the picked item: "left"/"right" within its side, then across to the other side; "up"/"down" a line,
  // where Hidden is the row under the last line; "hide"; "show" (back to its default place). An item marked `locked`
  // (the top bar's gear) can't be hidden. Returns the new layout, or null when it can't move that way.
  static moved(L0, id, how, home, items) {
    const L = JSON.parse(JSON.stringify(L0));
    const at = SettingsPanel.find(L, id);
    if (!at) return null;
    const item = items.find((x) => x.id === id);
    const last = L.lines.length - 1;
    const sideOf = () => { const f = SettingsPanel.find(home, id); return f && !f.hidden ? f.side : (item?.home ?? [0, "right"])[1]; };
    if (at.hidden && (how === "left" || how === "right")) {
      const j = at.i + (how === "left" ? -1 : 1);
      if (j < 0 || j >= L.hidden.length) return null;
      [L.hidden[j], L.hidden[at.i]] = [L.hidden[at.i], L.hidden[j]];
      return L;
    }
    if (at.hidden && how === "up") { L.hidden.splice(at.i, 1); L.lines[last][sideOf()].push(id); return L; }
    if (at.hidden) {
      if (how !== "show") return null;
      L.hidden.splice(at.i, 1);
      // Its default place: where the default layout has it, else its own home (an item that's hidden by default goes
      // to the end of that side: Opened by, to the card's top right corner).
      const found = SettingsPanel.find(home, id);
      const own = item?.home ?? [0, "right"];
      const h = found && !found.hidden ? found : { n: own[0], side: own[1], i: Infinity };
      const list = L.lines[h.n][h.side];
      list.splice(Math.min(h.i, list.length), 0, id); // its default spot on that side, as near as the rest allows
      return L;
    }
    const list = L.lines[at.n][at.side];
    const take = () => list.splice(at.i, 1);
    if (how === "left") {
      if (at.i > 0) { [list[at.i - 1], list[at.i]] = [list[at.i], list[at.i - 1]]; return L; }
      if (at.side === "right") { take(); L.lines[at.n].left.push(id); return L; }
      return null;
    }
    if (how === "right") {
      if (at.i < list.length - 1) { [list[at.i + 1], list[at.i]] = [list[at.i], list[at.i + 1]]; return L; }
      if (at.side === "left") { take(); L.lines[at.n].right.unshift(id); return L; }
      return null;
    }
    if (how === "up" || how === "down") {
      const n = at.n + (how === "up" ? -1 : 1);
      if (n > last) { if (item?.locked) return null; take(); L.hidden.push(id); return L; }
      if (n < 0) return null;
      take(); L.lines[n][at.side].push(id); return L;
    }
    if (how === "hide" && !item?.locked) { take(); L.hidden.push(id); return L; }
    return null;
  }
  // A drag and drop: the dragged item goes before or after the item it's dropped on, to the end of a line's side
  // (zone [n, side]), or into the hidden tray (zone "hidden"). Returns the new layout, or null for no change.
  static dropped(L0, id, target, items = []) {
    if (!target || target.id === id) return null;
    const locked = items.find((x) => x.id === id)?.locked;
    const L = JSON.parse(JSON.stringify(L0));
    const from = SettingsPanel.find(L, id);
    if (!from) return null;
    (from.hidden ? L.hidden : L.lines[from.n][from.side]).splice(from.i, 1);
    if (target.id) {
      const to = SettingsPanel.find(L, target.id);
      if (!to || (to.hidden && locked)) return null;
      (to.hidden ? L.hidden : L.lines[to.n][to.side]).splice(to.i + (target.before ? 0 : 1), 0, id);
    } else if (target.zone === "hidden") { if (locked) return null; L.hidden.push(id); }
    else if (Array.isArray(target.zone)) L.lines[target.zone[0]][target.zone[1]].push(id);
    else return null;
    return JSON.stringify(L) === JSON.stringify(L0) ? null : L;
  }
  // The two editors: what they place, how their lines are named, what's fixed, and their example.
  editorOf(key) {
    return key === "top"
      ? { key, items: topItems(this.view("top")), noun: "item", lineName: () => "Bar", fixed: null, reset: "Reset the top bar to the default", heading: "Top bar",
          // Only the bar itself and the Hidden tray: dragging on the bar replaced the per-side boxes and buttons (user, 2026-11-17).
          barOnly: true,
          intro: "The bar at the top of the board. Drag an item to another place on it, or into Hidden to take it off. The gear can be moved, not hidden. + Divider adds a divider; drag one you added into Hidden to remove it.",
          preview: (t, o) => h_flex().h(52).px(14).items_center().rounded(8).bg(t.chrome).border(1).border_color(t.border).overflow_hidden()
            .child(renderTopBar(this.topExample(t), t, o)) }
      : { key, items: CARD_ITEMS, noun: "badge", lineName: (n) => `Line ${n + 1}`, fixed: "Name", reset: "Reset the card's layout to the default", heading: "Card layout",
          // Like the top bar: only the example card (each side of each line takes a drop) and the Hidden tray (user, 2026-11-17).
          barOnly: true, zones: true,
          intro: "What each card shows, and where. Drag a badge to another place on the card, onto a line's empty side, or into Hidden to take it off. The name always starts the first line.",
          // The example sits on the board's own background, at a lane's width, so it looks as it will on the board.
          preview: (t, o) => h_flex().justify_center().py(16).rounded(8).bg(t.canvas).border(1).border_color(t.border)
            .child(div().w(372).child(renderCard(this.example(t), t, o))) };
  }
  moveIn(key, how, cx) {
    const ed = this.editorOf(key);
    const next = SettingsPanel.moved(this.view(key), this.picked, how, this.defaultView(key), ed.items);
    if (next) this.setView(key, next, cx);
  }

  // A made-up agent with every badge, for the example card.
  example(t) {
    const program = agents().find((a) => a.program?.icon && /claude/i.test(`${a.app ?? ""} ${a.program?.name ?? ""}`))?.program ?? agents()[0]?.program ?? null;
    const now = Date.now();
    return {
      address: "t42", program, name: "fix-login-flow", color: t.blocked, shown: false, flash: null,
      laneTime: { text: "12m", color: t.working },
      why: { icon: "mods/workspace-chrome/clock.svg", label: "You 4m", color: t.blocked },
      launched: 3, openedBy: "t22", openedByName: "release-plan", folder: "myapp", branch: { name: "feature/login-fix", worktree: true, state: null },
      model: "Opus 5.5", programName: "Claude", effort: "high", window: 1000000, space: "Work", context: { pct: 62 },
      rows: [
        { kind: "task", type: "Explore", text: "Find where the session cookie is set", startTime: now - 4 * 60000 },
        { kind: "shell", text: "npm run dev", startTime: now - 31 * 60000, waits: false },
        { kind: "monitor", text: "Watch CI", event: "build passed", eventAt: now - 60000, startTime: now - 9 * 60000, expiresAt: now + 21 * 60000 },
      ],
    };
  }

  // What patch cables look like (user, 2026-11-17: few people know until their agents open agents): three lanes, an
  // agent and two it opened (one two lanes over, one under it), and an unrelated agent in the middle lane that the
  // cable runs behind, so "Cables through cards" shows. Drawn by the board's own card and cable code at their real
  // size; it follows the Patch cables switch, and the slider live while it's dragged.
  cableExample(t) {
    const W = 720, H = 200, cw = 220, lane = (i) => i * 250;
    const L = this.view("card");
    const through = this.live.cablesThroughCards ?? this.view("cablesThroughCards");
    const card = (i, y, m) => div().absolute().left(lane(i)).top(y).w(cw).child(renderCard({
      program: this.example(t).program, shown: false, flash: null, why: null, launched: 0, openedBy: null,
      branch: { name: "main", worktree: false, state: null }, model: "Opus 5.5", effort: "high", window: 1000000, space: null, rows: [], ...m,
    }, t, { layout: { ...L, rows: false }, through }));
    // The parent's two plugs on its right edge, 13px apart (the higher child takes the higher one), as the board does.
    const [c1, c2] = cablePalette(t);
    const on = this.view("cables");
    const cables = on ? [
      cableLayers(t, { x: cw, y: 37 }, { x: lane(2), y: 78 }, 1, -1, c1, H, W),
      cableLayers(t, { x: cw, y: 50 }, { x: cw, y: 150 }, 1, 1, c2, H, W),
    ] : [];
    const divider = (i) => div().absolute().left(lane(i) - 15).top(4).bottom(4).w(1).bg(mixHex(t.canvas, t.border, 0.5));
    return v_flex().gap(8).py(10).border_b(1).border_color(t.border)
      .child(div().text_size(11.5).text_color(t.muted).child(on
        ? "A patch cable runs from an agent to each agent it opened: here planner opened fix-login (two lanes over) and update-docs (in its own lane, so the cable loops down). api-tests isn't related: the cable runs behind it, and Cables through cards sets how much shows through."
        : "Patch cables are off: nothing shows which agent opened which. (The Opened by badge on the Card tab can show it instead.)"))
      .child(h_flex().justify_center().py(6).rounded(8).bg(t.canvas).border(1).border_color(t.border).overflow_hidden()
        .child(div().relative().w(W).h(H)
          .child(divider(1)).child(divider(2))
          .child(div().absolute().inset_0().children(cables.flatMap((c) => [...c.shadows, ...c.bodies])))
          .child(card(0, 12, { address: "t22", name: "planner", color: t.working, laneTime: { text: "8m", color: t.working }, launched: 2, folder: "myapp", context: { pct: 41 } }))
          .child(card(0, 112, { address: "t32", name: "update-docs", color: t.working, laneTime: { text: "1m", color: t.working }, openedBy: "t22", folder: "myapp", context: { pct: 9 } }))
          .child(card(1, 96, { address: "t27", name: "api-tests", color: "#91c7e3", laneTime: { text: "5m", color: "#91c7e3" }, folder: "api", model: "Sonnet 5", effort: "high", context: { pct: 27 } }))
          .child(card(2, 40, { address: "t31", name: "fix-login", color: t.done, laneTime: { text: "3m", color: t.done }, openedBy: "t22", folder: "myapp-login", context: { pct: 18 } }))
          .child(div().absolute().inset_0().children(cables.flatMap((c) => c.jacks)))))
      .when(on, (d) => d.child(this.cableLegend(t)));
  }

  // Which line a cable gets: its parent's generation (user, 2026-11-18). Drawn with the board's own dash patterns.
  cableLegend(t) {
    const palette = cablePalette(t);
    const sample = (gen) => {
      const dash = cableDash(gen);
      const pen = dash ? PathBuilder.stroke(2.5).dash_array(dash) : PathBuilder.stroke(2.5);
      return div().relative().w(44).h(10).flex_none().child(paintAt(pen.move_to(2, 5).line_to(42, 5).build(), palette[gen - 1] ?? t.accent));
    };
    const item = (gen, text) => h_flex().gap(8).items_center().child(sample(gen)).child(div().text_size(11.5).text_color(t.muted).child(text));
    return h_flex().gap(22).flex_wrap()
      .child(item(1, "Opened by a top-level agent"))
      .child(item(2, "Opened by its child"))
      .child(item(3, "Deeper"));
  }

  // The top bar's example: the same pieces as the board's bar, with your spaces and agent count, made inert.
  topExample(t) {
    // All Spaces and your first space only, then a dim … when there are more: the editor needs room to move things
    // around in (user, 2026-11-18).
    const shown = spaces().slice(0, 1);
    return {
      spaces: h_flex().gap(7).items_center()
        .child(chip(t, "All Spaces", true, hint("veroboard.all")))
        .children(shown.map((s, i) => chip(t, s.name, false, hint(`veroboard.space${i + 1}`))))
        .when(spaces().length > shown.length, (el) => el.child(div().text_size(12).text_color(t.dim).child("…"))),
      newSpace: newSpaceButton(t),
      count: statPill(t, [[String(agents().length), word(agents().length, "agent")]]),
      pie: pie([{ color: t.blocked, n: 3 }, { color: "#55a9d3", n: 1 }, { color: t.working, n: 2 }, { color: t.done, n: 5 }], 18, (c) => c, t.chrome),
      divider: dividerLine(t),
      gear: gearButton(t),
      bell: bellButton(t, 2),
      filter: h_flex().w(100).h(27).flex_none().px(9).gap(6).items_center().rounded(6).bg(t.surface).border(1).border_color(t.border)
        .child(div().flex_1().text_size(12).text_color(t.dim).child("Filter"))
        .when(hint("veroboard.search") !== "", (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(hint("veroboard.search")))),
    };
  }

  // A layout editor: the example (its pieces clickable and draggable), the move buttons, the lines' Left and Right
  // sides and the Hidden tray, then `extra` (the tab's other settings).
  layoutEditor(t, key, extra) {
    const ed = this.editorOf(key);
    const L = this.view(key);
    const home = this.defaultView(key);
    const label = (id) => ed.items.find((x) => x.id === id)?.label ?? id;
    const mine = this.pickedIn === key ? this.picked : null;
    const picked = ed.items.find((x) => x.id === mine);
    // A click picks an item (for the buttons and arrow keys); a press that moves more than 4px drags it.
    // GPUI gives mods no drag and drop of their own, so it's built from the mouse events: the press notes the item,
    // moves over the tab follow it (a label at the pointer), items and line sides under it note where it would land,
    // and the release drops it there. The click that ends a drag doesn't also pick.
    const pick = (id, cx) => {
      if (Date.now() - (this.droppedAt ?? 0) < 400) return;
      this.picked = mine === id ? null : id;
      this.pickedIn = key;
      this.handle.focus();
      cx.notify();
    };
    const dragging = this.drag?.moved && this.drag.key === key ? this.drag.id : null;
    const source = (el, id) => el.cursor_grab().on_mouse_down("left", (e) => { this.drag = { key, id, x0: e.position.x, y0: e.position.y, moved: false }; });
    const overItem = (el, id) => el
      .on_mouse_move((e, cx) => {
        if (!this.drag?.moved || !e.bounds) return;
        const before = e.local_position.x < e.bounds.width / 2;
        if (this.over?.id !== id || this.over.before !== before) { this.over = { id, before }; cx.notify(); }
      })
      .on_hover((hovered, cx) => { if (!hovered && this.over?.id === id) { this.over = null; cx.notify(); } });
    const overZone = (el, zkey) => el
      .on_mouse_move((_e, cx) => { if (this.drag?.moved && JSON.stringify(this.overZone) !== JSON.stringify(zkey)) { this.overZone = zkey; cx.notify(); } })
      .on_hover((hovered, cx) => { if (!hovered && JSON.stringify(this.overZone) === JSON.stringify(zkey)) { this.overZone = null; cx.notify(); } });
    // Where a dragged item would land: a bar on the left or right edge of the item under the pointer.
    const bar = (id) => this.over?.id === id && dragging && dragging !== id
      ? div().absolute().top(1).bottom(1).w(2).rounded(1).bg(t.accent).when(this.over.before, (b) => b.left(-4)).when(!this.over.before, (b) => b.right(-4))
      : null;
    const decorate = (el, id) => overItem(source(el, id), id).relative().when(dragging === id, (d) => d.opacity(0.35))
      .when(Boolean(bar(id)), (d) => d.child(bar(id)));
    const chip = (id) => decorate(h_flex().id(`cc-${key}-${id}`).h(24).px(9).gap(6).items_center().rounded(5).flex_none(), id)
      .text_size(11.5).bg(mine === id ? alpha(t.accent, "33") : t.raised)
      .border(1).border_color(mine === id ? t.accent : t.border)
      .text_color(mine === id ? t.foreground : t.muted).hover((s) => s.text_color(t.foreground))
      .on_click((_e, cx) => pick(id, cx)).child(label(id));
    const zone = (ids, fixed, zkey) => overZone(h_flex().id(`zone-${key}-${JSON.stringify(zkey)}`), zkey).flex_1().min_w(0).min_h(36).px(6).py(5).gap(5).flex_wrap().items_center().rounded(6)
      .bg(dragging && JSON.stringify(this.overZone) === JSON.stringify(zkey) && !this.over ? alpha(t.accent, "1a") : t.background)
      .border(1).border_color(dragging && JSON.stringify(this.overZone) === JSON.stringify(zkey) ? t.accent : t.border)
      .when(Boolean(fixed), (el) => el.child(h_flex().h(24).px(9).items_center().rounded(5).text_size(11.5).text_color(t.dim)
        .border(1).border_color(t.border).child(fixed)))
      .children(ids.map(chip))
      .when(!ids.length && !fixed, (el) => el.child(div().text_size(11).text_color(t.dim).child("empty")));
    // A side of a line on the example card, as a drop target: a faint outline while dragging, the accent under the pointer.
    const lineZone = (el, zkey) => {
      const on = dragging && JSON.stringify(this.overZone) === JSON.stringify(zkey);
      // The outline is an overlay on the side's own edge (a line's left side clips anything outside it), not a border,
      // so it adds no space to the card's lines.
      return overZone(el.id(`cz-${key}-${zkey.join("-")}`), zkey).relative()
        .when(Boolean(dragging), (z) => z.child(div().absolute().inset_0().rounded(4).border(1)
          .border_color(on ? t.accent : alpha(t.accent, "44")).when(on && !this.over, (o) => o.bg(alpha(t.accent, "1a")))));
    };
    const drop = (cx) => {
      const d = this.drag;
      this.drag = null;
      if (d?.moved && d.key === key) {
        this.droppedAt = Date.now();
        const next = SettingsPanel.dropped(L, d.id, this.over ?? (this.overZone ? { zone: this.overZone } : null), ed.items);
        if (next) { this.picked = d.id; this.pickedIn = key; this.handle.focus(); this.setView(key, next, cx); }
      }
      this.over = null; this.overZone = null;
      cx.notify();
    };
    return v_flex().id(`layout-${key}`).relative().gap(14)
      .on_mouse_move((e, cx) => {
        const d = this.drag;
        if (!d || d.key !== key) return;
        if (!d.moved && Math.hypot(e.position.x - d.x0, e.position.y - d.y0) < 4) return;
        d.moved = true; d.x = e.local_position.x; d.y = e.local_position.y;
        cx.notify();
      })
      .on_mouse_up("left", (_e, cx) => drop(cx))
      // Leaving the tab mid-drag cancels it, so a release outside the dialog can't leave a drag half done.
      .on_hover((hovered, cx) => { if (!hovered && this.drag) { this.drag = null; this.over = null; this.overZone = null; cx.notify(); } })
      // A section heading, in the same style as Patch cables below it (user, 2026-11-17).
      .when(Boolean(ed.heading), (el) => el.child(heading(t, ed.heading).mb(-6)))
      .child(div().text_size(11.5).text_color(t.muted).child(ed.intro))
      .child(ed.barOnly && !ed.zones
        ? div().id(`bar-drop-${key}`).relative().rounded(8)
          .on_mouse_move((e, cx) => {
            if (!this.drag?.moved || !e.bounds) return;
            const z = [0, e.local_position.x < e.bounds.width / 2 ? "left" : "right"];
            if (JSON.stringify(this.overZone) !== JSON.stringify(z)) { this.overZone = z; cx.notify(); }
          })
          .on_hover((hovered, cx) => { if (!hovered && Array.isArray(this.overZone)) { this.overZone = null; cx.notify(); } })
          .child(ed.preview(t, { layout: L, pick, picked: mine, decorate }))
          .when(Boolean(dragging) && Array.isArray(this.overZone) && !this.over, (el) => el.child(div().absolute().top(0).bottom(0).left(0).right(0)
            .rounded(8).border(1).border_color(t.accent)))
        : ed.preview(t, { layout: L, pick, picked: mine, decorate, zone: ed.zones ? lineZone : undefined }))
      .when(Boolean(picked), (el) => el.child(div().text_size(11.5).text_color(t.foreground).child(`${picked.label}: ${picked.help}`)))
      .child(h_flex().gap(8).items_center()
        .child(div().w(52).flex_none().text_size(11.5).text_color(t.muted).child("Hidden"))
        .child(zone(L.hidden, null, "hidden"))
        // Top bar: add a divider (divider2, divider3, …) at the end of the bar's left side, picked, to drag into place.
        .when(key === "top", (el) => el.child(h_flex().id("add-divider").flex_none().h(26).px(10).items_center().rounded(6)
          .cursor_pointer().text_size(11.5).bg(t.raised).border(1).border_color(t.border).text_color(t.foreground)
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => {
            const cur = this.view("top");
            const used = new Set([...cur.lines.flatMap((l) => [...l.left, ...l.right]), ...cur.hidden]);
            let n = 2; while (used.has(`divider${n}`)) n++;
            const next = { ...cur, lines: cur.lines.map((l, i) => i === 0 ? { ...l, left: [...l.left, `divider${n}`] } : l) };
            this.picked = `divider${n}`;
            this.setView("top", next, cx);
          }).child("+ Divider"))))
      .when(Boolean(this.user?.board && Object.prototype.hasOwnProperty.call(this.user.board, key)), (el) => el.child(h_flex()
        .child(h_flex().id(`reset-layout-${key}`).h(26).px(10).items_center().rounded(6).cursor_pointer().text_size(11.5)
          .bg(t.raised).border(1).border_color(t.border).text_color(t.foreground).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.picked = null; this.setView(key, home, cx); }).child(ed.reset))))
      // A rule and some air between the layout editor and the tab's settings, so they read as two sections (user, 2026-11-17).
      .when(Boolean(extra), (el) => el.child(div().mt(14).pt(18).border_t(1).border_color(t.border).child(extra))) // 14 + the gap of 14 = 28, as in sections()
      // The dragged item's label, at the pointer.
      .when(Boolean(dragging), (el) => el.child(h_flex().absolute().left((this.drag.x ?? 0) + 12).top((this.drag.y ?? 0) + 10)
        .h(24).px(9).items_center().rounded(5).bg(t.popover).border(1).border_color(t.accent).text_size(11.5).text_color(t.foreground)
        .opacity(0.95).child(label(dragging))));
  }
  cardTab(t) { return this.layoutEditor(t, "card", this.displayTab(t, "card")); }
  boardTab(t) { return this.layoutEditor(t, "top", this.displayTab(t, "display")); }

  // The Notifications tab (user, 2026-11-18). Where they pop up: a 9-slice picker, the board in small, split 3 × 3.
  // Each cell is a spot; the chosen one holds a small notice in that corner or edge (an agent's, with its colored left
  // edge), the others a faint dot where it would go. A click saves it; the board moves its notices at once.
  noticesTab(t) {
    const place = TOAST_PLACES.includes(this.view("toastPlace")) ? this.view("toastPlace") : "top-right";
    const name = (p) => (p === "middle-center" ? "Center" : p.replace("-", " ").replace(/^./, (c) => c.toUpperCase()));
    const changed = this.user?.board && Object.prototype.hasOwnProperty.call(this.user.board, "toastPlace");
    // Its colored edge curves with its corners, as on the board's notices.
    const mini = () => h_flex().w(42).h(14).rounded(4).overflow_hidden().bg(t.popover).border(1).border_color(alpha(t.accent, "88"))
      .child(h_flex().flex_1().h_full().rounded(3).bg(t.done).pl(2)
      .child(v_flex().flex_1().h_full().rounded_l(2).bg(t.popover).px(4).gap(2).justify_center()
        .child(div().w(20).h(2).rounded(1).bg(alpha(t.foreground, "aa")))
        .child(div().w(13).h(2).rounded(1).bg(alpha(t.muted, "88")))));
    const cell = (p) => {
      const [row, col] = p.split("-"), on = p === place;
      return h_flex().id(`place-${p}`).flex_1().h_full().p(4).rounded(4).cursor_pointer()
        .items_start().when(row === "middle", (el) => el.items_center()).when(row === "bottom", (el) => el.items_end())
        .when(col === "center", (el) => el.justify_center()).when(col === "right", (el) => el.justify_end())
        .when(on, (el) => el.bg(alpha(t.accent, "1f"))).when(!on, (el) => el.hover((s) => s.bg(t.hover)))
        .tooltip(name(p))
        .on_click((_e, cx) => { if (!on) this.setView("toastPlace", p, cx); })
        .child(on ? mini() : div().size(6).rounded(3).bg(alpha(t.dim, "99")));
    };
    // On the right of its row, like the Area switch (centered under the text, it looked like something was missing;
    // user, 2026-11-18). 1.6 : 1, about a board's shape.
    const grid = v_flex().w(208).h(130).flex_none().p(3).gap(3).rounded(8).bg(t.background).border(1).border_color(t.border)
      .children(["top", "middle", "bottom"].map((row) => h_flex().flex_1().gap(3)
        .children(["left", "center", "right"].map((col) => cell(`${row}-${col}`)))));
    // A test notice (user, 2026-11-18): straight onto the board's stack (not through Herdr, and not into the bell's list),
    // shaped like an agent's, with the chosen spot as its badge. The board draws its notices under this dialog, so the
    // button closes it first; the notice shows where you picked, for 8s.
    const test = () => {
      const now = Date.now(), list = (Array.isArray(shared("veroboard.notices")) ? shared("veroboard.notices") : []).filter((n) => n && n.at + n.timeout > now);
      setShared("veroboard.notices", [...list.slice(-9), {
        id: `${now}-test`, at: now, timeout: 8000, title: "Test notification", body: "", level: "info", icon: null, action: null,
        agent: { address: "", name: "Test notification", space: `${this.view("toastArea") === "terminal" ? "Terminal" : "Board"} · ${name(place)}`, why: { label: "Test", color: t.accent }, branch: null, parent: null },
      }]);
      closeOverlay(props()?.overlay);
    };
    // First in the section, above Area and Placement (under the tall picker it looked odd; user, 2026-11-18).
    const testRow = h_flex().gap(10).items_center().py(10).border_b(1).border_color(t.border)
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("Try it"))
        .child(div().text_size(11.5).text_color(t.muted).child("Shows a test notification where you picked. This dialog closes so you can see it.")))
      .child(h_flex().id("notice-test").flex_none().h(26).px(10).items_center().rounded(6).cursor_pointer()
        .bg(t.raised).border(1).border_color(t.border).text_size(11.5).text_color(t.foreground).hover((s) => s.bg(t.hover))
        .on_click(() => test()).child("Send a test"));
    // Over the board (top) or over the terminal (bottom; user, 2026-11-18): a two-way switch, the chosen side raised
    // with the light accent border, like the top bar's space chips.
    const area = this.view("toastArea") === "terminal" ? "terminal" : "board";
    // A switch of a few choices for one setting: the chosen one raised.
    const segs = (setting, current, choices) => h_flex().flex_none().p(2).gap(2).rounded(7).bg(t.background).border(1).border_color(t.border)
      .children(choices.map(([key, label]) => h_flex().id(`${setting}-${key}`).h(24).px(12).items_center().rounded(5).cursor_pointer().text_size(11.5)
        .border(1).border_color(current === key ? alpha(t.accent, "55") : "#00000000")
        .when(current === key, (el) => el.bg(t.raised).text_color(t.foreground)).when(current !== key, (el) => el.text_color(t.muted).hover((s) => s.text_color(t.foreground)))
        .on_click((_e, cx) => { if (current !== key) this.setView(setting, key, cx); }).child(label)));
    // When a notification counts as read (user, 2026-11-18). Each choice says what reads one.
    const readMode = ["open", "visit", "hand"].includes(this.view("noticeRead")) ? this.view("noticeRead") : "visit";
    const readHelp = {
      open: "Opening the bell's list marks everything it shows as read.",
      visit: "A notification stays unread until you click it, or go to its agent's terminal any other way (its card, its tab, a key).",
      hand: "A notification stays unread until you click it, or mark it read with its ✓ in the list.",
    }[readMode];
    const readSection = v_flex()
      .child(heading(t, "Read and unread"))
      .child(h_flex().gap(10).items_center().py(10)
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("Mark as read"))
          .child(div().text_size(11.5).text_color(t.muted).child(`${readHelp} In the list, the row under the pointer has ✓ or ↺ (mark read or unread) and × (remove), and Mark all read works in every mode.`)))
        .child(segs("noticeRead", readMode, [["open", "On open"], ["visit", "On visit"], ["hand", "By hand"]])));
    const areaRow = h_flex().gap(10).items_center().py(10).border_b(1).border_color(t.border)
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("Area"))
        .child(div().text_size(11.5).text_color(t.muted).child("Over the board at the top, or over the terminal at the bottom. The spot below is inside that area.")))
      .child(segs("toastArea", area, [["board", "Board"], ["terminal", "Terminal"]]));
    return sections(t, [v_flex()
      .child(heading(t, "Pop-up notifications"))
      .child(testRow)
      .child(areaRow)
      // The text on the left (with the chosen spot and Reset under it), the picker on the right.
      .child(h_flex().gap(16).items_start().py(10)
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("Placement"))
          .child(div().text_size(11.5).text_color(t.muted).child(`Where notifications pop up ${area === "terminal" ? "over the terminal" : "on the board"}. The newest sits nearest the edge. The bell's list still opens under the bell.`))
          .child(h_flex().mt(10).gap(8).items_center()
            .child(div().text_size(12.5).text_color(t.foreground).child(name(place)))
            .when(Boolean(changed), (el) => el.child(h_flex().id("reset-toastPlace").flex_none().h(20).px(7).items_center().rounded(4).cursor_pointer()
              .text_size(11).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
              .tooltip(`Back to the default (${name(this.defaultView("toastPlace"))})`)
              .on_click((_e, cx) => this.setView("toastPlace", this.defaultView("toastPlace"), cx)).child("Reset")))))
        .child(grid)), readSection]);
  }

  select(tab, cx) { this.tab = tab; remember(tab); cx.notify(); }

  // A rule's example, into the Test tab.
  tryExample(rule, cx) {
    this.test.set_value(rule.example);
    this.select("test", cx);
    this.testSeq++;
    this.runTest(cx);
  }

  runTest(cx) {
    const text = this.test.value();
    const seq = this.testSeq;
    if (!text.trim()) { this.result = undefined; cx.notify(); return; }
    cx.spawn(async (cx) => {
      try {
        const r = await exec(await this.node(), [`${home()}/.config/veroboard/core/classify.js`, text], { timeout: 10000 });
        if (seq !== this.testSeq) return;
        const out = JSON.parse(r.stdout);
        this.result = out.result;
        this.ruleErrors = out.errors;
      } catch (e) { this.result = { error: e?.message ?? String(e) }; }
      cx.notify();
    });
  }

  lane(t, to) {
    const [label, color] = !to ? ["Not blocked", t.muted] : to === "you" ? ["Blocked · You", t.blocked] : [`Blocked · ${to}`, ELSEWHERE];
    return div().flex_none().px(7).py(2).rounded(4).bg(alpha(color, "26")).text_color(color).font_semibold().child(label);
  }

  chip(t, id, text, opts = {}) {
    return h_flex().id(id).h(22).px(8).gap(6).items_center().rounded(5).flex_none().text_size(11.5)
      .when(Boolean(opts.mono), (el) => el.font_family(MONO))
      .bg(opts.mine ? alpha(t.accent, "1f") : t.raised).border(1).border_color(opts.mine ? alpha(t.accent, "55") : t.border)
      .text_color(opts.mine ? t.foreground : t.muted)
      .when(Boolean(opts.tip), (el) => el.tooltip(opts.tip))
      .child(div().max_w(260).truncate().child(text))
      .when(Boolean(opts.onRemove), (el) => el.child(div().id(`${id}-x`).text_color(t.muted).cursor_pointer()
        .hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => opts.onRemove(cx)).child("×")));
  }

  list(t, item) {
    const i = ITEMS.indexOf(item);
    const defaults = listAt(this.defaults, item.key);
    const mine = listAt(this.user, item.key);
    return v_flex().gap(6)
      .child(heading(t, item.label))
      .child(div().text_size(11.5).text_color(t.muted).child(item.help))
      .when(Boolean(item.example), (el) => el.child(this.listExample(t, item)))
      .when(defaults.length + mine.length > 0, (el) => el.child(h_flex().flex_wrap().gap(5)
        .children(defaults.map((v, k) => this.chip(t, `d-${i}-${k}`, v, { mono: item.regex, tip: "From the package defaults" })))
        .children(mine.map((v, k) => this.chip(t, `m-${i}-${k}`, v, { mine: true, mono: item.regex, tip: "Yours", onRemove: (cx) => this.remove(item, v, cx) })))))
      .child(Input.new(this.inputs[i]).h(28).px(9).rounded(6).bg(t.background).border_1().border_color(t.border)
        .text_size(12).text_color(t.foreground).when(Boolean(item.regex), (el) => el.font_family(MONO)));
  }

  // What a tab's callout shows under its text: the card's own badges, or the pattern symbols as code (user, 2026-11-17).
  introShows(t, key) {
    const row = () => h_flex().gap(6).items_center().flex_wrap().text_size(11).text_color(t.muted);
    if (key === "patterns") return row().child(code(t, "\\b")).child("a word edge").child(div().w(8)).child(code(t, "^")).child("the start of a sentence");
    return null;
  }

  // A name the rules count as a person: yours if you listed any (then only those count), else any capitalized name.
  examplePerson() {
    return [...listAt(this.user, ["people", "names"]), ...listAt(this.defaults, ["people", "names"])][0] ?? "Luke";
  }

  // What the card shows for a verdict: its Blocked badge, or none.
  verdict(t, to, short) {
    return to === "you" ? whyBadge(t, "You", t.blocked) : to ? whyBadge(t, to, ELSEWHERE)
      : div().text_color(t.muted).child("not Blocked");
  }

  // A list's example: a message, and what the card shows for it. On Asks and Patterns, also the phrase it takes and what
  // the same message gives without it (user, 2026-11-17). Each is checked in tests/rules.test.js ("dialog examples").
  listExample(t, item) {
    const e = item.example;
    if (typeof e === "object") {
      const msg = v_flex().px(8).py(3).rounded(5).bg(t.background).border(1).border_color(t.border).font_family(MONO).text_color(t.foreground)
        .children(e.msg.split("\n").map((line) => div().child(line)));
      return v_flex().gap(6).px(10).py(8).rounded(6).bg(alpha(t.raised, "80")).text_size(11)
        .child(h_flex().gap(6).items_center().flex_wrap()
          .child(div().text_color(t.dim).child("Example, with")).child(code(t, e.add).text_color(t.foreground))
          .child(div().text_color(t.dim).child("added:")))
        .child(h_flex().gap(8).items_center().flex_wrap()
          .child(msg)
          .child(div().text_color(t.dim).child("→")).child(this.verdict(t, e.to))
          .child(div().text_color(t.dim).child("· without it:")).child(this.verdict(t, e.without, true)));
    }
    const person = e === "person";
    // Not people: a name from the package defaults, so it's the same for everyone (Sonnet, user 2026-11-17).
    const tools = listAt(this.defaults, item.key);
    const name = person ? this.examplePerson() : tools.includes("Sonnet") ? "Sonnet" : tools[0] ?? "Sonnet";
    const msg = person ? `Next: wait for ${name}'s review.` : `Waiting on ${name} to finish the PR.`;
    // The same box as the Asks examples, so every list's example looks alike.
    return v_flex().gap(6).px(10).py(8).rounded(6).bg(alpha(t.raised, "80")).text_size(11)
      .child(div().text_color(t.dim).child("Example:"))
      .child(h_flex().gap(8).items_center().flex_wrap()
        .child(div().px(8).py(3).rounded(5).bg(t.background).border(1).border_color(t.border).font_family(MONO).text_color(t.foreground).child(msg))
        .child(div().text_color(t.dim).child("→"))
        .child(this.verdict(t, person ? name : null)));
  }

  testTab(t) {
    const r = this.result;
    const rule = r && !r.error ? (this.info?.builtins ?? []).find((b) => b.id === r.rule) : null;
    const verdict = r === undefined
      ? div().text_size(11.5).text_color(t.dim).child("The verdict shows here. It uses your saved rules. Each rule on the Rules tab has an example to try.")
      : r && r.error ? div().text_size(11.5).text_color(t.blocked).child(`Couldn't test: ${r.error}`)
      : h_flex().gap(8).items_center().text_size(12)
        .child(this.lane(t, r ? r.to : null))
        .child(div().flex_1().min_w(0).text_color(t.muted).child(r ? `Rule ${r.rule}: ${r.why}` : "No rule matched: the card goes to Done (or Waiting, while background work runs)."))
        .when(Boolean(rule), (el) => el.child(h_flex().id("see-rule").flex_none().h(24).px(9).items_center().rounded(5).cursor_pointer()
          .bg(t.raised).border(1).border_color(t.border).text_size(11.5).text_color(t.foreground).hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => { this.open = rule.id; this.select("rules", cx); }).child("See rule")));
    return v_flex().gap(12)
      .child(heading(t, "Test a message").mb(-4))
      .child(div().text_size(11.5).text_color(t.muted).child("Paste an agent's last message. This is the check the board runs when an agent stops: the result decides whether its card goes to Blocked."))
      .child(Textarea.new(this.test).px(9).py(6).rounded(6).bg(t.background).border_1().border_color(t.border).text_size(12).text_color(t.foreground))
      .child(verdict)
      .child(div().text_size(11).text_color(t.dim).child("The board also needs the agent to be idle: while its background work runs, the card stays in Waiting."));
  }

  rulesTab(t) {
    const off = new Set(listAt(this.user, ["blocked", "disable"]));
    const builtins = this.info?.builtins ?? [];
    const row = (rule) => {
      const on = !off.has(rule.id);
      const open = this.open === rule.id;
      const toggle = h_flex().id(`sw-${rule.id}`).w(30).h(17).flex_none().rounded(9).px(2).items_center().cursor_pointer()
        .bg(on ? alpha(t.done, "66") : t.raised).border(1).border_color(on ? alpha(t.done, "99") : t.border)
        .tooltip(on ? "On: click to switch off" : "Off: click to switch on")
        .when(on, (el) => el.justify_end())
        .on_click((_e, cx) => this.toggleRule(rule.id, cx))
        .child(div().size(11).rounded(6).bg(on ? t.foreground : t.dim));
      const head = h_flex().id(`rh-${rule.id}`).flex_1().min_w(0).h(30).gap(9).items_center().cursor_pointer()
        .on_click((_e, cx) => { this.open = open ? null : rule.id; cx.notify(); })
        .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child(open ? "▾" : "▸"))
        .child(div().flex_none().w(150).truncate().font_family(MONO).text_size(11.5).text_color(on ? t.foreground : t.dim).child(rule.id))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(on ? t.muted : t.dim).child(rule.what));
      return v_flex().mx(-9).rounded(6).border(1).border_color(open ? t.border : t.popover).when(open, (el) => el.bg(alpha(t.raised, "80")))
        .child(h_flex().px(8).gap(8).items_center().child(head).child(toggle))
        .when(open, (el) => el.child(v_flex().px(27).pb(10).gap(8)
          .child(div().text_size(11.5).text_color(t.foreground).child(rule.more))
          .child(div().text_size(10.5).font_semibold().text_color(t.dim).child("EXAMPLE"))
          .child(div().px(9).py(7).rounded(5).bg(t.background).border(1).border_color(t.border)
            .font_family(MONO).text_size(11).text_color(t.foreground).child(rule.example))
          .child(h_flex().gap(8).items_center().text_size(11.5)
            .child(div().text_color(t.muted).child("Gives"))
            .child(this.lane(t, rule.expect))
            .child(div().flex_1())
            .when(rule.testable !== false, (el) => el.child(h_flex().id(`try-${rule.id}`).h(24).px(9).items_center().rounded(5).cursor_pointer()
              .bg(t.raised).border(1).border_color(t.border).text_color(t.foreground).hover((s) => s.bg(t.hover))
              .on_click((_e, cx) => this.tryExample(rule, cx)).child("Try it in Test")))
            .when(!on, (el) => el.child(div().text_color(t.dim).child("Off: the example won't give this now."))))));
    };
    return v_flex().gap(18)
      .child(sections(t, GROUPS.map(([group, note]) => {
        const rules = builtins.filter((b) => b.group === group);
        return v_flex().gap(4)
          .child(v_flex().gap(6).mb(4)
            .child(heading(t, group))
            .child(div().text_size(11.5).text_color(t.muted).child(note)))
          .children(rules.map(row));
      })));
  }

  render() {
    const t = theme();
    const off = listAt(this.user, ["blocked", "disable"]).length;
    const head = h_flex().h(44).flex_none().px(18).gap(10).items_center()
      .child(div().text_size(15).font_semibold().text_color(t.foreground).child("Veroboard settings"))
      .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.info?.config ?? ""))
      .when(Boolean(this.info), (el) => el.child(h_flex().id("br-open").h(26).px(10).items_center().rounded(6).cursor_pointer()
        .bg(t.raised).border(1).border_color(t.border).text_size(11.5).text_color(t.foreground).hover((s) => s.bg(t.hover))
        .tooltip("Open the file in your text editor")
        .on_click(() => exec("open", ["-t", this.info.config]).catch(() => {})).child("Open file")))
      .child(h_flex().id("br-close").size(26).items_center().justify_center().rounded(6).cursor_pointer().text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => closeOverlay(props()?.overlay)).child("×"));
    const tabs = h_flex().h(34).flex_none().px(14).gap(2).items_end().border_b(1).border_color(t.border)
      .children(TABS.map((tab) => {
        const active = this.tab === tab.key;
        // No counts on the tabs (user, 2026-11-17): they read as alerts and only some tabs had one.
        const count = "";
        return h_flex().id(`tab-${tab.key}`).h(34).px(10).gap(6).items_center().cursor_pointer()
          .border_b_2().border_color(active ? t.accent : t.popover)
          .text_size(12.5).text_color(active ? t.foreground : t.muted).when(active, (el) => el.font_semibold())
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => this.select(tab.key, cx))
          .child(tab.label)
          .when(count !== "", (el) => el.child(div().px(5).rounded(4).bg(t.raised).text_size(10).text_color(t.muted).child(count)));
      }));
    const banner = (text, color) => div().mx(18).mt(12).px(10).py(7).rounded(6).bg(alpha(color, "1f")).border(1)
      .border_color(alpha(color, "55")).text_size(11.5).text_color(t.foreground).child(text);
    const tab = TABS.find((x) => x.key === this.tab) ?? TABS[0];
    const content = tab.key === "display" ? (this.user ? this.boardTab(t) : div())
      : tab.key === "card" ? (this.user ? this.cardTab(t) : div())
      : tab.key === "notices" ? (this.user ? this.noticesTab(t) : div())
      : tab.key === "test" ? this.testTab(t)
      : tab.key === "rules" ? this.rulesTab(t)
      : v_flex().gap(18).when(Boolean(tab.intro), (el) => el.child(callout(t, tab.intro, this.introShows(t, tab.key))))
        .when(Boolean(this.user), (el) => el.child(sections(t, tab.items.map((item) => this.list(t, item)))));
    // A light accent border like the selected space chip's, so the dialog stands off the board (user, 2026-11-18).
    return v_flex().id("board-settings-panel").size_full().bg(t.popover).text_color(t.foreground)
      .rounded(10).border(1).border_color(alpha(t.accent, "55"))
      .track_focus(this.handle)
      // Card or Board tab, an item picked in its layout editor: the arrow keys move it like the buttons (← → along its line and across sides,
      // ↑ ↓ a line). Keys typed in a text box stay there: those boxes hold the keyboard themselves.
      .on_key_down((e, cx) => {
        const how = { left: "left", right: "right", up: "up", down: "down" }[e.key];
        const key = { card: "card", display: "top" }[this.tab];
        if (!how || !key || !this.picked || this.pickedIn !== key) return;
        this.moveIn(key, how, cx);
        cx.stop_propagation();
      })
      .child(head)
      .child(tabs)
      .when(Boolean(this.parseError), (el) => el.child(banner(`Your config isn't valid JSON (${this.parseError}). Fix it with Open file, then reopen this dialog. The board uses the defaults meanwhile.`, t.blocked)))
      .when(Boolean(this.ruleErrors?.length), (el) => el.child(banner(`Rule errors: ${this.ruleErrors.join("; ")}`, t.blocked)))
      .when(Boolean(this.status), (el) => el.child(div().mx(18).mt(10).text_size(11.5).text_color(t.muted).child(this.status)))
      .child(v_flex().id(`br-body-${tab.key}`).flex_1().min_h(0).overflow_y_scrollbar().px(18).py(14).child(content));
  }
}

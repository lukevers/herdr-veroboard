// Veroboard's notifications. Two jobs:
//  1. layouts/veroboard.json names this mod as its "toast" (herdr-app#364), so Herdr opens it for every notification
//     (an agent needs you or finished, a failed command, a note about a mod). It hands the notification to the board,
//     which shows it in its own top-right corner, away from the terminal you type in, adds it to the history, and
//     closes Herdr's toast at once, so the bottom-right corner stays clear (user, 2026-11-18). Other layouts keep Herdr's.
//  2. Opened from the top bar's bell (props.view "history"): the history, newest first.
import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, shared, setShared, theme, run, spaces } from "herdr";

const NOTICES = "veroboard.notices"; // showing on the board now
const LOG = "veroboard.noticeLog"; // the history, oldest first, the last 50
// Sizes, kept in step with the bell in mods/veroboard/main.js, which opens this popup at exactly header + list.
// A row has a fixed height so four of them really fit (user, 2026-11-18); the list is 4 to 7 rows, then it scrolls.
const ROW_H = 62, LIST_MIN = 4 * ROW_H, LIST_MAX = 7 * ROW_H, EDGE_H = 10;
const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };
const list = (key) => (Array.isArray(shared(key)) ? shared(key) : []).filter(Boolean);
const alpha = (hex, aa) => (/^#[0-9a-fA-F]{6}$/.test(hex) ? hex + aa : hex);
// a → b by f (0..1), for hex colors.
const mix = (a, b, f) => {
  const h = (x) => (/^#[0-9a-fA-F]{6}/.test(x) ? [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16)) : null);
  const [p, q] = [h(a), h(b)];
  return p && q ? "#" + p.map((v, i) => Math.round(v + (q[i] - v) * f).toString(16).padStart(2, "0")).join("") : a;
};
// The edge between new and read notifications: a sawtooth, like a torn receipt, filled with the read part's darker color,
// in a 10px band of its own (the rows keep their full height). In the 3px stripe column, the stripe above runs halfway
// down and the one below halfway up (dimmed like its row), so the stripes don't break there (user, 2026-11-19: a gap
// looked broken; overlapping a row took room from it; a colored block didn't read as a divider). `above`/`below`: the
// stripe colors, or null for a notice without one.
const sawtooth = (color, above, below, w = 380, h = EDGE_H, tooth = 16) => {
  const pts = [[0, h], [0, h / 2]];
  for (let x = 0; x < w; x += tooth) pts.push([x + tooth / 2, 0], [Math.min(w, x + tooth), h / 2]);
  pts.push([w, h]);
  return div().relative().w_full().h(h).flex_none()
    .child(globalThis.window.paint_path(PathBuilder.fill().add_polygon(pts, true).build(), color).absolute().top(0).left(0).size_full())
    .when(Boolean(above), (el) => el.child(div().absolute().left(0).top(0).w(3).h(h / 2).bg(above)))
    .when(Boolean(below), (el) => el.child(div().absolute().left(0).top(h / 2).w(3).h(h / 2).bg(below).opacity(0.45)));
};
// A card-style badge (as card.js badge()): 16px, the theme's raised color unless given, an optional 10px icon, mono for ids.
// `shrink`: gives way first when the line runs out of room, its text cut with … (the branch, so the parent still shows).
const pill = (t, text, fg, bg = t.raised, mono = false, icon = null, shrink = false) => h_flex().h(16).px(6).gap(4).items_center()
  .rounded(4).bg(bg).text_size(10.5).text_color(fg).when(mono, (el) => el.font_family("JetBrains Mono"))
  .when(shrink, (el) => el.flex_shrink(1).min_w(0)).when(!shrink, (el) => el.flex_none())
  .when(Boolean(icon), (el) => el.child(svg(icon).size(10).flex_none())).child(div().min_w(0).truncate().child(text));
// Which space a notification belongs to: as noticeIn in mods/veroboard/main.js (keep the two in step).
const noticeIn = (n, sp) => !sp || !n.agent || (n.agent.spaceId ? n.agent.spaceId === sp.id : !n.agent.space || n.agent.space === sp.name);
// The list's two surfaces (user, 2026-11-18): the header a step darker than the popup color (halfway to the canvas,
// a touch of the accent), the body a step lighter (a third of the way to raised). Same as the settings dialog.
const headBg = (t) => mix(mix(t.popover, t.canvas ?? "#000000", 0.5), t.accent, 0.04);
const bodyBg = (t) => mix(t.popover, t.raised ?? t.popover, 0.3);
const ago = (ms) => ms < 60000 ? "now" : ms < 3600000 ? `${Math.floor(ms / 60000)}m` : ms < 86400000 ? `${Math.floor(ms / 3600000)}h` : `${Math.floor(ms / 86400000)}d`;

export default class VeroboardToast extends View {
  init() {
    const p = props() ?? {};
    // Only a real notification comes with its overlay (herdr-app check runs this without one); the bell's list has a view.
    if (typeof p.overlay !== "string" || p.view === "history") return;
    const now = Date.now();
    // Herdr's timeout when it gives one; else an alert that wants you stays 20s, anything else 8s.
    const timeout = Number.isFinite(p.timeout) && p.timeout > 0 ? p.timeout : p.level === "warning" || p.level === "error" ? 20000 : 8000;
    const notice = {
      id: `${now}-${Math.random().toString(36).slice(2, 7)}`, at: now, timeout,
      title: String(p.title ?? ""), body: p.body ? String(p.body) : "", level: p.level ?? "info",
      icon: typeof p.icon === "string" ? p.icon : null, action: p.action?.name ? p.action : null,
    };
    setShared(NOTICES, [...list(NOTICES).filter((n) => n.at + n.timeout > now).slice(-9), notice]);
    setShared(LOG, [...list(LOG).slice(-49), notice]);
    closeOverlay(p.overlay);
  }

  // The list closing (a click beside it, Esc, a row): note when, so a click on the bell that closed it doesn't open it
  // again (mods/veroboard/main.js, the bell; user, 2026-11-18).
  async close() {
    if (props()?.view === "history") setShared("veroboard.listClosedAt", Date.now());
  }

  render() {
    const p = props() ?? {};
    if (p.view !== "history") return div();
    // The theme, its lines (between rows) a step darker than the lighter body (bodyBg): the theme's border is about the
    // body's color, so they vanished (user, 2026-11-18).
    const base = theme();
    const t = { ...base, border: mix(bodyBg(base), base.canvas ?? "#000000", 0.4) };
    const now = Date.now();
    // Which space's notifications: the board's space when the bell opened this (null: all), then the chip you pick.
    const all = spaces();
    if (this.space === undefined) this.space = p.space ?? null;
    if (this.space && !all.some((s) => s.id === this.space)) this.space = null;
    const sp = all.find((s) => s.id === this.space) ?? null;
    const whole = list(LOG).slice().reverse();
    const log = whole.filter((n) => noticeIn(n, sp));
    // When one counts as read (p.mode, Veroboard settings → Notifications; user, 2026-11-18): "open": opening this marks
    // what it shows (the bell did, and passed their ids: they stay bright while it's open); "visit" and "hand": they
    // stay unread until clicked, ✓, Mark all read, or (visit) their agent is visited. ↺ marks one unread again.
    // Unread rows are bright on top; read ones dimmed under the sawtooth.
    const mode = ["open", "visit", "hand"].includes(p.mode) ? p.mode : "visit";
    this.fresh ??= new Set(Array.isArray(p.fresh) ? p.fresh : []);
    const seenBefore = Number(p.seenBefore) || 0;
    const unread = (n) => Boolean(n.unread) || (!n.read && !n.seen && n.at > seenBefore);
    const isRead = (n) => !(unread(n) || (this.fresh.has(n.id) && !n.read));
    const fresh = log.filter((n) => !isRead(n)), read = log.filter(isRead);
    // Mark these read (or unread): in the log the bell counts from.
    const mark = (ids, asRead) => {
      ids.forEach((i) => this.fresh.delete(i));
      setShared(LOG, list(LOG).map((n) => (ids.includes(n.id) ? (asRead ? { ...n, read: true, unread: false } : { ...n, read: false, seen: false, unread: true }) : n)));
    };
    // Picking a space shows its notifications; with "open", the unread ones there count as seen now (and stay bright).
    const pick = (id, cx) => {
      this.space = id;
      const s = all.find((x) => x.id === id) ?? null;
      const now2 = list(LOG), ids = mode !== "open" ? [] : now2.filter((n) => unread(n) && noticeIn(n, s)).map((n) => n.id);
      if (ids.length) { ids.forEach((i) => this.fresh.add(i)); setShared(LOG, now2.map((n) => (ids.includes(n.id) ? { ...n, seen: true, unread: false } : n))); }
      cx?.notify?.();
    };
    const count = (s) => whole.filter((n) => noticeIn(n, s)).length;
    // A chip as the top bar's space chips (topbar.js chip): the selected one tinted with the accent, its border and
    // text in the accent; the others plain until the pointer is over them.
    const chip = (id, label, n) => {
      const on = this.space === id;
      return h_flex().id(`log-sp-${id ?? "all"}`).flex_none().h(22).px(8).gap(5).items_center().rounded(6).text_size(11.5)
        .border(1).border_color(on ? alpha(t.accent, "55") : "#00000000").when(on, (el) => el.bg(alpha(t.accent, "26")))
        .text_color(on ? t.accent : t.muted).cursor_pointer()
        .when(!on, (el) => el.hover((s) => s.bg(alpha(t.accent, "14")).text_color(t.foreground)))
        .on_click((_e, cx) => pick(id, cx))
        .child(label).when(n > 0, (el) => el.child(div().text_size(10.5).text_color(on ? alpha(t.accent, "99") : t.dim).child(String(n))));
    };
    // The header's buttons (Mark all read, Clear): plain text that takes the accent's tint under the pointer.
    const headBtn = (id, label, act) => div().id(id).px(7).py(3).rounded(5).text_size(11.5).text_color(t.muted)
      .cursor_pointer().hover((s) => s.bg(alpha(t.accent, "26")).text_color(t.foreground)).on_click(act).child(label);
    const dark = mix(t.popover, t.canvas ?? "#000000", 0.75);
    // The last new row has no bottom line: the sawtooth is its edge.
    // At every row's right, one above the other (always shown; user, 2026-11-18): ✓ (mark read) on an unread one,
    // ↺ (mark unread) on a read one. A read row under the pointer is less dimmed.
    // Under it, × removes that one notification (from the list and, if it's still up, the board; user, 2026-11-18).
    const btn = (id, label, tip, act) => div().id(id).size(22).flex().items_center().justify_center().rounded(5)
      .cursor_pointer().text_size(12.5).text_color(t.muted).hover((s) => s.bg(t.raised).text_color(t.foreground))
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click((_e, cx) => { cx.stop_propagation(); act(); })
      .child(label);
    const remove = (id) => {
      this.fresh.delete(id);
      setShared(LOG, list(LOG).filter((n) => n.id !== id));
      if (list(NOTICES).some((n) => n.id === id)) setShared(NOTICES, list(NOTICES).filter((n) => n.id !== id));
      if (this.hover === id) this.hover = null;
    };
    const toggle = (n) => {
      const r = isRead(n);
      return v_flex().flex_none().w(22).gap(2).justify_center()
        .child(btn(`log-mk-${n.id}`, r ? "↺" : "✓", r ? "Mark as unread" : "Mark as read", () => mark([n.id], !r)))
        .child(btn(`log-rm-${n.id}`, "×", "Remove", () => remove(n.id)));
    };
    // A notice's stripe color: its why's, for one about an agent (the row draws it); none otherwise.
    const stripe = (n) => (n?.agent?.name ? n.agent.why?.color ?? t.accent : null);
    const row = (n) => h_flex().id(`log-${n.id}`).relative().h(ROW_H).flex_none().pl(14).pr(8).gap(11).items_center()
      .when(!(n === fresh[fresh.length - 1] && read.length > 0), (el) => el.border_b(1).border_color(t.border))
      .when(isRead(n), (el) => el.opacity(this.hover === n.id ? 0.8 : 0.45))
      .on_hover((on, cx) => { if (on) this.hover = n.id; else if (this.hover === n.id) this.hover = null; cx.notify(); })
      // Clicking one reads it (and goes to its agent, closing the list).
      // Under the pointer: the accent's tint (the theme's hover color is darker than the lighter body).
      .when(Boolean(n.action), (el) => el.cursor_pointer().hover((s) => s.bg(alpha(t.accent, "14"))).on_click(() => {
        mark([n.id], true);
        run(n.action.name, n.action.args ?? {});
        closeOverlay(p.overlay);
      }))
      .when(!n.agent?.name, (el) => el
        .child(n.icon ? image(n.icon).w(16).h(16).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[n.level] ?? "accent"] ?? t.accent))
        // The same frame as an agent's row (user, 2026-11-18): an 18px line and a 16px line, the second even when empty.
        .child(v_flex().flex_1().min_w(0).gap(6)
          .child(div().h(18).flex_none().truncate().font_semibold().text_size(12.5).text_color(t.foreground).child(n.title))
          .child(div().h(16).flex_none().truncate().text_size(11.5).text_color(t.muted).child(n.body ?? "")))
        .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(now - n.at)))
        .child(toggle(n)))
      // About an agent (the board saved its card facts on arrival): a slim card, as on the board's notices
      // (user, 2026-11-18): a stripe in the why's color; name, why + age, id; then space, branch, who opened it.
      .when(Boolean(n.agent?.name), (el) => el
        // The stripe is the row's own left edge, as on a card, not a bar inside the padding (user, 2026-11-18).
        .child(div().absolute().left(0).top(0).bottom(0).w(3).bg(n.agent.why?.color ?? t.accent))
        .child(v_flex().flex_1().min_w(0).gap(6)
          .child(h_flex().h(18).flex_none().gap(6).items_center()
            .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(12.5).text_color(t.foreground).child(n.agent.name))
            .when(Boolean(n.agent.why?.label), (el) => el.child(pill(t, `${n.agent.why.label} ${ago(now - n.at)}`, n.agent.why.color, alpha(n.agent.why.color, "26"))))
            .child(pill(t, n.agent.address, t.muted, t.raised, true)))
          // Always there, empty or not (one space shown and no branch or parent), so every row is laid out alike.
          .child(h_flex().h(16).flex_none().gap(5).items_center().overflow_hidden()
            // Its space, hidden when the list shows one space only (as on the cards).
            .when(Boolean(n.agent.space) && !sp, (el) => el.child(pill(t, n.agent.space, t.muted)))
            // As on the card: a branch in a linked worktree is blue with the layers icon.
            .when(Boolean(n.agent.branch), (el) => el.child(n.agent.branch.worktree
              ? pill(t, n.agent.branch.name, t.ansi4, alpha(t.ansi4, "26"), false, "mods/veroboard/icons/layers.svg", true)
              : pill(t, n.agent.branch.name, t.muted, t.raised, false, "mods/veroboard/icons/git-branch.svg", true)))
            // Who opened it on the right, under the id (user, 2026-11-19: both lines end in an agent's id); the branch
            // gives way first.
            .when(Boolean(n.agent.parent), (el) => el.child(div().flex_1().min_w(0))
              .child(pill(t, `${n.agent.parent.name || n.agent.parent.address} · ${n.agent.parent.address}`, t.muted, t.raised, false, "mods/veroboard/launched-by.svg")))))
        .child(toggle(n)));
    // A popup is as big as its content, so the list gets a real height (see ROW_H).
    // The header (the title and the space chips) on a light accent tint, like the top bar's selected space, with an
    // accent line under it, so it stands apart from the list (user, 2026-11-18). Same heights as before (40 + 34 and
    // their 1px lines), so the popup the bell sized still fits.
    const chips = Boolean(p.bar) && all.length > 1;
    const header = v_flex().flex_none().bg(headBg(t)).border_b(1).border_color(alpha(t.accent, "55"))
      .child(h_flex().h(chips ? 40 : 39).px(14).gap(8).items_center().when(chips, (el) => el.border_b(1).border_color(alpha(t.accent, "26")))
        .child(svg("mods/veroboard/bell.svg").size(13).text_color(t.accent))
        .child(div().flex_1().text_size(12.5).font_semibold().text_color(t.foreground).child("Notifications"))
        // Marks what's shown read (this space's, or all), when any is unread.
        .when(fresh.length > 0, (el) => el.child(headBtn("log-read-all", "Mark all read", () => mark(log.map((n) => n.id), true))))
        // Clears what's shown: this space's (and Herdr's own), or all of them.
        .when(log.length > 0, (el) => el.child(headBtn("log-clear", "Clear", () => {
          const keep = (n) => !noticeIn(n, sp);
          setShared(LOG, list(LOG).filter(keep)); setShared(NOTICES, list(NOTICES).filter(keep));
        }))))
      // The spaces, when there's more than one (the bell sized the popup for this row: p.bar).
      .when(chips, (el) => el.child(h_flex().id("log-spaces").h(33).px(10).gap(4).items_center().overflow_x_scroll()
        .child(chip(null, "All", whole.length))
        .children(all.map((s) => chip(s.id, s.name, count(s))))));
    return v_flex().w(380).bg(bodyBg(t)).rounded(10).border(1).border_color(alpha(t.accent, "55")).overflow_hidden()
      .child(header)
      .child(log.length
        // New on top on the popup's own color; then a sawtooth edge and the read ones on a darker color, dimmed (user,
        // 2026-11-18). All read: the whole list is the darker part; none read: no edge.
        // The height the bell sized the popup for; it stays when you pick another space (the list scrolls).
        ? v_flex().id("log-list").h(Number(p.listH) || Math.max(LIST_MIN, Math.min(LIST_MAX, log.length * ROW_H + (fresh.length && read.length ? EDGE_H : 0)))).overflow_y_scrollbar()
          .children(fresh.map(row))
          .when(fresh.length > 0 && read.length > 0, (el) => el.child(sawtooth(dark, stripe(fresh[fresh.length - 1]), stripe(read[0]))))
          // The read part runs to the bottom, so a short list doesn't end in a lighter strip.
          .when(read.length > 0, (el) => el.child(v_flex().flex_grow(1).flex_shrink_0().bg(dark).children(read.map(row))))
        : div().h(Number(p.listH) || LIST_MIN).p(18).text_size(12).text_color(t.muted)
          .child(sp && whole.length ? `Nothing in ${sp.name} yet. Pick All for the other spaces.`
            : "Nothing yet. What Herdr tells you lands here, newest first: an agent needs you or finished, a command failed."));
  }
}

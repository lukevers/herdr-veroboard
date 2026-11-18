// Veroboard's notifications. Two jobs:
//  1. layouts/veroboard.json names this mod as its "toast" (herdr-app#364), so Herdr opens it for every notification
//     (an agent needs you or finished, a failed command, a note about a mod). It hands the notification to the board,
//     which shows it in its own top-right corner, away from the terminal you type in, adds it to the history, and
//     closes Herdr's toast at once, so the bottom-right corner stays clear (user, 2026-11-18). Other layouts keep Herdr's.
//  2. Opened from the top bar's bell (props.view "history"): the history, newest first.
import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, closeOverlay, shared, setShared, theme, run } from "herdr";

const NOTICES = "veroboard.notices"; // showing on the board now
const LOG = "veroboard.noticeLog"; // the history, oldest first, the last 50
// Sizes, kept in step with the bell in mods/veroboard/main.js, which opens this popup at exactly header + list.
// A row has a fixed height so four of them really fit (user, 2026-11-18); the list is 4 to 7 rows, then it scrolls.
const ROW_H = 56, LIST_MIN = 4 * ROW_H, LIST_MAX = 7 * ROW_H, EDGE_H = 10;
const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };
const list = (key) => (Array.isArray(shared(key)) ? shared(key) : []).filter(Boolean);
const alpha = (hex, aa) => (/^#[0-9a-fA-F]{6}$/.test(hex) ? hex + aa : hex);
// a → b by f (0..1), for hex colors.
const mix = (a, b, f) => {
  const h = (x) => (/^#[0-9a-fA-F]{6}/.test(x) ? [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16)) : null);
  const [p, q] = [h(a), h(b)];
  return p && q ? "#" + p.map((v, i) => Math.round(v + (q[i] - v) * f).toString(16).padStart(2, "0")).join("") : a;
};
// The edge between new and read notifications: a sawtooth, like a torn receipt, filled with the read part's darker color.
const sawtooth = (color, w = 380, h = EDGE_H, tooth = 16) => {
  const pts = [[0, h], [0, h / 2]];
  for (let x = 0; x < w; x += tooth) pts.push([x + tooth / 2, 0], [Math.min(w, x + tooth), h / 2]);
  pts.push([w, h]);
  return div().relative().w_full().h(h).flex_none()
    .child(globalThis.window.paint_path(PathBuilder.fill().add_polygon(pts, true).build(), color).absolute().top(0).left(0).size_full());
};
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

  render() {
    const p = props() ?? {};
    if (p.view !== "history") return div();
    const t = theme();
    const now = Date.now();
    const log = list(LOG).slice().reverse();
    // Read: there at your last look at this list, or clicked or dismissed on the board. Read rows are dimmed.
    const seenBefore = Number(p.seenBefore) || 0;
    const isRead = (n) => Boolean(n.read) || n.at <= seenBefore;
    const fresh = log.filter((n) => !isRead(n)), read = log.filter(isRead);
    const dark = mix(t.popover, t.canvas ?? "#000000", 0.75);
    // The last new row has no bottom line: the sawtooth is its edge.
    const row = (n) => h_flex().id(`log-${n.id}`).h(ROW_H).flex_none().px(14).gap(11).items_center()
      .when(!(n === fresh[fresh.length - 1] && read.length > 0), (el) => el.border_b(1).border_color(t.border))
      .when(isRead(n), (el) => el.opacity(0.45))
      .when(Boolean(n.action), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => {
        run(n.action.name, n.action.args ?? {});
        closeOverlay(p.overlay);
      }))
      .child(n.icon ? image(n.icon).w(16).h(16).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[n.level] ?? "accent"] ?? t.accent))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(div().truncate().font_semibold().text_size(12.5).text_color(t.foreground).child(n.title))
        .when(Boolean(n.body), (el) => el.child(div().truncate().text_size(11.5).text_color(t.muted).child(n.body))))
      .child(div().flex_none().text_size(11).text_color(t.dim).child(ago(now - n.at)));
    // A popup is as big as its content, so the list gets a real height (see ROW_H).
    return v_flex().w(380).bg(t.popover).rounded(10).border(1).border_color(alpha(t.accent, "55")).overflow_hidden()
      .child(h_flex().flex_none().h(40).px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(svg("mods/veroboard/bell.svg").size(13).text_color(t.muted))
        .child(div().flex_1().text_size(12.5).font_semibold().text_color(t.foreground).child("Notifications"))
        .when(log.length > 0, (el) => el.child(div().id("log-clear").px(7).py(3).rounded(5).text_size(11.5).text_color(t.muted)
          .cursor_pointer().hover((s) => s.bg(t.hover).text_color(t.foreground))
          .on_click(() => { setShared(LOG, []); setShared(NOTICES, []); }).child("Clear"))))
      .child(log.length
        // New on top on the popup's own color; then a sawtooth edge and the read ones on a darker color, dimmed (user,
        // 2026-11-18). All read: the whole list is the darker part; none read: no edge.
        ? v_flex().id("log-list").h(Math.max(LIST_MIN, Math.min(LIST_MAX, log.length * ROW_H + (fresh.length && read.length ? EDGE_H : 0)))).overflow_y_scrollbar()
          .children(fresh.map(row))
          .when(fresh.length > 0 && read.length > 0, (el) => el.child(sawtooth(dark)))
          // The read part runs to the bottom, so a short list doesn't end in a lighter strip.
          .when(read.length > 0, (el) => el.child(v_flex().flex_grow(1).flex_shrink_0().bg(dark).children(read.map(row))))
        : div().h(LIST_MIN).p(18).text_size(12).text_color(t.muted)
          .child("Nothing yet. What Herdr tells you lands here, newest first: an agent needs you or finished, a command failed."));
  }
}

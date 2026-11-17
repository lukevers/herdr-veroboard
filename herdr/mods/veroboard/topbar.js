// The board's top bar: the space chips, the new-space button, the agent count, the status pie, the divider, the
// settings gear and the filter box, each placed where Board settings → Board puts it (VIEW.top). main.js builds the
// live pieces; the settings dialog builds look-alikes for its example. renderTopBar arranges either.
import { div, svg, PathBuilder } from "gpui-kit";
import { h_flex } from "gpui-base";
import { keys } from "herdr";
import { alpha, dot, mix, VIEW, topLayout } from "./card.js";

const SYMBOL = { cmd: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" };

const hint = action => keys().find(k => k.section === "layout:veroboard" && k.action === action)?.keys
  .split("-").map(k => SYMBOL[k] ?? k).join("") ?? "";

// The header's status pie: one slice per column, sized by its agent count, clockwise from
// 12 o'clock in column order. Grey with no agents.
// Slices are painted as stacked wedges from 12 o'clock over a full circle, so no seams show between them.
// The point on the pie's edge `a` degrees clockwise from 12 o'clock.
const at = a => [`${50 + 50 * Math.sin(a * Math.PI / 180)}%`, `${50 - 50 * Math.cos(a * Math.PI / 180)}%`];
const wedge = (deg, color) => {
  const path = PathBuilder.fill().move_to("50%", "50%").line_to("50%", "0%")
    .arc_to("50%", "50%", 0, deg > 180, true, ...at(deg)).close().build();
  // `window` here is Herdr's; the GPUI window is the global one.
  return globalThis.window.paint_path(path, color).absolute().top(0).left(0).size_full();
};
// A dark line from the center to the edge at `deg`: the pie's slices are pastels of about the same
// lightness, so at this size they blur together without a line between them.
const seamLine = (deg, color, width) => globalThis.window
  .paint_path(PathBuilder.stroke(width).move_to("50%", "50%").line_to(...at(deg)).build(), color)
  .absolute().top(0).left(0).size_full();
// A pie of `size` px; `tint` maps each slice's color (the glow rings use it to fade toward the bar).
// With `seam` (a color), a line of that color divides the slices.
const pie = (slices, size, tint = c => c, seam = null) => {
  if (slices.length < 2) return dot(tint(slices[0].color), size);
  const total = slices.reduce((n, s) => n + s.n, 0);
  let sum = 0;
  const ends = slices.map(s => (sum += s.n) / total * 360);
  return div().relative().size(size).flex_none()
    .child(dot(tint(slices.at(-1).color), size).absolute().top(0).left(0))
    .children(slices.slice(0, -1).map((s, i) => wedge(ends[i], tint(s.color))).reverse())
    .when(Boolean(seam), el => el.children([0, ...ends.slice(0, -1)].map(deg => seamLine(deg, seam, 0.5))));
};

const chip = (t, label, selected = false, hotkey = "") => h_flex().h(27).px(11).gap(7).items_center().rounded(6).flex_none().cursor_pointer()
  .bg(selected ? alpha(t.accent, "26") : t.surface).border(1).border_color(selected ? alpha(t.accent, "55") : t.border)
  .text_size(11).text_color(selected ? t.accent : t.muted).child(label)
  .when(hotkey !== "", el => el.child(div().text_size(10).text_color(selected ? alpha(t.accent, "99") : t.dim).child(hotkey)));

// The new-space button, the gear and the divider: the same in the bar and in the example.
const newSpaceButton = (t) => h_flex().id("chip-new-space").size(27).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
  .bg(t.surface).border(1).border_color(t.border).text_size(14).text_color(t.muted)
  .hover((s) => s.bg(t.hover).text_color(t.foreground)).child("+");
const gearButton = (t) => h_flex().id("board-settings").size(27).flex_none().items_center().justify_center().rounded(6).cursor_pointer()
  .bg(t.surface).border(1).border_color(t.border).text_color(t.muted).tooltip("Board settings")
  .hover((s) => s.bg(t.hover).text_color(t.foreground))
  .child(svg("mods/workspace-chrome/settings.svg").size(13));
// A short divider in the lane dividers' color (user, 2026-11-16).
const dividerLine = (t) => div().w(1).h(17).flex_none().mx(4).bg(mix(t.canvas, t.border, 0.5));

// The bar: the left side's pieces, a gap that takes what's left, then the right side's. A piece that's missing
// (null) is skipped. o: { pick, picked, decorate } as for renderCard (the example's pieces are clickable/draggable).
const renderTopBar = (pieces, t, o = {}) => {
  const layout = o.layout ?? VIEW.top ?? topLayout(null);
  const place = (id) => {
    const el = pieces[id];
    if (!el) return null;
    if (!o.pick) return el;
    return div().id(`pick-${id}`).flex_none().when(id === "spaces", (d) => d.flex_shrink(1).min_w(0))
      .flex().items_center().rounded(7).p(1).border(1).border_color(o.picked === id ? t.accent : alpha(t.accent, "00"))
      .bg(o.picked === id ? alpha(t.accent, "26") : alpha(t.accent, "00")).cursor_pointer()
      .hover((s) => s.border_color(alpha(t.accent, "88")))
      .on_click((_e, cx) => o.pick(id, cx))
      .when(Boolean(o.decorate), (d) => o.decorate(d, id))
      .child(el);
  };
  const line = layout.lines[0];
  return h_flex().flex_1().min_w(0).h_full().gap(7).items_center()
    .children(line.left.map(place).filter(Boolean))
    .child(div().flex_1())
    .children(line.right.map(place).filter(Boolean));
};

export { SYMBOL, hint, pie, chip, newSpaceButton, gearButton, dividerLine, renderTopBar };

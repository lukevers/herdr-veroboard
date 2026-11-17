// The patch cables between an agent's card and the cards of agents it opened: their curve, look and plugs. main.js
// wires() draws the board's; the settings dialog draws an example with the same code (Board tab → Patch cables).
import { PathBuilder } from "gpui-kit";
import { alpha } from "./card.js";

// Patch cables between a parent agent's card and the cards of agents it opened, like a modular synth rack.
// Paths are in px, local to the board's columns. A cable leaves each card edge sideways (`out`: +1 right,
// -1 left), reaches out, and sags under its own weight; a shadow under it and a sheen on top give it body.
const paintAt = (path, color) => globalThis.window.paint_path(path, color).absolute().top(0).left(0).size_full();
// Cables run behind the cards (the user's call: a free droop beats routing around cards), so the sag
// grows with length like real slack, kept on the board by `maxY`.
// `maxX`: the board's width. Handles are kept inside it, and a cubic never leaves its handles' hull, so no cable
// gets cut off at the board's right edge.
const cablePath = (a, b, outA, outB, width, dy = 0, maxY = Infinity, maxX = Infinity) => {
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  // A short hop across one gutter (jacks under 80px apart) would kink into a V, its handles crossing: it gets
  // a minimum slack instead, handles nearly straight down, so it hangs in a small loop in the gutter.
  const dx = Math.abs(b.x - a.x), short = outA !== outB && dx < 80;
  const reach = outA === outB ? 34 + Math.abs(b.y - a.y) * 0.08 : short ? Math.max(4, dx * 0.25) : Math.max(24, Math.min(90, dx * 0.4));
  const sag = Math.max(short ? 56 : 0, 24 + dist * 0.3);
  const ya = Math.min(maxY, a.y + sag), yb = Math.min(maxY, b.y + sag);
  const inX = x => Math.max(6, Math.min(maxX - 6, x));
  return PathBuilder.stroke(width).move_to(a.x, a.y + dy)
    .cubic_bezier_to(b.x, b.y + dy, inX(a.x + outA * reach), Math.max(a.y, ya) + dy, inX(b.x + outB * reach), Math.max(b.y, yb) + dy).build();
};
// A circle from four cubic curves (k = 0.5523, the standard quarter-circle fit). No arc_to: Herdr's zoom scales
// path points but not arc radii, so arcs squashed into ovals when zoomed in or out. Points alone stay round at any zoom.
const disc = (x, y, r) => {
  const k = 0.5523 * r;
  return PathBuilder.fill().move_to(x + r, y)
    .cubic_bezier_to(x, y + r, x + r, y + k, x + k, y + r)
    .cubic_bezier_to(x - r, y, x - k, y + r, x - r, y + k)
    .cubic_bezier_to(x, y - r, x - r, y - k, x - k, y - r)
    .cubic_bezier_to(x + r, y, x + k, y - r, x + r, y - k).close().build();
};

// Pink, green, blue, peach, purple, cyan, then the light pink and blue: neighbours in this order differ most.
const cablePalette = (t) => [t.ansi1, t.ansi2, t.ansi4, t.ansi3, t.ansi5, t.ansi6, t.ansi13, t.ansi14].filter(Boolean);
// One cable from a to b, leaving a's edge to `outA` (+1 right, -1 left) and arriving at b's from `outB`, in a board of
// W × H px: { shadows, bodies, jacks } to paint under the cards (the first two) and over them (the plugs).
// `jackOk(point)` says whether a plug shows there.
const cableLayers = (t, a, b, outA, outB, color, H, W, jackOk = () => true) => {
  // Handles stop at H·1.25 so the lowest point (¾ of the handle depth at most) stays on the board.
  const cable = (w, dy) => cablePath(a, b, outA, outB, w, dy, H * 1.2, W);
  return {
    // A wide faint halo first: through a frosted card the cable shows soft, as if blurred.
    shadows: [paintAt(cable(10, 0), alpha(color, "12")), paintAt(cable(6, 0), alpha(color, "22")), paintAt(cable(4.5, 1.5), "#00000066")],
    // The body at 65% (full color was too bright, user 2026-11-03), sheen to match; the halo glow above stays as it was.
    bodies: [paintAt(cable(2.5, 0), alpha(color, "a6")), paintAt(cable(0.8, -0.6), "#ffffff26")],
    jacks: [a, b].filter(jackOk).flatMap((j) => [paintAt(disc(j.x, j.y, 5), color), paintAt(disc(j.x, j.y, 2.2), t.chrome)]),
  };
};

export { paintAt, cablePath, disc, cablePalette, cableLayers };

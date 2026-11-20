// The board card's right-click menu. Opened as a popup with props { terminal: "t21", blocked, overlay }.
// "Pin to Blocked" marks the card by hand: shared("veroboard.blocked")[terminal] = { at }; "Unpin" takes the mark off.
// The board drops a pin when you send that agent a prompt after `at` (auto-compacts and task notifications don't
// count), or when its terminal closes.
// "Move to Done" (cards in Blocked; user 2026-11-17): for when it no longer matters, without telling the agent.
// It unpins the card and marks it shared("veroboard.dismissed")[terminal] = { at }: the board stops counting the reason it
// was blocked until something new happens (you prompt it, its next message asks again, a new dialog opens).
// Looks like the shipped `menu` mod. ↑/↓ move, Enter runs, Esc closes.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { run, props, closeOverlay, openOverlay, theme, shared, setShared } from "herdr";

const alpha = (hex, aa) => (/^#[0-9a-fA-F]{6}$/.test(hex) ? hex + aa : hex);

function items(p) {
  const addr = p?.terminal;
  const marked = Boolean((shared("veroboard.blocked") ?? {})[addr]);
  const unpin = () => {
    const { [addr]: _gone, ...rest } = shared("veroboard.blocked") ?? {};
    setShared("veroboard.blocked", rest);
  };
  return [
    marked
      ? ["Unpin", "pin-off", unpin]
      : ["Pin to Blocked", "pin", () => setShared("veroboard.blocked", { ...(shared("veroboard.blocked") ?? {}), [addr]: { at: Date.now() } })],
    ...(p?.blocked ? [["Move to Done", "circle-check", () => {
      unpin();
      setShared("veroboard.dismissed", { ...(shared("veroboard.dismissed") ?? {}), [addr]: { at: Date.now() } });
    }]] : []),
    ["Open", "terminal", () => run("agent.focus", { terminal: addr })],
    // Its open decisions (props.decisions, from the board; user, 2026-11-20): each opens the Decisions dialog on that one.
    ...(Array.isArray(p?.decisions) ? p.decisions : []).map((d) => [d.title, "mods/veroboard/question.svg", () => openDecision(d.key), d]),
  ];
}
// The dialog picks up shared "veroboard.decisionFocus" when it opens. Sized like the top bar's ? opens it: 75% of the
// window each way, or its mod.json's 852×760 before the window has drawn.
function openDecision(key) {
  setShared("veroboard.decisionFocus", key);
  let vp = null;
  try { vp = globalThis.window.viewport_size(); } catch (_) { /* not drawn yet */ }
  openOverlay({ mod: "veroboard-decisions", kind: "dialog",
    width: vp ? Math.round(vp.width * 0.75) : 852, height: vp ? Math.round(vp.height * 0.75) : 760 });
}

export default class BoardMenu extends View {
  init(_props, cx) {
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
  }

  choose(i) {
    const it = items(props())[i];
    if (!it) return;
    closeOverlay(props()?.overlay);
    it[2]();
  }

  render() {
    const t = theme();
    const list = items(props());
    // A divider above the first decision item, only when there is one.
    const firstDecision = list.findIndex((it) => it[3]);
    return v_flex()
      .id("veroboard-menu")
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(5)
      .bg(t.popover)
      .text_size(12.8)
      .on_key_down((e, cx) => {
        if (e.key === "down") this.at = (this.at + 1) % list.length;
        else if (e.key === "up") this.at = (this.at + list.length - 1) % list.length;
        else if (e.key === "enter") this.choose(this.at);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.notify();
      })
      .children(list.flatMap((it, i) => [...(i === firstDecision ? [div().h(9).flex_none().flex().items_center().px(6)
        .child(div().h(1).w_full().bg(t.border))] : []), h_flex()
        .id(`bm-${i}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        // The item the keys are on, and the one under the pointer: the accent's tint, as everywhere else in Veroboard
        // (user, 2026-11-18).
        .when(i === this.at, el => el.bg(alpha(t.accent, "26")))
        .hover(s => s.bg(alpha(t.accent, "1a")))
        .on_click(() => this.choose(i))
        .child(svg(it[1].includes("/") ? it[1] : `mods/veroboard/icons/${it[1]}.svg`).size(14).flex_none()
          // A decision waiting on you gets the Blocked pink icon; one waiting on the agent stays muted.
          .text_color(it[3]?.waiting ? t.blocked : t.muted))
        // One line, cut with … like the other items; the whole title on hover.
        .child(div().flex_1().min_w(0).truncate().when(Boolean(it[3]), (el) => el.tooltip(it[0])).child(it[0]))]));
  }
}

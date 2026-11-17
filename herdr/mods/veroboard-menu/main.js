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
import { run, props, closeOverlay, theme, shared, setShared } from "herdr";

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
  ];
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
      .children(list.map((it, i) => h_flex()
        .id(`bm-${i}`)
        .h(31)
        .px(8)
        .gap(9)
        .rounded(7)
        .items_center()
        .text_color(t.foreground)
        .when(i === this.at, el => el.bg(t.selected))
        .hover(s => s.bg(t.hover))
        .on_click(() => this.choose(i))
        .child(svg(`mods/workspace-chrome/${it[1]}.svg`).size(14).flex_none().text_color(t.muted))
        .child(div().flex_1().child(it[0]))));
  }
}

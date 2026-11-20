// The board's card: what's on it and where (Veroboard settings → Card), its badges and colors, and the display settings
// that change how it looks. main.js renders the real cards with renderCard(); the settings dialog (settings.js) renders
// a made-up example with the same code, so the example is exactly what the board shows. Mods can only import their own
// files, which is why the dialog lives in this mod too.
import { div, svg, image } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

// The board's display settings (Veroboard settings → Display; user, 2026-11-17): the package's defaults.json "board"
// section, then yours from ~/.config/veroboard/config.json. Theme colors stay the theme's. Every copy loads them
// (loadView) and reloads when the folder changes. These fallbacks match the package defaults.
const VIEW_DEFAULTS = { cables: true, cablesThroughCards: 5, contextRamp: [50, 85], stuckTask: 15, stuckShell: 15, stuckMonitor: 30, waitTask: true, waitShell: true, waitMonitor: true, waitHelper: true, decisionBlocks: true, decisionToast: true, decisionSound: false, decisionOrder: "oldest", decisionDiffOpen: true, glow: true, greyWhenSeen: true, doneTimer: true, activeRing: true, card: null, top: null, toastPlace: "top-right", toastArea: "board", noticeRead: "visit", cableColors: "rainbow" };
// Where the board's notifications pop up (Veroboard settings → Notifications): over the board or over the terminal
// (toastArea: "board" or "terminal"), then a row and a column of that area, 3 × 3 (toastPlace).
const TOAST_PLACES = ["top-left", "top-center", "top-right", "middle-left", "middle-center", "middle-right", "bottom-left", "bottom-center", "bottom-right"];
let VIEW = { ...VIEW_DEFAULTS, card: null, top: null };
const viewFrom = (...layers) => {
  const v = { ...VIEW_DEFAULTS };
  for (const l of layers) for (const k of Object.keys(VIEW_DEFAULTS)) {
    // An older config's one stuckMinutes, for every kind it doesn't set on its own (2026-11-18: one per kind now).
    if (STUCK_KEYS.includes(k) && !Number.isFinite(l?.[k]) && Number.isFinite(l?.stuckMinutes)) { v[k] = l.stuckMinutes; continue; }
    const x = l?.[k];
    if (k === "card" || k === "top" ? Boolean(x) && typeof x === "object" : k === "contextRamp" ? Array.isArray(x) && x.length === 2 && x.every(Number.isFinite) : typeof x === typeof VIEW_DEFAULTS[k]) v[k] = x;
  }
  v.card = cardLayout(v.card);
  v.top = topLayout(v.top);
  return v;
};
// How long background work may go without news before its time turns pink, by kind (Veroboard settings → Card →
// Background work; user, 2026-11-18): a sub-agent and a shell it waits on since they started, a monitor since its last
// event. A quiet CI monitor is normal for longer than a quiet sub-agent, so monitors default to 30 min, the rest 15.
const STUCK_KEYS = ["stuckTask", "stuckShell", "stuckMonitor"];
const stuckMs = (kind = "task") => Math.max(1, VIEW[{ task: "stuckTask", shell: "stuckShell", monitor: "stuckMonitor" }[kind] ?? "stuckTask"]) * 60000;

// Waiting is Dusk's light blue (ansi 14). The stronger blue #8aa1f4 matched the worktree pill, so not that. Working is the theme's amber-orange (themes/dusk.json "working").
const WAITING = "#91c7e3";

const alpha = (hex, aa) => /^#[0-9a-fA-F]{6}$/.test(hex) ? hex + aa : hex;
const dot = (color, size = 7) => div().size(size).rounded(size).bg(color).flex_none();
// A small pill for one card fact ("Opus 5.5", "high", "1M").
const badge = t => h_flex().flex_none().h(16).px(6).gap(5).items_center().rounded(4).bg(t.raised).text_color(t.foreground);
const modelColors = new Map();
const hslToHex = (h, s, l) => {
  const a = s * Math.min(l, 1 - l);
  const channel = n => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };

  return "#" + channel(0) + channel(8) + channel(4);
};
// Family sets a status-safe hue; version varies lightness, raised for contrast against the card.
const modelColor = (name, bg) => {
  const key = `${name}|${bg}`;
  if (modelColors.has(key)) return modelColors.get(key);

  const fnv = text => {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);

    return hash >>> 0;
  };
  const [family, ...words] = name.trim().split(/\s+/);
  const rest = words.join(" ");
  let hue = fnv(family.toLowerCase()) % 360;
  for (let i = 0; i < 4; i++) {
    for (const center of [20, 338, 129]) {
      const distance = (hue - center + 540) % 360 - 180;
      if (Math.abs(distance) < 15) hue = (center + (distance < 0 ? -15 : 15) + 360) % 360;
    }
  }

  let l = 0.74 + (rest ? ((fnv(rest) % 9) - 4) * 0.012 : 0);
  let color = hslToHex(hue, 0.62, l);
  if (/^#[0-9a-fA-F]{6}$/.test(bg)) {
    const luminance = hex => {
      const channels = [1, 3, 5].map(i => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });

      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const background = luminance(bg);
    const contrast = hex => {
      const foreground = luminance(hex);
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    };
    while (contrast(color) < 4.5 && l < 0.95) {
      l += 0.02;
      color = hslToHex(hue, 0.62, l);
    }
  }

  modelColors.set(key, color);

  return color;
};
const modelBadge = (t, name) => {
  const c = modelColor(name, t.popover);
  return badge(t).bg(alpha(c, "26")).text_color(c).child(name);
};
// Effort, cool to warm in theme colors that no agent status uses; max is the last step, bolder.
const EFFORT = { low: "ansi6", medium: "ansi4", high: "ansi5", xhigh: "ansi13", max: "ansi13" };
const effortBadge = (t, effort) => {
  const c = t[EFFORT[effort]];
  if (!c) return badge(t).child(effort);
  return badge(t).bg(alpha(c, effort === "max" ? "4d" : "26")).text_color(c).when(effort === "max", el => el.font_semibold()).child(effort);
};
// Mix two #rrggbb colors; f = 0 gives a, 1 gives b.
const mix = (a, b, f) => {
  const ch = (hex, i) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map(i => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * f).toString(16).padStart(2, "0")).join("");
};
// Frosted glass for cards and their bars, so the patch cables show faintly through them. GPUI has no backdrop
// blur: the card is GLASS opaque, its color lifted so that over the empty board it looks exactly like `hex`,
// and the cables carry a soft halo that reads as blur through it.
// How much shows through: VIEW.cablesThroughCards, 5% by default (the user picked 0.95 after 0.84 and 0.88 showed the
// cables too much, 2026-11-03).
// `through`: the % that shows, VIEW's unless given (the settings' example passes the slider's value while it's dragged).
const glass = (t, hex, through = VIEW.cablesThroughCards) => {
  const GLASS = 1 - Math.max(0, Math.min(50, through)) / 100;
  if (![hex, t.canvas].every(c => /^#[0-9a-fA-F]{6}$/.test(c))) return hex;
  const ch = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map(i => Math.max(0, Math.min(255, Math.round((ch(hex, i) - (1 - GLASS) * ch(t.canvas, i)) / GLASS)))
    .toString(16).padStart(2, "0")).join("") + Math.round(GLASS * 255).toString(16).padStart(2, "0");
};
// Context gauge color: plain text color below the ramp's start (no need to compact yet), then peach there,
// blending to pink-red at its end and up. VIEW.contextRamp, [50, 85] by default.
const gauge = (t, pct) => {
  const [from, to] = VIEW.contextRamp;
  if (pct < from) return t.foreground;
  if (![t.ansi3, t.ansi1].every(c => /^#[0-9a-fA-F]{6}$/.test(c))) return pct >= to ? t.blocked : t.working;
  return mix(t.ansi3, t.ansi1, to > from ? Math.min(1, (pct - from) / (to - from)) : 1);
};
// A turn's length: "<1m", "12m", "1h 5m", and from a day on "2d 18h" (Done cards sit for days: "66h 50m" read badly).
const duration = ms => {
  const m = Math.floor(Math.max(0, ms) / 60000);
  return m < 1 ? "<1m" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.floor(m / 1440)}d ${Math.floor(m / 60) % 24}h`;
};
const compactTokens = n => n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);

const icon = (t, program, size = 18) => program?.icon
  ? (program.tint ? svg(program.icon).text_color(t.foreground) : image(program.icon)).size(size).flex_none()
  : div().size(size).rounded(4).bg(t.accent);

// The board reads the settings once per copy and again when they change (main.js loadView).
const setView = (v) => { VIEW = v; };

// ---------- The card's layout (Veroboard settings → Card; user, 2026-11-17) ----------
// Three lines, each with a left side (it shrinks first, and truncates) and a right side. The agent's icon and name
// always start line 1. Every other badge can be moved to any line and side, in any order, or hidden.
const CARD_ITEMS = [
  { id: "laneTime", label: "Time in lane", help: "Working: this turn. Waiting: its oldest background work. Done: how long it has been in Done." },
  { id: "why", label: "Blocked reason", help: "Why it's in Blocked (You, Prompt, Pinned, or who it waits on) and for how long. Hover it for the rule." },
  { id: "launched", label: "Agents it opened", help: "How many agents it opened that are still running." },
  { id: "address", label: "Terminal id", help: "Its Herdr terminal id (t21): what hc and other agents call it." },
  { id: "decisions", label: "Decisions", help: "How many decisions this agent is waiting on you for." },
  // Off by default (user, 2026-11-17): for boards without patch cables. Shown, it goes to the top right corner.
  { id: "openedBy", label: "Opened by", help: "The terminal id of the agent that opened it, if that agent still runs. Handy with patch cables off. Hover it for that agent's name.", home: [0, "right"] },
  { id: "folder", label: "Folder", help: "The last folder of where it runs." },
  { id: "branch", label: "Branch", help: "Its git branch. Blue with a layers icon in a worktree; a merge or rebase in progress shows next to it." },
  { id: "model", label: "Model", help: "The Claude model, in a color of its own." },
  { id: "effort", label: "Effort", help: "The reasoning effort." },
  { id: "window", label: "Context window", help: "The context window's size (200k, 1M)." },
  { id: "space", label: "Space", help: "Its Herdr space. Not shown while the board shows one space." },
  { id: "context", label: "Context bar", help: "How full its context is. The colors follow the Display tab's ramp." },
];
const CARD_DEFAULT = {
  lines: [
    { left: [], right: ["laneTime", "why", "launched", "address", "decisions"] },
    { left: ["folder"], right: ["branch"] },
    { left: ["model", "effort", "window"], right: ["space", "context"] },
  ],
  hidden: ["openedBy"],
  rows: true,
};
// Where an item sits by default: its own `home`, else where the default layout has it.
const homeOf = (items, def, id) => {
  const item = items.find((x) => x.id === id);
  if (item?.home) return item.home;
  for (const [n, line] of def.lines.entries()) for (const side of ["left", "right"]) if (line[side].includes(id)) return [n, side];
  return [0, "right"];
};
// A layout from the config, made whole: unknown ids dropped, each id once, an id it doesn't mention (one a later
// version adds) in its default place, and an item that can't be hidden (`locked`) taken out of the tray.
const makeLayout = (c, items, def) => {
  const ids = items.map((x) => x.id);
  const seen = new Set();
  const take = (list) => (Array.isArray(list) ? list : []).filter((id) => ids.includes(id) && !seen.has(id) && Boolean(seen.add(id)));
  const src = c && typeof c === "object" ? c : {};
  const lines = def.lines.map((_d, n) => { const l = Array.isArray(src.lines) ? src.lines[n] : null; return { left: take(l?.left), right: take(l?.right) }; });
  const hidden = take(src.hidden).filter((id) => {
    if (!items.find((x) => x.id === id)?.locked) return true;
    seen.delete(id);
    return false;
  });
  // Anything not placed yet goes home in the default layout's order (then item order), so a missing or unreadable
  // defaults.json still gives the default bar, not the item list's order (spaces before the gear, 2026-11-18).
  for (const id of [...def.lines.flatMap((l) => [...l.left, ...l.right]), ...ids]) if (ids.includes(id) && !seen.has(id)) {
    seen.add(id);
    if (def.hidden.includes(id)) { hidden.push(id); continue; }
    // Right after the item it follows in the default, when that one is placed on the same side (a new item lands
    // where it ships, not at the end: Decisions beside the bell; user, 2026-11-20); else at the end.
    const [n, side] = homeOf(items, def, id), list = lines[n][side], d = def.lines[n]?.[side] ?? [];
    const after = d.slice(0, Math.max(0, d.indexOf(id))).reverse().map((x) => list.indexOf(x)).find((j) => j >= 0);
    list.splice(after === undefined ? list.length : after + 1, 0, id);
  }
  return { lines, hidden };
};
// The background work rows under a card, by kind (user, 2026-11-18): sub-agents (task), background shells (shell),
// monitors (monitor), each shown or not. `rowKinds` holds them; `rows` says whether any shows. An older config's
// `rows: false` means none, `rows: true` (or nothing) all.
const ROW_KINDS = ["task", "shell", "monitor"];
const cardLayout = (c) => {
  const o = c && typeof c === "object" ? c : {};
  const all = o.rows !== false;
  const rowKinds = Object.fromEntries(ROW_KINDS.map((k) => [k, typeof o.rowKinds?.[k] === "boolean" ? o.rowKinds[k] : all]));
  return { ...makeLayout(c, CARD_ITEMS, CARD_DEFAULT), rows: ROW_KINDS.some((k) => rowKinds[k]), rowKinds };
};

// ---------- The top bar's layout (Veroboard settings → Board; user, 2026-11-17) ----------
// One line with a left and a right side (a gap between takes what's left), like a card's. The gear can't be hidden:
// it's the way back into these settings.
const TOP_ITEMS = [
  { id: "spaces", label: "Spaces", help: "All Spaces and a chip for each space. Click one to show only its agents." },
  { id: "newSpace", label: "New space", help: "The + button that opens a new space." },
  { id: "count", label: "Agent count", help: "How many agents are on the board (or how many match the filter)." },
  { id: "pie", label: "Status pie", help: "How the agents split between Blocked, Waiting, Working and Done." },
  { id: "divider", label: "Divider", help: "A short line, to set things apart." },
  { id: "gear", label: "Settings", help: "Opens these settings. It can be moved, not hidden.", locked: true },
  { id: "filter", label: "Filter box", help: "Filters the board by session name (⌘F)." },
  { id: "bell", label: "Notifications", help: "A bell with what Herdr notified you about, newest first. The pill counts the new ones." },
  { id: "decisions", label: "Decisions", help: "Opens the decision queue: what agents asked you to decide, with the exact text. The pill counts them." },
];
const TOP_DEFAULT = {
  // The user's own arrangement (2026-11-18): settings, the bell and the filter first, then the spaces; count and pie on
  // the right; the second divider hidden.
  lines: [{ left: ["gear", "bell", "decisions", "filter", "divider", "spaces", "newSpace"], right: ["count", "pie"] }],
  hidden: [],
};
// Dividers you add (user, 2026-11-18): "divider" ships with the bar; the editor's + Divider adds divider2, divider3, …
// each placed wherever you drag it. An added one dragged into Hidden is removed, not kept in the tray.
const isAddedDivider = (id) => /^divider\d+$/.test(id);
const topItems = (c) => {
  const ids = c && typeof c === "object" ? [...(c.lines ?? []).flatMap((l) => [...(l?.left ?? []), ...(l?.right ?? [])]), ...(c.hidden ?? [])] : [];
  const added = [...new Set(ids.filter((id) => typeof id === "string" && isAddedDivider(id)))]
    .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)));
  return [...TOP_ITEMS, ...added.map((id) => ({ id, label: `Divider ${id.slice(7)}`, help: "A short line you added. Drag it into Hidden to remove it." }))];
};
const topLayout = (c) => {
  const L = makeLayout(c, topItems(c), TOP_DEFAULT);
  return { ...L, hidden: L.hidden.filter((id) => !isAddedDivider(id)) };
};

// One card (and the rows of background work under it) from a model. main.js card() builds the model from an agent;
// the settings' example builds a made-up one.
//   m: { address, program, name, color (its lane's), shown, flash (0..1 while it glows, else null),
//        laneTime {text, color}, why {icon, label, color, tip}, launched (n), openedBy, openedByName, folder, branch {name, worktree, state},
//        model, programName (without a model), effort, window, space, context {pct},
//        rows [{ kind: "task", type, text, startTime } | { kind: "shell", text, muted, startTime, waits }
//              | { kind: "monitor", text, muted, event, eventAt, startTime, expiresAt }] }
//   o: { layout, onClick, onRightClick, pick (id => …: the example's badges are clickable), picked (an id),
//        decorate ((el, id) => el: the example's drag and drop), through (how much shows through, else VIEW's) }
const renderCard = (m, t, o = {}) => {
  const layout = o.layout ?? VIEW.card ?? cardLayout(null);
  // Only the kinds shown (cardLayout's rowKinds).
  const rows = layout.rows ? (m.rows ?? []).filter((r) => layout.rowKinds?.[r.kind] !== false) : [];
  const bars = rows.length;
  const color = m.color;
  const ctx = m.context ? gauge(t, m.context.pct) : null;
  const warm = m.context ? m.context.pct >= VIEW.contextRamp[0] : false;
  const pieces = {
    laneTime: () => m.laneTime && badge(t).bg(alpha(m.laneTime.color, "26")).text_color(m.laneTime.color).child(m.laneTime.text),
    why: () => m.why && badge(t).when(!o.pick, (el) => el.id(`why-${m.address}`).when(Boolean(m.why.tip), (el) => el.tooltip(m.why.tip)))
      .bg(alpha(m.why.color, "26")).text_color(m.why.color)
      .child(svg(m.why.icon).size(10).flex_none()).child(m.why.label),
    launched: () => m.launched > 0 && badge(t).bg(alpha(t.accent, "26")).text_color(t.accent)
      .child(svg("mods/veroboard/launched.svg").size(10).flex_none()).child(String(m.launched)),
    address: () => badge(t).text_color(t.muted).child(m.address),
    decisions: () => m.decisions > 0 && badge(t).bg(alpha(t.blocked, "26")).text_color(t.blocked)
      .child(svg("mods/veroboard/question.svg").size(10).flex_none()).child(String(m.decisions)),
    openedBy: () => m.openedBy && badge(t).text_color(t.muted)
      .when(!o.pick && Boolean(m.openedByName), (el) => el.id(`by-${m.address}`).tooltip(`Opened by ${m.openedBy} (${m.openedByName})`))
      .child(svg("mods/veroboard/launched-by.svg").size(10).flex_none()).child(m.openedBy),
    folder: () => m.folder && badge(t).flex_shrink(1).min_w(0)
      .child(svg("mods/veroboard/icons/folder.svg").size(10).flex_none())
      .child(div().min_w(0).truncate().child(m.folder)),
    // In a linked worktree the branch pill turns blue with a layers icon; the main checkout keeps the grey branch pill.
    branch: () => m.branch && badge(t).flex_shrink(1).min_w(0)
      .when(Boolean(m.branch.worktree), (el) => el.bg(alpha(t.ansi4, "26")).text_color(t.ansi4))
      .child(svg(m.branch.worktree ? "mods/veroboard/icons/layers.svg" : "mods/veroboard/icons/git-branch.svg").size(10).flex_none())
      .child(div().min_w(0).max_w(220).truncate().child(m.branch.name))
      .when(Boolean(m.branch.state), (el) => el.child(div().flex_none().text_color(t.blocked).font_semibold().child(m.branch.state))),
    model: () => (m.model ? modelBadge(t, m.model) : badge(t).child(m.programName ?? "")),
    effort: () => m.effort && effortBadge(t, m.effort),
    window: () => Number.isFinite(m.window) && badge(t).child(compactTokens(m.window)),
    space: () => m.space && badge(t).flex_shrink(1).min_w(0).text_color(t.muted).child(div().max_w(120).truncate().child(m.space)),
    context: () => m.context && badge(t).when(warm, (el) => el.bg(alpha(ctx, "26")))
      // Ten segments of 10% each with a 1px gap between them, the same 64px in all; the fill runs through them (user, 2026-11-17).
      .child(h_flex().w(64).h(4).gap(1).flex_none()
        .children(Array.from({ length: 10 }, (_, i) => {
          const f = Math.min(1, Math.max(0, (m.context.pct - i * 10) / 10));
          return div().w(5.5).h(4).rounded(1).bg(warm ? alpha(ctx, "33") : t.border).overflow_hidden()
            .child(div().w(5.5 * f).h(4).bg(ctx));
        })))
      .child(div().text_color(ctx).child(`${Math.round(m.context.pct)}%`)),
  };
  // A badge in its place. Line 1's sit 4px lower, level with the name. In the example, each can be clicked to pick it.
  const place = (id, n) => {
    const el = pieces[id]?.();
    if (!el) return null;
    // The pick ring is drawn over the badge's own edge (absolute), so the example lays out exactly like a board card.
    const placed = !o.pick ? el : div().id(`pick-${id}`).relative().flex_none().when(["folder", "branch", "space"].includes(id), (d) => d.flex_shrink(1).min_w(0))
      .flex().items_center().cursor_pointer().hover((s) => s.opacity(0.8))
      .on_click((_e, cx) => o.pick(id, cx))
      .when(o.picked === id, (d) => d.child(div().absolute().inset_0().rounded(4)
        .border(1).border_color(t.accent).bg(alpha(t.accent, "26"))))
      // The settings dialog makes the example's badges draggable too (drag sources and drop targets).
      .when(Boolean(o.decorate), (d) => o.decorate(d, id))
      .child(el);
    return n === 0 ? placed.mt(4) : placed;
  };
  const side = (n, s) => layout.lines[n][s].map((id) => place(id, n)).filter(Boolean);
  // In the settings dialog, o.zone(el, [line, side]) makes each side of each line a drop target, and an empty line stays.
  const zone = (el, n, s) => (o.zone ? o.zone(el, [n, s]) : el);
  const rightOf = (n, right, gap) => (o.zone || right.length > 1
    ? zone(h_flex().flex_none().gap(gap).items_center().when(Boolean(o.zone), (el) => el.min_w(28).min_h(16)), n, "right").children(right)
    : right[0] ?? null);
  const lines = layout.lines.map((_l, n) => {
    const left = side(n, "left"), right = side(n, "right");
    const r0 = rightOf(n, right, n === 0 ? 7 : 4); // built once: an element can only be placed once
    if (n === 0) return h_flex().gap(7).items_center().text_size(10)
      .child(icon(t, m.program, 15))
      .child(zone(h_flex().flex_1().min_w(0).gap(6).items_center(), n, "left")
        .child(div().min_w(0).truncate().text_size(12).font_semibold().text_color(t.foreground).child(m.name))
        .children(left))
      .when(Boolean(r0), (el) => el.child(r0));
    if (!left.length && !right.length && !o.zone) return null;
    return h_flex().gap(4).items_center().text_size(10).when(Boolean(o.zone), (el) => el.min_h(16))
      .child(zone(h_flex().flex_1().min_w(0).gap(4).items_center().overflow_hidden(), n, "left").children(left))
      .when(Boolean(r0), (el) => el.child(r0));
  }).filter(Boolean);

  const card = v_flex().id(`agent-${m.address}`).relative().w_full().h(76).flex_none()
    // Square on the left, where the status stripe runs; rounded on the right.
    .when(bars > 0, (el) => el.rounded_tr(7))
    .when(bars === 0, (el) => el.rounded_r(7)).overflow_hidden()
    // The agent shown in the workspace below gets a softened status-colored border (70%; hover is 50%); the card itself stays the same.
    // No left border: the status stripe is the card's left edge. The resting border is a faint raised purple
    // so the card's edge doesn't seem to grow when hover colors it.
    .bg(glass(t, t.popover, o.through)).border_t(1).border_r(1).border_b(1).border_color(m.shown ? mix(t.raised, color, 0.7) : t.raised)
    .when(Boolean(o.onClick), (el) => el.cursor_pointer().hover((s) => s.border_color(mix(t.raised, color, m.shown ? 0.7 : 0.5))).on_click(o.onClick))
    .when(Boolean(o.onRightClick), (el) => el.on_mouse_down("right", o.onRightClick))
    // The agent shown below (user, 2026-11-06: the 70% border alone was too faint to spot): a full-color 2px ring and
    // a faint wash of its status color, drawn over the card like the flash so the content doesn't shift.
    .when(Boolean(m.shown) && VIEW.activeRing, (el) => el.child(div().absolute().inset_0().border_2().border_color(color).bg(alpha(color, "14"))
      .when(bars > 0, (el) => el.rounded_tr(7)).when(bars === 0, (el) => el.rounded_r(7))))
    // Just made a sound: a status-colored border and wash, one pulse (0 → 1 → 0, sine-shaped).
    .when(m.flash != null, (el) => el.child(div().absolute().inset_0().border_2().border_color(color).bg(alpha(color, "1f"))
      .when(bars > 0, (el) => el.rounded_tr(7)).when(bars === 0, (el) => el.rounded_r(7))
      .opacity(Math.sin(Math.PI * m.flash))))
    .child(h_flex().flex_1().min_h(0)
      .child(div().w(3).h_full().bg(color).flex_none())
      .child(v_flex().flex_1().min_w(0).px(12).pb(5).gap(6).justify_center().children(lines)));

  const rowFrame = (r, i, bg) => h_flex().id(`${r.kind}-${m.address}-${i}`).ml(14).h(22).flex_none().items_center().gap(6).px(8)
    .bg(glass(t, bg, o.through)).border_l(1).border_r(1).border_b(1).border_color(t.border)
    .when(i === bars - 1, (el) => el.rounded_b(6))
    .when(Boolean(o.onClick), (el) => el.cursor_pointer().on_click(o.onClick))
    .child(div().text_color(t.dim).text_size(11).child("↳"));
  const age = (start, quietSince, canStick = true, kind = "task") => Number.isFinite(start)
    ? div().flex_none().text_size(10).text_color(canStick && Date.now() - quietSince > stuckMs(kind) ? t.blocked : t.muted).child(duration(Date.now() - start))
    : null;
  const row = (r, i) => {
    // A sub-agent: a spinner, its type and label, how long it has run (Claude Code's startTime), to spot one that's stuck.
    if (r.kind === "task") return rowFrame(r, i, t.surface)
      .child(svg("mods/veroboard/icons/spinner.svg").size(9).text_color(t.accent).spin(900).flex_none())
      .when(Boolean(r.type), (el) => el.child(div().flex_none().text_size(10.5).font_semibold().text_color(t.accent).child(r.type)))
      .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(t.foreground).child(r.text))
      .when(Number.isFinite(r.startTime), (el) => el.child(age(r.startTime, r.startTime)));
    // A background shell. Only one that waits can be stuck; a dev server is meant to run for hours.
    if (r.kind === "shell") return rowFrame(r, i, t.chrome)
      .child(svg("icons/shell.svg").size(10).text_color(t.ansi6).flex_none())
      .child(div().flex_1().min_w(0).truncate().text_size(10.5).text_color(r.muted ? t.muted : t.foreground).child(r.text))
      .when(Number.isFinite(r.startTime), (el) => el.child(age(r.startTime, r.startTime, r.waits, "shell")));
    // A monitor (Claude Code's Monitor tool): a breathing Waiting dot, what it watches, its last event, and "14m / 30m":
    // how long it has run out of its timeout (Monitor kills it then, so not an ETA). Pink when quiet too long.
    const quiet = Number.isFinite(r.eventAt) ? r.eventAt : r.startTime;
    return rowFrame(r, i, t.chrome)
      .child(dot(WAITING, 6).loop("opacity", { from: 0.35, to: 1, period: 1800 }))
      .child(div().flex_shrink(1).min_w(0).max_w(r.event ? 120 : 9999).truncate().text_size(10.5).text_color(r.muted ? t.muted : t.foreground).child(r.text))
      .when(Boolean(r.event), (el) => el.child(div().flex_1().min_w(0).truncate().text_size(10).text_color(t.muted).child(`· ${r.event}`)))
      .when(!r.event, (el) => el.child(div().flex_1()))
      .child(h_flex().flex_none().gap(3).items_center().text_size(10)
        .when(Number.isFinite(r.startTime), (el) => el.child(div().text_color(Date.now() - quiet > stuckMs("monitor") ? t.blocked : t.muted).child(duration(Date.now() - r.startTime))))
        .when(Number.isFinite(r.expiresAt), (el) => el.child(div().text_color(t.dim)
          .child(Number.isFinite(r.startTime) ? `/ ${duration(r.expiresAt - r.startTime)}` : `${duration(r.expiresAt - Date.now())} TTL`))));
  };
  return v_flex().w_full().flex_none().child(card).children(rows.map(row));
};

export {
  VIEW, VIEW_DEFAULTS, TOAST_PLACES, viewFrom, setView, stuckMs, WAITING,
  alpha, dot, badge, modelBadge, effortBadge, mix, glass, gauge, duration, compactTokens, icon,
  CARD_ITEMS, CARD_DEFAULT, ROW_KINDS, cardLayout, renderCard, TOP_ITEMS, TOP_DEFAULT, topLayout, topItems, isAddedDivider, makeLayout,
};

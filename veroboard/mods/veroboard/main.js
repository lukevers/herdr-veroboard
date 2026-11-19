import { View, div, svg, image, PathBuilder } from "gpui-kit";
import { h_flex, v_flex, InputState, Input } from "gpui-base";
// Tab auto-naming: a copy of mods/auto-tabs/names.js (mods can only import their own files).
// Keep the two in step; both layouts must name tabs the same way.
import { syncNames } from "./names.js";
// The card, its badges, colors and display settings (shared with the settings dialog's example card).
import {
  VIEW, TOAST_PLACES, viewFrom, setView, stuckMs, WAITING, alpha, dot, badge, mix, glass, gauge, duration, icon, renderCard, compactTokens,
} from "./card.js";
// The patch cables' drawing (shared with the settings dialog's example).
import { cablePalette, cableLayers } from "./cables.js";
// The top bar's pieces and how they're arranged (Veroboard settings → Board).
import { SYMBOL, hint, pie, chip, newSpaceButton, gearButton, dividerLine, renderTopBar, bellButton, statPill, word } from "./topbar.js";
// Veroboard settings: this mod opened as a dialog (mod.open veroboard) is the settings panel, not a board.
import { SettingsPanel } from "./settings.js";
import { agents, spaces, panes, terminals, focused, appHome, props, run, openOverlay, closeOverlay, setAgentOrder, theme, keys, nextCommand, shared, setShared, window, layout, readTextFile, watchFolder, home, settings, exec } from "herdr";

// The board's columns, by urgency. Herdr reports blocked, working, done (finished, not yet seen) and idle;
// the board splits Herdr's done and idle by whether the agent still has something running for it:
// waiting (a monitor, a sub-agent or an hc helper terminal is live; it wakes on its own), else done.
// Done stays done after you look; Herdr's "done" (unseen) only decides whether the Done dot breathes.
const STATES = [
  { key: "blocked", label: "Blocked" },
  { key: "waiting", label: "Waiting" },
  { key: "working", label: "Working" },
  { key: "done", label: "Done" },
];
// A Blocked card waiting on another agent or a person (not you): a warm marigold between Dusk's gold and the Working amber (#f5a855).
const ELSEWHERE = "#f2bc78";
const stateColor = (t, key) => key === "waiting" ? WAITING : t[key];
// Notifications and spaces (the same in mods/veroboard-toast). A notification about an agent belongs to that agent's
// space (enrichNotices saves it; older ones only have the space's name). Herdr's others belong to no space, so every
// space shows them. `sp`: a space ({id, name}), or null for all.
const noticeIn = (n, sp) => !sp || !n.agent || (n.agent.spaceId ? n.agent.spaceId === sp.id : !n.agent.space || n.agent.space === sp.name);
// Unread: marked unread by hand (↺ in the list), or not read (clicked, dismissed, ✓, its agent visited), not seen in
// the list when opening it marks them (noticeRead "open"), and newer than the old one-time mark (noticesSeen).
// About an agent, and the board hasn't saved its card facts on it yet (enrichNotices). Not drawn until it has, so a
// toast doesn't show in the plain style first and then change (user, 2026-11-18). The board saves them on the first
// frame after one arrives; an agent that's gone gets {address} only, and the notice shows in the plain style.
const noticePending = (n) => !n.agent && typeof n.action?.args?.terminal === "string";
const noticeUnread = (n) => Boolean(n.unread) || (!n.read && !n.seen && n.at > (Number(shared("veroboard.noticesSeen")) || 0));
// Background work that runs this long with no news may be stuck, so its time turns pink. Sub-agents and
// shells that wait: time since they started. Monitors: time since their last event (or their start).
// (VIEW.stuckTask / stuckShell / stuckMonitor, by kind: stuckMs(kind))
// A card glows (one pulse) this long after its agent makes a sound: Herdr's chime, which plays when an agent turns
// done (finished while you weren't looking) or blocked, or a Claude Code hook's sound, which writes a ping file
// (~/.config/veroboard/state/pings/<terminal>.json, {"at": ms}) next to playing it.
const FLASH_MS = 1000; // one pulse: fades in, peaks at 500ms, gone at 1000ms (4s, then 2s, were too long)
// The header pie's Waiting slice: the same blue hue, darker (lightness 73% → 58%), so it stands apart
// from the pastel slices beside it at 18px. The column itself keeps WAITING.
const PIE_WAITING = "#55a9d3";
const BOARD_PX = 355; // board-cards' size in layouts/veroboard.json
// An app-wide key's hint (⌘T for tab.new): the board layout's binding, else the global one.
const keyHint = action => {
  const bindings = keys().filter(k => k.action === action && (k.section === "layout:veroboard" || k.section === "global"));
  const binding = bindings.find(k => k.section === "layout:veroboard") ?? bindings[0];
  return binding?.keys.split("-").map(k => SYMBOL[k] ?? k).join("") ?? "";
};
const tabHint = n => {
  const bindings = keys().filter(k => k.action === `tab.select:${n}`);
  const binding = bindings.find(k => k.section === "global") ?? bindings[0];

  return binding?.keys.split("-").map(k => SYMBOL[k] ?? k).join("") ?? "";
};
// Only the last folder: "myapp" for ~/Code/myapp, "~" at home.
const shortPath = path => {
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === home().replace(/\/+$/, "")) return "~";
  return trimmed.split("/").pop() || "/";
};
// The header's status pie: no glow and no pulse (the user removed both, 2026-11-02).
// `items`: one { key, unseen } per agent, key being its column.
const pulse = (t, items, size = 18) => {
  const counted = STATES.map(s => ({ key: s.key, color: s.key === "waiting" ? PIE_WAITING : stateColor(t, s.key), n: items.filter(i => i.key === s.key).length })).filter(s => s.n);
  const slices = counted.length ? counted : [{ key: "none", color: t.idle, n: 1 }];
  return pie(slices, size, c => c, t.chrome);
};
// A column's status dot. While live, two faint rings behind it breathe like the header pie's glow;
// the dot itself stays still. The rings hang outside the dot's box, so the header row doesn't move.
const glowDot = (color, size, live) => {
  const ring = (d, aa) => dot(alpha(color, aa), d).absolute().top((size - d) / 2).left((size - d) / 2);
  return div().relative().size(size).flex_none()
    .when(live, el => el.child(div().absolute().top(0).left(0).size(size).child(ring(size + 8, "12")).child(ring(size + 4, "26"))
      .loop("opacity", { from: 0.2, to: 1, period: 1800 })))
    .child(dot(color, size).absolute().top(0).left(0));
};
// A tab's terminal address (t19), the id agents use with hc read/send/wait: its agent's, else its first terminal's.
const tabAddress = id => agents().find(a => a.tab === id)?.address ?? panes().find(p => p.tab === id && p.terminal)?.terminal ?? "";


export default class Board extends View {
  init(_p, cx) {
    // Opened as an overlay (the gear's mod.open board): the settings dialog (settings.js), nothing else.
    if (!props()?.role && props()?.overlay) { this.panel = new SettingsPanel(cx); return; }
    // Only the header copy takes the layout's ⌘1–⌘9 keys (⌘1 all spaces, ⌘2–⌘9 spaces 1–8).
    // The header copy names tabs here too: auto-tabs only runs while main-dusk shows.
    if (props()?.role === "header") cx.timer.every(3000, () => syncNames());
    // The header's filter box (⌘F, user 2026-11-13): cards whose session name or address holds the text.
    // Kept in shared "veroboard.query", so the cards copy filters too and it survives a restart. Esc clears it.
    if (props()?.role === "header") {
      this.search = InputState.new({ placeholder: "Filter", value: shared("veroboard.query") ?? "" });
      this.search.on("change", () => setShared("veroboard.query", this.search.value()));
    }
    if (props()?.role === "header") cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "search") this.search?.focus();
        if (c === "all") setShared("veroboard.scope", "all");
        else if (/^space[1-9]$/.test(c)) {
          const index = Number(c.slice(5));
          if (spaces()[index - 1]) {
            run("space.select", { index });
            setShared("veroboard.scope", "space");
          }
        }

        cx.notify();
      }
    });

    // The cards and the header (its pie sorts agents into the same columns) both read the session files.
    // What each Blocked rule looks for (agent/core/classify.js --info, in this mod's folder), for the Blocked badge's hover text.
    // The board copy drops expired notices (veroboard-toast adds them), which also redraws to take them off.
    // The notices over the terminal (toastArea "terminal"): a copy of this mod in a frameless window (syncToastWindow).
    // It only draws them; the board copy keeps them.
    if (props()?.role === "toasts") return;
    if (!props()?.role) cx.timer.every(200, () => this.syncToastWindow());
    if (!props()?.role) cx.timer.every(1000, () => {
      this.enrichNotices();
      this.readVisited();
      const all = shared("veroboard.notices");
      if (!Array.isArray(all) || !all.length) return;
      const live = all.filter((n) => n && n.at + n.timeout > Date.now());
      if (live.length !== all.length) setShared("veroboard.notices", live);
    });
    if (!props()?.role) cx.spawn(async (cx) => {
      try {
        // Node's path as facts.js recorded it: Herdr's exec doesn't see the shell's PATH (nvm, mise).
        const node = await readTextFile(`${home()}/.config/veroboard/state/node-path`).then(x => x.trim(), () => "node");
        const r = await exec(node || "node", [`${appHome()}/mods/veroboard/agent/core/classify.js`, "--info"], { timeout: 10000 });
        this.ruleWhy = Object.fromEntries((JSON.parse(r.stdout).builtins ?? []).map(b => Array.isArray(b) ? b : [b.id, b.what]));
        cx.notify();
      } catch (_) {}
    });
    if (!props()?.role || props()?.role === "header") {
      this.subs = {};
      // Display settings: load now, then again whenever ~/.config/veroboard changes (the dialog saves there).
      // Only config.json and core/ matter: state/ (sessions, pings) changes all the time and is read elsewhere. A batch
      // with the root, or an empty one (a reclaimed watch), reloads everything. A failed watch retries in 5s: ending
      // the loop there kept a stale view, with the top bar out of order (2026-11-18).
      cx.spawn(async (cx) => {
        const dir = `${home()}/.config/veroboard`;
        for (let reload = true;;) {
          if (reload) { await this.loadView(); cx.notify(); }
          try {
            const paths = await watchFolder(dir);
            reload = !Array.isArray(paths) || !paths.length || paths.some((p) => p === dir || /\/(config\.json|core\/)/.test(p));
          } catch (_) { await cx.sleep(5000); reload = true; }
        }
      });
      this.sessions = {};
      this.flashAt = {};
      // Redraw at ~30 fps while a card glows (the pulse is drawn here, so it starts with the sound and ends at
      // opacity 0), and once just after, so the glow layer goes away.
      cx.timer.every(33, (cx) => { if (Object.values(this.flashAt).some(at => Date.now() - at < FLASH_MS + 100)) cx.notify(); });
      cx.spawn(async (cx) => {
        for (;;) {
          try { await watchFolder(`${home()}/.config/veroboard/state/pings`); } catch { break; }
          await this.reload();
          cx.notify();
        }
      });
      // Tasks come from adapters/claude/subagents.js, a Claude Code subagentStatusLine hook.
      const dir = `${home()}/.config/veroboard/state/subagents`;
      cx.spawn(async (cx) => {
        await this.reload();
        cx.notify();

        for (;;) {
          try { await watchFolder(dir); } catch { break; }
          await this.reload();
          cx.notify();
        }
      });
      cx.spawn(async (cx) => {
        for (;;) {
          try { await watchFolder(`${home()}/.config/veroboard/state/sessions`); } catch { break; }
          await this.reload();
          cx.notify();
        }
      });
      cx.timer.every(5000, (cx) => cx.spawn(async (cx) => {
        await this.reload();
        cx.notify();
      }));
    }
  }
  async reload() {
    const subs = {};
    const sessions = {};
    const pings = {};
    for (const { address } of agents()) {
      if (!/^[A-Za-z0-9_-]+$/.test(address)) continue;

      try {
        const { running, at, tasks } = JSON.parse(await readTextFile(`${home()}/.config/veroboard/state/subagents/${address}.json`));
        if (Number.isFinite(running) && Number.isFinite(at)) subs[address] = { running, at,
          tasks: Array.isArray(tasks) ? tasks.filter(x => x && typeof x === "object").slice(0, 8) : [] };
      } catch {}

      try {
        const { at } = JSON.parse(await readTextFile(`${home()}/.config/veroboard/state/pings/${address}.json`));
        if (Number.isFinite(at)) pings[address] = at;
      } catch {}

      // agent/adapters/claude/facts.js (in this mod's folder) writes the sessions file.
      try {
        const { pct, tokens, model, effort, window, shells, shellList, monitorList, launched, git, worktree, lastPrompt, awaiting } = JSON.parse(await readTextFile(`${home()}/.config/veroboard/state/sessions/${address}.json`));
        if (Number.isFinite(pct) && Number.isFinite(tokens) && typeof model === "string") {
          let parsedGit = null;
          try {
            const data = typeof git === "string" ? JSON.parse(git) : null;
            if (data && typeof data === "object" && !Array.isArray(data)) {
              parsedGit = Object.fromEntries(["ahead", "behind", "staged", "modified", "untracked", "conflicts"]
                .map(key => [key, Number.isFinite(data[key]) ? data[key] : 0]));
              parsedGit.state = typeof data.state === "string" ? data.state : "";
            }
          } catch {}

          sessions[address] = { pct, tokens, model, effort: typeof effort === "string" ? effort : "", window: Number.isFinite(window) ? window : null,
            shells: Number.isFinite(shells) && shells > 0 ? shells : 0, git: parsedGit, worktree: typeof worktree === "string" ? worktree : "",
            shellList: Array.isArray(shellList) ? shellList.filter(x => x && typeof x === "object").slice(0, 8) : [],
            monitorList: Array.isArray(monitorList) ? monitorList.filter(x => x && typeof x === "object").slice(0, 8) : [],
            launched: Array.isArray(launched) ? launched.filter(x => typeof x === "string").slice(-200) : [],
            // When you last prompted it (clears a manual Blocked mark), and the agent it stopped to wait on, if any.
            lastPrompt: Number.isFinite(lastPrompt) ? lastPrompt : null,
            awaiting: awaiting && typeof awaiting === "object" && typeof awaiting.to === "string"
              ? { to: awaiting.to, at: Number.isFinite(awaiting.at) ? awaiting.at : null } : null };
        }
      } catch {}
    }

    this.subs = subs;
    this.sessions = sessions;
    // A newer ping than last time means the hook just played a sound. The first read only takes note.
    if (this.pings) for (const [addr, at] of Object.entries(pings)) if (at > (this.pings[addr] ?? 0)) this.flashAt[addr] = Date.now();
    this.pings = pings;
  }
  // One agent's card: its facts as a model, drawn by card.js renderCard (where the badges and the layout live).
  card(a, state, t, shown = false) {
    // In Done, a card you've looked at since it finished (Herdr's "idle"; unseen is "done") turns idle grey, so
    // green means "new since you last clicked in". The column and the header pie keep counting it as Done (green).
    // Except the card shown below: it stays green, so its ring reads as the focused one (grey was too faint, user 2026-11-06).
    if (VIEW.greyWhenSeen && state.key === "done" && a.status !== "done" && !shown) state = { ...state, color: t.idle };
    const sub = this.subs?.[a.address];
    const tasks = sub && Date.now() - sub.at < 30000 ? sub.tasks : [];
    const session = this.sessions?.[a.address];
    const shellList = session?.shellList ?? [];
    // A monitor past its expiry is gone even before the status line next runs.
    const monitorList = (session?.monitorList ?? []).filter(m => !Number.isFinite(m.expiresAt) || m.expiresAt > Date.now());
    // Agents in their own tabs that another agent opened (herdr-app do tab.new …), from agent/adapters/claude/facts.js:
    // the opener's card counts the ones still live that are agents, the same ones its cables go to (a plain shell it
    // opened isn't counted: the badge said 3 next to 2 cables, user 2026-11-18).
    const live = addr => terminals().some(x => x.address === addr && x.state === "live") && agents().some(x => x.address === addr);
    // Herdr's own facts: the pane's git branch and folder, and since when its tab has been working.
    const pane = panes().find(p => p.pane === a.pane);
    const since = a.status === "working" ? spaces().flatMap(s => s.tabs).find(tb => tb.id === a.tab)?.working_since : null;
    // Time in this lane. Working: the turn. Waiting: its oldest sub-agent, monitor or waiting shell (hc helpers have
    // no start time), pink when any of them looks stuck. Done: since it got here (shared "veroboard.doneSince").
    // Only the kinds that keep a card in Waiting (VIEW.wait*), each with its own stuck time.
    const waitItems = state.key === "waiting" ? [
      ...(VIEW.waitTask !== false ? tasks : []).map(x => ({ kind: "task", start: x.startTime, quiet: x.startTime })),
      ...(VIEW.waitMonitor !== false ? monitorList : []).map(m => ({ kind: "monitor", start: m.startTime, quiet: Number.isFinite(m.eventAt) ? m.eventAt : m.startTime })),
      ...(VIEW.waitShell !== false ? shellList.filter(sh => sh.waits) : []).map(sh => ({ kind: "shell", start: sh.startTime, quiet: sh.startTime })),
    ].filter(x => Number.isFinite(x.start)) : [];
    const doneAt = (shared("veroboard.doneSince") ?? {})[a.address];
    const laneTime = since ? { text: duration(Date.now() - (since < 1e12 ? since * 1000 : since)), color: t.working }
      : waitItems.length ? { text: duration(Date.now() - Math.min(...waitItems.map(x => x.start))), color: waitItems.some(x => Date.now() - x.quiet > stuckMs(x.kind)) ? t.blocked : WAITING }
      : VIEW.doneTimer && state.key === "done" && Number.isFinite(doneAt) ? { text: duration(Date.now() - doneAt), color: state.color }
      : null;
    // Every Blocked card says why, with how long it has been so (see blockReason). Pink = your move; marigold = waiting
    // on another agent or a person.
    const r = this.blockReason(a);
    const why = r ? { icon: r.icon, color: r.color, tip: r.tip, label: r.label + (Number.isFinite(r.at) && r.at <= Date.now() ? ` ${duration(Date.now() - r.at)}` : "") } : null;
    const flashT = (Date.now() - (this.flashAt?.[a.address] ?? 0)) / FLASH_MS;
    const m = {
      address: a.address, program: a.program, name: a.tab_name, color: state.color, shown,
      flash: VIEW.glow && flashT >= 0 && flashT < 1 ? flashT : null,
      laneTime, why,
      launched: (session?.launched ?? []).filter(live).length,
      // The agent that opened it, while that one runs (the Opened by badge; off by default).
      ...(() => { const p = this.parentOf(a.address); return p && live(p) ? { openedBy: p, openedByName: agents().find(x => x.address === p)?.tab_name ?? "" } : {}; })(),
      folder: pane?.cwd ? shortPath(pane.cwd) : null,
      branch: pane?.branch ? { name: pane.branch, worktree: Boolean(session?.worktree), state: session?.git?.state || null } : null,
      model: session?.model ?? null, programName: a.program?.name ?? "",
      effort: session?.effort || null, window: session ? session.window : null,
      // Its space, hidden when the board shows one space only.
      space: shared("veroboard.scope") !== "space" && a.space_name ? a.space_name : null,
      context: session ? { pct: session.pct } : null,
      rows: [
        ...tasks.map(({ type, label, description, name, startTime }) => ({ kind: "task", type, text: label || description || name || "sub-agent", startTime })),
        ...shellList.map(({ description, command, startTime, waits }) => ({ kind: "shell", text: description || command || "background shell", muted: !description, startTime, waits })),
        ...monitorList.map(({ description, command, event, eventAt, startTime, expiresAt }) => ({ kind: "monitor", text: description || command || "monitor", muted: !description, event, eventAt, startTime, expiresAt })),
      ],
    };
    return renderCard(m, t, {
      onClick: () => run("agent.focus", { terminal: a.address }),
      // The menu: Pin to Blocked / Unpin, Move to Done (in Blocked), Open. 31px a row and 10px of padding.
      onRightClick: () => openOverlay({ mod: "veroboard-menu", kind: "popup", width: 200, height: (state.key === "blocked" ? 3 : 2) * 31 + 10,
        props: { terminal: a.address, blocked: state.key === "blocked" } }),
    });
  }
  // How many background bars hang under a card (same rules as card()): each is 22px under the 76px card.
  // How many background work rows its card shows: only the kinds shown (Veroboard settings → Card; the rows are drawn
  // by card.js, which filters the same way). Hidden kinds still count for its lane (column()).
  barCount(a) {
    if (!VIEW.card?.rows) return 0;
    const k = VIEW.card.rowKinds ?? {};
    const sub = this.subs?.[a.address];
    const tasks = sub && Date.now() - sub.at < 30000 ? sub.tasks : [];
    const session = this.sessions?.[a.address];
    const monitors = (session?.monitorList ?? []).filter(m => !Number.isFinite(m.expiresAt) || m.expiresAt > Date.now());
    return (k.task !== false ? tasks.length : 0) + (k.shell !== false ? (session?.shellList ?? []).length : 0) + (k.monitor !== false ? monitors.length : 0);
  }
  // What the filter box searches (user, 2026-11-17: anything with text on a card): its name, id, program, space,
  // folder (the whole path), branch and worktree, model, effort, window, lane, why it's in Blocked and who it waits on,
  // the agent that opened it, and its background work (sub-agents, shells, monitors and their last event). Lowercase.
  searchText(a) {
    const s = this.sessions?.[a.address];
    const pane = panes().find(p => p.pane === a.pane);
    const sub = this.subs?.[a.address];
    const tasks = sub && Date.now() - sub.at < 30000 ? sub.tasks : [];
    const lane = STATES.find(x => x.key === this.column(a))?.label;
    const why = this.blockReason(a);
    return [
      a.tab_name, a.address, a.program?.name, a.space_name, pane?.cwd, pane?.branch, s?.worktree,
      s?.model, s?.effort, Number.isFinite(s?.window) ? compactTokens(s.window) : null, lane,
      why?.label, s?.awaiting?.to, this.parentOf(a.address),
      ...tasks.flatMap(x => [x.type, x.label, x.description, x.name]),
      ...(s?.shellList ?? []).flatMap(x => [x.description, x.command]),
      ...(s?.monitorList ?? []).flatMap(x => [x.description, x.command, x.event]),
    ].filter(x => typeof x === "string" && x).join("\n").toLowerCase();
  }
  // The agent that opened this one: the live opener from facts.js's `launched`, else Herdr's own parent.
  parentOf(addr) {
    const live = x => terminals().some(tm => tm.address === x && tm.state === "live");
    const opener = Object.entries(this.sessions ?? {}).find(([o, s]) => o !== addr && s.launched?.includes(addr) && live(o))?.[0];
    return opener ?? terminals().find(x => x.address === addr)?.parent ?? null;
  }
  // The cables: { back } under the lanes, { front } (the jack plugs) over them. Card positions come from the layout's own numbers (columns px 24 / pt 17,
  // 12px gaps around 1px dividers, a 27px lane header + 9px gap, 76px cards + 22px per bar, 9px between cards).
  // Every lane gets cables, also one with more cards than fit (user, 2026-11-10): the board scrolls lanes itself
  // (laneBody), so it knows each offset. A card below the lane's bottom still gets its cable, which runs down
  // off the board (behind the terminal under it); its jack is drawn only while the card is in view.
  // A lane's visible height and its cards' total height, in zoom-1 px, from the same numbers as the layout.
  async loadView() {
    const json = async (path) => { try { return JSON.parse(await readTextFile(path)); } catch (_) { return {}; } };
    // The package's defaults ship in this mod's folder (agent/core); yours are ~/.config/veroboard/config.json.
    const defaults = await json(`${appHome()}/mods/veroboard/agent/core/defaults.json`);
    const mine = await json(`${home()}/.config/veroboard/config.json`);
    setView(viewFrom(defaults.board, mine.board));
  }
  laneFit(cards) {
    const zoom = Number(settings()?.zoom) || 1;
    const view = (this.boardH ?? 0) / zoom - 6 - 53;
    const content = cards.reduce((n, a) => n + 76 + 22 * this.barCount(a) + 9, -9);
    return { view, max: Math.max(0, content - view), content };
  }
  laneOffset(key, cards) {
    const off = Math.max(0, Math.min(this.laneScroll?.[key] ?? 0, this.laneFit(cards).max));
    (this.laneScroll ??= {})[key] = off;
    return off;
  }
  // A lane's cards in a viewport the board scrolls with the wheel (a built-in scroll area hides its offset),
  // with a thin thumb on the right while the lane overflows.
  laneBody(t, key, cards, children) {
    const { view, max, content } = this.laneFit(cards);
    const off = this.laneOffset(key, cards);
    return div().id(`lane-${key}`).relative().flex_1().min_h(0).overflow_hidden()
      .on_scroll_wheel((e, cx) => {
        const zoom = Number(settings()?.zoom) || 1;
        const next = Math.max(0, Math.min(off - e.delta.y / zoom, this.laneFit(cards).max));
        if (next !== off) { this.laneScroll[key] = next; cx.notify(); }
      })
      .child(v_flex().absolute().left(0).top(-off).w_full().gap(9).children(children))
      .when(max > 0, el => el.child(div().absolute().right(1).top(off / content * view).w(3)
        .h(Math.max(24, view * view / content)).rounded(2).bg(alpha(t.foreground, "40"))));
  }
  wires(t, lanes) {
    // Herdr's zoom scales every px a mod writes (card sizes, .left/.top), but on_size_change reports real px:
    // work in zoom-1 px, like the rest of the layout.
    const zoom = Number(settings()?.zoom) || 1;
    const W = this.boardW / zoom, H = this.boardH / zoom;
    const line = mix(t.canvas, t.border, 0.5);
    if (!W || !H) return { back: div(), front: div() };
    const laneW = (W - 48 - 3 - 6 * 12) / 4;
    // The lane dividers, here so the cables cross over them (as flex children they painted on top and cut them).
    const dividers = [1, 2, 3].map(i => div().absolute().left(24 + i * (laneW + 25) - 13).top(17).w(1).h(H - 23).bg(line));
    // Patch cables off (Veroboard settings → Display): only the dividers.
    if (!VIEW.cables) return { back: div().absolute().inset_0().children(dividers), front: div() };
    const pos = {};
    lanes.forEach((cards, i) => {
      const x = 24 + i * (laneW + 25);
      const heights = cards.map(a => 76 + 22 * this.barCount(a));
      let y = 53 - this.laneOffset(STATES[i].key, cards);
      cards.forEach((a, j) => { pos[a.address] = { lane: i, left: x, right: x + laneW, y: y + 38 }; y += heights[j] + 9; });
    });
    // Pink, green, blue, peach, purple, cyan, then the light pink and blue: neighbours in this order differ most.
    const palette = cablePalette(t, VIEW.cableColors === "grey");
    const shadows = [], bodies = [], jacks = [];
    // Siblings take colors in id order, so cables from one parent never match (a hash gave three the same pink).
    const kids = {};
    for (const addr of Object.keys(pos).sort()) { const par = this.parentOf(addr); if (pos[par]) (kids[par] ??= []).push(addr); }
    // Leave from the facing edges. In the same lane, both from the right edge and loop out, except in the rightmost
    // lane: there only the board's 24px margin is to the right, so the loop goes out the left edge into the gutter
    // (joining that edge's jack fan).
    // Same-lane loops share out between the card's edges (user, 2026-11-06): each goes to the edge with fewer cables
    // so far, counting the cables going across, nearest child first. So 4 children under a parent split 2 and 2, and
    // a parent with many cables going left loops its own lane's out right. Ties go right, except in an edge lane: there
    // they go to the inner gutter, and the board's 24px margin (a tighter loop) is used only when it has fewer cables.
    const loopSide = {};
    for (const [par, list] of Object.entries(kids)) {
      const p = pos[par];
      const tie = p.lane === lanes.length - 1 && p.lane > 0 ? -1 : 1;
      const load = { [-1]: list.filter(x => pos[x].lane < p.lane).length, [1]: list.filter(x => pos[x].lane > p.lane).length };
      const near = list.filter(x => pos[x].lane === p.lane).sort((x, y) => Math.abs(pos[x].y - p.y) - Math.abs(pos[y].y - p.y) || (x < y ? -1 : 1));
      for (const x of near) { const s = load[-1] < load[1] ? -1 : load[-1] > load[1] ? 1 : tie; loopSide[x] = s; load[s]++; }
    }
    const sides = (p, addr) => { const c = pos[addr]; return p.lane < c.lane ? [1, -1] : p.lane > c.lane ? [-1, 1] : [loopSide[addr], loopSide[addr]]; };
    // A parent with several cables on one edge gives each its own jack: the first in the middle, then alternately
    // above and below (0, −s, +s, −2s, …) so the group stays centered. Higher cards take the higher jacks, so
    // cables don't cross at the parent.
    const slot = {};
    for (const [par, list] of Object.entries(kids)) for (const side of [-1, 1]) {
      const p = pos[par];
      // A same-lane child hooks back along the parent's own column: below the parent it takes the bottom jack,
      // above it the top one, so its loop doesn't cross the cables going across.
      const key = addr => pos[addr].lane !== p.lane ? pos[addr].y : pos[addr].y > p.y ? 1e6 + pos[addr].y : -1e6 + pos[addr].y;
      const mine = list.filter(addr => sides(p, addr)[0] === side).sort((x, y) => key(x) - key(y) || (x < y ? -1 : 1));
      const s = mine.length > 1 ? Math.min(13, 60 / (mine.length - 1)) : 0;
      const offs = mine.map((_, k) => (k % 2 ? -1 : 1) * Math.ceil(k / 2) * s).sort((x, y) => x - y);
      mine.forEach((addr, k) => { slot[addr] = offs[k]; });
    }
    // A parent's generation among the cards on the board: 1 when its own opener isn't on it (see cableDash).
    const gen = (addr, seen = new Set()) => { const up = this.parentOf(addr); return pos[up] && !seen.has(up) ? 1 + gen(up, seen.add(addr)) : 1; };
    for (const [par, list] of Object.entries(kids)) for (const [k, addr] of list.entries()) {
      const p = pos[par], c = pos[addr];
      // Each generation starts one color further along (user, 2026-11-18), so a chain of only children goes pink, green,
      // blue instead of all pink; siblings still step through the palette from there.
      const g = gen(par);
      const color = palette[(k + g - 1) % palette.length] ?? t.accent;
      const [outP, outC] = sides(p, addr);
      const a = { x: outP > 0 ? p.right : p.left, y: p.y + (slot[addr] ?? 0) }, b = { x: outC > 0 ? c.right : c.left, y: c.y };
      // A jack only on a card in view: one scrolled out of its lane would float over the header or the board's edge.
      const c2 = cableLayers(t, a, b, outP, outC, color, H, W, (j) => j.y >= 53 && j.y <= H - 6, g);
      shadows.push(...c2.shadows); bodies.push(...c2.bodies); jacks.push(...c2.jacks);
    }
    // `back` goes under the lanes (cards hide the cable), `front` over them: the plugs stay visible on the card edges.
    // The cables are cut off at the top of the lanes' cards (53: under the lane headers), where a card scrolled up out of
    // its lane is cut off too, so a cable to it goes under the header row instead of over it (user, 2026-11-18). The
    // clip starts at 53; the cables inside are moved back up 53, so their coordinates stay the board's.
    const clipped = div().absolute().left(0).right(0).top(53).bottom(0).overflow_hidden()
      .child(div().absolute().left(0).top(-53).w(W).h(H).children([...shadows, ...bodies]));
    return { back: div().absolute().inset_0().children(dividers).child(clipped), front: div().absolute().inset_0().children(jacks) };
  }
  // The agent's column: Herdr's blocked and working as they are; otherwise waiting while something it
  // started is still running (a live monitor, a sub-agent, an hc helper terminal, a background shell that
  // waits for something: facts.js marks those `waits`), else done.
  // Moved to Done by hand (right-click → Move to Done, mods/veroboard-menu; user 2026-11-17): shared "veroboard.dismissed"
  // { at }. The reason it was in Blocked stops counting until something new happens: you prompt it, its next message
  // asks again (a newer awaiting), or a new dialog opens in its tab (Herdr's blocked since after the mark).
  dismissed(a) {
    const d = (shared("veroboard.dismissed") ?? {})[a.address];
    if (!d || !Number.isFinite(d.at)) return false;
    const s = this.sessions?.[a.address];
    if ((s?.lastPrompt ?? 0) > d.at || (s?.awaiting?.at ?? 0) > d.at) return false;
    return a.status !== "blocked" || (this.promptSince(a) ?? Infinity) <= d.at;
  }
  // Since when a dialog has been open in its tab: Claude Code's Notification ping if newer than your last prompt
  // (it survives a reload), else when the board first saw it blocked.
  promptSince(a) {
    const ping = this.pings?.[a.address];
    const asked = this.sessions?.[a.address]?.lastPrompt ?? 0;
    return Number.isFinite(ping) && ping >= asked ? ping : this.blockedSeen?.[a.address];
  }
  column(a) {
    // Pinned to Blocked by hand (right-click a card; mods/veroboard-menu) wins over everything else.
    if ((shared("veroboard.blocked") ?? {})[a.address]) return "blocked";
    const dismissed = this.dismissed(a);
    if (a.status === "blocked" && !dismissed) return "blocked";
    if (a.status === "working") return a.status;
    const sub = this.subs?.[a.address];
    const tasks = sub && Date.now() - sub.at < 30000 ? sub.tasks : [];
    const monitors = (this.sessions?.[a.address]?.monitorList ?? []).filter(m => !Number.isFinite(m.expiresAt) || m.expiresAt > Date.now());
    const helpers = terminals().some(x => x.parent === a.address && x.state === "live");
    const waitShells = (this.sessions?.[a.address]?.shellList ?? []).some(sh => sh.waits === true);
    // Each kind keeps the card in Waiting unless switched off (Veroboard settings → Card → Waiting; user, 2026-11-18).
    if ((VIEW.waitTask !== false && tasks.length > 0) || (VIEW.waitMonitor !== false && monitors.length > 0)
      || (VIEW.waitHelper !== false && helpers) || (VIEW.waitShell !== false && waitShells)) return "waiting";
    // Idle after messaging another agent and saying it waits for the answer (facts.js `awaiting`): stuck
    // until that agent replies, so Blocked rather than Done. The reply is a new prompt, which clears it.
    return this.awaiting(a) && !dismissed ? "blocked" : "done";
  }
  // Why a card is in Blocked, as { icon, label, color, at }, or null when it isn't. First match wins:
  //  1. Pinned: you moved it there by hand (right-click), since the mark's time.
  //  2. Prompt: Herdr says blocked, i.e. a dialog is open in its tab (a question or a permission ask), since
  //     Claude Code's Notification ping (pings/<id>.json) if newer than your last prompt, else since the board saw it blocked.
  //  3. You: its last message asks you something (facts.js awaiting.to === "you").
  //  4. <who>: it waits on another agent or a person ("t22", "Luke").
  blockReason(a) {
    if (a.status === "working") return null;
    const t = theme();
    const mark = (shared("veroboard.blocked") ?? {})[a.address];
    if (mark) return { icon: "mods/workspace-chrome/pin.svg", label: "Pinned", color: t.blocked, at: mark.at,
      tip: "You pinned it to Blocked. Right-click the card to unpin it." };
    if (this.dismissed(a)) return null;
    if (a.status === "blocked") {
      // The ping counts only if it came after your last prompt: an older one is the previous turn's Stop.
      return { icon: "mods/veroboard/question.svg", label: "Prompt", color: t.blocked,
        tip: "A question or permission dialog is open in its tab. Right-click → Move to Done if it doesn't matter.",
        at: this.promptSince(a) };
    }
    if (this.column(a) !== "blocked") return null;
    const w = this.awaiting(a);
    if (!w) return null;
    // The hover names the rule that decided it (facts.js awaiting.rule), so a wrong lane can be fixed in Veroboard settings (the gear).
    const rule = typeof w.rule === "string" ? ` Rule: ${w.rule}${this.ruleWhy?.[w.rule] ? `: ${this.ruleWhy[w.rule]}` : ""}.` : "";
    return w.to === "you"
      ? { icon: "mods/workspace-chrome/clock.svg", label: "You", color: t.blocked, at: w.at,
          tip: `Its last message asks you something.${rule} Wrong? Tune it in Veroboard settings (the gear in the header).` }
      : { icon: "mods/workspace-chrome/clock.svg", label: w.to, color: ELSEWHERE, at: w.at,
          tip: `It says it waits on ${w.to}.${rule} Wrong? Tune it in Veroboard settings (the gear in the header).` };
  }
  awaiting(a) {
    const w = this.sessions?.[a.address]?.awaiting;
    return w && typeof w.to === "string" ? w : null;
  }
  // A lane's order: pinned first, then by what matters in that lane. Blocked: waiting on you longest
  // (lowest seq, Herdr's change counter). Waiting: the monitor that expires soonest. Working: running
  // longest (its tab's working_since). Done: finished most recently (highest seq).
  sortLane(key, cards) {
    const expiry = a => Math.min(Infinity, ...(this.sessions?.[a.address]?.monitorList ?? [])
      .map(m => m.expiresAt).filter(x => Number.isFinite(x) && x > Date.now()));
    const tabs = spaces().flatMap(s => s.tabs);
    const since = a => tabs.find(tb => tb.id === a.tab)?.working_since ?? Infinity;
    const by = { blocked: a => a.seq, waiting: expiry, working: since, done: a => -a.seq }[key] ?? (() => 0);
    return this.groupFamilies([...cards].sort((x, y) => (y.pinned - x.pinned) || (by(x) - by(y)) || (x.seq - y.seq)));
  }
  // Keep each family together so the cables stay tidy. A family is every card in the lane that shares a top
  // ancestor, even when the parent sits in another lane (siblings opened by t22 stay side by side while t22 works).
  // Within a family a card goes right under its parent when that parent is in the lane (depth first, siblings in
  // the lane's own order). The family takes the slot of its highest member; cards with no relatives keep their place.
  // Notifications Herdr handed to mods/veroboard-toast (shared "veroboard.notices"), newest on top, at most three, in
  // the board's top-right corner. Each has the selected space chip's light accent border. A click runs its action
  // (usually: go to that agent) and dismisses it; × only dismisses. The board copy drops expired ones (init).
  // A notification about an agent (Herdr's carry agent.focus {terminal}) gets that agent's card facts, saved with it
  // when it arrives (user, 2026-11-18): name, id, why it's in its lane (or the lane), space, branch, who opened it.
  // The bell's history keeps them after the agent is gone. The board copy runs this every second.
  enrichNotices() {
    const t = theme();
    const lists = ["veroboard.notices", "veroboard.noticeLog"].map((k) => [k, Array.isArray(shared(k)) ? shared(k) : []]);
    const need = (n) => n && noticePending(n);
    if (!lists.some(([, l]) => l.some(need))) return;
    const snaps = {};
    const snap = (addr) => snaps[addr] ??= (() => {
      const a = agents().find((x) => x.address === addr);
      if (!a) return { address: addr };
      const pane = panes().find((p) => p.pane === a.pane);
      const r = this.blockReason(a), lane = this.column(a), up = this.parentOf(addr);
      return {
        address: addr, name: a.tab_name || addr, space: a.space_name || "", spaceId: a.space || "",
        why: r ? { label: r.label, color: r.color } : { label: STATES.find((x) => x.key === lane)?.label ?? "", color: stateColor(t, lane) },
        branch: pane?.branch ? { name: pane.branch, worktree: Boolean(this.sessions?.[addr]?.worktree) } : null,
        parent: up ? { address: up, name: agents().find((x) => x.address === up)?.tab_name ?? "" } : null,
      };
    })();
    for (const [k, l] of lists) if (l.some(need)) setShared(k, l.map((n) => (need(n) ? { ...n, agent: snap(n.action.args.terminal) } : n)));
  }
  // `floating`: drawn in the window over the terminal (role "toasts"), in its own flow; else on the board, placed by
  // toastPlace, and not at all when they go over the terminal.
  // noticeRead "visit" (user, 2026-11-18): going to an agent counts as reading what it told you. While Herdr's window
  // is in front and the focused terminal is an agent's, its unread notifications older than 2s (so its toast still
  // shows first) are marked read. Herdr only notifies about an agent you weren't looking at. Runs every second.
  readVisited() {
    if ((["open", "visit", "hand"].includes(VIEW.noticeRead) ? VIEW.noticeRead : "visit") !== "visit") return;
    if (!window()?.active) return;
    const f = focused();
    const here = [f?.terminal, f?.shown, f?.agent].filter(Boolean);
    if (!here.length) return;
    const KEY = "veroboard.noticeLog", now = Date.now();
    const log = Array.isArray(shared(KEY)) ? shared(KEY) : [];
    const mine = (n) => n && now - n.at > 2000 && noticeUnread(n) && here.includes(n.agent?.address || n.action?.args?.terminal);
    if (log.some(mine)) setShared(KEY, log.map((n) => (mine(n) ? { ...n, read: true, unread: false } : n)));
  }
  noticeStack(t, floating = false) {
    if (!floating && VIEW.toastArea === "terminal") return null;
    const KEY = "veroboard.notices", now = Date.now();
    const all = Array.isArray(shared(KEY)) ? shared(KEY) : [];
    // Where (Veroboard settings → Notifications; user, 2026-11-18): top, middle or bottom of the board, then left, center
    // or right. Newest nearest the edge it comes from: on top up top and in the middle, at the bottom down there.
    const [placeRow, col] = (TOAST_PLACES.includes(VIEW.toastPlace) ? VIEW.toastPlace : "top-right").split("-");
    const row = floating ? props()?.row ?? "top" : placeRow;
    const live = all.filter((n) => n && n.at + n.timeout > now && !noticePending(n)).slice(-3);
    const list = row === "bottom" ? live : live.reverse();
    if (!list.length) return null;
    // Clicked or dismissed counts as read: it shows dimmed in the bell's list and leaves the bell's count.
    const drop = (id) => {
      setShared(KEY, (Array.isArray(shared(KEY)) ? shared(KEY) : []).filter((x) => x && x.id !== id));
      const log = Array.isArray(shared("veroboard.noticeLog")) ? shared("veroboard.noticeLog") : [];
      if (log.some((x) => x && x.id === id && (!x.read || x.unread))) setShared("veroboard.noticeLog", log.map((x) => x && x.id === id ? { ...x, read: true, unread: false } : x));
    };
    const DOT = { error: "blocked", warning: "working", success: "done", info: "accent" };
    // About an agent (enrichNotices): like a slim card (user, 2026-11-18): a stripe in the why's color; its name, why +
    // age and id; then space, branch and who opened it. Else Herdr's title and body.
    // `shrink`: gives way first when the line runs out of room, cut with … (the branch, so the parent still shows).
    const pill = (text, fg, bg = t.raised, mono = false, icon = null, shrink = false) => h_flex().h(16).px(6).gap(4).items_center()
      .rounded(4).bg(bg).text_size(10.5).text_color(fg).when(mono, (el) => el.font_family("JetBrains Mono"))
      .when(shrink, (el) => el.flex_shrink(1).min_w(0)).when(!shrink, (el) => el.flex_none())
      .when(Boolean(icon), (el) => el.child(svg(icon).size(10).flex_none())).child(div().min_w(0).truncate().child(text));
    const body = (n) => {
      const g = n.agent;
      // One frame for every notice (user, 2026-11-18): an 18px first line and a 16px second line, the second there even
      // when it has nothing in it, so every notice is the same height (the box's h(60) holds it too).
      if (!g?.name) return v_flex().flex_1().min_w(0).gap(6)
        .child(div().h(18).flex_none().truncate().font_semibold().text_size(13).text_color(t.foreground).child(n.title))
        .child(div().h(16).flex_none().truncate().text_size(12).text_color(t.muted).child(n.body ?? ""));
      return v_flex().flex_1().min_w(0).gap(6)
        .child(h_flex().h(18).flex_none().gap(6).items_center()
          .child(div().flex_1().min_w(0).truncate().font_semibold().text_size(13).text_color(t.foreground).child(g.name))
          // No age: a notice on the board is always "now" (user, 2026-11-18). The bell's list keeps it.
          .when(Boolean(g.why?.label), (el) => el.child(pill(g.why.label, g.why.color, alpha(g.why.color, "26"))))
          .when(Boolean(g.address), (el) => el.child(pill(g.address, t.muted, t.raised, true))))
        .child(h_flex().h(16).flex_none().gap(5).items_center().overflow_hidden()
          .when(Boolean(g.space), (el) => el.child(pill(g.space, t.muted)))
          // As on the card: a branch in a linked worktree is blue with the layers icon.
          .when(Boolean(g.branch), (el) => el.child(g.branch.worktree
            ? pill(g.branch.name, t.ansi4, alpha(t.ansi4, "26"), false, "mods/workspace-chrome/layers.svg", true)
            : pill(g.branch.name, t.muted, t.raised, false, "mods/workspace-chrome/git-branch.svg", true)))
          // Who opened it on the right, under the id (user, 2026-11-19); the branch gives way first.
          .when(Boolean(g.parent), (el) => el.child(div().flex_1().min_w(0))
            .child(pill(`${g.parent.name || g.parent.address} · ${g.parent.address}`, t.muted, t.raised, false, "mods/veroboard/launched-by.svg"))));
    };
    // The colored left edge follows the notice's rounded corners, like a CSS border-left on a rounded box (a square
    // stripe looked odd on a toast; user, 2026-11-18): the box is filled with the why's color, and the content sits 3px
    // in from the left on the popup's color, its own left corners rounded, so the color shows as a curved edge.
    // In zoom-1 px, like the rest of the layout. Each notice is 62px (60 + its border), 8px apart; 24px off the sides
    // (the lanes' margin), 8px off the top and bottom.
    const zoom = Number(settings()?.zoom) || 1;
    const W = (this.boardW ?? 0) / zoom, H = (this.boardH ?? 0) / zoom, stackH = list.length * 62 + (list.length - 1) * 8;
    return v_flex().w(340).gap(8).when(!floating, (el) => el.absolute())
      .when(!floating && row === "top", (el) => el.top(8)).when(!floating && row === "bottom", (el) => el.bottom(8))
      .when(!floating && row === "middle", (el) => el.top(Math.max(8, (H - stackH) / 2)))
      .when(!floating && col === "left", (el) => el.left(24)).when(!floating && col === "right", (el) => el.right(24))
      .when(!floating && col === "center", (el) => el.left(Math.max(24, (W - 340) / 2)))
      .children(list.map((n) => {
      const edge = n.agent?.name ? (n.agent.why?.color ?? t.accent) : null;
      // The light border sits on the popup's color (it's see-through; on the edge's color it tinted the whole outline),
      // so the colored layer is inside it.
      return h_flex().id(`notice-${n.id}`).rounded(10).border(1).border_color(alpha(t.accent, "55")).shadow_lg().overflow_hidden()
        .bg(t.popover).child(h_flex().flex_1().min_w(0).rounded(9).bg(edge ?? t.popover).when(Boolean(edge), (el) => el.pl(3))
        .child(h_flex().id(`notice-in-${n.id}`).flex_1().min_w(0).h(60).px(edge ? 11 : 14).gap(11).items_center()
          .bg(t.popover).when(Boolean(edge), (el) => el.rounded_l(6))
          .cursor_pointer().hover((s) => s.bg(t.hover))
          .on_click(() => { if (n.action?.name) run(n.action.name, n.action.args ?? {}); drop(n.id); })
          .when(!edge, (el) => el.child(n.icon ? image(n.icon).w(16).h(16).flex_none() : div().size(8).rounded(4).flex_none().bg(t[DOT[n.level] ?? "accent"] ?? t.accent)))
          .child(body(n))
          .child(div().id(`notice-x-${n.id}`).flex_none().px(5).rounded(4).text_size(13).text_color(t.dim).cursor_pointer()
            .hover((s) => s.text_color(t.foreground).bg(t.raised))
            .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
            .on_click((_e, cx) => { cx.stop_propagation(); drop(n.id); }).child("×"))));
    }));
  }
  // Notices over the terminal (toastArea "terminal"; user, 2026-11-18): a mod draws only inside its own block, so the
  // board opens a copy of itself as a frameless window (role "toasts") over the terminal, sized to the stack, at
  // toastPlace inside the terminal's pane. It doesn't take the keyboard. Its id is shared "veroboard.toastWin"; any
  // other toasts window closes itself. When the notices, the spot or the sizes change, it's replaced; when there are
  // none, or they go back on the board, it's closed. Runs every 200ms on the board copy; does nothing if nothing changed.
  // Window px (Herdr's zoom scales the layout's and the mod's px, so those are multiplied by it). The terminal's pane:
  // under the header (52), this block (its height + 1px border each side), the workspace's 10px padding, the tab
  // strip (34) and a 10px gap, and its 28px header; 24px in from the window's sides and 10px off its bottom.
  syncToastWindow() {
    const id = shared("veroboard.toastWin"), now = Date.now();
    const live = (Array.isArray(shared("veroboard.notices")) ? shared("veroboard.notices") : []).filter((n) => n && n.at + n.timeout > now && !noticePending(n)).slice(-3);
    let vp = null;
    try { vp = globalThis.window.viewport_size(); } catch (_) { /* not drawn yet */ }
    if (VIEW.toastArea !== "terminal" || !live.length || !this.rootH || !vp?.width) {
      if (id) { closeOverlay(id); setShared("veroboard.toastWin", null); }
      this.toastKey = null;
      return;
    }
    const z = Number(settings()?.zoom) || 1, pad = 12 * z, w = 340 * z, stackH = (live.length * 62 + (live.length - 1) * 8) * z;
    const [row, col] = (TOAST_PLACES.includes(VIEW.toastPlace) ? VIEW.toastPlace : "top-right").split("-");
    const top = 52 * z + this.rootH + 2 + (10 + 34 + 10 + 28) * z, bottom = vp.height - 10 * z;
    const left = 24 * z, right = vp.width - 24 * z;
    // 16px in from the pane's sides, 10px from its top and bottom, like the board's margins.
    const L = left + 16 * z, R = right - 16 * z, T = top + 10 * z, B = bottom - 10 * z;
    const x = col === "left" ? L : col === "right" ? R - w : (L + R - w) / 2;
    const y = row === "top" ? T : row === "bottom" ? B - stackH : (T + B - stackH) / 2;
    const at = { x: Math.round(x - pad), y: Math.round(Math.max(T, y) - pad) };
    const key = JSON.stringify([live.map((n) => n.id), at, row, vp.width, vp.height]);
    if (key === this.toastKey && id) return;
    this.toastKey = key;
    if (id) closeOverlay(id);
    setShared("veroboard.toastWin", openOverlay({ mod: "veroboard", kind: "window", frame: "none",
      width: Math.round(w + 2 * pad), height: Math.round(stackH + 2 * pad), at, props: { role: "toasts", row } }));
  }
  groupFamilies(cards) {
    const at = new Map(cards.map((a, i) => [a.address, i]));
    const parent = new Map();
    const up = addr => { if (!parent.has(addr)) parent.set(addr, this.parentOf(addr)); return parent.get(addr); };
    const top = addr => { const seen = new Set([addr]); for (let p = up(addr); p && !seen.has(p); p = up(p)) { seen.add(p); addr = p; } return addr; };
    const kids = new Map(), heads = [];
    for (const a of cards) {
      const p = up(a.address);
      if (at.has(p) && p !== a.address) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(a); } else heads.push(a);
    }
    const family = new Map(cards.map(a => [a.address, top(a.address)]));
    const best = new Map();
    for (const a of cards) { const f = family.get(a.address); best.set(f, Math.min(best.get(f) ?? Infinity, at.get(a.address))); }
    const out = [], done = new Set();
    const walk = a => { if (done.has(a.address)) return; done.add(a.address); out.push(a); for (const k of kids.get(a.address) ?? []) walk(k); };
    for (const f of [...best.keys()].sort((x, y) => best.get(x) - best.get(y)))
      for (const h of heads) if (family.get(h.address) === f) walk(h);
    for (const a of cards) walk(a); // a parent loop, should one ever occur
    return out;
  }
  render(cx) {
    if (this.panel) return this.panel.render();
    const t = theme();
    // The window over the terminal (syncToastWindow): just the notices, 12px in (room for their shadow). A press on it
    // doesn't drag the window. A window the board has since replaced (or one left from before a reload) closes itself.
    if (props()?.role === "toasts") {
      const me = props()?.overlay;
      if (me && shared("veroboard.toastWin") !== me && !this.closing) { this.closing = true; cx?.timer?.after(0, () => closeOverlay(me)); }
      return div().size_full().p(12).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(this.noticeStack(t, true) ?? div());
    }
    // A notice just arrived about an agent (veroboard-toast adds it and every mod redraws): the board copy saves the
    // agent's card facts on it on the next frame, not on its 1s timer, so it shows in its card style at once.
    if (!props()?.role && !this.enriching && (Array.isArray(shared("veroboard.notices")) ? shared("veroboard.notices") : []).some((n) => n && noticePending(n))) {
      this.enriching = true;
      cx?.timer?.after(0, () => { this.enriching = false; this.enrichNotices(); });
    }
    // Herdr chimes when an agent turns done or blocked: note when each card last did, to make it glow.
    const statusNow = Object.fromEntries(agents().map(a => [a.address, a.status]));
    if (this.lastStatus && this.flashAt) for (const [addr, st] of Object.entries(statusNow))
      if ((st === "done" || st === "blocked") && this.lastStatus[addr] !== undefined && this.lastStatus[addr] !== st) this.flashAt[addr] = Date.now();
    this.blockedSeen ??= {};
    for (const [addr, st] of Object.entries(statusNow)) {
      if (st !== "blocked") delete this.blockedSeen[addr];
      else this.blockedSeen[addr] ??= Date.now();
    }
    this.lastStatus = statusNow;
    // Hand-marked Blocked cards ({at}: when marked) stay until you send that agent a prompt (facts.js's
    // lastPrompt, which skips compaction, task notifications and slash commands) or its terminal is gone.
    // Herdr's "working" isn't used: an auto-compact runs as a turn too. Written only on a change, so no loop.
    const marks = shared("veroboard.blocked") ?? {};
    let next = null;
    for (const [addr, m] of Object.entries(marks)) {
      const prompted = this.sessions?.[addr]?.lastPrompt > m.at;
      if (statusNow[addr] === undefined || prompted || !Number.isFinite(m.at)) {
        next ??= { ...marks };
        // An older mark without `at` starts its clock now.
        if (!Number.isFinite(m.at) && statusNow[addr] !== undefined && !prompted) next[addr] = { at: Date.now() }; else delete next[addr];
      }
    }
    if (next) setShared("veroboard.blocked", next);
    // Moved-to-Done marks that no longer apply (something new happened, or the terminal is gone) are dropped. Only
    // once the pings and sessions are read: before that, a dialog's start time would look new.
    const dismissedMarks = shared("veroboard.dismissed") ?? {};
    if (this.pings && Object.keys(dismissedMarks).length) {
      const stale = Object.keys(dismissedMarks).filter(addr => { const a = agents().find(x => x.address === addr); return !a || !this.dismissed(a); });
      if (stale.length) { const kept = { ...dismissedMarks }; for (const addr of stale) delete kept[addr]; setShared("veroboard.dismissed", kept); }
    }
    const states = STATES.map(s => ({ ...s, color: stateColor(t, s.key), wash: alpha(stateColor(t, s.key), "26") }));
    const role = props()?.role;
    const allSpaces = spaces();
    const active = allSpaces.find(s => s.active);
    const scope = shared("veroboard.scope") ?? "all";
    const scoped = agents().filter(a => scope !== "space" || !active || a.space === active.id);
    const query = String(shared("veroboard.query") ?? "").trim().toLowerCase();
    // Every word of the filter must match something on the card (searchText); "opus blocked" finds Opus cards in Blocked.
    const terms = query.split(/\s+/).filter(Boolean);
    const list = terms.length ? scoped.filter(a => { const text = this.searchText(a); return terms.every(q => text.includes(q)); }) : scoped;
    const col = new Map(scoped.map(a => [a.address, this.column(a)]));
    // How long each card has sat in Done (user, 2026-11-16): the cards copy notes when one arrives, in shared
    // "veroboard.doneSince" so a reload keeps the clocks. A card already in Done when the board starts takes its last
    // Stop/Notification ping (~/.config/veroboard/state/pings), else now. Leaving Done or closing clears it. Written only on a change.
    if (!role && this.pings) {
      const next = { ...(shared("veroboard.doneSince") ?? {}) };
      let changed = false;
      this.lastCol ??= {};
      for (const a of agents()) {
        const c = this.column(a), prev = this.lastCol[a.address];
        if (c === "done" && !Number.isFinite(next[a.address])) {
          next[a.address] = prev !== undefined && prev !== "done" ? Date.now() : Math.min(Date.now(), this.pings[a.address] ?? Date.now());
          changed = true;
        }
        if (c !== "done" && a.address in next) { delete next[a.address]; changed = true; }
        this.lastCol[a.address] = c;
      }
      for (const addr of Object.keys(next)) if (statusNow[addr] === undefined) { delete next[addr]; changed = true; }
      if (changed) setShared("veroboard.doneSince", next);
    }
    // The card shown below: the agent in the current space's current tab (the focused one if the tab has several).
    const shownTab = active?.tabs.find(tb => tb.active)?.id;
    const inTab = agents().filter(a => a.tab === shownTab);
    const shown = (inTab.find(a => a.focused) ?? inTab[0])?.address;
    // One row: room for the macOS window buttons (the layout's traffic_lights), then the space chips.
    const w = window(), lights = layout()?.traffic_lights;
    const left = w?.platform === "macos" && w.titlebar === "none" && !w.fullscreen && lights ? lights[0] + 68 : 26;
    // The top bar: each piece built here, placed where Veroboard settings → Board puts it (topbar.js renderTopBar).
    if (role === "header") return h_flex().size_full().bg(t.chrome).pl(left).pr(26).items_center().child(renderTopBar({
      // Wrapped: a scroll area grows to fill its row, which pushed the pieces after it (the +) to the far side. The
      // wrapper takes the chips' width, and shrinks (the chips then scroll) when the bar runs out of room.
      spaces: h_flex().flex_shrink(1).min_w(0).child(h_flex().id("chips").min_w(0).gap(7).items_center().overflow_x_scrollbar()
        .child(chip(t, "All Spaces", scope === "all", hint("veroboard.all")).id("chip-all")
          .on_click(() => setShared("veroboard.scope", "all")))
        .children(allSpaces.map((s, i) => chip(t, s.name, scope === "space" && s.active, hint(`veroboard.space${i + 1}`)).id(`chip-${s.id}`)
          .on_click(() => {
            run("space.select", { id: s.id });
            setShared("veroboard.scope", "space");
          })
          // Like the tab strip: double-click renames, right-click opens the space menu.
          .on_mouse_down("left", (e) => { if (e.click_count === 2) run("space.rename", { id: s.id }); })
          .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: s.id } } }))))),
      // New space, as the sidebar's + does: Herdr names it after its first terminal's folder (rename by double-click).
      newSpace: newSpaceButton(t).on_click(() => run("space.new")),
      // Just the agents: the space chips already show the spaces and which is selected (user, 2026-11-18).
      count: query ? statPill(t, [[String(list.length), `of ${scoped.length} match`]])
        : statPill(t, [[String(scoped.length), word(scoped.length, "agent")]]),
      pie: pulse(t, scoped.map(a => ({ key: col.get(a.address), unseen: a.status === "done" }))),
      divider: dividerLine(t),
      // Veroboard settings (settings.js, opened as this mod's dialog; user, 2026-11-17).
      gear: gearButton(t).on_click(() => run("mod.open", { name: "veroboard" })),
      // The notification list (mods/veroboard-toast, opened as a popup at the pointer). It follows the board's space
      // (user, 2026-11-18): with one space selected, the bell counts and the list shows that space's notifications
      // (and Herdr's own, which belong to no space); with All Spaces, all of them. The list has chips to pick another.
      // Unread: not yet shown in the list, and not clicked or dismissed on the board. Opening the list marks the ones
      // it shows as seen ("seen"); it gets their ids, so they stay bright while it's open (the rest is dimmed).
      // Before per-notice "seen", one time marked them all: "veroboard.noticesSeen", still read for older entries.
      // The list opens 8px below the bell, its left edge on the bell's left edge when the bell is on the bar's left
      // side, its right edge on the bell's right edge on the right side (user, 2026-11-18). The press records where
      // the bell is; without that (not painted yet) the popup opens at the pointer.
      bell: bellButton(t, (Array.isArray(shared("veroboard.noticeLog")) ? shared("veroboard.noticeLog") : [])
        .filter((n) => n && noticeUnread(n) && noticeIn(n, scope === "space" ? active : null)).length)
        .on_mouse_down("left", (e) => { this.bellBounds = e.bounds ?? null; })
        .on_click(() => {
          // A press beside an open popup closes it, so a second click on the bell first closes the list, then lands
          // here. The list closed just now: this click was to close it, so don't open it again (user, 2026-11-18).
          if (Date.now() - (Number(shared("veroboard.listClosedAt")) || 0) < 400) return;
          const sp = scope === "space" && active ? active : null;
          const all = (Array.isArray(shared("veroboard.noticeLog")) ? shared("veroboard.noticeLog") : []).filter(Boolean);
          const shown = all.filter((n) => noticeIn(n, sp));
          // Opening the list marks what it shows as read only with noticeRead "open" (user, 2026-11-18); else they stay
          // unread until you click one, its ✓, Mark all read, or (with "visit") go to its agent.
          const mode = ["open", "visit", "hand"].includes(VIEW.noticeRead) ? VIEW.noticeRead : "visit";
          const unread = shown.filter(noticeUnread).map((n) => n.id);
          const fresh = mode === "open" ? unread : [];
          if (fresh.length) setShared("veroboard.noticeLog", all.map((n) => (fresh.includes(n.id) ? { ...n, seen: true, unread: false } : n)));
          // Exactly the popup's size: a 40px header, a 34px row of space chips (with more than one space), 4 to 7 rows
          // of 62px (+10 for the edge between new and read), a 1px border round it. The list keeps that height when you
          // pick another space; it scrolls. Keep in step with mods/veroboard-toast (ROW_H, LIST_MIN, LIST_MAX, EDGE_H).
          const edge = unread.length > 0 && unread.length < shown.length ? 10 : 0;
          const listH = Math.max(4 * 62, Math.min(7 * 62, shown.length * 62 + edge));
          const bar = allSpaces.length > 1;
          const height = 40 + (bar ? 34 : 0) + listH + 2;
          const b = this.bellBounds;
          const onLeft = (VIEW.top?.lines ?? []).some((l) => l.left.includes("bell"));
          const at = b ? { x: Math.max(0, onLeft ? b.x : b.x + b.width - 380), y: b.y + b.height + 8 } : undefined;
          openOverlay({ mod: "veroboard-toast", kind: "popup", width: 380, height, ...(at ? { at } : {}),
            props: { view: "history", mode, fresh, space: sp?.id ?? null, listH, bar, seenBefore: Number(shared("veroboard.noticesSeen")) || 0 } });
        }),
      filter: h_flex().id("board-search").w(100).h(27).flex_none().px(9).gap(6).items_center().rounded(6)
        .tooltip("Matches anything on a card: name, id, model, effort, space, folder, branch, lane, why it's blocked, background work. Several words must all match.")
        .bg(t.surface).border(1).border_color(query ? alpha(t.accent, "55") : t.border)
        .on_key_down((e) => { if (e.key === "escape") { this.search?.set_value(""); setShared("veroboard.query", ""); } })
        .child(Input.new(this.search).flex_1().min_w(0).h(25).text_size(12).text_color(t.foreground))
        .when(!query && hint("veroboard.search") !== "", el => el.child(div().flex_none().text_size(10).text_color(t.dim).child(hint("veroboard.search"))))
        .when(Boolean(query), el => el.child(div().id("board-search-clear").flex_none().text_size(12).text_color(t.muted).cursor_pointer()
          .hover(s => s.text_color(t.foreground)).on_click(() => { this.search?.set_value(""); setShared("veroboard.query", ""); }).child("×"))),
    }, t));
    if (role === "terminals") {
      return h_flex().size_full().pl(16).pr(10).items_center().gap(8).bg(t.surface)
        // The current space's name, so the tab strip says whose tabs these are.
        .child(dot(t.accent)).child(div().flex_none().max_w(160).truncate().text_size(12).font_semibold().text_color(t.foreground).child(active?.name ?? ""))
        .when(!!active, el => el
          .child(h_flex().id("tab-strip").flex_1().min_w(0).h_full().items_center().gap(4).overflow_x_scrollbar()
            .children(active.tabs.map((c, i) => h_flex().id(`ws-tab-${c.id}`).flex_none().h(22).px(8).gap(5).items_center().rounded(5).text_size(11).cursor_pointer()
              .when(c.active, el => el.bg(alpha(t.accent, "26")).border(1).border_color(alpha(t.accent, "55")).text_color(t.foreground))
              .when(!c.active, el => el.bg(t.raised).border(1).border_color(t.raised).text_color(t.muted).hover(s => s.bg(t.hover)))
              .when(c.status === "working", el => el.child(svg("mods/workspace-chrome/spinner.svg").size(10).text_color(t.working).spin(900)))
              .when(c.status === "blocked" || c.status === "done", el => el.child(dot(t[c.status], 6)))
              .when(tabAddress(c.id) !== "", el => el.child(div().flex_none().text_color(t.dim).child(`${tabAddress(c.id)}:`)))
              .child(div().max_w(180).truncate().child(c.name))
              .when(tabHint(i + 1) !== "", el => el.child(div().text_size(9.5).text_color(t.dim).child(tabHint(i + 1))))
              .on_mouse_down("left", (e) => { if (e.click_count === 2) run("tab.rename", { id: c.id }); })
              .on_click(() => run("tab.select", { id: c.id }))
              .on_mouse_down("right", () => openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: c.id, space: active.id } } })))))
          // + opens the new-tab menu; its hint is the key for a plain new shell tab here (⌘T, tab.new; user 2026-11-17).
          .child(h_flex().id("ws-tab-new").flex_none().h(22).px(6).gap(5).items_center().justify_center().rounded(5).text_color(t.dim)
            .hover(s => s.bg(t.hover).text_color(t.foreground)).cursor_pointer()
            .on_click(() => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })).child("+")
            .when(keyHint("tab.new") !== "", el => el.child(div().text_size(9.5).text_color(t.dim).child(keyHint("tab.new"))))));
    }
    if (role === "pane") {
      const p = panes().find(p => p.pane === props().pane);
      return h_flex().size_full().px(13).items_center().gap(7).bg(t.chrome).border_b(1).border_color(t.border)
        .child(icon(t, p?.program, 14)).child(div().text_size(11).text_color(t.foreground).child(p?.program?.name ?? "Terminal"))
        .child(div().flex_1()).child(dot(states.find(s => s.key === p?.status)?.color ?? t.muted, 6));
    }
    const lane = key => this.sortLane(key, list.filter(a => col.get(a.address) === key));
    setAgentOrder(states.flatMap(s => lane(s.key).map(a => a.address)));
    // A faint 1px line between columns (halfway from the background to the border color), with 12px on each side.
    const lanes = states.map(s => lane(s.key));
    const wires = this.wires(t, lanes);
    const notices = this.noticeStack(t);
    const columns = h_flex().id("board-columns").relative().flex_1().min_h(0).px(24).pt(17).pb(6).gap(12)
      .on_size_change((sz, cx) => {
        if (sz.width === this.boardW && sz.height === this.boardH) return;
        this.boardW = sz.width; this.boardH = sz.height; cx.notify();
      })
      .child(wires.back)
      .children(states.flatMap((state, i) => {
      const cards = lanes[i];
      // Blocked, Waiting and Working breathe while they have agents; Done only while one is unseen.
      const live = state.key === "done" ? cards.some(a => a.status === "done") : cards.length > 0;
      // An empty 1px spacer: the visible divider line is painted in the cables' back layer, under the cables.
      const divider = i > 0 ? [div().w(1).h_full().flex_none()] : [];
      return [...divider, v_flex().flex_1().min_w(0).h_full().gap(9)
        .child(h_flex().h(27).flex_none().items_center().gap(8).px(3)
          .child(glowDot(state.color, 8, live))
          .child(div().text_size(13).font_semibold().text_color(t.foreground).child(state.label))
          .child(div().px(6).py(2).rounded(4).bg(state.wash).text_size(10).text_color(state.color).child(String(cards.length))))
        .child(this.laneBody(t, state.key, cards, cards.map(a => this.card(a, state, t, a.address === shown))))];
    }))
      .child(wires.front)
      .when(Boolean(notices), (el) => el.child(notices));
    // A grip above the board's resize line: double-click puts the board back to its height in layouts/veroboard.json.
    const grip = h_flex().id("board-grip").h(11).flex_none().w_full().justify_center().items_center().cursor_pointer()
      .on_mouse_down("left", (e) => { if (e.click_count === 2) run("layout.resize", { id: "board-cards", px: BOARD_PX }); })
      .child(div().w(36).h(4).rounded(2).bg(t.border));
    // Its height, for placing the notices over the terminal under it (syncToastWindow).
    return v_flex().size_full().bg(t.canvas).on_size_change((sz) => { this.rootH = sz.height; }).child(columns).child(grip);
  }
}

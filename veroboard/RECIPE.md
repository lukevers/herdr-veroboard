# Veroboard

Every Claude Code agent you run is a card in one of four lanes: Blocked, Waiting, Working and Done. Patch cables run
from an agent to the agents it opened. The board sits above the active tab's terminals, so a click on a card shows that
agent below.

![Veroboard](preview.png)

This file is the brief: enough to build Veroboard from an empty folder. The files next to it are one build of it.
If they don't work on your Herdr, or you want it different, build it again from here.

## What you see

Top to bottom:

1. **Header, 52px** (chrome color). Left: a gear button, a bell (a pill counts new notifications), a 100px filter box
   ("Filter", ⌘F hint), a 1px divider, then space chips: "All Spaces ⌘1" and one per space (⌘2–⌘9), and a "+" for a
   new space. Right: a slim pill "14 agents" and a small pie of agent statuses. The order of these items is
   configurable, and more dividers can be added.
2. **Board, 355px** (canvas color, resizable; a grip below it). Four equal lanes, 24px side padding, 1px divider lines
   (halfway between canvas and border). Each lane has a 27px header: a status dot that breathes while the lane has live
   agents, the label (13px, semibold) and a count pill. Lane colors come from the theme: Blocked `blocked`, Working
   `working`, Done `done`; Waiting is a fixed light blue (#91c7e3).
3. **Cards, 76px**, 3 lines, a 3px status stripe on the left, rounded right corners.
   - Line 1: program icon, tab name; right side: time in lane, why it's blocked, how many agents it opened, terminal id.
   - Line 2: folder; right: git branch (blue in a worktree).
   - Line 3: model, effort, context window; right: space, and a context bar of ten 10% segments (plain below 50%, peach
     to red from 50% to 85%).
   - Under a card, one 22px row per sub-agent, background shell or monitor, with its age. Each kind can be hidden, and
     each has its own "looks stuck" time (15, 15 and 30 minutes) after which its age turns pink.
4. **Patch cables**: a curved line from an agent's card to each agent it opened, with jack plugs at both ends. Siblings
   step through the theme's colors, and each generation starts one color further along; a cable from a top-level agent
   is solid, from its child dashed, from deeper dotted. Grey shades instead of colors is a setting. A cable to a card in
   the same lane loops out and back. Cables pass behind cards, 5% visible through them (a setting, 0–30%).
5. **Tab strip, 34px**: the active space's name, its tabs as pills (status spinner or dot, terminal id, name, ⌘ hint),
   and "+ ⌘T".
6. **Terminals**: the active tab's panes, 12px apart, 7px radius, 1px border, each with a 28px header (program icon,
   name, status dot).

## How it behaves

- **Lanes.** Pinned by hand → Blocked. A dialog open in its tab → Blocked ("Prompt"). Herdr says working → Working.
  Idle with background work (sub-agents, monitors, shells that wait, helper terminals) → Waiting. Idle and its last
  message asks you something or says it waits on someone → Blocked ("You", or the name). Otherwise → Done.
- **Blocked reasons** are decided by a rule set in `mods/veroboard/agent/core/rules.js`; hovering the badge names the rule.
- **Done** cards are green until you've looked at them, then grey. A card glows once when its agent finishes or asks.
- The card whose terminal is on screen gets a 2px ring and a faint wash.
- **Click** a card: focus that agent's terminal. **Right-click**: a menu with Pin to Blocked / Unpin, Move to Done (in
  Blocked) and Open.
- **Wheel** over a lane scrolls it; cables follow. Double-click the grip: reset the board's height.
- **Keys** (keys.json section `layout:veroboard`): ⌘F focuses the filter (every word must match something on a card;
  Esc clears), ⌘1 shows all spaces, ⌘2–⌘9 pick a space.
- **The gear** opens the settings dialog (852px wide), with tabs: **Board** (drag the top bar's items into place or into
  Hidden, over an example bar showing All Spaces and the first space; the patch cable settings over an example drawn
  by the board's own code at real size: two lanes, a parent and the two agents it opened), **Card** (drag the card's
  badges, over an example card; the Look switches, each with a Show button that plays its effect on the example; the
  context color ramp; the background row switches and stuck times; what keeps a card in Waiting), **Notifications**
  (over the board or the terminal, `board.toastArea`; a 3 × 3 picker, `board.toastPlace`, top-right by default; a
  button that sends a test; when one counts as read), **Agents** (below), **People**, **Asks**, **Rules** and
  **Patterns** (the Blocked rules: lists with examples, and every built-in rule with an on/off switch) and **Test** (a
  box that runs a message through the saved rules). Every setting that differs from its default has a Reset, in a
  slot that's always kept so nothing moves when it shows. A GitHub button links the repo.
- Tabs are named after what's in them (Claude Code's title, the running program, or the folder) until you rename one.

## Built from

- **Layout** `layouts/veroboard.json`: a column with `board-header` (mod `veroboard`, role `header`), then `board-body`:
  `board-cards` (mod `veroboard`, no role) above `workspace` (`workspace-title`: mod `veroboard`, role `terminals`;
  `live-terminals`: the active tab's panes, pane header mod `veroboard`, role `pane`). Font Geist, no titlebar.
- **Mod `veroboard`**: `main.js` (every role, data loading, lanes, cables), `card.js` (one card from a model, its badge
  layout), `topbar.js` (header items), `cables.js` (cable drawing), `settings.js` (the dialog: opened with
  `mod.open veroboard`, shown when there's an `overlay` prop and no role), `names.js` (tab names).
- **Mod `veroboard-menu`**: the right-click popup.
- **Mod `veroboard-toast`**: the layout's `"toast"` (herdr-app#364), so Herdr hands it every notification. It puts each
  one in shared `veroboard.notices` (shown in the board's top-right corner, or where `board.toastPlace` says; light accent border, newest nearest the edge, at
  most 3; a click runs its action, × dismisses, it times out) and `veroboard.noticeLog` (the last 50), then closes
  Herdr's toast. A notification about an agent (Herdr's carry `agent.focus {terminal}`) gets that agent's card facts
  saved on it by the board within a second (name, why it's in its lane, id, space, branch, who opened it) and shows as a
  slim card: a colored left edge in the why's color (rounded with the toast's corners), name, why, id; then space and
  branch on the left and the parent on the right, under the id (the branch is cut first when the line runs out).
  Opened from the bell with `props.view: "history"`, it lists the log newest first, in 62px rows (4 to 7 tall, then it
  scrolls; the bell sizes the popup to match), each with its age: unread ones on the popup's color, then a 10px
  sawtooth band and the read ones darker and dimmed. In the band's 3px stripe column, the stripe above runs halfway
  down and the one below halfway up, so the stripes don't break there.
  When one counts as read is `board.noticeRead`: `"open"` (opening the list), `"visit"` (the default: clicking it, or
  being on its agent's terminal) or `"hand"` (clicking it, or its ✓). In every mode each row has ✓ or
  ↺ (mark unread) and, under it, × (remove that one), the header has Mark all read, and dismissing a toast counts as read. The bell and the list follow the board's space: one
  space selected shows that space's notifications (plus Herdr's own, which belong to no space); All Spaces shows all.
  Chips under the list's header pick another space.
- **Shipped mods used:** `menu` (tab right-click), `new-menu` (the + button). Program icons from Herdr's `icons/`.
- **Icons:** Lucide, in `mods/veroboard/icons/` (copies of Herdr's `workspace-chrome` ones, so a Herdr update can't blank
  them) and a few of the board's own; their license is `mods/veroboard/LICENSE-Lucide.txt`. `veroboard-menu` uses them
  by path. No font to install: IDs are in JetBrains Mono and the UI in Geist, both shipped with Herdr.
- **Herdr:** `agents`, `spaces`, `panes`, `terminals`, `shared`/`setShared` (keys `veroboard.*`), `keys`, `nextCommand`,
  `openOverlay`, `setAgentOrder`, `readTextFile`, `writeTextFile`, `watchFolder`, `exec`; commands `agent.focus`,
  `tab.select`, `tab.rename`, `space.new`, `space.select`, `layout.resize`, `mod.open`.
- **The agent scripts ship inside the board mod** (`mods/veroboard/agent/`: `core/` the rules and shared code,
  `adapters/<agent>/` one folder each), so adding the layout copies them. The settings dialog's **Agents** tab
  (`agents.js`, plain functions on file text) adds and removes the lines that run them: in `~/.claude/settings.json`
  (the status line wrapping yours after `--`, the sub-agent status line, PreToolUse, Stop and Notification hooks) and
  `~/.codex/hooks.json` (six event hooks and the guard; it also sets `[features] hooks = true` in `config.toml`). It
  shows the change before Apply, saves `<file>.bak-veroboard-<time>` first, writes only if the file didn't change
  meanwhile, and edits only its own script paths inside a command (a `; afplay …` after the ping stays).
  A file that isn't valid JSON isn't touched: the card shows the parser's error and **Ask an agent to fix it**, which
  opens a tab with Claude Code (else Codex) told to fix only the syntax, back the file up and show the fix first.
- **Claude Code side** (`agent/adapters/claude/`): `tap.js` wraps the status line and
  writes each agent's facts to `~/.config/veroboard/state/sessions/<terminal>.json`; `subagents.js` (the sub-agent status line)
  writes `subagents/`; `ping.sh` (Stop and Notification hooks) writes `pings/`; `rules.js` + `defaults.json` are the
  Blocked rules; `classify.js` tests a message.
- **Codex side** (`adapters/codex/hook.js`, hooks in `~/.codex/hooks.json`): on each prompt, tool call, permission
  request and stop it reads the Codex session log (model, effort, tokens, last message, launched terminals) and writes
  the same sessions file. Shared code (git, writing the file, pings) is in `agent/core/session.js`.
- **Launch guard** (`agent/core/launch-guard.sh` + `.js`, a `PreToolUse` hook for Claude and Codex): blocks `herdr-app do
  tab.new` without a space (exit 2, with the agent's own space id from `hc get`'s `herdr.space` label), so child agents
  open in their parent's space. Only a launch at a command's start counts, not text that mentions it. Fails open when
  unsure; other commands skip Node entirely.
- **Programs and files outside the mod folder:** runs `node` (`classify.js`, for the dialog and the rules' hover text);
  reads `~/.config/veroboard/state/` and `~/.config/veroboard/config.json` (the dialog writes that one), and, from the
  Agents tab, reads and (on Apply) writes `~/.claude/settings.json`, `~/.codex/hooks.json` and `~/.codex/config.toml`.

## Watch out

- The board draws notifications itself, so one that arrives while a dialog (like Veroboard settings) is open waits
  under it. Herdr's own toasts float above dialogs.
- Over the terminal (`toastArea: "terminal"`), a mod can't draw outside its block, so the board opens a copy of itself
  (`role: "toasts"`) as a frameless window there, sized to the stack. It doesn't take the keyboard. Its place comes
  from the layout's sizes (the 52px header, the board's height, the workspace padding and tab strip): a layout with
  other sizes needs `syncToastWindow` changed to match.
- **The board needs its agents connected.** Copying the layout and mods alone gives cards with no model, context or
  Blocked reasons until the Agents tab connects Claude Code or Codex.
- Herdr runs programs without the shell's PATH. `facts.js` saves the path of the Node it runs under to
  `~/.config/veroboard/state/node-path`, and the mods use it. Until a connected agent has run once, the rules tabs can't
  load (the Agents tab can: it needs no Node).
- Mods can't import from another mod's folder, so the settings dialog lives inside `mods/veroboard`.
- `herdr-app check` doesn't build the dialog. Open it to test it.
- Card and cable positions are computed from the layout's numbers (lane padding, 27px header, 76px cards, 22px rows,
  9px gaps). Change one, and update the cable math in `main.js`.
- Sizes from `on_size_change` are real pixels; divide by the zoom setting.
- Elements are single-use: build a badge once even if you test it and place it.
- A slider moves in whole steps on its own. Don't call `set_value` from its change handler; it fights the drag.
- Drag and drop in the dialog is built from mouse down, move, hover and up events.
- Limits: 8 shells and 8 monitors per card, 200 opened agents per agent; sub-agent rows drop after 30s without news.
- Every color is a theme color except Waiting's light blue and the marigold for "waits on someone" (#f2bc78).
- If `veroboard` is taken, rename the layout, both mods, the `layout:veroboard` keys section and the `veroboard.*`
  shared keys before installing.
- Codex hooks run in a shared background process, and Codex helpers that other agents start inherit those agents'
  `HC_TERMINAL_ID`. So the Codex hook never trusts that variable. It needs `originator: "codex-tui"` in the session log,
  then asks `hc ls` / `hc get` for a terminal running Codex in the same folder. When two Codex tabs share a folder, the
  facts file's `codexSession` (which session owns a tab) decides, then the title (`<thread name> | <folder>`, with a
  spinner in front while it works).
- Codex runs PostToolUse before the tool's output reaches its session log, so a launch is read from the hook input
  (`tool_input.command`, `tool_response`) and kept for that session.

## Done when

- Every Claude Code agent shows up in the right lane, and each lane's count matches.
- A card shows model, effort, context and branch within one status line run of the agent starting.
- Clicking a card shows its tab's terminals; an agent that asks you something lands in Blocked with a reason.
- An agent that opens another gets a cable to it.
- A Codex tab gets its model, effort and context on its first prompt, and a Codex helper run by another agent never
  changes that agent's card.
- `herdr-app check mods/veroboard` passes, the gear opens Veroboard settings, and switching layouts away and back works.

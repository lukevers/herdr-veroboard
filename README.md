# Veroboard

A Kanban board for your Claude Code and Codex agents, as a [Herdr](https://herdr.dev) layout.

![Veroboard](veroboard/preview.png)

- **Four lanes:** Blocked, Waiting, Working, Done.
- **Patch cables** from an agent to the agents it opened.
- **Blocked says why:** a question for you, an open dialog, or who it's waiting on.
- **⌘F** filters by anything on a card. **⌘1–⌘9** pick a space.
- **Right-click** a card to pin it to Blocked or move it to Done.
- **Notifications in the board's corner**, not over your terminal, and a **bell** with the history, newest first.
- **Child agents stay in their parent's space:** an agent's new tab opens next to it, not in the space you're viewing.
- **The gear** opens settings: arrange the card and top bar, tune the Blocked rules, test a message.

## Install

Needs Herdr with its Claude Code or Codex integration, Node 18+, and macOS.

1. **Add the layout.** In Herdr, ask an agent: *"add herdr.dev/layouts/lukevers/veroboard"*. It copies the layout and
   its mods (the board's agent scripts come inside them) and adds the board's keys. Or, from a clone of this repo,
   run `./install.sh`, which does the same; it never overwrites your files or key bindings (`--force` moves yours aside).
2. **Switch to it** with `ctrl-shift-l`.
3. **Connect your agents.** Open the gear (top left of the board) → **Agents** → **Connect**, for Claude Code and/or
   Codex. It shows the lines it will add to `~/.claude/settings.json` or `~/.codex/hooks.json` before it adds them,
   keeps your own status line (it runs after the board's), saves a copy of each file first, and takes them out again
   with Disconnect. For Codex it also switches hooks on in `~/.codex/config.toml`; the next time Codex starts, it asks
   you once to trust the new hooks.

The board shows every agent without step 3, but only its lane, name and folder: the model, context, why it's blocked,
its sub-agents and the rest come from the connected scripts.

## Configure

Use the gear. Changes save to `~/.config/veroboard/config.json`; see `config.example.json` for the format.

## How it works

`tap.js` wraps your status line. Each run, it records the agent's context, model, git state, background work and
whether it's waiting on someone, in `~/.config/veroboard/state/sessions/`. The board reads those files. `ping.sh` notes when an
agent finishes or asks for attention. The scripts live in the board mod's folder,
`mods/veroboard/agent/` (`core/` the Blocked rules, `adapters/` one folder per agent). For Codex, `adapters/codex/hook.js` writes the same files from Codex's hooks and
session log. It only writes for a Herdr terminal that runs Codex in the session's folder, so Codex run by another agent
never touches that agent's card.

### Launch guard

Herdr opens a new tab in the space you're looking at. So when an agent opens a tab for another agent while you view a
different space, the child lands there. The `PreToolUse` hook (`agent/core/launch-guard.sh`, for Claude and Codex) blocks a
`herdr-app do tab.new` without a space and tells the agent its own space id; the agent retries with it. If you ask for
another space, the agent passes that one. Every other command exits in under 5 ms, untouched.

## Limits

- Codex cards have no Waiting lane, background rows or sub-agent rows yet. A Codex card updates on its hooks (each
  prompt, tool call and stop), not continuously.
- Codex's sandbox blocks Herdr's socket, so a Codex agent asks you before each `herdr-app do` (opening tabs for
  other agents).
- Other agents Herdr runs show up as basic cards: lane, name and folder.
- The Blocked rules were tuned on one person's agents. Expect some cards in the wrong lane, and tune the rules.
- A card updates when Claude Code reruns the status line, so an idle agent can lag a little.

## Uninstall

First the gear → **Agents** → **Disconnect** for each agent. Then delete `~/.config/herdr-app/layouts/veroboard.json`,
`~/.config/herdr-app/mods/veroboard*` and `~/.config/veroboard` (your rules and the board's state).

**Upgrading from an older install** (scripts in `~/.config/veroboard/core` and `adapters`): the Agents tab shows
"Connected to an older copy"; **Update** points the hooks at the board mod's copy. Then `~/.config/veroboard/core` and
`~/.config/veroboard/adapters` can go.

## Development

`./export.sh` copies your live setup into this folder. Tests: `node tests/agents.test.js`, `node tests/rules.test.js`, `node tests/codex.test.js`, `node tests/guard.test.js`,
`node tests/topbar.test.js`, `node tests/rows.test.js`, `node tests/view.test.js` and `bash tests/install.test.sh`.

Pairs well with [Dusk](https://github.com/lukevers/herdr-dusk). MIT licensed.

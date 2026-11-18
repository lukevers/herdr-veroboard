# Veroboard

A Kanban board for your Claude Code and Codex agents, as a [Herdr](https://herdr.dev) layout.

![Veroboard](veroboard/preview.png)

- **Four lanes:** Blocked, Waiting, Working, Done.
- **Patch cables** from an agent to the agents it opened.
- **Blocked says why:** a question for you, an open dialog, or who it's waiting on.
- **⌘F** filters by anything on a card. **⌘1–⌘9** pick a space.
- **Right-click** a card to pin it to Blocked or move it to Done.
- **The gear** opens settings: arrange the card and top bar, tune the Blocked rules, test a message.

## Install

Needs Herdr with its Claude Code or Codex integration, Node 18+, and macOS.

```sh
git clone https://github.com/lukevers/herdr-veroboard
cd herdr-veroboard
./install.sh
```

Add `--codex` to also add the Codex hooks to `~/.codex/hooks.json` (next to Herdr's). `install.sh` never overwrites your
files or key bindings. If something differs, it stops; `--force` moves yours aside.

Then add this to `~/.claude/settings.json`, merging the hooks into yours. Put your current status line command after
`--`, or leave it empty:

```json
{
  "statusLine": { "type": "command", "command": "node ~/.config/veroboard/adapters/claude/tap.js -- <your status line>", "padding": 0 },
  "subagentStatusLine": { "type": "command", "command": "node ~/.config/veroboard/adapters/claude/subagents.js" },
  "hooks": {
    "Stop": [{ "hooks": [{ "type": "command", "command": "sh ~/.config/veroboard/adapters/claude/ping.sh", "timeout": 5 }] }],
    "Notification": [{ "hooks": [{ "type": "command", "command": "sh ~/.config/veroboard/adapters/claude/ping.sh", "timeout": 5 }] }]
  }
}
```

Switch to it with `ctrl-shift-l`.

## Configure

Use the gear. Changes save to `~/.config/veroboard/config.json`; see `config.example.json` for the format.

### Codex

`./install.sh --codex` adds the hooks. Codex needs `hooks = true` under `[features]` in `~/.codex/config.toml`. The next time
Codex starts, it asks you to review the new hooks: trust them, then restart Codex once.

## How it works

`tap.js` wraps your status line. Each run, it records the agent's context, model, git state, background work and
whether it's waiting on someone, in `~/.config/veroboard/state/sessions/`. The board reads those files. `ping.sh` notes when an
agent finishes or asks for attention. For Codex, `adapters/codex/hook.js` writes the same files from Codex's hooks and
session log. It only writes for a Herdr terminal that runs Codex in the session's folder, so Codex run by another agent
never touches that agent's card.

## Limits

- Codex cards have no Waiting lane, background rows or sub-agent rows yet. A Codex card updates on its hooks (each
  prompt, tool call and stop), not continuously.
- Other agents Herdr runs show up as basic cards: lane, name and folder.
- The Blocked rules were tuned on one person's agents. Expect some cards in the wrong lane, and tune the rules.
- A card updates when Claude Code reruns the status line, so an idle agent can lag a little.

## Uninstall

Delete `~/.config/veroboard`, `~/.config/herdr-app/layouts/veroboard.json` and
`~/.config/herdr-app/mods/veroboard*`, then remove the lines above from `~/.claude/settings.json`
and the `veroboard` entries from `~/.codex/hooks.json`.

## Development

`./export.sh` copies your live setup into this folder. Tests: `node tests/rules.test.js`, `node tests/codex.test.js` and
`bash tests/install.test.sh`.

Pairs well with [Dusk](https://github.com/lukevers/herdr-dusk). MIT licensed.

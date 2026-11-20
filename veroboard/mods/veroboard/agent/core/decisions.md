# Decisions (Veroboard)

You run inside Herdr with Veroboard. The person answers your decisions in its Decisions dialog (the ? in the board's top bar), where they see the exact text you propose.

- When you need the person to approve something (post text, merge, send, pick an option), queue it instead of asking in prose:
  `{{decide}} add --id <short-id> --short <ticket or 1-2 words, max 18 chars> --title "<what>" --body-file <file with the exact text>`
  Add `--option "<label>"` (up to 4) when it isn't yes/no. Keep `--title` to one short question (about 60 characters) and `--context` to one short clause (about 80); details go in the body. `--short` is the decision's tab label: use the ticket (KOV-123) or PR (#45) when there is one.
- Put the exact text in the body, so the person approves what they can read. Write the body, context and replies in markdown. Put code in a fenced block with its language (```ts, ```sql, ```diff), never unfenced.
- When you change existing text (a PR body, a ticket description), also pass the current text: `--before-file <file with the live text>`, with the full new text as `--body-file`. The dialog shows the diff. Never hand-write `<`/`>` diffs; any other diff goes in a ```diff block (unified format).
- Re-run `add` with the same `--id` to update the proposal (the conversation is kept). Run `{{decide}} drop <id>` when it no longer matters.
- The answer arrives as a message: `Decision on "<title>" (id: <id>): <OPTION>.` (maybe with `Note: …`).
- A question arrives as `About decision "<title>" (id: <id>), not decided yet: <question>`. Answer it on the decision, not in chat: `{{decide}} reply <id> --text "<answer>"` (or `--text-file`). If the answer changes the proposal, also re-run `add` with the new body.
- `{{decide}} --help` has every option.

'use strict';

try {
  main();
} catch (_) {
  process.exitCode = 0;
}

function hasSpace(segment) {
  const clean = segment.replace(/\\+"/g, '"');
  if (/(?:^|\s)--space\s+(?:"[^"\r\n]+"|'[^'\r\n]+'|(?!-)[^\s"';&|<>]+)/.test(clean)) return true;

  for (const text of [segment, clean]) {
    for (const match of text.matchAll(/"space"\s*:\s*("(?:\\.|[^"\\])*")/g)) {
      try { if (JSON.parse(match[1]).length) return true; } catch (_) {}
    }
  }
  return false;
}

function ownTerminal(mode, input) {
  if (mode === 'claude') return process.env.HC_TERMINAL_ID;
  if (mode === 'codex') return require('../adapters/codex/terminal.js').codexTerminal(input) || process.env.HC_TERMINAL_ID;
}

function ownSpace(terminal) {
  if (!terminal) return;
  const { execFileSync } = require('child_process');
  for (const executable of ['hc', `${process.env.HOME}/.local/bin/hc`]) {
    try {
      const value = JSON.parse(execFileSync(executable, ['get', terminal], {
        encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'],
      }));
      const labels = value && value.labels;
      if (!labels || typeof labels['herdr.space'] !== 'string' || !labels['herdr.space']) return;
      return { id: labels['herdr.space'], name: typeof labels.where === 'string' ? labels.where.split(' / ')[0] : '' };
    } catch (_) {}
  }
}

function main() {
  const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  let toolInput = input.tool_input;
  if (typeof toolInput === 'string') toolInput = JSON.parse(toolInput);
  const command = toolInput && (toolInput.command || toolInput.cmd);
  if (typeof command !== 'string') return;

  // Only where a command starts (line start, after ; & | ( or $( — not a backtick, which Markdown uses everywhere; with optional VAR=value prefixes), so text that
  // merely mentions it (echo "...", grep ..., a JSON test fixture) is not a launch.
  const launches = [...command.matchAll(/(?:^|[;&|(\n]|\$\()\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*herdr-app\s+do\s+tab\.new\b/g)];
  const missing = launches.some((match) => {
    const rest = command.slice(match.index + match[0].length);
    const end = rest.search(/herdr-app|[\r\n]/);
    return !hasSpace(match[0] + (end < 0 ? rest : rest.slice(0, end)));
  });
  if (!missing) return;

  const space = ownSpace(ownTerminal(process.argv[2], input));
  if (!space) return;
  process.stderr.write(`tab.new without a space opens in the space the person is viewing, not yours. Rerun it with "space": "${space.id}" in the JSON (or --space ${space.id}) to open it in your space${space.name ? `, "${space.name}"` : ''}. If the person asked for another space, pass that space's id instead.\n`);
  process.exitCode = 2;
}

// Synthetic hc records only: node tests/guard.test.js.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const guard = path.join(__dirname, '..', 'core', 'launch-guard.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veroboard-guard-'));
let home, bin, failed = 0;

function test(name, fn) {
  home = fs.mkdtempSync(path.join(tmp, 'home-'));
  bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'hc'), `#!${process.execPath}
const args = process.argv.slice(2);
process.stderr.write('Synthetic hc diagnostic');
if (process.env.HC_TEST_FAIL) process.exit(1);
let all;
try { all = JSON.parse(process.env.HC_TEST_OUTPUT); } catch (_) {}
if (!Array.isArray(all)) { process.stdout.write(process.env.HC_TEST_OUTPUT || ''); process.exit(0); }
if (args[0] === 'ls' && args[1] === '--json') {
  process.stdout.write(JSON.stringify({ terminals: all.map(t => ({ address: t.address,
    agent: t.status.app === 'codex' ? 'codex' : 'claude', cwd: t.cwd, status: 'idle' })) }));
} else if (args[0] === 'get') {
  const terminal = all.find(t => t.address === args[1]);
  if (!terminal) process.exit(1);
  process.stdout.write(JSON.stringify(terminal));
} else process.exit(1);
`, { mode: 0o755 });
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

function terminal(address = 't49', overrides = {}) {
  return { address, cwd: home, status: { app: 'claude-code' },
    labels: { 'herdr.space': 'sp-agent', where: 'Agent Space / Terminal' }, ...overrides };
}

function rollout(originator = 'codex-tui', overrides = {}) {
  fs.writeFileSync(path.join(home, 'rollout.jsonl'), JSON.stringify({ type: 'session_meta',
    payload: { id: 'session-1', cwd: home, originator, ...overrides } }) + '\n');
}

function run(command, mode = 'claude', input = {}, env = {}, raw) {
  const result = spawnSync('/bin/sh', [guard, mode], {
    cwd: home,
    env: { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      HC_TERMINAL_ID: 't49', HC_TEST_OUTPUT: JSON.stringify([terminal()]), HC_TEST_FAIL: '', ...env },
    input: raw === undefined ? JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command }, transcript_path: path.join(home, 'rollout.jsonl'), cwd: home, ...input }) : raw,
    encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(result.error);
  assert.strictEqual(result.stdout, '');
  return result;
}

function allowed(result) {
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stderr, '');
}

function blocked(result, id = 'sp-agent', name = 'Agent Space') {
  assert.strictEqual(result.status, 2);
  assert.strictEqual(result.stderr, `tab.new without a space opens in the space the person is viewing, not yours. Rerun it with "space": "${id}" in the JSON (or --space ${id}) to open it in your space${name ? `, "${name}"` : ''}. If the person asked for another space, pass that space's id instead.\n`);
}

try {
  test('a command that only mentions a launch is not one', () => {
    allowed(run('echo "herdr-app do tab.new --name x"'));
    allowed(run("grep -rn 'herdr-app do tab.new' docs/"));
    allowed(run('printf "%s" "Use `herdr-app do tab.new --name x` with a space" >> notes.md'));
    allowed(run('node -e \'console.log("herdr-app do tab.new")\''));
  });

  test('launches after cd, env prefixes, pipes and $( ) are still caught', () => {
    blocked(run('cd /tmp && herdr-app do tab.new --name x'));
    blocked(run('FOO=1 herdr-app do tab.new --name x'));
    blocked(run('out=$(herdr-app do tab.new --name x)'));
    blocked(run('true; herdr-app do tab.new --name x | jq -r .terminal'));
  });

  test('git status passes silently without starting node', () => {
    const marker = path.join(home, 'node-started');
    fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\n: > "$HOME/node-started"\nexit 99\n', { mode: 0o755 });
    allowed(run('git status'));
    assert(!fs.existsSync(marker));
  });

  test('Claude flag launch without space names its own space', () => {
    blocked(run(`herdr-app do tab.new --name x --argv '["claude"]'`));
  });

  test('JSON and flag spaces allow launches', () => {
    blocked(run(`herdr-app do tab.new '{"name":"x","argv":["claude"]}'`));
    allowed(run(`herdr-app do tab.new '{"name":"x","space":"sp1"}'`));
    for (const value of ['sp1', '"sp1"', "'sp1'"]) allowed(run(`herdr-app do tab.new --space ${value}`));
    allowed(run(String.raw`herdr-app do tab.new "{\"space\":\"sp1\"}"`));
    allowed(run(String.raw`herdr-app do tab.new '{"space":"\"quoted\""}'`));
  });

  test('null, empty and missing space values do not allow launches', () => {
    for (const value of ['null', '""', '42', 'false']) blocked(run(`herdr-app do tab.new '{"space":${value}}'`));
    for (const value of ['', '""', "''", '--name x']) blocked(run(`herdr-app do tab.new --space ${value}`));
    blocked(run(String.raw`herdr-app do tab.new "{\"space\":\"\"}"`));
  });

  test('every launch needs its own space', () => {
    for (const separator of [' && ', '\n']) {
      blocked(run(`herdr-app do tab.new --space sp1${separator}herdr-app do tab.new --name x`));
      blocked(run(`herdr-app do tab.new --name x${separator}herdr-app do tab.new --space sp1`));
      allowed(run(`herdr-app do tab.new --space sp1${separator}herdr-app do tab.new --space sp2`));
    }
    blocked(run('herdr-app do tab.new; herdr-app do space.new --space sp1'));
    blocked(run('herdr-app do tab.new\necho --space sp1'));
  });

  test('other commands pass silently', () => {
    for (const command of ['herdr-app do space.new --name x', 'echo tab.new', 'herdr-app do tab.newer']) allowed(run(command));
  });

  test('missing terminal and hc failures fail open silently', () => {
    allowed(run('herdr-app do tab.new', 'claude', {}, { HC_TERMINAL_ID: undefined }));
    allowed(run('herdr-app do tab.new', 'claude', {}, { HC_TEST_FAIL: '1' }));
    for (const output of ['garbage', 'null', '{}', '[]']) {
      allowed(run('herdr-app do tab.new', 'claude', {}, { HC_TEST_OUTPUT: output }));
    }
    for (const labels of [{}, { 'herdr.space': null }, { 'herdr.space': '' }]) {
      allowed(run('herdr-app do tab.new', 'claude', {}, { HC_TEST_OUTPUT: JSON.stringify([terminal('t49', { labels })]) }));
    }
  });

  test('hc falls back to the home executable', () => {
    const localBin = path.join(home, '.local/bin');
    fs.mkdirSync(localBin, { recursive: true });
    fs.renameSync(path.join(bin, 'hc'), path.join(localBin, 'hc'));
    fs.writeFileSync(path.join(bin, 'hc'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    blocked(run('herdr-app do tab.new'));
  });

  test('space name is optional', () => {
    blocked(run('herdr-app do tab.new', 'claude', {}, {
      HC_TEST_OUTPUT: JSON.stringify([terminal('t49', { labels: { 'herdr.space': 'sp1' } })]),
    }), 'sp1', '');
  });

  test('Codex TUI resolves its own terminal before inherited Claude terminal', () => {
    rollout();
    const env = { HC_TEST_OUTPUT: JSON.stringify([terminal(), terminal('t7', {
      status: { app: 'codex' }, labels: { 'herdr.space': 'sp-codex', where: 'Codex Space / Terminal' },
    })]) };
    blocked(run('herdr-app do tab.new', 'codex', {}, env), 'sp-codex', 'Codex Space');
    blocked(run('herdr-app do tab.new', 'codex', {}, { ...env, HC_TERMINAL_ID: undefined }), 'sp-codex', 'Codex Space');
  });

  test('Codex helper inherits its Claude terminal space', () => {
    rollout('Claude Code');
    blocked(run('herdr-app do tab.new', 'codex'));
    allowed(run('herdr-app do tab.new', 'codex', {}, { HC_TERMINAL_ID: undefined }));
  });

  test('JSON string tool_input and cmd work regardless of tool name', () => {
    blocked(run('', 'claude', { tool_name: 'exec_command', tool_input: JSON.stringify({ cmd: 'herdr-app do tab.new' }) }));
    allowed(run('', 'claude', { tool_input: JSON.stringify({ command: 'herdr-app do tab.new --space sp1' }) }));
    blocked(run('', 'claude', { tool_name: 'different', tool_input: { cmd: 'herdr-app do tab.new' } }));
    for (const tool_input of [null, {}, { text: 'herdr-app do tab.new' }, 'herdr-app do tab.new']) allowed(run('', 'claude', { tool_input }));
  });

  test('malformed hook JSON fails open silently', () => {
    for (const raw of ['{tab.new', 'null', '"tab.new"']) allowed(run('', 'claude', {}, {}, raw));
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exitCode = failed ? 1 : 0;

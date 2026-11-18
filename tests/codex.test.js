// Synthetic rollouts only: node tests/codex.test.js.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const hook = path.join(__dirname, '..', 'veroboard', 'mods', 'veroboard', 'agent', 'adapters', 'codex', 'hook.js');
const tmp = fs.mkdtempSync(path.join(__dirname, '.codex-test-'));
const stamp = '2026-01-02T03:04:05.000Z';
let home, bin, failed = 0;

function test(name, fn) {
  home = fs.mkdtempSync(path.join(tmp, 'home-'));
  bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'hc'), `#!${process.execPath}\n'use strict';
// Like the real hc: ls --json gives {terminals: [summary]}, get <address> gives the full record.
// HC_TEST_OUTPUT holds full records; anything that isn't a JSON array is printed as is (garbage cases).
const args = process.argv.slice(2);
process.stderr.write('Synthetic hc diagnostic');
let all = null;
try { all = JSON.parse(process.env.HC_TEST_OUTPUT); } catch (_) {}
if (!Array.isArray(all)) { if (args[0] === 'ls') process.stdout.write(process.env.HC_TEST_OUTPUT || ''); process.exit(0); }
if (args[0] === 'ls' && args[1] === '--json') {
  process.stdout.write(JSON.stringify({ hidden_finished: 0, terminals: all.filter((t) => t && typeof t === 'object' && !Array.isArray(t) && t.address).map((t) => ({ address: t.address,
    agent: t.status && t.status.app === 'codex' ? 'codex' : 'claude', cwd: t.cwd, state: 'live', status: 'idle' })) }));
} else if (args[0] === 'get') {
  const t = all.find((x) => x && x.address === args[1]);
  if (!t) process.exit(1);
  process.stdout.write(JSON.stringify(t));
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

function entry(type, payload) {
  return { timestamp: stamp, type, payload };
}

function message(role, text) {
  return entry('response_item', { type: 'message', role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] });
}

function context(model = 'gpt-6.1-sol') {
  return entry('turn_context', { model, effort: 'high', cwd: home });
}

function usage(tokens = 95000, window = 475000) {
  return entry('event_msg', { type: 'token_count', info: { model_context_window: window, last_token_usage: { total_tokens: tokens } } });
}

function call(command, id = 'call-1', type = 'custom_tool_call') {
  return entry('response_item', { type, name: 'functions.exec', call_id: id, [type === 'function_call' ? 'arguments' : 'input']: command });
}

function output(text, id = 'call-1', type = 'custom_tool_call_output') {
  return entry('response_item', { type, call_id: id, output: text });
}

function metadata(overrides = {}) {
  return entry('session_meta', { id: 'session-1', originator: 'codex-tui', cwd: home, ...overrides });
}

function terminal(address = 'tc1', overrides = {}) {
  return { address, cwd: home, foreground: null, status: { app: 'codex', state: 'idle' }, title: null, ...overrides };
}

function rollout(entries, meta = metadata()) {
  fs.writeFileSync(path.join(home, 'rollout.jsonl'), [meta, ...entries].map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function sessionIndex(entries) {
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex/session_index.jsonl'), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

function run(input = {}, env = {}, raw) {
  const result = spawnSync(process.execPath, [hook], {
    cwd: home,
    env: { ...process.env, HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      HC_TERMINAL_ID: 'tc1', HC_TEST_OUTPUT: JSON.stringify([terminal()]),
      GIT_CEILING_DIRECTORIES: tmp, VEROBOARD_CONFIG: path.join(home, 'config.json'), ...env },
    input: raw === undefined ? JSON.stringify({ transcript_path: path.join(home, 'rollout.jsonl'), ...input }) : raw,
    encoding: 'utf8', timeout: 5000,
  });
  assert.ifError(result.error);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, '');
  assert.strictEqual(result.stderr, '');
  return result;
}

function facts(id = 'tc1') {
  return JSON.parse(fs.readFileSync(path.join(home, `.config/veroboard/state/sessions/${id}.json`), 'utf8'));
}

function writtenTerminals() {
  return fs.readdirSync(path.join(home, '.config/veroboard/state/sessions')).sort();
}

function nothingWritten() {
  assert(!fs.existsSync(path.join(home, '.config')));
}

try {
  test('shared sessions read HOME at call time and skip unchanged facts', () => {
    const session = require('../veroboard/mods/veroboard/agent/core/session.js');
    const previousHome = process.env.HOME;
    try {
      process.env.HOME = home;
      assert.strictEqual(session.stateDir(), path.join(home, '.config/veroboard/state'));
      const data = { pct: 25, tokens: 100, window: 400, model: 'Example', effort: 'high', shells: 0,
        shellList: [], monitorList: [], launched: [], git: '', worktree: '', lastPrompt: null, awaiting: null };
      assert.strictEqual(session.writeSession('tc1', data), true);
      const previous = fs.readFileSync(path.join(session.stateDir(), 'sessions/tc1.json'), 'utf8');
      assert.strictEqual(session.writeSession('tc1', data), false);
      assert.strictEqual(fs.readFileSync(path.join(session.stateDir(), 'sessions/tc1.json'), 'utf8'), previous);
      assert.strictEqual(session.writeSession('tc1', { ...data, rulesErrors: ['Synthetic error'] }), true);
      assert.strictEqual(session.gitFacts(null), '');
    } finally {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
    }
  });

  test('latest model display name and effort', () => {
    rollout([context('gpt-6-astra'), context()]);
    run({ hook_event_name: 'SessionStart' });
    assert.strictEqual(facts().model, 'GPT-6.1-Sol');
    assert.strictEqual(facts().effort, 'high');
    rollout([context('gpt-6-astra')]);
    run();
    assert.strictEqual(facts().model, 'GPT-6-Astra');
  });

  test('latest tokens, pct and window tolerate null info', () => {
    rollout([context(), usage(5, 10), usage(), entry('event_msg', { type: 'token_count', info: null })]);
    run();
    assert.strictEqual(facts().tokens, 95000);
    assert.strictEqual(facts().window, 475000);
    assert.strictEqual(facts().pct, 20);
    assert.strictEqual(facts().git, '');
    assert.strictEqual(facts().worktree, '');
    assert.strictEqual(facts().shells, 0);
    assert.deepStrictEqual(facts().shellList, []);
    assert.deepStrictEqual(facts().monitorList, []);
    assert(!('rulesErrors' in facts()));
  });

  test('token sum fallback, pct cap and previous window', () => {
    rollout([context(), usage(10, 100)]);
    run();
    rollout([entry('event_msg', { type: 'token_count', info: { last_token_usage: { input_tokens: 120, output_tokens: 30 } } })]);
    run();
    assert.strictEqual(facts().window, 100);
    assert.strictEqual(facts().tokens, 150);
    assert.strictEqual(facts().pct, 100);
  });

  test('Stop question awaits you, pings and stays silent', () => {
    rollout([context(), message('assistant', 'Finished.')]);
    const before = Date.now();
    run({ hook_event_name: 'Stop', last_assistant_message: 'Which option would you prefer?' });
    assert.strictEqual(facts().awaiting.to, 'you');
    assert(facts().awaiting.at >= before);
    const ping = JSON.parse(fs.readFileSync(path.join(home, '.config/veroboard/state/pings/tc1.json'), 'utf8'));
    assert(ping.at >= before && ping.at <= Date.now());
    assert.strictEqual(fs.readFileSync(path.join(home, '.config/veroboard/state/node-path'), 'utf8').trim(), process.execPath);
  });

  test('Stop falls back to task_complete, then assistant text', () => {
    rollout([context(), message('assistant', 'Finished.'), entry('event_msg', { type: 'task_complete', last_agent_message: 'Tell me which.' })]);
    run({ hook_event_name: 'Stop' });
    assert.strictEqual(facts().awaiting.to, 'you');
    rollout([context(), message('assistant', 'Tell me which.')]);
    run({ hook_event_name: 'Stop' });
    assert.strictEqual(facts().awaiting.to, 'you');
  });

  test('UserPromptSubmit clears awaiting and sets lastPrompt', () => {
    rollout([context(), message('user', 'Please check the example.')]);
    run({ hook_event_name: 'Stop', last_assistant_message: 'Tell me which.' });
    const before = Date.now();
    run({ hook_event_name: 'UserPromptSubmit' });
    assert.strictEqual(facts().awaiting, null);
    assert(facts().lastPrompt >= before && facts().lastPrompt <= Date.now());
    const last = facts().lastPrompt;
    run({ hook_event_name: 'PostToolUse' });
    assert.strictEqual(facts().lastPrompt, last);
    assert.strictEqual(facts().awaiting, null);
  });

  test('lastPrompt ignores instruction and environment messages', () => {
    rollout([context(), message('user', 'Please check the example.'),
      ...['# AGENTS.md instructions', '<environment_context', '<user_instructions', '<permissions', '<turn_aborted'].map((text) => ({
        ...message('user', text), timestamp: '2026-02-03T04:05:06.000Z',
      }))]);
    run();
    assert.strictEqual(facts().lastPrompt, Date.parse(stamp));
  });

  test('PostToolUse input catches a launch before the log has its output, and Stop keeps it', () => {
    rollout([context(), call('herdr-app do tab.new --name x')]);
    run({ hook_event_name: 'PostToolUse', tool_name: 'Bash',
      tool_input: JSON.stringify({ command: "herdr-app do tab.new '{\"name\":\"x\"}'" }),
      tool_response: JSON.stringify('{\n  "tab": "tb1",\n  "terminal": "t7q"\n}\n') });
    assert.deepStrictEqual(facts().launched, ['t7q']);
    run({ hook_event_name: 'Stop', last_assistant_message: 'Done.' });
    assert.deepStrictEqual(facts().launched, ['t7q']);
  });

  test('a launch kept from another Codex session is dropped', () => {
    rollout([context(), call('herdr-app do tab.new')]);
    run({ hook_event_name: 'PostToolUse', tool_input: { command: 'herdr-app do tab.new' }, tool_response: '{"terminal":"t7q"}' });
    rollout([context()], metadata({ id: 'session-2' }));
    run({ hook_event_name: 'Stop', last_assistant_message: 'Done.' });
    assert.deepStrictEqual(facts().launched, []);
  });

  test('PostToolUse output with a terminal id but no launch command adds nothing', () => {
    rollout([context()]);
    run({ hook_event_name: 'PostToolUse', tool_input: { command: "echo '{\"terminal\": \"t9z\"}'" }, tool_response: '{"terminal": "t9z"}' });
    assert.deepStrictEqual(facts().launched, []);
  });

  test('launched reads the input_text output Codex really writes', () => {
    rollout([context(),
      call('text(await tools.exec_command({cmd:"herdr-app do tab.new --name x",max_output_tokens:2000}));'),
      output([{ type: 'input_text', text: 'Script completed\nOutput:\n' },
        { type: 'input_text', text: '{"exit_code":0,"output":"{\\n  \\"tab\\": \\"tb1\\",\\n  \\"terminal\\": \\"t6q\\"\\n}"}' }]),
    ]);
    run();
    assert.deepStrictEqual(facts().launched, ['t6q']);
  });

  test('launched terminals include escaped JSON and bare addresses once', () => {
    rollout([context(),
      output('{"terminal":"t99"}', 'unrelated'),
      call('await tools.exec_command({cmd:"herdr-app do tab.new --title example"})'),
      output([{ type: 'text', text: '{\\"terminal\\": \\"t5h\\"}' }]),
      call(JSON.stringify({ cmd: 'herdr-app do pane.split' }), 'call-2', 'function_call'),
      output('t5h\nvps/t7\nt8\nnot an address', 'call-2', 'function_call_output'),
      output('{"terminal":"t90"}', 'call-2'),
    ]);
    run();
    assert.deepStrictEqual(facts().launched, ['t5h', 'vps/t7', 't8']);
  });

  test('Stop recognizes a final hc send without --wait', () => {
    rollout([context(), call('await tools.exec_command({cmd:"hc send t22 hello"})')]);
    run({ hook_event_name: 'Stop', last_assistant_message: "I'm waiting for the go-ahead." });
    assert.strictEqual(facts().awaiting.to, 't22');
    assert.strictEqual(facts().awaiting.rule, 'send-wait');
    rollout([context(), call(JSON.stringify({ cmd: 'hc send t22 --wait hello' }))]);
    run({ hook_event_name: 'Stop', last_assistant_message: "I'm waiting for the go-ahead." });
    assert.notStrictEqual(facts().awaiting && facts().awaiting.rule, 'send-wait');
  });

  test('only the last tool of the current turn can trigger send-wait', () => {
    rollout([context(), call('hc send t22 hello'), message('user', 'Continue.'), message('assistant', "I'm waiting for the go-ahead.")]);
    run({ hook_event_name: 'Stop' });
    assert.notStrictEqual(facts().awaiting && facts().awaiting.rule, 'send-wait');
    rollout([context(), call('hc send t22 hello'), call('git status', 'call-2')]);
    run({ hook_event_name: 'Stop', last_assistant_message: "I'm waiting for the go-ahead." });
    assert.notStrictEqual(facts().awaiting && facts().awaiting.rule, 'send-wait');
  });

  test('CommandExecution argv can identify the final send', () => {
    rollout([context(), entry('event_msg', { type: 'item_completed', item: { type: 'CommandExecution', command: ['bash', '-lc', 'hc send t8 hello'] } })]);
    run({ hook_event_name: 'Stop', last_assistant_message: "I'm waiting for the go-ahead." });
    assert.strictEqual(facts().awaiting.to, 't8');
  });

  test('PermissionRequest pings while Interrupt clears awaiting', () => {
    rollout([context()]);
    run({ hook_event_name: 'PermissionRequest' });
    assert(fs.existsSync(path.join(home, '.config/veroboard/state/pings/tc1.json')));
    run({ hook_event_name: 'Stop', last_assistant_message: 'Tell me which.' });
    run({ hook_event_name: 'Interrupt' });
    assert.strictEqual(facts().awaiting, null);
  });

  test('garbage stdin exits zero without output or facts', () => {
    run({}, {}, '{garbage');
    assert(!fs.existsSync(path.join(home, '.config')));
  });

  test('missing transcript or session metadata writes nothing', () => {
    run({ hook_event_name: 'SessionStart', transcript_path: '/missing/synthetic-rollout.jsonl' });
    run({ transcript_path: undefined });
    run({}, {}, 'null');
    rollout([metadata()], context());
    run();
    rollout([], metadata({ originator: undefined }));
    run();
    fs.writeFileSync(path.join(home, 'rollout.jsonl'), '{garbage\n');
    run();
    nothingWritten();
  });

  test('session metadata alone uses safe fact defaults', () => {
    rollout([]);
    run({ hook_event_name: 'SessionStart' });
    assert.strictEqual(facts().model, 'Codex');
    assert.strictEqual(facts().effort, '');
    assert.strictEqual(facts().window, 0);
    assert.strictEqual(facts().pct, 0);
    assert.strictEqual(facts().lastPrompt, null);
  });

  test('Claude Code helper sessions never write even for an existing terminal', () => {
    rollout([context()], metadata({ originator: 'Claude Code' }));
    run({ hook_event_name: 'Stop' });
    nothingWritten();
  });

  test('inherited Claude terminal in the same cwd is never a candidate', () => {
    rollout([context()]);
    run({ hook_event_name: 'PermissionRequest' }, {
      HC_TEST_OUTPUT: JSON.stringify([terminal('tc1', { status: { app: 'claude-code' } })]),
    });
    nothingWritten();
  });

  test('one Codex terminal resolves without a usable inherited id', () => {
    rollout([context()]);
    for (const id of [undefined, '', '../bad', 'stale']) {
      run({ hook_event_name: 'Stop' }, { HC_TERMINAL_ID: id, HC_TEST_OUTPUT: JSON.stringify([terminal('t5h')]) });
      assert.strictEqual(facts('t5h').model, 'GPT-6.1-Sol');
      assert.deepStrictEqual(writtenTerminals(), ['t5h.json']);
      assert.deepStrictEqual(fs.readdirSync(path.join(home, '.config/veroboard/state/pings')), ['t5h.json']);
    }
  });

  test('a stale Claude id cannot override the unique Codex candidate', () => {
    rollout([context()]);
    run({}, { HC_TEST_OUTPUT: JSON.stringify([
      terminal('tc1', { status: { app: 'claude-code' } }), terminal('t5h'),
    ]) });
    assert.strictEqual(facts('t5h').model, 'GPT-6.1-Sol');
    assert.deepStrictEqual(writtenTerminals(), ['t5h.json']);
  });

  test('candidate inherited id wins when several Codex terminals share a cwd', () => {
    rollout([context()]);
    sessionIndex([{ id: 'session-1', thread_name: 'Other' }]);
    run({}, { HC_TEST_OUTPUT: JSON.stringify([terminal(), terminal('t5h', { title: 'Other | folder' })]) });
    assert.strictEqual(facts().model, 'GPT-6.1-Sol');
    assert.deepStrictEqual(writtenTerminals(), ['tc1.json']);
  });

  test('a new Codex tab is found on its first turn when the other tab in its folder is owned', () => {
    const dir = path.join(home, '.config/veroboard/state/sessions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 't1.json'), JSON.stringify({ model: 'GPT-6.1-Sol', codexSession: 'older-session' }));
    rollout([context()], metadata({ id: 'new-session' }));
    const env = { HC_TERMINAL_ID: undefined, HC_TEST_OUTPUT: JSON.stringify([
      terminal('t1', { title: 'Older thread | folder' }), terminal('t2', { title: '⠴ veroboard-codex-sandbox' })]) };
    run({}, env);
    assert.strictEqual(facts('t2').codexSession, 'new-session');
    assert.strictEqual(facts('t1').codexSession, 'older-session');
    // The older session still finds its own tab, now that both are owned.
    rollout([context()], metadata({ id: 'older-session' }));
    run({ hook_event_name: 'Stop', last_assistant_message: 'Done.' }, env);
    assert.strictEqual(facts('t1').codexSession, 'older-session');
    assert.strictEqual(facts('t2').codexSession, 'new-session');
    assert.strictEqual(facts('t1').model, 'GPT-6.1-Sol');
  });

  test('two unowned Codex tabs in one folder without a thread name write nothing', () => {
    rollout([context()], metadata({ id: 'new-session' }));
    run({}, { HC_TERMINAL_ID: undefined, HC_TEST_OUTPUT: JSON.stringify([terminal('t1'), terminal('t2')]) });
    nothingWritten();
  });

  test('last session index name selects the single matching title', () => {
    rollout([context()]);
    sessionIndex([
      { id: 'session-1', thread_name: 'Old', updated_at: '2026-11-18' },
      { id: 'session-1', thread_name: 'Current', updated_at: '2026-11-17' },
      { id: 'another-session', thread_name: 'Old' },
    ]);
    for (const title of ['Current | folder', 'Current', '⠴ Current | folder']) {
      run({}, { HC_TERMINAL_ID: undefined, HC_TEST_OUTPUT: JSON.stringify([
        terminal('t1', { title: 'Old | folder' }), terminal('t2', { title }),
      ]) });
      assert.strictEqual(facts('t2').model, 'GPT-6.1-Sol');
      assert.deepStrictEqual(writtenTerminals(), ['t2.json']);
    }
  });

  test('ambiguous candidates without exactly one thread title match write nothing', () => {
    rollout([context()]);
    const env = { HC_TERMINAL_ID: undefined, HC_TEST_OUTPUT: JSON.stringify([
      terminal('t1', { title: 'Thread extra | folder' }), terminal('t2', { title: 'Other | folder' }),
    ]) };
    run({ hook_event_name: 'Stop' }, env);
    sessionIndex([{ id: 'session-1', thread_name: 'Thread' }]);
    run({ hook_event_name: 'Stop' }, env);
    run({}, { ...env, HC_TEST_OUTPUT: JSON.stringify([
      terminal('t1', { title: 'Thread | folder' }), terminal('t2', { title: 'Thread' }),
    ]) });
    sessionIndex([{ id: 'session-1', thread_name: 'Other' }, { id: 'session-1', thread_name: '' }]);
    run({}, env);
    nothingWritten();
  });

  test('cwd uses metadata, realpaths and foreground cwd before terminal cwd', () => {
    const alias = path.join(home, 'alias');
    fs.symlinkSync(home, alias, 'dir');
    rollout([context()]);
    run({ cwd: '/wrong/input-cwd' }, { HC_TEST_OUTPUT: JSON.stringify([
      null, false, 12, 'terminal', [], {}, terminal('tc1', { foreground: { cwd: '/wrong/foreground-cwd' } }),
      terminal('t2', { cwd: '/wrong/base-cwd', foreground: { cwd: alias } }),
      terminal('t3', { status: null }),
    ]) });
    assert.strictEqual(facts('t2').model, 'GPT-6.1-Sol');
    assert.deepStrictEqual(writtenTerminals(), ['t2.json']);
  });

  test('missing metadata cwd falls back to input cwd with plain string comparison', () => {
    rollout([context()], metadata({ cwd: undefined }));
    const cwd = path.join(home, 'nonexistent');
    run({ cwd }, { HC_TEST_OUTPUT: JSON.stringify([terminal('t2', { cwd })]) });
    assert.strictEqual(facts('t2').model, 'GPT-6.1-Sol');
    assert.deepStrictEqual(writtenTerminals(), ['t2.json']);
  });

  test('no cwd match never falls back to inherited terminal id', () => {
    rollout([context()]);
    run({}, { HC_TEST_OUTPUT: JSON.stringify([terminal('tc1', { cwd: '/elsewhere' })]) });
    run({}, { HC_TEST_OUTPUT: '[]' });
    nothingWritten();
  });

  test('hc missing, malformed or non-array output stays silent and writes nothing', () => {
    rollout([context()]);
    for (const output of ['garbage', '{}', 'null']) run({}, { HC_TEST_OUTPUT: output });
    fs.unlinkSync(path.join(bin, 'hc'));
    run({}, { PATH: bin });
    nothingWritten();
  });

  test('hc falls back to the home executable when absent from PATH', () => {
    rollout([context()]);
    const localBin = path.join(home, '.local/bin');
    fs.mkdirSync(localBin, { recursive: true });
    fs.renameSync(path.join(bin, 'hc'), path.join(localBin, 'hc'));
    run({}, { PATH: bin });
    assert.strictEqual(facts().model, 'GPT-6.1-Sol');
  });

  test('50 MB rollout keeps old launches and reads current facts from the tail', () => {
    const file = path.join(home, 'rollout.jsonl');
    rollout([call('herdr-app do tab.new'), output('{"terminal":"t1"}')]);
    const filler = JSON.stringify(message('developer', 'Synthetic padding. '.repeat(5000))) + '\n';
    const fd = fs.openSync(file, 'a');
    try {
      for (let i = 0; i < Math.ceil(50 * 1024 * 1024 / Buffer.byteLength(filler)); i++) fs.writeSync(fd, filler);
      const entries = [context(), usage(), ...Array.from({ length: 205 }, (_, i) => [call('herdr-app do terminal.open', `launch-${i}`), output(JSON.stringify({ terminal: `t${i.toString(36)}` }), `launch-${i}`)]).flat()];
      fs.writeSync(fd, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    } finally { fs.closeSync(fd); }

    const start = Date.now();
    run();
    const elapsed = Date.now() - start;
    assert.strictEqual(facts().tokens, 95000);
    assert.strictEqual(facts().launched.length, 200);
    assert.strictEqual(facts().launched[0], 't5');
    assert.strictEqual(facts().launched[199], `t${(204).toString(36)}`);
    console.log(`ok   50 MB hook elapsed ${elapsed} ms (target < 300 ms)`);
    // With just one launch, its output must still survive beyond the tail window.
    const longLine = JSON.stringify(message('developer', 'x'.repeat(5 * 1024 * 1024))) + '\n';
    fs.writeFileSync(file, JSON.stringify(metadata({ id: 'session-long' })) + '\n' + JSON.stringify(call('herdr-app do tab.new')) + '\n' + longLine + JSON.stringify(output('t7')) + '\n' + JSON.stringify(context()) + '\n');
    run();
    assert.deepStrictEqual(facts().launched, ['t7']);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exitCode = failed ? 1 : 0;

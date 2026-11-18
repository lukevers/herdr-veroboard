// Connecting Claude Code and Codex to the board (veroboard/mods/veroboard/agents.js), run on its own:
// node tests/agents.test.js. Pure functions on file text: nothing here reads or writes a real config.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'veroboard', 'mods', 'veroboard', 'agents.js'), 'utf8');
const m = new Function(src.replace(/^export \{([^}]*)\};?\s*$/m, 'return {$1};'))();
let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } };

const ROOT = '~/.config/herdr-app/mods/veroboard/agent';
const OLD = '~/.config/veroboard';
const oldClaude = JSON.stringify({
  model: 'opus',
  statusLine: { type: 'command', command: `node ${OLD}/adapters/claude/tap.js -- node ~/.claude/statusline.js`, padding: 0 },
  subagentStatusLine: { type: 'command', command: `node ${OLD}/adapters/claude/subagents.js` },
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `sh ${OLD}/core/launch-guard.sh claude`, timeout: 5 }] },
      { matcher: 'Edit', hooks: [{ type: 'command', command: 'my-own-check' }] }],
    Stop: [{ hooks: [{ type: 'command', command: `sh ${OLD}/adapters/claude/ping.sh`, timeout: 5 }, { type: 'command', command: 'say done' }] }],
    Notification: [{ hooks: [{ type: 'command', command: `sh ${OLD}/adapters/claude/ping.sh`, timeout: 5 }] }],
  },
});

test('the root: this mod\'s agent folder, as ~/… under your home', () => {
  assert.strictEqual(m.agentRoot('/Users/x/.config/herdr-app', '/Users/x'), ROOT);
  assert.strictEqual(m.agentRoot('/opt/herdr', '/Users/x'), '/opt/herdr/mods/veroboard/agent');
});
test('Claude, nothing yet: off; connecting adds all five, and then it is connected', () => {
  assert.strictEqual(m.claudeStatus('', ROOT).state, 'off');
  const r = m.claudeConnect('{"model":"opus"}', ROOT);
  assert.strictEqual(r.changes.length, 5);
  const s = JSON.parse(r.text);
  assert.strictEqual(s.model, 'opus');
  assert.strictEqual(s.statusLine.command, `node ${ROOT}/adapters/claude/tap.js --`);
  assert.strictEqual(m.claudeStatus(r.text, ROOT).state, 'connected');
  assert.deepStrictEqual(m.claudeConnect(r.text, ROOT).changes, [], 'connecting again changes nothing');
});
test('Claude, a status line of your own: wrapped after "--", and given back on disconnect', () => {
  const mine = JSON.stringify({ statusLine: { type: 'command', command: 'node ~/.claude/statusline.js', padding: 2 } });
  assert.strictEqual(m.claudeStatus(mine, ROOT).state, 'off');
  const r = m.claudeConnect(mine, ROOT), s = JSON.parse(r.text);
  assert.strictEqual(s.statusLine.command, `node ${ROOT}/adapters/claude/tap.js -- node ~/.claude/statusline.js`);
  assert.strictEqual(s.statusLine.padding, 2, 'keeps its other settings');
  const back = JSON.parse(m.claudeDisconnect(r.text).text);
  assert.deepStrictEqual(back, JSON.parse(mine));
});
test('Claude, the old install: "old"; Update points every piece here and keeps the rest', () => {
  assert.strictEqual(m.claudeStatus(oldClaude, ROOT).state, 'old');
  const r = m.claudeConnect(oldClaude, ROOT), s = JSON.parse(r.text);
  assert.strictEqual(m.claudeStatus(r.text, ROOT).state, 'connected');
  assert.strictEqual(s.statusLine.command, `node ${ROOT}/adapters/claude/tap.js -- node ~/.claude/statusline.js`);
  assert.strictEqual(s.hooks.PreToolUse.length, 2, 'no second guard added');
  assert.strictEqual(s.hooks.PreToolUse[1].hooks[0].command, 'my-own-check');
  assert.strictEqual(s.hooks.Stop[0].hooks[1].command, 'say done');
  assert(!r.text.includes(`${OLD}/`), 'no old path left');
});
test('Claude, applying again changes nothing, and a status line wrapped twice comes back wrapped once', () => {
  const once = m.claudeConnect(oldClaude, ROOT).text;
  assert.deepStrictEqual(m.claudeConnect(once, ROOT).changes, []);
  const dbl = JSON.stringify({ statusLine: { type: 'command', command: `node ${OLD}/adapters/claude/tap.js -- node ${ROOT}/adapters/claude/tap.js -- node ~/.claude/statusline.js` } });
  assert.strictEqual(JSON.parse(m.claudeConnect(dbl, ROOT).text).statusLine.command, `node ${ROOT}/adapters/claude/tap.js -- node ~/.claude/statusline.js`);
  assert.strictEqual(JSON.parse(m.claudeDisconnect(dbl).text).statusLine.command, 'node ~/.claude/statusline.js');
});
test('Claude, disconnect takes only ours out', () => {
  const s = JSON.parse(m.claudeDisconnect(oldClaude).text);
  assert.strictEqual(s.statusLine.command, 'node ~/.claude/statusline.js');
  assert.strictEqual(s.subagentStatusLine, undefined);
  assert.deepStrictEqual(s.hooks, { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'my-own-check' }] }], Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] });
  assert.strictEqual(s.model, 'opus');
});
test('Claude, a hook that also plays a sound keeps it: on Update and on Disconnect', () => {
  const t = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: `sh ${OLD}/adapters/claude/ping.sh; afplay /System/Library/Sounds/Ping.aiff`, timeout: 5 }] }] } });
  const up = JSON.parse(m.claudeConnect(t, ROOT).text);
  assert.strictEqual(up.hooks.Stop[0].hooks[0].command, `sh ${ROOT}/adapters/claude/ping.sh; afplay /System/Library/Sounds/Ping.aiff`);
  assert.strictEqual(up.hooks.Stop.length, 1, 'not a second ping');
  const off = JSON.parse(m.claudeDisconnect(t).text);
  assert.strictEqual(off.hooks.Stop[0].hooks[0].command, 'afplay /System/Library/Sounds/Ping.aiff');
  const guard = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `sh ${OLD}/core/launch-guard.sh claude && echo ok` }] }] } });
  assert.strictEqual(JSON.parse(m.claudeDisconnect(guard).text).hooks.PreToolUse[0].hooks[0].command, 'echo ok');
});
test('Claude, a sub-agent status line of your own is kept, and does not block "connected"', () => {
  const mine = JSON.stringify({ subagentStatusLine: { type: 'command', command: 'my-subagents' } });
  const r = m.claudeConnect(mine, ROOT);
  assert.strictEqual(JSON.parse(r.text).subagentStatusLine.command, 'my-subagents');
  assert(r.changes.some((c) => c.includes('kept yours')));
  assert.strictEqual(m.claudeStatus(r.text, ROOT).state, 'connected');
});
test('Claude, a broken settings file is refused, not overwritten', () => {
  assert.throws(() => m.claudeConnect('{ not json', ROOT));
  assert.throws(() => m.claudeStatus('[1,2]', ROOT));
});
test('Codex: connect adds six event hooks and the guard; old ones are pointed here; disconnect keeps yours', () => {
  const mine = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'my-stop' }] }],
    SessionStart: [{ hooks: [{ type: 'command', command: `node ${OLD}/adapters/codex/hook.js`, timeout: 5 }] }] } });
  assert.strictEqual(m.codexStatus(mine, ROOT).state, 'partial');
  const r = m.codexConnect(mine, ROOT), s = JSON.parse(r.text);
  assert.strictEqual(r.changes.length, 7);
  assert.strictEqual(m.codexStatus(r.text, ROOT).state, 'connected');
  assert.strictEqual(s.hooks.SessionStart.length, 1, 'the old hook was pointed here, not doubled');
  assert.strictEqual(s.hooks.PreToolUse[0].matcher, 'Bash');
  assert.strictEqual(s.hooks.PreToolUse[0].hooks[0].command, `sh ${ROOT}/core/launch-guard.sh codex`);
  const back = JSON.parse(m.codexDisconnect(r.text).text);
  assert.deepStrictEqual(back, { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'my-stop' }] }] } });
});
test('Codex: hooks switched on in config.toml, kept as they are when they already are', () => {
  assert.strictEqual(m.codexHooksOn('model = "x"\n'), false);
  assert.strictEqual(m.codexHooksOn('[features]\nhooks = true\n'), true);
  assert.strictEqual(m.codexHooksOn('[features]\n# hooks = true\n'), false);
  assert.strictEqual(m.codexHooksEnable('model = "x"\n'), 'model = "x"\n\n[features]\nhooks = true\n');
  assert.strictEqual(m.codexHooksEnable('[features]\nweb = true\n[tui]\nx = 1\n'), '[features]\nhooks = true\nweb = true\n[tui]\nx = 1\n');
  assert.strictEqual(m.codexHooksEnable('[features]\nhooks = false\n'), '[features]\nhooks = true\n');
  assert.strictEqual(m.codexHooksEnable(''), '[features]\nhooks = true\n');
  const on = '[features]\nhooks = true\n';
  assert.strictEqual(m.codexHooksEnable(on), on);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');

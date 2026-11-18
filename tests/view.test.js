// The board's display settings read from the package defaults and your config (card.js viewFrom), run on its own:
// node tests/view.test.js. card.js imports gpui-kit, so the pure part is cut out and run with stub layouts.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'veroboard', 'mods', 'veroboard', 'card.js'), 'utf8');
const cut = (from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
const seg = [cut('const VIEW_DEFAULTS', '\n// Where the board'), cut('const viewFrom', '\nconst STUCK_KEYS') , cut('const STUCK_KEYS', '\nconst stuckMs')].join('\n');
const { viewFrom } = new Function('cardLayout', 'topLayout', seg + '; return { viewFrom };')((c) => c, (c) => c);
let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } };
const pkg = { stuckTask: 15, stuckShell: 15, stuckMonitor: 30, waitTask: true, waitShell: true, waitMonitor: true, waitHelper: true };

test('defaults: sub-agents and shells 15 min, monitors 30; everything keeps a card in Waiting', () => {
  const v = viewFrom(pkg, {});
  assert.deepStrictEqual([v.stuckTask, v.stuckShell, v.stuckMonitor], [15, 15, 30]);
  assert.deepStrictEqual([v.waitTask, v.waitShell, v.waitMonitor, v.waitHelper], [true, true, true, true]);
});
test('an older config with one stuckMinutes keeps it for every kind', () => {
  const v = viewFrom(pkg, { stuckMinutes: 20 });
  assert.deepStrictEqual([v.stuckTask, v.stuckShell, v.stuckMonitor], [20, 20, 20]);
});
test('a kind set on its own wins over the older stuckMinutes', () => {
  const v = viewFrom(pkg, { stuckMinutes: 20, stuckMonitor: 45 });
  assert.deepStrictEqual([v.stuckTask, v.stuckShell, v.stuckMonitor], [20, 20, 45]);
});
test('a Waiting switch turned off reads as off; the others stay on', () => {
  const v = viewFrom(pkg, { waitMonitor: false });
  assert.deepStrictEqual([v.waitTask, v.waitShell, v.waitMonitor, v.waitHelper], [true, true, false, true]);
});
test('a value of the wrong type is ignored', () => {
  const v = viewFrom(pkg, { stuckTask: "10", waitShell: "no" });
  assert.strictEqual(v.stuckTask, 15); assert.strictEqual(v.waitShell, true);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');

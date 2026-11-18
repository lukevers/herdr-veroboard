// The card's background work rows by kind (card.js ROW_KINDS, cardLayout), run on its own: node tests/rows.test.js.
// card.js imports gpui-kit, so the pure part is cut out and run with a stub layout.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'veroboard', 'mods', 'veroboard', 'card.js'), 'utf8');
const seg = src.slice(src.indexOf('const ROW_KINDS'), src.indexOf('\n};\n', src.indexOf('const cardLayout = (c) =>')) + 4);
const { cardLayout } = new Function('makeLayout', 'CARD_ITEMS', 'CARD_DEFAULT', seg + '; return { cardLayout };')(() => ({ lines: [], hidden: [] }), [], {});
let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } };
const all = { task: true, shell: true, monitor: true }, none = { task: false, shell: false, monitor: false };

test('no config: every kind shows', () => {
  const L = cardLayout(null);
  assert.strictEqual(L.rows, true); assert.deepStrictEqual(L.rowKinds, all);
});
test('an older config with rows: false shows none', () => {
  const L = cardLayout({ rows: false });
  assert.strictEqual(L.rows, false); assert.deepStrictEqual(L.rowKinds, none);
});
test('an older config with rows: true shows all', () => {
  assert.deepStrictEqual(cardLayout({ rows: true }).rowKinds, all);
});
test('one kind off keeps the others', () => {
  const L = cardLayout({ rows: true, rowKinds: { task: true, shell: false, monitor: true } });
  assert.strictEqual(L.rows, true); assert.deepStrictEqual(L.rowKinds, { task: true, shell: false, monitor: true });
});
test('every kind off means no rows', () => {
  const L = cardLayout({ rows: true, rowKinds: none });
  assert.strictEqual(L.rows, false);
});
test('rowKinds wins over rows: one kind back on after rows: false', () => {
  const L = cardLayout({ rows: false, rowKinds: { task: true } });
  assert.strictEqual(L.rows, true); assert.deepStrictEqual(L.rowKinds, { task: true, shell: false, monitor: false });
});
test('a saved layout reads back the same (no change on a round trip)', () => {
  const L = cardLayout({ rows: true, rowKinds: { task: false, shell: true, monitor: true } });
  assert.deepStrictEqual(cardLayout(L).rowKinds, L.rowKinds);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall passed');

// The top bar's layout logic (card.js topLayout/topItems), run on its own: node tests/topbar.test.js.
// card.js imports gpui-kit, so the pure part (homeOf … topLayout) is cut out and run with stubs.
const fs = require('fs'), path = require('path'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'veroboard', 'mods', 'veroboard', 'card.js'), 'utf8');
const start = src.indexOf('const topLayout = (c) =>');
const seg = src.slice(src.indexOf('const homeOf'), src.indexOf('\n};\n', start) + 4);
const { topLayout, topItems } = new Function('CARD_ITEMS', 'CARD_DEFAULT', seg + '; return { topLayout, topItems };')([], { lines: [], hidden: [] });
let failed = 0;
const test = (name, fn) => { try { fn(); console.log(`ok   ${name}`); } catch (e) { failed++; console.log(`FAIL ${name}: ${e.message}`); } };
const line = (L) => L.lines[0];

test('default bar: gear, bell, filter, divider, spaces, + | count, pie', () => {
  const L = topLayout(null);
  assert.deepStrictEqual(line(L), { left: ['gear', 'bell', 'filter', 'divider', 'spaces', 'newSpace'], right: ['count', 'pie'] });
  assert.deepStrictEqual(L.hidden, []);
});
test('added dividers stay where they are placed, on either side', () => {
  const L = topLayout({ lines: [{ left: ['gear', 'divider2', 'spaces'], right: ['count', 'divider3', 'pie'] }], hidden: [] });
  assert.deepStrictEqual(line(L).left.slice(0, 3), ['gear', 'divider2', 'spaces']);
  assert.deepStrictEqual(line(L).right.slice(0, 3), ['count', 'divider3', 'pie']);
});
test('an added divider dragged into Hidden is removed; the shipped one stays hideable', () => {
  const L = topLayout({ lines: [{ left: ['gear'], right: [] }], hidden: ['divider', 'divider2'] });
  assert.deepStrictEqual(L.hidden, ['divider']);
  assert(!line(L).left.includes('divider2') && !line(L).right.includes('divider2'));
});
test('added dividers are labelled by number, in order', () => {
  const items = topItems({ lines: [{ left: ['divider10', 'divider2'], right: [] }], hidden: [] });
  assert.deepStrictEqual(items.filter((x) => /^divider\d+$/.test(x.id)).map((x) => x.label), ['Divider 2', 'Divider 10']);
});
test('unknown ids are dropped, not drawn', () => {
  const L = topLayout({ lines: [{ left: ['gear', 'nope', 'dividerx'], right: [] }], hidden: [] });
  assert(!line(L).left.includes('nope') && !line(L).left.includes('dividerx'));
});
console.log(failed ? `${failed} failed` : 'all passed');
process.exitCode = failed ? 1 : 0;

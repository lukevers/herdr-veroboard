// The rules and every config field: node tests/rules.test.js. Each config needs a fresh process (rules.js reads it once).
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const RULES = path.join(__dirname, '..', 'claude', 'rules.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'veroboard-test-'));
const run = (config, code) => {
  const file = path.join(tmp, `config-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, typeof config === 'string' ? config : JSON.stringify(config));
  return JSON.parse(execFileSync(process.execPath, ['-e', `const r = require(${JSON.stringify(RULES)}); ${code}`], { env: { ...process.env, VEROBOARD_CONFIG: file } }).toString());
};
const config = {
  people: { names: ['Alex'], notPeople: [] },
  blocked: { asks: ['your thoughts'], notAsks: ['just FYI'], nothingForYou: ['all quiet on your side'], todoLabels: ['action item'],
    patterns: { asks: ['\\bthumbs up\\b'], notAsks: ['^\\s*PS\\b'] }, disable: ['paste'] },
};
const cases = [
  ['Next: wait for Alex to reply.', 'Alex/named-wait'],
  ['Next: wait for Bob to reply.', null],
  ['Next: wait for t22.', 't22/named-wait'],
  ['Done. Send me your thoughts.', 'you/asks'],
  ['Done. Just FYI, tell me if this breaks.', null],
  ['Done. Paste the log here.', null],
  ['Done.\nAction item: rotate the key.', 'you/todo-label'],
  ['Done. Give it a thumbs up.', 'you/ask-pattern-1'],
  ['Done. Tell me which. All quiet on your side.', null],
  ['Done.\nPS tell me later.', null],
];
let failed = 0;
const got = run(config, `console.log(JSON.stringify({ errors: r.errors, out: ${JSON.stringify(cases.map((c) => c[0]))}.map((t) => { const g = r.classify(t); return g ? g.to + '/' + g.rule : null; }) }))`);
if (got.errors.length) { failed++; console.log('FAIL config errors', got.errors); }
cases.forEach(([text, want], i) => {
  const ok = got.out[i] === want;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(text)} → ${got.out[i]}${ok ? '' : ` (want ${want})`}`);
});
const bad = run('{bad', `const g = r.classify('Tell me which.'); console.log(JSON.stringify({ n: r.errors.length, g: g && g.to + '/' + g.rule }))`);
const badOk = bad.n === 1 && bad.g === 'you/tell-me';
if (!badOk) failed++;
console.log(`${badOk ? 'ok  ' : 'FAIL'} invalid config → 1 error, defaults still work (${bad.g})`);
// Every built-in rule's example (shown in the Veroboard settings dialog) gives the verdict it documents; an example for a
// rule that ignores or ends the check turns into an ask with that rule switched off.
const ex = run({}, `console.log(JSON.stringify(r.BUILTINS.filter((b) => b.testable !== false).map((b) => { const g = r.classify(b.example); return [b.id, b.expect, g && g.to, g && g.rule]; })))`);
for (const [id, expect, to, rule] of ex) {
  const ok = (to ?? null) === expect && (expect === null || rule === id);
  if (!ok) { failed++; console.log(`FAIL example ${id} → ${to}/${rule} (want ${expect})`); }
}
console.log(`${ex.every(([id, expect, to, rule]) => (to ?? null) === expect && (expect === null || rule === id)) ? 'ok  ' : 'FAIL'} ${ex.length} rule examples give their documented verdict`);
for (const [id, expect] of ex.filter(([, expect]) => expect === null)) {
  const off = run({ blocked: { disable: [id] } }, `const b = r.BUILTINS.find((x) => x.id === ${JSON.stringify(id)}); const g = r.classify(b.example); console.log(JSON.stringify(g && g.to))`);
  if (off !== 'you') { failed++; console.log(`FAIL example ${id}: still not blocked with the rule off (${off})`); }
}
console.log(`ok   examples of rules that end the check or ignore a sentence depend on that rule`);
// Dialog examples: each Asks and Patterns list in Veroboard settings shows "if you add <phrase>, this message gives X; without it, Y".
// They're read from the dialog's own source, so a wording change there is checked here.
const SETTINGS = fs.readFileSync(path.join(__dirname, '..', 'veroboard', 'mods', 'veroboard', 'settings.js'), 'utf8');
const examples = [...SETTINGS.matchAll(/key: (\[[^\]]+\])[^\n]*\n[^\n]*\n\s*example: (\{[^\n]*\}) \},/g)]
  .map((m) => ({ key: JSON.parse(m[1]), ex: Function(`return ${m[2]}`)() }));
if (examples.length !== 6) { failed++; console.log(`FAIL dialog examples: found ${examples.length}, want 6`); }
for (const { key, ex } of examples) {
  const cfg = {}; let v = cfg;
  for (const k of key.slice(0, -1)) v = v[k] = {};
  v[key[key.length - 1]] = [ex.add];
  const verdict = (c) => run(c, `const g = r.classify(${JSON.stringify(ex.msg)}); console.log(JSON.stringify(g && g.to))`);
  const withIt = verdict(cfg), without = verdict({});
  const ok = withIt === ex.to && without === ex.without;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} dialog example ${key.join('.')} "${ex.add}" → ${withIt}, without → ${without}${ok ? '' : ` (want ${ex.to}, ${ex.without})`}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);

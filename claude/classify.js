#!/usr/bin/env node
'use strict';
// For the Board settings dialog (and you): where would a card with this last message go?
//   node classify.js "<message>"     (or the message on stdin) → {"result": {to, rule, why} | null, "errors": [...]}
//   node classify.js --info          → {"config", "defaults", "builtins": [[id, what it looks for]], "errors"}
const fs = require('fs');
const path = require('path');
const rules = require('./rules.js');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
if (process.argv[2] === '--info') {
  out({ config: rules.USER_CONFIG, defaults: path.join(__dirname, 'defaults.json'), builtins: rules.BUILTINS, errors: rules.errors });
} else {
  let text = process.argv[2];
  if (text === undefined) { try { text = fs.readFileSync(0, 'utf8'); } catch (_) { text = ''; } }
  const r = rules.classify(text);
  out({ result: r ? { ...r, why: rules.describe(r.rule) } : null, errors: rules.errors });
}

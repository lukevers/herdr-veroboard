// The SessionStart hook that teaches agents the decision queue (core/decisions-context.js): node tests/decisions-context.test.cjs.
const { execFileSync } = require("node:child_process"), path = require("node:path"), assert = require("node:assert/strict");
const script = path.join(__dirname, "../core/decisions-context.js");
const run = (env) => execFileSync("node", [script, "claude"], { input: "{}", env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } }).toString();
assert.equal(run({}), "", "outside Herdr it prints nothing");
const out = JSON.parse(run({ HC_TERMINAL_ID: "t1" }));
assert.equal(out.hookSpecificOutput.hookEventName, "SessionStart");
const rules = out.hookSpecificOutput.additionalContext;
assert.ok(rules.startsWith("# Decisions (Veroboard)"));
assert.ok(!rules.includes("{{decide}}"), "every placeholder is filled");
assert.ok(rules.includes(`node ${path.join(__dirname, "../core/decide.js").replace(process.env.HOME, "~")} add --id`), "names this install's decide.js");
assert.equal(execFileSync("node", [script], { input: "not json", env: { PATH: process.env.PATH, HOME: "/nonexistent", HC_TERMINAL_ID: "t1" } }).toString().length > 0, true, "bad input or an odd HOME still works");
console.log("decisions-context: all passed");

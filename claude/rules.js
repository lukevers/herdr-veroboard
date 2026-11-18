'use strict';
/*
 * Herdr board: who an agent's last message waits on. The board shows the answer as Blocked · You, Blocked · <name>
 * (another agent or a person), or not blocked.
 *
 * The rules are built-in code (each with an id) plus lists from two JSON files:
 *   defaults.json (next to this file)        shipped with the package; don't edit
 *   ~/.config/veroboard/config.json        yours (or $VEROBOARD_CONFIG): same shape. Lists ADD to the
 *                                             defaults; blocked.disable turns built-in rules off by id.
 *
 * classify(text) -> { to: "you" | "<name>" | "tNN", rule: "<id>" } | null
 * awaitsAfterSend(text) -> true when a message sent with `hc send` says it waits for the answer.
 * errors: config files or patterns that failed to load (the rest still works).
 *
 * Built-in rule ids, in the order they're checked:
 *   named-wait      its own Next line says it waits for someone ("Next: wait for Luke's replies", "I'm waiting for t22")
 *   wait-line       a line of its own says so ("**Waiting on t22.**"), anywhere outside code blocks
 *   next-nothing    "Next: nothing / none / no action" → not blocked
 *   nothing-for-you "You have nothing to do", "no action needed from you" → not blocked
 *   (sentences dropped before the "you" checks:)
 *   elsewhere       the ask is answered in another agent's tab ("Your call in t30's tab")
 *   outside-if      a condition on an outside event ("If the PR lands, say go")
 *   offer           an optional offer ("Want me to draft it?", "if you want")
 *   past-decision   your earlier call, not a new ask ("per your call", "stays your call") — blanks the phrase only
 *   (asks: "you")
 *   question        a "?" at or near the end
 *   negated-ask     "nothing needs your call" — removed before the ask phrases below
 *   tell-me, let-me-know, your-call, needs-you, waiting-on-you, on-hold-until, once-you, on-your-word, say-quoted,
 *   reply-with, quoted-when-ready, paste, pending-your, todo-label, is-yours, say-the-word, do-and-ill, pick-one
 *   send-wait       after `hc send tNN`, the message opens by saying it waits ("I'm waiting for the go-ahead")
 *
 * Mined and tuned on ~5,000 past turns (2026-11-04 to 2026-11-17); see the git history for each rule's example.
 */
const fs = require('fs');
const path = require('path');

const USER_CONFIG = process.env.VEROBOARD_CONFIG || path.join(process.env.HOME || '', '.config/veroboard/config.json');
const errors = [];

function readJson(file, required) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (required || e.code !== 'ENOENT') errors.push(`${file}: ${e.message}`);
    return {};
  }
}
const defaults = readJson(path.join(__dirname, 'defaults.json'), true);
const user = readJson(USER_CONFIG, false);
const listAt = (o, keys) => { let v = o; for (const k of keys) v = v && typeof v === 'object' ? v[k] : undefined; return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()) : []; };
const both = (...keys) => [...new Set([...listAt(defaults, keys), ...listAt(user, keys)])];
const cfg = {
  names: both('people', 'names'),
  notPeople: both('people', 'notPeople'),
  asks: both('blocked', 'asks'),
  notAsks: both('blocked', 'notAsks'),
  nothingForYou: both('blocked', 'nothingForYou'),
  todoLabels: both('blocked', 'todoLabels'),
  askPatterns: both('blocked', 'patterns', 'asks'),
  notAskPatterns: both('blocked', 'patterns', 'notAsks'),
  disable: new Set(both('blocked', 'disable')),
};
const on = (id) => !cfg.disable.has(id);

const esc = (s) => s.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A plain phrase as a whole-word match: "sign off" also matches "sign  off", not "sign offer".
const phrase = (p) => (/^\w/.test(p.trim()) ? '\\b' : '') + esc(p).replace(/\s+/g, '\\s+') + (/\w$/.test(p.trim()) ? '\\b' : '');
const phrases = (list) => (list.length ? new RegExp(list.map(phrase).join('|'), 'i') : null);
const patterns = (list, kind) => list.map((src, n) => {
  try { return [`${kind}-pattern-${n + 1}`, new RegExp(src, 'i')]; } catch (e) { errors.push(`blocked.patterns.${kind}[${n}]: ${e.message}`); return null; }
}).filter(Boolean);

// Agent ids need a digit (t30, t2x), so "the" isn't one.
const TID = 't(?:\\d[0-9a-z]?|[a-z]\\d)';
const isAgent = (x) => new RegExp(`^${TID}$`).test(x) || /^t[0-9a-z]{2}$/.test(x);
// people.names, when set, is the only people who count; agents (tNN) always count.
const isParty = (x) => !cfg.names.length || isAgent(x) || cfg.names.some((n) => n.toLowerCase() === x.toLowerCase());

const AWAITS = /\b(waiting|awaiting|standing by|paused|holding)\b|\bblocked (on|by)\b/i;
const NOT_AWAITS = /\b(nothing|no(t| one| \w+)|nobody|isn't|aren't)\b[^.\n]{0,30}?\b(waiting|awaiting|standing by|paused|holding|blocked)\b/gi; // "Nothing is waiting on your review"

// The ask phrases, one built-in rule each. Each is tested as \b(?:…), as when they were one alternation.
const TODO_LABELS = cfg.todoLabels.map(esc).join('|') || '(?!)';
const NEEDS_YOU = [
  ['tell-me', 'tell me'],
  ['let-me-know', 'let me know (whether|which|if|what|how)'],
  ['your-call', 'your (call|decision|go-?ahead|approval|answer|pick|choice|sign-?off|input|ok|okay)\\b'],
  ['needs-you', 'needs? (your|you to)\\b'],
  ['waiting-on-you', 'waiting (on|for) you\\b'],
  ['on-hold-until', 'on hold until (you|your|I hear)\\b'],
  ['once-you', 'once you (decide|confirm|approve|say|reply|answer|pick|choose|tell)'],
  ['on-your-word', 'on your (go|word|ok)\\b'],
  ['say-quoted', '(say|reply|answer)\\b[^.\\n]{0,12}(\\*\\*|["“`])'],
  ['reply-with', 'reply with\\b'],
  // Starts with a quote mark, so no \\b in front (as part of one \\b(…) alternation it could never match).
  ['quoted-when-ready', '["“]\\w[\\w ]{0,20}["”] when ready\\b', { raw: true }],
  // "paste" only as an instruction ("Paste the log here", "please paste…"), not a noun ("by rule, retry, or paste").
  ['paste', '(?:^|\\n|[.!?:;](?:\\*\\*)?\\s+|[-*>]\\s+|\\*\\*|\\b(?:please|just|can you|could you|you can|you could|then|and)\\s+)paste\\b'],
  ['pending-your', 'pending (?:on )?your\\b'],
  // A to-do label of its own: "Still yours: add X to the vault", "**For you:** …"; not "For you: nothing", nor
  // "Next for you: unblock t22's Linear write" (that ask is on t22's card). Labels: blocked.todoLabels.
  ['todo-label', `(?<=(?:^|\\n)[\\s>*-]{0,6})(?:still |also )?(?:${TODO_LABELS})(?:\\*\\*)?\\s*:(?:\\*\\*)?\\s*(?!nothing\\b|none\\b|no\\b|n\\/a\\b)(?![^\\n]*\\b${TID}'s\\b)`],
  ['is-yours', '\\b(?:is|are|stays?) yours\\b(?! to\\b)'],
  ['say-the-word', '\\bsay (the word|the number|go|yes|which)\\b'],
  ['do-and-ill', "(reply|say|approve|confirm|answer|pick|choose|send|mark up|call out|name)\\b[^.\\n]{0,90}\\b(and|then) I('ll| will)\\b"],
  ['pick-one', 'pick (one|between)|choose (one|between)|which (one|option|way)\\b'],
].filter(([id]) => on(id)).map(([id, src, opt]) => [id, new RegExp(opt && opt.raw ? src : `\\b(?:${src})`, 'i')]);
const USER_ASKS = phrases(cfg.asks);
const ASK_PATTERNS = patterns(cfg.askPatterns, 'ask');
const NOT_NEEDS_YOU = /\b(nothing|no(t| one| \w+)|nobody|isn't|aren't|don't)\b[^.\n]{0,30}?\b(needs? (your|you)|waiting (on|for) you|your (call|decision|approval|input))/gi;

// The party it waits on, named in its own Next line or "I'm waiting for…". Words that aren't parties (pronouns) are
// built in; tools and models whose work the board shows as Waiting are people.notPeople.
const NOT_PARTY = ['you', 'your', 'the', 'it', 'a', 'an', 'this', 'that', 'these', 'those', 'them', 'both', 'all', 'any', ...cfg.notPeople.map(esc)].join('|');
const WAITS_ON = new RegExp(`(?:Next:?\\**:?\\s*(?:I'll |I will |I'm |I am )?|\\b(?:I'm|I am|I'll|I will)\\s+(?:now\\s+|still\\s+|just\\s+)?|(?:^|\\n|[.!]\\s+|\\*\\*|-\\s+)(?:Still |Now |Currently )?(?=[Ww]ait))[Ww]ait(?:ing)? (?:for|on|until) (?!(?:${NOT_PARTY})\\b)([A-Z][A-Za-z-]+|t[0-9a-z]{2})\\b`);
const WAITS_LINE = new RegExp(`(?:^|\\n)[\\s>*-]*(?:\\*\\*)?(?:Still |Now |Currently )?Waiting (?:on|for) ${WAITS_ON.source.split('(?:for|on|until) ')[1]}`, 'g');
const NOTHING_FOR_YOU = /\b(you have nothing to do|nothing (?:needed |required |for you to do |to do )?(?:from|for|on) (?:you|your end)|no action (?:needed |required )?(?:from|for|on) (?:you|your end)|nothing(?:'s| is| else is)? (?:waiting|blocked|pending|parked) on you|you don't need to do anything|nothing you need to do)\b/i;
const USER_NOTHING = phrases(cfg.nothingForYou);

// Sentences dropped (blanked, so the layout stays) before the "you" checks.
const ELSEWHERE_ASK = new RegExp(`\\b${TID}'s (?:tab|card|session|pane|window|prompt|question|dialog)\\b`
  + `|\\b(?:in|over in|over at|switch to|head to|go to|answer in|reply in|via) ${TID}\\b`
  + `|\\b${TID} (?:is |are )?(?:waiting (?:on|for) you|needs you|is asking you|asks you|has (?:a|the|your) (?:question|prompt|dialog))`, 'i');
const EVENT = /\b(lands?|landed|merges?|merged|repl(y|ies)|comes? back|answers?|changes?|turns? out|fails?|passes?|ships?|happens?|arrives?|approves?|responds?|gets? back)\b/i;
const outsideIf = (x) => { const m = x.match(/^[\s*>-]*If\b([^,]*)/i); return Boolean(m) && EVENT.test(m[1]) && !/\b(you|your|you're)\b/i.test(m[1]); };
const OFFER = /^[\s*>_-]*(?:[^.:?!\n]{0,40}:\**\s*)?(?:(?:do you |would you )?want me to|would you like me to|if you(?:'d)? (?:want|like|prefer|rather)\b|optional(?:ly)?\b|no reply needed)|\bif you (?:want|like)(?: it| one| them)?[.!]?\**\s*$/i;
// Mid-sentence too, unless the sentence offers a choice ("Reply 'open PR', or 'go' if you want the boot proven first").
const isOffer = (x) => OFFER.test(x) || (/\bif you(?:'d)? (?:want|like|prefer|rather)\b/i.test(x) && !/\b(?:or|tell me|let me know)\b/i.test(x));
const NOT_AN_ASK = /\b(?:(?<!\b(?:reply|respond|answer|wait|waits|waiting|awaiting|await|need|needs|until|hold|holding)\s)(?:per|with|after|following|for) your (?:call|choice|decision|approval|sign-?off|go-?ahead|input|pick|ok|okay|answer)|(?:stays?|remains?) your (?:call|choice|decision))\b/gi;
const USER_NOT_ASKS = phrases(cfg.notAsks);
const NOT_ASK_PATTERNS = patterns(cfg.notAskPatterns, 'not-ask');
const dropped = (x) => (on('elsewhere') && ELSEWHERE_ASK.test(x)) || (on('outside-if') && outsideIf(x)) || (on('offer') && isOffer(x))
  || Boolean(USER_NOT_ASKS && USER_NOT_ASKS.test(x)) || NOT_ASK_PATTERNS.some(([, re]) => re.test(x));
const blank = (s) => s.replace(/\S/g, '_');
const ownAsks = (text) => {
  const kept = text.split(/((?<=[.!?](?:\*\*)?)\s+|\n)/).map((x) => (dropped(x) ? blank(x) : x)).join('');
  return (on('past-decision') ? kept.replace(NOT_AN_ASK, blank) : kept).trim();
};

function classify(text) {
  if (typeof text !== 'string') return null;
  const body = text.trim().split('\n').filter((l) => !/^\s*(\*\*)?Execution handoff:/i.test(l)).join('\n').trim();
  const tail = body.slice(-400);
  if (on('named-wait')) {
    const next = body.lastIndexOf('Next');
    const named = WAITS_ON.exec(next >= 0 && next > body.length - 600 ? body.slice(next) : body.slice(-300)); // only its own Next line, when it has one
    if (named && isParty(named[1])) return { to: named[1], rule: 'named-wait' };
  }
  if (on('wait-line')) {
    const lineWait = [...body.replace(/```[\s\S]*?(```|$)/g, '').matchAll(WAITS_LINE)].filter((m) => isParty(m[1])).pop(); // not in code blocks
    if (lineWait) return { to: lineWait[1], rule: 'wait-line' };
  }
  if (on('next-nothing') && /Next:?\**:?\s*(nothing|no action|none\b)/i.test(tail)) return null;
  if (on('nothing-for-you') && NOTHING_FOR_YOU.test(tail)) return null;
  if (USER_NOTHING && USER_NOTHING.test(tail)) return null;
  const mine = ownAsks(body);
  if (on('question') && (/\?\s*(\*\*)?\s*$/.test(mine) || /\?(\*\*)?\s+[^?]{0,160}$/.test(mine))) return { to: 'you', rule: 'question' };
  const end = mine.slice(-400);
  const asks = on('negated-ask') ? end.replace(NOT_NEEDS_YOU, '') : end;
  for (const [id, re] of NEEDS_YOU) if (re.test(asks)) return { to: 'you', rule: id };
  if (USER_ASKS && USER_ASKS.test(asks)) return { to: 'you', rule: 'asks' };
  for (const [id, re] of ASK_PATTERNS) if (re.test(asks)) return { to: 'you', rule: id };
  return null;
}

const awaitsAfterSend = (text) => on('send-wait') && typeof text === 'string' && AWAITS.test(text.slice(0, 240).replace(NOT_AWAITS, ''));

// Every built-in rule: its group, what it looks for (what), more detail (more), and an example last message with the
// verdict it gives (expect: "you", a name, or null for not blocked). The Veroboard settings dialog shows these, the board's
// Blocked badge names the rule that decided a card, and tests/rules.test.js checks every example. Keep in step with
// the checks above.
const BUILTINS = [
  { id: 'named-wait', group: 'Waits on someone', what: 'Its Next line says it waits for someone',
    more: 'Looks at its own "Next:" line (or "I\'m waiting for…") for a person or agent it waits on. Pronouns and the Not people list don\'t count; if People is set, only those names do.',
    example: 'The PR is up and green.\nNext: wait for Luke\'s review, then merge.', expect: 'Luke' },
  { id: 'wait-line', group: 'Waits on someone', what: 'A line of its own says it waits',
    more: 'A line that starts with "Waiting on …" or "Still waiting for …" counts anywhere in the message, outside code blocks. The last such line wins.',
    example: '**Waiting on t22.** It owns the schema decision.\n\nStatus:\n1. The parser rewrite is merged and deployed to staging.\n2. All 214 unit tests and the 12 end-to-end flows pass.\n3. The docs describe the new error codes.\n4. The old feature flag is removed from every service.\n5. The dashboards show the new metrics with a day of history.', expect: 't22' },
  { id: 'next-nothing', group: 'Not blocked', what: '"Next: nothing" means not blocked',
    more: 'A Next line that says nothing, none or no action ends the check: the card isn\'t blocked, even if an optional ask follows.',
    example: 'Deployed and verified in production.\nNext: none. Tell me if the numbers look off tomorrow.', expect: null },
  { id: 'nothing-for-you', group: 'Not blocked', what: 'It says you have nothing to do',
    more: 'Phrases like "nothing needed from you", "no action required on your end" or "you have nothing to do" near the end mean not Blocked · You. Add your own in Nothing for you.',
    example: 'All 4 checks pass. Tell me if you see a regression later; no action needed from you now.', expect: null },
  { id: 'elsewhere', group: 'Ignored sentences', what: 'Ignores an ask answered in another agent\'s tab',
    more: 'A sentence that points you at another agent ("your call in t30\'s tab", "answer in t22") is that card\'s ask, so it doesn\'t light up this one too.',
    example: 'Merged the fix. Your call in t30\'s tab on whether to post the note.', expect: null },
  { id: 'outside-if', group: 'Ignored sentences', what: 'Ignores an ask that hangs on an outside event',
    more: 'A sentence starting "If …" whose condition is an outside event (lands, merges, replies, fails, ships…) isn\'t an ask yet. A condition on your judgement ("If that looks right, say go") still counts.',
    example: 'Tests are green. If the PR lands, say go and I\'ll deploy.', expect: null },
  { id: 'offer', group: 'Ignored sentences', what: 'Ignores an optional offer',
    more: '"Want me to…?", "Would you like me to…", "if you want", "optionally" and "no reply needed" are offers once the work is done, not asks. A real choice ("…or keep it? Once you choose, I\'ll…") still counts.',
    example: 'Done: the fix is merged and deployed. Want me to open a follow-up ticket?', expect: null },
  { id: 'past-decision', group: 'Ignored sentences', what: 'Ignores your earlier decision',
    more: '"per your call", "with your sign-off", "for your approval" and "stays your call" refer to a decision already made. Only the phrase is ignored; the rest of the sentence is still read.',
    example: 'Shipped per your call. The ticket is closed.', expect: null },
  { id: 'question', group: 'Asks you', what: 'It ends with a question',
    more: 'A "?" at the very end, or followed by less than about two lines of text. Questions in ignored sentences (offers, other tabs) don\'t count.',
    example: 'Both fixes are ready. Should I merge them together?', expect: 'you' },
  { id: 'negated-ask', group: 'Ignored sentences', what: 'Ignores a negated ask',
    more: '"Nothing needs your approval", "no one is waiting on you": the ask phrase is removed before the ask rules below are checked.',
    example: 'Merged and released. Nothing here needs your approval.', expect: null },
  { id: 'tell-me', group: 'Asks you', what: '"tell me …"', more: 'Any "tell me" near the end.',
    example: 'Two options are drafted. Tell me which one to ship.', expect: 'you' },
  { id: 'let-me-know', group: 'Asks you', what: '"let me know which / whether / if …"', more: '"Let me know" followed by which, whether, if, what or how.',
    example: 'The migration is ready. Let me know whether to run it tonight.', expect: 'you' },
  { id: 'your-call', group: 'Asks you', what: '"your call / decision / approval …"', more: '"your call", "your decision", "your go-ahead", "your approval", "your pick", "your sign-off", "your input" and similar.',
    example: 'Both designs work. The rollout order is your call.', expect: 'you' },
  { id: 'needs-you', group: 'Asks you', what: '"needs your …", "needs you to …"', more: 'Something needs your action or access.',
    example: 'The vault key needs your access to add.', expect: 'you' },
  { id: 'waiting-on-you', group: 'Asks you', what: '"waiting on / for you"', more: 'It says it waits on you directly.',
    example: 'The draft is in the PR description. It\'s waiting on you.', expect: 'you' },
  { id: 'on-hold-until', group: 'Asks you', what: '"on hold until you …"', more: '"on hold until you", "on hold until your …", "on hold until I hear".',
    example: 'The release is on hold until you sign off on the change list.', expect: 'you' },
  { id: 'once-you', group: 'Asks you', what: '"once you decide / confirm / approve …"', more: 'The next step starts once you decide, confirm, approve, say, reply, answer, pick, choose or tell.',
    example: 'Once you approve the plan, I\'ll start the build.', expect: 'you' },
  { id: 'on-your-word', group: 'Asks you', what: '"on your go / word / ok"', more: 'It goes ahead on your word.',
    example: 'The deploy is staged and goes out on your word.', expect: 'you' },
  { id: 'say-quoted', group: 'Asks you', what: 'say / reply / answer, then a quoted word', more: '"Reply **ship**", "say \'go\'", "answer `yes`": a reply word in bold, quotes or code right after.',
    example: 'The branch is rebased. Reply **ship** to merge it.', expect: 'you' },
  { id: 'reply-with', group: 'Asks you', what: '"reply with …"', more: 'It asks you to reply with something.',
    example: 'I can finish the import. Reply with the account ID to continue.', expect: 'you' },
  { id: 'quoted-when-ready', group: 'Asks you', what: '"\'go\' when ready"', more: 'A short quoted word, then "when ready".',
    example: 'The cutover script is staged. "Go" when ready.', expect: 'you' },
  { id: 'paste', group: 'Asks you', what: '"paste …" as an instruction', more: '"Paste the log here", "please paste …", "then paste …". Not "paste" as a noun ("by rule, retry, or paste").',
    example: 'Run the query in the admin console. Paste the result here.', expect: 'you' },
  { id: 'pending-your', group: 'Asks you', what: '"pending your …"', more: 'Something is pending your review, approval or answer.',
    example: 'Everything else is merged. The release is pending your review.', expect: 'you' },
  { id: 'todo-label', group: 'Asks you', what: 'A line-start to-do label for you', more: 'A line starting with one of the To-do labels and a colon ("Still yours: …", "For you: …"). Not "For you: nothing", nor a line that names another agent\'s item ("t22\'s").',
    example: 'Done on my side.\nStill yours: add the API key to the vault.', expect: 'you' },
  { id: 'is-yours', group: 'Asks you', what: '"… is yours"', more: '"is yours", "are yours", "stays yours". Not "yours to keep".',
    example: 'The code is merged. The DNS change is yours.', expect: 'you' },
  { id: 'say-the-word', group: 'Asks you', what: '"say the word / go / yes / which"', more: 'It waits for you to say the word, go, yes, which or the number.',
    example: 'The cleanup script is ready; say the word and it runs.', expect: 'you' },
  { id: 'do-and-ill', group: 'Asks you', what: '"approve … and I\'ll …"', more: 'You do something (approve, reply, pick, confirm, send, name…) and then it acts: "… and I\'ll", "… then I will".',
    example: 'The copy is drafted. Approve it and I\'ll publish.', expect: 'you' },
  { id: 'pick-one', group: 'Asks you', what: '"pick one", "choose between", "which option"', more: 'It asks you to choose.',
    example: 'Three names fit the package. Pick one.', expect: 'you' },
  { id: 'send-wait', group: 'Waits on someone', what: 'After hc send, it says it waits for the answer',
    more: 'When its last action was `hc send tNN …` (without --wait) and its message opens by saying it waits, paused, holds or is blocked, the card is Blocked on that agent. The test box can\'t try this one: it needs the hc send call.',
    example: '(after: hc send t22 "Which schema version should I target?")\nI\'m waiting for t22\'s answer before I continue.', expect: 't22', testable: false },
];
const describe = (id) => {
  const b = BUILTINS.find((x) => x.id === id);
  if (b) return b.what;
  if (id === 'asks') return 'One of your Asks phrases';
  const m = /^(ask|not-ask)-pattern-(\d+)$/.exec(id || '');
  return m ? `Your ${m[1] === 'ask' ? 'ask' : 'not-ask'} pattern #${m[2]}` : '';
};

module.exports = { classify, awaitsAfterSend, errors, config: cfg, USER_CONFIG, BUILTINS, describe };

'use strict';
const fs = require('fs');
const { execSync } = require('child_process');

function stateDir() {
  return `${process.env.HOME}/.config/veroboard/state`;
}

// Which node runs this, for the board's mods: Herdr's exec doesn't get the shell's PATH (nvm, mise), so they
// read the path from ~/.config/veroboard/state/node-path. Written only when it changes.
function noteNode() {
  try {
    const file = `${stateDir()}/node-path`;
    let prev = '';
    try { prev = fs.readFileSync(file, 'utf8').trim(); } catch (_) {}
    if (prev !== process.execPath) {
      fs.mkdirSync(stateDir(), { recursive: true });
      fs.writeFileSync(file, process.execPath + '\n');
    }
  } catch (_) {}
}

function gitInfo(cwd) {
  try {
    const opts = { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 1000 };
    // one call gives branch, upstream, ahead/behind, and per-file states
    const out = execSync('git --no-optional-locks status --porcelain=v2 --branch', opts).toString();
    let branch = '';
    let ahead = 0, behind = 0, hasUpstream = false;
    let staged = 0, modified = 0, untracked = 0, conflicts = 0;
    for (const line of out.split('\n')) {
      if (!line) continue;
      if (line.startsWith('# branch.head')) {
        branch = line.slice('# branch.head'.length).trim();
      } else if (line.startsWith('# branch.upstream')) {
        hasUpstream = true;
      } else if (line.startsWith('# branch.ab')) {
        const m = line.match(/\+(\d+)\s+-(\d+)/);
        if (m) { ahead = +m[1]; behind = +m[2]; }
      } else if (line[0] === '1' || line[0] === '2') {
        const xy = line.split(' ')[1] || '..'; // X=index(staged) Y=worktree
        if (xy[0] !== '.') staged++;
        if (xy[1] !== '.') modified++;
      } else if (line[0] === 'u') {
        conflicts++;
      } else if (line[0] === '?') {
        untracked++;
      }
    }
    let detached = false, tag = '';
    if (branch === '(detached)') {
      detached = true;
      // exact tag at HEAD, if any
      try { tag = execSync('git describe --tags --exact-match HEAD', opts).toString().trim(); } catch (_) {}
      try { branch = execSync('git rev-parse --short HEAD', opts).toString().trim(); } catch (_) {}
    }
    if (!branch) return null;
    // in-progress operation state, detected from the git dir
    let state = '', linked = '';
    try {
      // git dir, shared git dir and checkout root: a linked worktree has its own git dir apart from the shared one.
      const [gitDir, commonDir, top] = execSync('git rev-parse --git-dir --git-common-dir --show-toplevel', opts).toString().trim().split('\n');
      const abs = gitDir.startsWith('/') ? gitDir : `${cwd}/${gitDir}`;
      const absCommon = commonDir.startsWith('/') ? commonDir : `${cwd}/${commonDir}`;
      try { if (fs.realpathSync(abs) !== fs.realpathSync(absCommon)) linked = (top || '').split('/').pop() || 'worktree'; } catch (_) {}
      const has = (p) => { try { return fs.existsSync(`${abs}/${p}`); } catch (_) { return false; } };
      if (has('rebase-merge') || has('rebase-apply')) state = 'REBASE';
      else if (has('MERGE_HEAD')) state = 'MERGING';
      else if (has('CHERRY_PICK_HEAD')) state = 'CHERRY-PICK';
      else if (has('REVERT_HEAD')) state = 'REVERTING';
      else if (has('BISECT_LOG')) state = 'BISECT';
    } catch (_) {}
    if (conflicts > 0 && !state) state = 'CONFLICT';
    return { branch, detached, tag, ahead, behind, hasUpstream, staged, modified, untracked, conflicts, state, linked };
  } catch (_) { return null; }
}

function gitFacts(git) {
  return git ? JSON.stringify({
    ahead: git.ahead, behind: git.behind, staged: git.staged, modified: git.modified,
    untracked: git.untracked, conflicts: git.conflicts, state: git.state,
  }) : '';
}

function writeSession(herdrId, facts) {
  try {
    const dir = `${stateDir()}/sessions`;
    const file = `${dir}/${herdrId}.json`;
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {}
    const same = prev && ['pct', 'tokens', 'window', 'model', 'effort', 'shells', 'shellList', 'monitorList', 'launched', 'git', 'worktree', 'lastPrompt', 'awaiting', 'rulesErrors']
      .every((k) => JSON.stringify(prev[k]) === JSON.stringify(facts[k]));
    if (!same) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ...facts, at: Date.now() }));
      fs.renameSync(`${file}.tmp`, file);
      return true;
    }
  } catch (_) {}
  return false;
}

function ping(herdrId) {
  try {
    const dir = `${stateDir()}/pings`;
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(`${dir}/${herdrId}.json`, JSON.stringify({ at: Date.now() }));
  } catch (_) {}
}

function validId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]+$/.test(id);
}

module.exports = { stateDir, noteNode, gitInfo, gitFacts, writeSession, ping, validId };

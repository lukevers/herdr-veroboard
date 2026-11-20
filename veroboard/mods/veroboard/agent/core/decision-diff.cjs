"use strict";

const linesOf = text => text === "" ? [] : text.split(/\r\n|\n|\r/);

// Hirschberg avoids a full line-by-line LCS matrix at the 64-KiB limit (user, 2026-11-20).
function matches(a, b, ai = 0, bi = 0) {
  const pairs = [], tail = [];
  let start = 0, endA = a.length, endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) {
    pairs.push([ai + start, bi + start]);
    start++;
  }
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    tail.push([ai + --endA, bi + --endB]);
  }
  const left = a.slice(start, endA), right = b.slice(start, endB);
  const values = new Set(left);
  if (left.length && right.some(x => values.has(x))) {
    if (left.length === 1) pairs.push([ai + start, bi + start + right.indexOf(left[0])]);
    else {
      const mid = Math.floor(left.length / 2);
      const lengths = (x, y) => {
        const row = new Uint32Array(y.length + 1);
        for (const value of x) {
          let diagonal = 0;
          for (let j = 1; j <= y.length; j++) {
            const old = row[j];
            row[j] = value === y[j - 1] ? diagonal + 1 : Math.max(row[j], row[j - 1]);
            diagonal = old;
          }
        }

        return row;
      };
      const forward = lengths(left.slice(0, mid), right);
      const reverse = lengths(left.slice(mid).reverse(), [...right].reverse());
      let split = 0;
      for (let j = 1; j <= right.length; j++) {
        if (forward[j] + reverse[right.length - j] > forward[split] + reverse[right.length - split]) split = j;
      }
      pairs.push(...matches(left.slice(0, mid), right.slice(0, split), ai + start, bi + start));
      pairs.push(...matches(left.slice(mid), right.slice(split), ai + start + mid, bi + start + split));
    }
  }

  return pairs.concat(tail.reverse());
}

function diffText(before, body) {
  const a = linesOf(before), b = linesOf(body), rows = [];
  const diffStats = { added: 0, removed: 0 };
  let old = 0, next = 0;
  for (const [i, j] of [...matches(a, b), [a.length, b.length]]) {
    while (old < i) { rows.push({ type: "del", text: a[old], old: ++old }); diffStats.removed++; }
    while (next < j) { rows.push({ type: "add", text: b[next], new: ++next }); diffStats.added++; }
    if (i < a.length) rows.push({ type: "ctx", text: a[old], old: ++old, new: ++next });
  }
  const ranges = [];
  rows.forEach((line, i) => {
    if (line.type === "ctx") return;
    const start = Math.max(0, i - 3), end = Math.min(rows.length, i + 4), last = ranges.at(-1);
    if (last && start <= last.end) last.end = end;
    else ranges.push({ start, end });
  });
  old = 1; next = 1;
  const positions = rows.map(line => {
    const position = [old, next];
    if (line.type !== "add") old++;
    if (line.type !== "del") next++;

    return position;
  });

  return { diff: ranges.map(({ start, end }) => ({ oldStart: positions[start][0], newStart: positions[start][1],
    lines: rows.slice(start, end) })), diffStats };
}

module.exports = { diffText };

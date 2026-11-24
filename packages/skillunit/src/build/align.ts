/**
 * Which line of one text each line of another stands for, so a line of the skill folder can be
 * traced to the build that made it, through a formatter that moved lines and an edit by hand.
 */

/**
 * For each line of `to`, the index of the line of `from` it stands for. Lines both texts share,
 * in order, map to each other (the longest common subsequence); a line between two shared ones
 * maps to the line at the same distance in `from`, kept between them.
 */
export function alignLines(from: string[], to: string[]): number[] {
  const n = from.length;
  const m = to.length;
  if (!n) return to.map(() => 0);
  // Lines equal at the start and the end need no table.
  let head = 0;
  while (head < n && head < m && from[head] === to[head]) head++;
  let tail = 0;
  while (tail < n - head && tail < m - head && from[n - 1 - tail] === to[m - 1 - tail]) tail++;

  const a = from.slice(head, n - tail);
  const b = to.slice(head, m - tail);
  const pairs: [number, number][] = [];
  for (let i = 0; i < head; i++) pairs.push([i, i]);
  for (const [i, j] of lcs(a, b)) pairs.push([i + head, j + head]);
  for (let k = tail; k > 0; k--) pairs.push([n - k, m - k]);

  const out = new Array<number>(m);
  let prev: [number, number] = [-1, -1];
  for (const pair of [...pairs, [n, m] as [number, number]]) {
    const [fi, ti] = pair;
    // The lines of `from` between the two shared ones, if any; else the line inserted after `prev`.
    const lo = prev[0] + 1;
    const hi = fi - 1;
    for (let t = prev[1] + 1; t < ti; t++) {
      const guess = lo <= hi ? Math.min(hi, Math.max(lo, prev[0] + (t - prev[1]))) : prev[0] >= 0 ? prev[0] : fi;
      out[t] = Math.max(0, Math.min(n - 1, guess));
    }
    if (ti < m) out[ti] = fi;
    prev = pair;
  }
  return out;
}

/** A run of lines where two texts differ: the first line of it in each, `line` counted in `actual` from 1. */
export interface Difference {
  line: number;
  /** The first line of the run in `expected`, or undefined when `actual` only has more lines there. */
  expected: string | undefined;
  /** The first line of the run in `actual`, or undefined when it lacks lines `expected` has. */
  actual: string | undefined;
}

/** Each run of lines where `actual` is not `expected`, in order: the lines both share, in order, match. */
export function differences(expected: string[], actual: string[]): Difference[] {
  const pairs = lcs(expected, actual);
  const out: Difference[] = [];
  let a = 0;
  let b = 0;
  for (const [i, j] of [...pairs, [expected.length, actual.length] as [number, number]]) {
    if (i > a || j > b) out.push({ line: Math.min(b, Math.max(actual.length - 1, 0)) + 1, expected: i > a ? expected[a] : undefined, actual: j > b ? actual[b] : undefined });
    a = i + 1;
    b = j + 1;
  }
  return out;
}

/** The pairs of indexes of a longest common subsequence of lines, in order. */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [];
  const w = m + 1;
  const table = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * w + j] = a[i] === b[j] ? table[(i + 1) * w + j + 1]! + 1 : Math.max(table[(i + 1) * w + j]!, table[i * w + j + 1]!);
    }
  }
  const out: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push([i++, j++]);
    } else if (table[(i + 1) * w + j]! >= table[i * w + j + 1]!) i++;
    else j++;
  }
  return out;
}

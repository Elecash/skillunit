/**
 * What changed in the code a unit points at, for `skillunit review`. Inside a git repository it
 * is the diff from the merge base with the default branch to the working tree, cut down to the
 * declaration when the `Source` names one. Outside git, or with no base, it is only the path.
 * For a new unit there is nothing to diff, so it is where the code is: `path:line`, for the
 * reader to open in an editor or read with their own tools.
 */
import { existsSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { defaultBase, Git } from '../git.js';
import { ConfigError } from '../lint/types.js';
import { removeTemp } from '../temp.js';
import { declarationLines } from '../sync/fingerprint.js';
import type { UnitState } from '../sync/sync.js';
import type { SourceRef } from '../units/types.js';

/** The git base a review diffs against: the merge base of HEAD with the default branch. */
export interface GitBase {
  git: Git;
  /** Absolute, real path of the working tree's top folder. */
  top: string;
  ref: string;
  commit: string;
}

/** The base for `dir`, or null outside a repository or when no default branch is found. */
export function findBase(dir: string): GitBase | null {
  const top = new Git(dir).top();
  if (!top) return null;
  const git = new Git(top);
  try {
    const ref = defaultBase(git);
    return { git, top: realpathSync(top), ref, commit: git.mergeBase(ref, 'HEAD') };
  } catch (e) {
    if (e instanceof ConfigError) return null;
    throw e;
  }
}

export interface Change {
  /** The `Source` as the unit writes it. */
  source: string;
  state: UnitState;
  /** Where the code is now, to open it. */
  at: Location;
  /** A unified diff from the base to the working tree; for `#name`, of that declaration only. */
  diff?: string;
  /** What else there is to say: no git base, no difference, not in the base, not found. */
  note?: string;
}

/**
 * A place in the code: the absolute path, and for a file the line to open it at. Line 1 for a
 * whole file (the first changed line for a diff), the declaration's first line for `#name`,
 * with `lastLine` its end, and no line for a folder or a path that does not exist.
 */
export interface Location {
  path: string;
  /** `missing` when the path, or the declaration a `#name` names, is not there now. */
  kind: 'file' | 'folder' | 'missing';
  line?: number;
  lastLine?: number;
}

export function changeFor(ref: SourceRef, source: string, state: UnitState, sourceRoot: string, base: GitBase | null): Change {
  const abs = resolve(sourceRoot, ref.path);
  const at = locate(ref, abs);
  const where = at.kind === 'missing' ? { note: ref.symbol && existsSync(abs) ? `no top-level declaration \`${ref.symbol}\` in ${ref.path}` : `${ref.path} does not exist` } : {};
  if (state === 'new') return { source, state, at, ...where };
  if (!base) return { source, state, at, note: 'changed since the unit was last reviewed; outside a git repository, or with no default branch to compare with, there is no diff to show' };
  const path = gitPath(base.top, abs);
  if (path === null) return { source, state, at, note: 'changed since the unit was last reviewed; it is outside the git repository, so there is no diff to show' };
  const since = `${base.ref} (${base.commit.slice(0, 7)})`;
  const same = { source, state, at, note: `the same as at ${since}: it changed before that commit, so this review has no diff to show` };

  if (ref.symbol) {
    const before = base.git.show(base.commit, path);
    const now = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    const oldPart = before === null ? null : snippet(before, ref.path, ref.symbol);
    const newPart = now === null ? null : snippet(now, ref.path, ref.symbol);
    if (!oldPart && !newPart) return { source, state, at, note: `\`${ref.symbol}\` is a top-level declaration neither at ${since} nor now` };
    const diff = diffSnippets(base, oldPart, newPart, `${base.ref}:${path}#${ref.symbol}`, `${path}#${ref.symbol}`);
    return diff ? { source, state, at, diff } : same;
  }

  const diff = base.git.diffToWorkingTree(base.commit, path);
  const untracked = base.git.untracked(path);
  const note = untracked.length ? `not tracked by git, so not in the diff: ${untracked.join(', ')}` : undefined;
  if (!diff && !note) return same;
  // A file opens at its first changed line; a folder's diff covers several files, so it has none.
  const first = at.kind === 'file' && !ref.symbol ? firstChangedLine(diff) : undefined;
  return { source, state, at: first ? { ...at, line: first } : at, ...(diff ? { diff } : {}), ...(note ? { note } : {}) };
}

/** Where a `Source` is now: see `Location`. */
function locate(ref: SourceRef, abs: string): Location {
  const stat = statSync(abs, { throwIfNoEntry: false });
  if (stat?.isDirectory() && !ref.symbol) return { path: abs, kind: 'folder' };
  if (!stat?.isFile()) return { path: abs, kind: 'missing' };
  if (!ref.symbol) return { path: abs, kind: 'file', line: 1 };
  const lines = declarationLines(readFileSync(abs, 'utf8'), ref.path, ref.symbol);
  return lines ? { path: abs, kind: 'file', line: lines.first, lastLine: lines.last } : { path: abs, kind: 'missing' };
}

/** The first line a unified diff adds or removes, counted in the new file. */
function firstChangedLine(diff: string): number | undefined {
  let line = 0;
  for (const text of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) line = Number(hunk[1]);
    else if (line && (text.startsWith('+') || text.startsWith('-'))) return Math.max(1, line);
    else if (line && text.startsWith(' ')) line++;
  }
  return undefined;
}

/** A path from the top folder with `/`, or null outside it. Follows links, for a path that may not exist. */
function gitPath(top: string, abs: string): string | null {
  let real = abs;
  let rest = '';
  while (!existsSync(real) && dirname(real) !== real) {
    rest = rest ? `${basename(real)}/${rest}` : basename(real);
    real = dirname(real);
  }
  const path = [relative(top, realpathSync(real)).split(sep).join('/'), rest].filter(Boolean).join('/');
  return path.startsWith('..') ? null : path;
}

interface Snippet {
  text: string;
  /** Line of the file the snippet starts at. */
  first: number;
}

function snippet(text: string, file: string, name: string): Snippet | null {
  const lines = declarationLines(text, file, name);
  if (!lines) return null;
  const all = text.replace(/\r\n?/g, '\n').split('\n');
  return { text: `${all.slice(lines.first - 1, lines.last).join('\n')}\n`, first: lines.first };
}

/**
 * The diff of two snippets, with their own labels and hunk lines counted from the top of the
 * file, so `@@ -12,4 +12,6 @@` points at the file.
 */
function diffSnippets(base: GitBase, before: Snippet | null, after: Snippet | null, from: string, to: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'skillunit-review-'));
  try {
    writeFileSync(join(dir, 'a'), before?.text ?? '');
    writeFileSync(join(dir, 'b'), after?.text ?? '');
    const raw = base.git.diffFiles(join(dir, 'a'), join(dir, 'b'));
    const at = raw.indexOf('\n@@');
    if (at < 0) return '';
    const shift = (n: string, by: number) => String(Number(n) + (Number(n) > 0 ? by : 0));
    const hunks = raw
      .slice(at + 1)
      .replace(/^@@ -(\d+)(,\d+)? \+(\d+)(,\d+)? @@/gm, (_, a, an = '', b, bn = '') => `@@ -${shift(a, (before?.first ?? 1) - 1)}${an} +${shift(b, (after?.first ?? 1) - 1)}${bn} @@`);
    return `--- ${before ? from : '/dev/null'}\n+++ ${after ? to : '/dev/null'}\n${hunks}`;
  } finally {
    removeTemp(dir);
  }
}

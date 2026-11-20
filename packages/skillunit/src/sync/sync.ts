/**
 * `skillunit sync`: reports every unit whose `Source` changed between a base commit and HEAD
 * while the unit itself did not. A unit counts as reviewed when its text changed in the same
 * range (whitespace aside), or when a commit in the range carries `Skill-reviewed: <unit-id>`.
 * Nothing is stored in the repository.
 */
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { Problem } from '../lint/types.js';
import { ConfigError } from '../lint/types.js';
import { parseFile, type Unit } from '../units/index.js';
import { Git } from './git.js';

export const TRAILER = 'Skill-reviewed';

export interface SyncOptions {
  /** Folder of the skill. */
  skill: string;
  /** Folder `Source:` paths start from. */
  sourceRoot: string;
  /** Ref to compare HEAD with; sync uses its merge base with HEAD. Default: the default branch. */
  base?: string;
}

export interface SyncResult {
  ok: boolean;
  /** The ref given or found, and the merge-base commit the diff starts from. */
  base: { ref: string; commit: string };
  /** Files changed in the range, from the repository's top folder. */
  changed: string[];
  problems: Problem[];
  summary: {
    units: number;
    /** Units with a `Source` that changed in the range. */
    pointing: number;
    /** Of those, units whose own text changed too. */
    edited: number;
    /** Of those, units a `Skill-reviewed` trailer names. */
    marked: number;
    /** Of those, units nobody reviewed: each one is a problem. */
    toReview: number;
  };
}

export function sync(options: SyncOptions): SyncResult {
  const skillDir = realpathSync(options.skill);
  const git = new Git(skillDir);
  const top = git.top();
  const ref = options.base ?? defaultBase(git);
  if (!git.commit(ref)) throw new ConfigError(`--base ${ref} is not a commit in this repository`);
  const base = git.mergeBase(ref, 'HEAD');

  const changed = git.changedFiles(base, 'HEAD');
  const changedSet = new Set(changed);
  const reviewed = new Set(git.trailers(TRAILER, base, 'HEAD').flatMap((v) => v.split(',')).map((id) => id.trim()).filter(Boolean));

  const skillPath = toGit(top, skillDir);
  const head = unitsAt(git, 'HEAD', skillPath);
  const before = unitsAt(git, base, skillPath);
  const sourceRoot = realOrResolved(options.sourceRoot);

  const problems: Problem[] = [];
  const summary = { units: head.size, pointing: 0, edited: 0, marked: 0, toReview: 0 };
  const short = base.slice(0, 7);

  for (const unit of head.values()) {
    const line = unit.labels.find((l) => l.name === 'Source')?.line ?? unit.line;
    const touched: string[] = [];
    for (const source of unit.source) {
      if (isAbsolute(source.path)) continue; // lint reports it
      const path = toGit(top, resolve(sourceRoot, source.path));
      if (path.startsWith('..')) {
        problems.push({
          file: unit.file,
          line,
          unit: unit.id,
          severity: 'error',
          rule: 'sync',
          message: `\`Source\` ${source.path} is outside the git repository, so sync cannot tell when it changes`,
        });
        continue;
      }
      if (changedSet.has(path) || changed.some((c) => c.startsWith(`${path}/`))) touched.push(source.path);
    }
    if (touched.length === 0) continue;

    summary.pointing++;
    const old = before.get(unit.id);
    if (!old || normalize(old.text) !== normalize(unit.text)) {
      summary.edited++;
    } else if (reviewed.has(unit.id)) {
      summary.marked++;
    } else {
      summary.toReview++;
      const what = touched.map((t) => `\`${t}\``).join(', ');
      problems.push({
        file: unit.file,
        line: unit.line,
        unit: unit.id,
        severity: 'error',
        rule: 'sync',
        message: `${what} changed since ${short} and this unit did not; review it, then edit it or add \`${TRAILER}: ${unit.id}\` to a commit message`,
      });
    }
  }

  problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { ok: problems.length === 0, base: { ref, commit: base }, changed, problems, summary };
}

/**
 * The branch to compare with: the pull request's target in GitHub Actions, else the remote's
 * default branch, else a local `main` or `master`.
 */
export function defaultBase(git: Git): string {
  const candidates: string[] = [];
  const target = process.env.GITHUB_BASE_REF;
  if (target) candidates.push(`origin/${target}`);
  const remoteHead = git.run(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], true)?.trim();
  if (remoteHead) candidates.push(remoteHead.replace(/^refs\/remotes\//, ''));
  candidates.push('origin/main', 'origin/master', 'main', 'master');
  const found = candidates.find((c) => git.commit(c));
  if (!found) throw new ConfigError('could not find the default branch to compare with; pass --base <ref>');
  return found;
}

/** The unit text with whitespace normalised, so a formatter run does not count as an edit. */
export function normalize(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Units of the skill as committed in `commit`, by id. The first unit wins when ids repeat. */
function unitsAt(git: Git, commit: string, skillPath: string): Map<string, Unit> {
  const out = new Map<string, Unit>();
  const prefix = skillPath ? `${skillPath}/` : '';
  for (const path of git.files(commit, skillPath)) {
    const rel = path.slice(prefix.length);
    if (!rel.endsWith('.md') || rel.split('/').some((part) => part.startsWith('.') || part === 'node_modules')) continue;
    for (const unit of parseFile(git.show(commit, path), rel).units) if (!out.has(unit.id)) out.set(unit.id, unit);
  }
  return out;
}

/** Path from the repository's top folder, with `/`; '' for the top itself. */
function toGit(top: string, path: string): string {
  return relative(top, path).split(sep).join('/');
}

/** Real path when it exists, so it compares with git's top folder; resolved otherwise. */
function realOrResolved(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

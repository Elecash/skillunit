/**
 * `--changed`: ask every question whose skill file (or a `with` file) changed since the base.
 * The skill files come from git: what differs in the working tree from the merge base of HEAD
 * with `--base` (default: the default branch), untracked files included.
 */
import { realpathSync } from 'node:fs';
import { posix, relative, sep } from 'node:path';
import { defaultBase, Git } from '../git.js';
import { ConfigError } from '../lint/types.js';
import type { Selection } from './runner.js';

export interface ChangedSince {
  /** The ref given or found, and the merge-base commit the diff starts from. */
  ref: string;
  commit: string;
  /** Files of the skill that changed, from the skill folder, with `/`. */
  files: string[];
}

/** The skill files that differ in the working tree from the merge base of `base` and HEAD. */
export function changedSkillFiles(skill: string, base?: string): ChangedSince {
  const skillDir = realpathSync(skill);
  const git = new Git(skillDir);
  const top = git.top();
  if (!top) throw new ConfigError(`--changed needs a git repository to tell which skill files changed; ${skillDir} is not in one`);
  const ref = base ?? defaultBase(git);
  if (!git.commit(ref)) throw new ConfigError(`--base ${ref} is not a commit in this repository`);
  const commit = git.mergeBase(ref, 'HEAD');
  const skillPath = relative(realpathSync(top), skillDir).split(sep).join('/');
  const prefix = skillPath ? `${skillPath}/` : '';
  const files = git
    .changedSince(commit)
    .filter((c) => c.startsWith(prefix))
    .map((c) => c.slice(prefix.length));
  return { ref, commit, files };
}

export function changedSelection(changed: ChangedSince): Selection {
  const files = new Set(changed.files);
  const norm = (p: string) => posix.normalize(p.split('\\').join('/'));
  const anyMarkdown = changed.files.some((f) => f.endsWith('.md'));

  return (q) => files.has(norm(q.file)) || (q.withFiles === 'all' ? anyMarkdown : q.withFiles.some((f) => files.has(norm(f))));
}

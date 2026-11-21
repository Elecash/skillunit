/**
 * `test --changed`: run every spec whose skill file (or a `with` file) changed since the base,
 * and the tests that name, with `unit:`, a unit sync reports as stale or new. The skill files
 * come from git, between the merge base with `--base` (default: the default branch) and HEAD.
 */
import { realpathSync } from 'node:fs';
import { posix, relative, sep } from 'node:path';
import { defaultBase, Git } from '../git.js';
import { ConfigError } from '../lint/types.js';
import type { SyncResult } from '../sync/sync.js';
import type { Selection } from './runner.js';

export interface ChangedSince {
  /** The ref given or found, and the merge-base commit the diff starts from. */
  ref: string;
  commit: string;
  /** Files of the skill that changed, from the skill folder, with `/`. */
  files: string[];
}

/** The skill files that changed between the merge base of `base` and HEAD. */
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
    .changedFiles(commit, 'HEAD')
    .filter((c) => c.startsWith(prefix))
    .map((c) => c.slice(prefix.length));
  return { ref, commit, files };
}

export function changedSelection(sync: SyncResult, changed: ChangedSince): Selection {
  const files = new Set(changed.files);
  const toReview = new Set(sync.units.filter((u) => u.state !== 'in-sync').map((u) => u.id));
  const norm = (p: string) => posix.normalize(p.split('\\').join('/'));
  const anyMarkdown = changed.files.some((f) => f.endsWith('.md'));

  return (spec) => {
    const withChanged = spec.withFiles === 'all' ? anyMarkdown : spec.withFiles.some((f) => files.has(norm(f)));
    if (files.has(norm(spec.file)) || withChanged) return 'all';
    const ids = new Set(spec.tests.filter((t) => t.unit && toReview.has(t.unit)).map((t) => t.id));
    return ids.size ? ids : null;
  };
}

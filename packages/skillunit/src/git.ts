/**
 * The few git commands SkillUnit needs, run as subprocesses in one working folder. Sync compares
 * the lock and needs none; `test --changed` uses git to find the skill files that changed, and
 * `review` to show what changed in the code.
 */
import { spawnSync } from 'node:child_process';
import { ConfigError } from './lint/types.js';

export class Git {
  constructor(private readonly cwd: string) {}

  /** Output of a git command. Throws a ConfigError when it fails, unless `quiet` returns null. */
  run(args: string[], quiet = false): string | null {
    const result = spawnSync('git', args, { cwd: this.cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (result.error) throw new ConfigError(`could not run git: ${result.error.message}`);
    if (result.status !== 0) {
      if (quiet) return null;
      throw new ConfigError(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
    }
    return result.stdout;
  }

  /** Absolute path of the working tree's top folder, or null outside a repository. */
  top(): string | null {
    return this.run(['rev-parse', '--show-toplevel'], true)?.trim() || null;
  }

  commit(ref: string): string | null {
    return this.run(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], true)?.trim() || null;
  }

  mergeBase(a: string, b: string): string {
    const base = this.run(['merge-base', a, b], true)?.trim();
    if (!base) throw new ConfigError(`${a} and ${b} have no common commit; pass another --base`);
    return base;
  }

  /** Paths, from the top folder, that differ between two commits. */
  changedFiles(from: string, to: string): string[] {
    return this.run(['diff', '--name-only', '-z', from, to])!.split('\0').filter(Boolean);
  }

  /** A file as committed, or null when the commit does not have it. `path` is from the top folder. */
  show(commit: string, path: string): string | null {
    return this.run(['show', `${commit}:${path}`], true);
  }

  /** The unified diff of a path (file or folder, from the top folder) from a commit to the working tree. */
  diffToWorkingTree(commit: string, path: string): string {
    return this.run(['-c', 'core.quotePath=false', 'diff', '--no-color', '--no-ext-diff', commit, '--', `:(top)${path}`])!;
  }

  /** Files under a path that git does not track and does not ignore, from the top folder. */
  untracked(path: string): string[] {
    return this.run(['ls-files', '-z', '--others', '--exclude-standard', '--', `:(top)${path}`])!.split('\0').filter(Boolean);
  }

  /** The unified diff of two files outside the repository; empty when they are the same. */
  diffFiles(a: string, b: string): string {
    const result = spawnSync('git', ['diff', '--no-index', '--no-color', '--no-ext-diff', a, b], { cwd: this.cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.error) throw new ConfigError(`could not run git: ${result.error.message}`);
    if (result.status !== 0 && result.status !== 1) throw new ConfigError(`git diff --no-index failed: ${result.stderr.trim()}`);
    return result.stdout;
  }
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

/** The few git commands sync needs, run as subprocesses in one working folder. */
import { spawnSync } from 'node:child_process';
import { ConfigError } from '../lint/types.js';

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

  /** Absolute path of the working tree's top folder. */
  top(): string {
    const top = this.run(['rev-parse', '--show-toplevel'], true);
    if (top === null) throw new ConfigError(`sync needs a git repository; ${this.cwd} is not in one`);
    return top.trim();
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

  /**
   * Values of a commit trailer in the commits after `from` up to `to`, one per trailer line.
   * `key=` and `valueonly` need git 2.22; `separator=` (2.26) is not used, so each value comes
   * on its own line.
   */
  trailers(key: string, from: string, to: string): string[] {
    const out = this.run(['log', `--format=%(trailers:key=${key},valueonly)`, `${from}..${to}`])!;
    return out.split('\n').map((v) => v.trim()).filter(Boolean);
  }

  /** Files under `dir` (from the top folder) in a commit. */
  files(commit: string, dir: string): string[] {
    return this.run(['ls-tree', '--full-tree', '-r', '-z', '--name-only', commit, '--', dir || '.'])!.split('\0').filter(Boolean);
  }

  show(commit: string, path: string): string {
    return this.run(['show', `${commit}:${path}`])!;
  }
}

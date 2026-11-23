/**
 * A copy of apps/tinyfetch in a temporary git repository: the base commit is the app as it is, a
 * scenario changes it and commits, `test` runs the app's
 * tests as CI does (they write the JUnit report the proof layer reads), and `run` calls the built
 * SkillUnit CLI on the copy.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(here, '../../..');
const appSource = join(workspace, 'apps', 'tinyfetch');
export const CLI = join(workspace, 'packages', 'skillunit', 'dist', 'cli.js');
const require = createRequire(import.meta.url);
const typescript = dirname(require.resolve('typescript/package.json'));
const vitest = join(workspace, 'node_modules', 'vitest');
const prettier = dirname(require.resolve('prettier/package.json', { paths: [join(workspace, 'packages', 'skillunit')] }));

/** The API key, from the environment or the workspace's `.env`. Never printed. */
export function apiKey(): string | undefined {
  if (process.env.TYPESAFE_API_KEY) return process.env.TYPESAFE_API_KEY;
  const env = join(workspace, '.env');
  if (!existsSync(env)) return undefined;
  return /^TYPESAFE_API_KEY=(.+)$/m.exec(readFileSync(env, 'utf8'))?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2') || undefined;
}

export interface Run {
  code: number;
  report: Record<string, any>;
  stderr: string;
}

export class App {
  readonly root: string;
  readonly base: string;
  private static all: App[] = [];

  private constructor(name: string) {
    this.root = mkdtempSync(join(tmpdir(), `tinyfetch-${name}-`));
    for (const part of ['src', 'skill', 'specs', 'skillunit.yaml', 'skillunit.lock', 'tsconfig.json', 'package.json', 'vitest.config.ts']) {
      cpSync(join(appSource, part), join(this.root, part), { recursive: true });
    }
    // The type-check runs the project's own tsc, found in node_modules at or above the tsconfig.
    mkdirSync(join(this.root, 'node_modules', '.bin'), { recursive: true });
    symlinkSync(typescript, join(this.root, 'node_modules', 'typescript'), 'dir');
    // The tests run with Vitest, and `proof.format` runs Prettier through `npx --no-install`.
    symlinkSync(vitest, join(this.root, 'node_modules', 'vitest'), 'dir');
    symlinkSync(prettier, join(this.root, 'node_modules', 'prettier'), 'dir');
    symlinkSync(join(prettier, 'bin', 'prettier.cjs'), join(this.root, 'node_modules', '.bin', 'prettier'));
    writeFileSync(join(this.root, '.gitignore'), 'node_modules\nreports\ntmp\n');
    this.git('init', '-q');
    this.git('symbolic-ref', 'HEAD', 'refs/heads/main');
    this.commit('base');
    this.base = this.git('rev-parse', 'HEAD').trim();
  }

  static copy(name: string): App {
    const app = new App(name);
    App.all.push(app);
    return app;
  }

  static removeAll() {
    for (const app of App.all.splice(0)) rmSync(app.root, { recursive: true, force: true });
  }

  git(...args: string[]): string {
    return execFileSync('git', ['-c', 'user.name=Scenario', '-c', 'user.email=scenario@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: this.root,
      encoding: 'utf8',
    });
  }

  read(path: string): string {
    return readFileSync(join(this.root, path), 'utf8');
  }

  write(path: string, text: string) {
    writeFileSync(join(this.root, path), text);
  }

  /** Replaces `from` with `to` in a file. Throws when `from` is not there, so a stale scenario fails loudly. */
  edit(path: string, from: string, to: string) {
    const text = this.read(path);
    if (!text.includes(from)) throw new Error(`scenario edit: ${path} does not contain ${JSON.stringify(from)}`);
    this.write(path, text.replace(from, to));
  }

  commit(message: string) {
    this.git('add', '-A');
    this.git('commit', '-q', '--allow-empty', '-m', message);
  }

  /** Runs the app's tests, which write `reports/junit.xml`. Returns whether they all passed. */
  test(): boolean {
    const result = spawnSync(process.execPath, [join(vitest, 'vitest.mjs'), 'run'], { cwd: this.root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', CI: '1' } });
    if (!existsSync(join(this.root, 'reports', 'junit.xml'))) throw new Error(`the tests wrote no report (exit ${result.status}): ${result.stdout}${result.stderr}`.trim());
    return result.status === 0;
  }

  /** Runs `skillunit <command> --reporter json` on the copy. With `--changed`, `--base` is the base commit. */
  run(command: 'check' | 'lint' | 'proof' | 'test', ...args: string[]): Run {
    const base = args.includes('--changed') ? ['--base', this.base] : [];
    const key = apiKey();
    const result = spawnSync(process.execPath, [CLI, command, '--reporter', 'json', ...base, ...args], {
      cwd: this.root,
      encoding: 'utf8',
      env: { ...process.env, ...(key ? { TYPESAFE_API_KEY: key } : {}), NO_COLOR: '1' },
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status === 2 || !result.stdout.trim()) {
      throw new Error(`skillunit ${command} could not run (exit ${result.status}): ${result.stderr.trim()}`);
    }
    return { code: result.status ?? -1, report: JSON.parse(result.stdout), stderr: result.stderr };
  }
}

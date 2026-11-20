/**
 * `.env` files: the one next to `skillunit.yaml`, then one in each parent folder up to the git
 * root, so a single `.env` at the root of a repository serves every project in it. A variable
 * already set in the environment always wins, and a closer file wins over a farther one.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** The `.env` files that apply from `start`, closest first. */
export function envFiles(start: string): string[] {
  const folders: string[] = [];
  let dir = resolve(start);
  for (;;) {
    folders.push(dir);
    if (existsSync(join(dir, '.git'))) break; // the git root: a folder, or a file in a worktree
    const up = dirname(dir);
    if (up === dir) return [join(resolve(start), '.env')].filter(isFile); // no git: only `start`
    dir = up;
  }
  return folders.map((f) => join(f, '.env')).filter(isFile);
}

/**
 * Sets the variables of every `.env` file that applies from `start`. Returns the files read.
 * Lines are `KEY=value`, with optional quotes around the value; `#` starts a comment line.
 */
export function loadEnv(start: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const files = envFiles(start);
  for (const file of files) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue;
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m) continue;
      const value = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
      if (env[m[1]!] === undefined) env[m[1]!] = value;
    }
  }
  return files;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { envFiles, loadEnv } from './env.js';

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** outside/.env  ·  outside/repo/.git  ·  repo/.env  ·  repo/apps/app/.env  ·  repo/apps/other */
function layout() {
  const outside = mkdtempSync(join(tmpdir(), 'skillunit-env-'));
  roots.push(outside);
  const repo = join(outside, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, 'apps', 'app'), { recursive: true });
  mkdirSync(join(repo, 'apps', 'other'), { recursive: true });
  writeFileSync(join(outside, '.env'), 'OUTSIDE=1\nSHARED=outside\n');
  writeFileSync(join(repo, '.env'), '# the repository key\nTYPESAFE_API_KEY=root-key\nSHARED=root\nQUOTED="a b"\n');
  writeFileSync(join(repo, 'apps', 'app', '.env'), "export TYPESAFE_API_KEY='app-key'\n");
  return { outside, repo };
}

describe('.env files', () => {
  it('reads the folder of the config, then each parent up to the git root, and no further [skill:key-outside-the-repo]', () => {
    const { repo } = layout();
    expect(envFiles(join(repo, 'apps', 'app'))).toEqual([join(repo, 'apps', 'app', '.env'), join(repo, '.env')]);
    expect(envFiles(join(repo, 'apps', 'other'))).toEqual([join(repo, '.env')]);
  });

  it('lets the closer file win, and the environment win over every file', () => {
    const { repo } = layout();
    const env: NodeJS.ProcessEnv = {};
    loadEnv(join(repo, 'apps', 'app'), env);
    expect(env).toEqual({ TYPESAFE_API_KEY: 'app-key', SHARED: 'root', QUOTED: 'a b' });
    const set: NodeJS.ProcessEnv = { TYPESAFE_API_KEY: 'from-ci' };
    loadEnv(join(repo, 'apps', 'app'), set);
    expect(set.TYPESAFE_API_KEY).toBe('from-ci');
  });

  it('reads only the start folder outside a git repository', () => {
    const { outside } = layout();
    const plain = join(outside, 'plain');
    mkdirSync(plain);
    expect(envFiles(plain)).toEqual([]);
    writeFileSync(join(plain, '.env'), 'X=1\n');
    expect(envFiles(plain)).toEqual([join(plain, '.env')]);
  });
});

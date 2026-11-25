import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { envFiles, loadEnv } from './env.js';
import { PROVIDER_NAMES, PROVIDERS } from './models/index.js';
import { unit } from './vitest.js';

/** The environment variables of the providers that ship with SkillUnit. */
const KEYS = PROVIDER_NAMES.flatMap((n) => [...PROVIDERS[n].env]);
/** `a`, `a or b`, `a, b or c`. */
const or = (items: string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`);

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
  unit('key-outside-the-repo', {
      when: "the test layer needs the decision model's API key.",
      // The variables come from the providers that ship, so a new one shows up in the skill.
      do: `put the key of the provider in \`skillunit.yaml\`, ${or(KEYS.map((v) => `\`${v}\``))}, in the environment (a secret in CI), or in a \`.env\` file that git ignores, next to \`skillunit.yaml\` or at the root of the repository.`,
      check: `forbid \`/(${KEYS.map((v) => v.replace(/_API_KEY$/, '')).join('|')})_API_KEY:\\s*\\S/\` in yaml`,
      ask: [
        {
          id: 'key-in-config',
          scenario: 'CI needs the TypeSafe key, and the agent is setting up the project.',
          question: 'Where should the agent put the key?',
          options: {
            env: `In a \`.env\` file that git ignores locally, and as a \`${PROVIDERS.typesafe.env[0]}\` secret in CI`,
            config: 'In `skillunit.yaml`, next to `model`',
            'test-file': 'In the test file that declares the questions',
          },
          expect: 'env',
        },
        {
          id: 'key-of-the-provider',
          scenario: "The project's `skillunit.yaml` has `model: { provider: openai }`, and the agent is adding the decision model's key to CI.",
          question: 'Which secret should the agent add?',
          options: {
            openai: `\`${PROVIDERS.openai.env[0]}\``,
            typesafe: `\`${PROVIDERS.typesafe.env[0]}\``,
            both: `Both \`${PROVIDERS.openai.env[0]}\` and \`${PROVIDERS.typesafe.env[0]}\``,
          },
          expect: 'openai',
        },
      ],
    }, (u) => {
    u.example('sh', 'echo "TYPESAFE_API_KEY=your-key" >> .env');
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

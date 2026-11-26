// The file `SKILL.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:skillunit` is the code under its description; see docs/proof.md.
// #region skill:skillunit
import { ask, setup, unit } from 'skillunit/vitest';
// #endregion
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect } from 'vitest';
import { loadConfig } from '../config.js';
import { envFiles } from '../env.js';
import { init } from '../init.js';
import { PROVIDER_NAMES, PROVIDERS } from '../models/index.js';
import { runAll } from '../test/runner.js';
import { code, collected, envLayout, cleanUp, or, question, scratch, skillProject, stub } from './helpers.js';

afterAll(cleanUp);

/** The environment variables of the providers that ship with SkillUnit. */
const KEYS = PROVIDER_NAMES.flatMap((n) => [...PROVIDERS[n].env]);

setup('skillunit', {
  file: 'SKILL.md',
  title: 'SkillUnit',
  description: 'SkillUnit builds an agent skill from the tests of the code it describes, and asks a decision model closed questions about what the skill says.',
  frontmatter: {
    name: 'skillunit',
    description:
      'Write an agent skill from the tests of the code it describes, and check that it still says what the code does, with SkillUnit. Use when asked to write or restructure a skill, to add or fix the tests that declare its files, units and questions, or to check that a skill still says what it should after the code changed.',
  },
});

describe('SKILL.md', () => {
  unit(
    'init-first',
    {
      when: 'a project has a skill, or code that needs one, and no `skillunit.yaml`.',
      do: 'run `npx skillunit init <skill folder>` from the project root and set `context` to one sentence about what the skill is for; then declare each file of the skill with `setup()` and each unit with `unit()` in the tests, set `proof.run` to the command that runs those tests, and run `npx skillunit proof --write`.',
      ask: {
        scenario: 'The project has a skill folder but no `skillunit.yaml`.',
        question: 'What should the agent do first?',
        options: {
          init: 'Run `npx skillunit init` on the skill folder, then set `context`',
          manual: 'Write `skillunit.yaml` from scratch by hand',
          run: 'Run `npx skillunit test` to see what happens',
        },
        expect: 'init',
      },
    },
    (u) => {
      const root = scratch('init');
      const said = init('skills/my-skill', root).join('\n');
      expect(said).toContain('declare each file of the skill with `setup()` and each unit with `unit()`');
      expect(said).toContain('set `proof.run` in skillunit.yaml');
      expect(said).toContain('run `skillunit proof --write`');
      const settings = readFileSync(join(root, 'skillunit.yaml'), 'utf8');
      expect(settings).toMatch(/^# context: /m);
      expect(settings).toMatch(/^# proof: \{ run: /m);
      expect(loadConfig(join(root, 'skillunit.yaml')).skill).toBe(join(root, 'skills', 'my-skill'));
      u.example('yaml', settings);
    },
  );

  unit(
    'key-outside-the-repo',
    {
      when: "the test layer needs the decision model's API key.",
      // The variables come from the providers that ship, so a new one shows up in the skill.
      do: `put the key of the provider \`skillunit.yaml\` names, ${or(code(KEYS))}, in the environment (a secret in CI), or in a \`.env\` file that git ignores, next to \`skillunit.yaml\` or at the root of the repository; never in \`skillunit.yaml\` itself.`,
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
    },
    (u) => {
      const { repo } = envLayout();
      // The file of the folder, then the one at the root of the repository; none above it.
      expect(envFiles(join(repo, 'apps', 'app'))).toEqual([join(repo, 'apps', 'app', '.env'), join(repo, '.env')]);
      expect(envFiles(join(repo, 'apps', 'other'))).toEqual([join(repo, '.env')]);
      u.example('sh', `echo "${KEYS[0]}=your-key" >> .env`);
    },
  );

  unit(
    'dry-run-without-key',
    {
      when: 'there is no API key, and the user asked for tests.',
      do: 'write the questions anyway, run `npx skillunit check --dry-run`, and tell the user they were not sent to the model.',
      evenWhen: 'the questions look obviously right; a question that was never sent has not passed.',
      ask: {
        id: 'no-key-yet',
        scenario: [
          'The user asks for SkillUnit tests for their skill, and TYPESAFE_API_KEY is not set anywhere.',
          'The agent is about to test a skill, but there is no .env file and no API key in the environment.',
        ],
        question: 'What should the agent do?',
        options: {
          dry: 'Write the questions, run `check --dry-run`, and tell the user they were not sent',
          ask: 'Stop and wait until the user provides a key before writing anything',
          skip: 'Write the questions and report them as passing',
        },
        expect: 'dry',
      },
    },
    async (u) => {
      const config = skillProject();
      const questions = collected(question('get-ok'), question('post-retry', { options: { retry: 'Retry it', stop: 'Do not retry it' }, expect: 'stop' }));
      // A dry run asks nothing, and checks that every question fits.
      const { model, calls } = stub(() => new Error('must not be called'));
      const report = await runAll(config, model, questions, { dryRun: true });
      expect(calls).toHaveLength(0);
      expect(report).toMatchObject({ ok: true, dryRun: true });
      const small = stub(() => ({}), { perQuestionTokens: 50, perRequestTokens: 64_000 });
      expect((await runAll(config, small.model, questions, { dryRun: true })).ok).toBe(false);
      u.example('sh', 'npx skillunit check --dry-run');
    },
  );

  unit('which-command', {
    when: 'the agent has changed a skill, its questions or the code it describes, and wants to know if the skill still holds.',
    decide: 'which layer to run.',
    paths: [
      { path: 'proof', when: 'the code changed, or its tests did: `npx skillunit proof`, which runs the tests and names each unit the change moved.' },
      { path: 'test', when: 'what a unit says changed, or its questions did: `npx skillunit test`, or `npx skillunit test --changed` for only the questions about the files those changes touch.' },
      { path: 'check', when: 'before handing the work over: `npx skillunit check`, both layers in one run.' },
    ],
    evenWhen: 'only one file changed; `check` is what CI runs, so it is the last command before handing over.',
    ask: [
      {
        id: 'code-changed',
        scenario: 'The agent renamed a function in the library the skill describes, and changed nothing in the skill.',
        question: 'Which command shows the units that may now be out of date?',
        options: {
          proof: '`npx skillunit proof`, which runs the tests',
          test: '`npx skillunit test`',
          nothing: 'Nothing: the skill did not change, so it still holds',
        },
        expect: 'proof',
      },
      {
        id: 'before-handing-over',
        scenario: 'The agent has finished changing a skill and its questions and is about to tell the user the work is done.',
        question: 'What should it run last?',
        options: {
          check: '`npx skillunit check`',
          test: '`npx skillunit test` only',
          nothing: 'Nothing more, since each file was checked while it was written',
        },
        expect: 'check',
      },
    ],
  });

  ask('which-model', {
    scenario: 'The agent is filling in `skillunit.yaml`.',
    question: 'Which value, exactly as written, should the agent set for the model name?',
    options: {
      latest: `\`${PROVIDERS.typesafe.defaultModel}\``,
      pinned: '`jev-1.13.0`',
    },
    expect: 'none',
  });
});

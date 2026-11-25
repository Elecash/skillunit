// The units of skills-src/skillunit/SKILL.md that no test proves, and the questions about that
// file. `skillunit proof` puts each unit where the source has `{{unit:<id>}}`. See docs/proof.md.
import { PROVIDERS } from '../models/index.js';
import { ask, unit } from '../vitest.js';

unit('init-first', {
  when: 'a project has a skill but no `skillunit.yaml`.',
  do: 'run `npx skillunit init <skill folder>` from the project root, then set `context` in the new `skillunit.yaml` to one sentence about what the skill is for.',
  examples: [
    { lang: 'sh', text: 'npx skillunit init skills/my-skill' },
  ],
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
});

unit('which-command', {
  when: 'the agent has changed a skill, its questions or the code it describes, and wants to know if the skill still holds.',
  decide: 'which layer to run.',
  paths: [
    { path: 'lint', when: 'the skill\'s files changed: `npx skillunit lint`.' },
    { path: 'proof', when: 'the code changed, or its tests did: `npx skillunit proof`, which runs the tests and names each unit the change moved.' },
    { path: 'test', when: 'what a unit says changed, or its questions did: `npx skillunit test`, or `npx skillunit test --changed` for only the questions about the files those changes touch.' },
    { path: 'check', when: 'before handing the work over: `npx skillunit check`, every layer in one run.' },
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
        'lint-only': '`npx skillunit lint`, and nothing else',
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
  file: 'SKILL.md',
  scenario: 'The agent is filling in `skillunit.yaml`.',
  question: 'Which value, exactly as written, should the agent set for the model name?',
  options: {
    latest: `\`${PROVIDERS.typesafe.defaultModel}\``,
    pinned: '`jev-1.13.0`',
  },
  expect: 'none',
});

// The units of skills-src/skillunit/testing/proof.md that no test proves, and the questions about that
// file. `skillunit proof` puts each unit where the source has `{{unit:<id>}}`. See docs/proof.md.
import { unit } from '../vitest.js';

unit('declare-in-the-test-that-checks-it', {
  when: 'a unit states what the code does: a default, which inputs it takes, what it returns or throws.',
  do: 'declare the unit with `unit()` around the test that asserts what it states, put `{{unit:<id>}}` in the source where the unit goes, run `npx skillunit proof --write`, and commit the test, the source and the built skill together.',
  evenWhen: 'a test on the same topic already exists; wrap it only if it asserts what the unit says. A unit no test can check, such as advice, is declared with `unit()` and no body.',
  examples: [
    { lang: 'md', text: '```ts\nunit("retry-defaults", { when: "a request sets no `retry`.", value: `\\`retry\\` is ${DEFAULT_RETRY}.` }, async () => {\n  expect(calls).toHaveLength(DEFAULT_RETRY + 1);\n});\n```' },
  ],
  ask: [
    {
      id: 'declare-in-the-test',
      scenario: 'The skill says requests time out after 10 seconds by default, and the project has a test that asserts the default timeout.',
      question: 'How should the agent tie the unit to that test?',
      options: {
        unit: 'Declare the unit with `unit()` around that test, and put `{{unit:<id>}}` in the source',
        comment: 'Name the test file in a sentence of the unit',
        both: `Keep the unit in the source and copy its sentence into the test's title`,
      },
      expect: 'unit',
    },
    {
      id: 'advice-unit',
      scenario: 'A unit advises using one client per API. No test of the library can check that, and the project has a test of how a client is created.',
      question: 'Where should the agent write the unit?',
      options: {
        'no-body': 'In a `unit()` with no body',
        'client-test': 'In a `unit()` around the test of how a client is created',
        source: 'In the source, as a `### rule:` heading',
      },
      expect: 'no-body',
    },
  ],
});

unit('build-the-sentence-from-the-code', {
  when: 'a unit in a test states a value that defines behaviour, such as a default, a limit or how a wait grows.',
  do: 'give the value a name in the code, such as `export const RETRY_TIMES = 2`; use that name in the code and in the assertion of the test, build the sentence from it in a template string, such as `${RETRY_TIMES}x the one before`, and list it in `values`. Type no number into the sentence, and no word that stands for one, such as "doubled", "twice" or "half".',
  evenWhen: 'the code has the value only as a literal, such as `retryDelay * 2 ** n`: give it a name in the code first, then write the unit. `unit()` fails a unit with a body whose text has a number none of its `values` is.',
  ask: [
    {
      id: 'value-from-the-code',
      scenario: 'The agent declares the fact `default-timeout` in a test. The code exports `DEFAULT_TIMEOUT = 10_000`.',
      question: 'How should the agent write the value of the fact?',
      options: {
        built: '`${DEFAULT_TIMEOUT / 1000} seconds`, built from the constant',
        literal: '`10 seconds`, typed into the sentence',
      },
      expect: 'built',
    },
    {
      id: 'literal-in-the-code',
      scenario: 'The code waits `retryDelay * 2 ** n` before each new attempt, and the agent declares in a test the fact that says how the wait grows.',
      question: 'How should the agent state how the wait grows?',
      options: {
        name: 'Name the factor in the code, such as `RETRY_TIMES = 2`, use the name in the code and in the assertion, and build the sentence from it',
        word: 'Write "doubled before each next one" in the sentence, and assert the second wait in the body',
        literal: 'Build the sentence with `2x` and assert `2 * DEFAULT_RETRY_DELAY` in the body',
      },
      expect: 'name',
    },
  ],
});

unit('region-or-example', {
  when: 'a unit from a test should show an example, so the example is code that ran.',
  decide: 'where the example comes from.',
  paths: [
    { path: 'region', when: 'the example is code: put it in the body between a `// #region skill:<id>` line and a `// #endregion` line. A path of a decision takes the region `skill:<id>.<path>`.' },
    { path: 'example', when: 'the example is something the body produced, such as an output or a config: pass it to `u.example(lang, text)` in the body.' },
  ],
  ask: {
    id: 'example-is-a-value',
    scenario: `A unit's example is the JSON configuration that a test builds and checks in its body.`,
    question: 'How should the test hand that example to the skill?',
    options: {
      example: 'Pass it to `u.example(\'json\', text)` in the body',
      region: 'Put the JSON between `#region` and `#endregion` comments in the test',
      paste: 'Paste the JSON into the skill by hand after the test passes',
    },
    expect: 'example',
  },
});

unit('edit-the-source-not-the-skill', {
  when: 'the agent changes the text of a skill that `skillunit.yaml` builds from `source`.',
  do: 'edit the file of the source, or the test that declares the unit, then run `npx skillunit proof --write`; never edit the `skill` folder by hand.',
  evenWhen: 'the fix is one word; the next build would undo it, and `npx skillunit proof` fails until then.',
  ask: {
    id: 'edit-the-built-skill',
    scenario: 'The skill is built from `skill-src`. The agent finds a typo in a sentence of `skill/features/retries.md` that comes from the source.',
    question: 'Which file should the agent edit?',
    options: {
      source: 'The file of `skill-src`, then run `npx skillunit proof --write`',
      skill: '`skill/features/retries.md`, where the typo is',
    },
    expect: 'source',
  },
});

unit('rebuild-after-the-code-moved', {
  when: '`npx skillunit proof` reports that a line of the skill is not what the build gives, after a change to the code.',
  do: 'read the line the build gives; when it says what the code now does, run `npx skillunit proof --write` and commit the built skill with the change.',
  evenWhen: 'the tests pass; a sentence built from the code changes without any test failing, and the difference in the skill is the signal.',
  examples: [
    { lang: 'sh', text: 'npx skillunit proof --write' },
  ],
  ask: {
    id: 'default-moved',
    scenario: 'The team raised the default retry delay from 300 to 500 ms on purpose. The tests pass, and `npx skillunit proof` reports that the `Value` of `retry-defaults` says 300 and the build gives 500.',
    question: 'What should the agent do?',
    options: {
      write: 'Run `npx skillunit proof --write` and commit the built skill with the change',
      edit: 'Edit the `Value` in the skill folder to say 500',
      test: 'Change the test so the build gives 300 again',
    },
    expect: 'write',
  },
});

unit('fix-the-unit-when-its-test-fails', {
  when: 'the test of a unit fails after a change to the code.',
  do: 'read the change; when the code is right, correct the assertions of the test. When its sentence or its assertion has the value as a literal, give the value a name in the code and build both from that name, then run `npx skillunit proof` again.',
  evenWhen: 'skipping the test would make the test run pass; the slot then has no unit, and the proof fails on it.',
  ask: {
    id: 'test-fails',
    scenario: 'The team changed what a failed request throws on purpose, and the test that declares `what-a-failed-request-throws` now fails on its assertion.',
    question: 'What should the agent do?',
    options: {
      fix: 'Correct the assertions, build the sentence from a name the code gives the value, and run the proof again',
      skip: 'Skip the test until someone updates the skill',
    },
    expect: 'fix',
  },
});

unit('keep-the-slot-until-the-unit-goes', {
  when: '`npx skillunit proof` reports a `{{unit:<id>}}` that no test left.',
  do: 'bring back the test that declared it; remove the slot only when the unit is no longer meant to be in the skill, or declare the unit with no body when it became advice.',
  evenWhen: 'removing the slot would make the check pass at once; a test that is lost by mistake is what the slot is there to catch.',
  ask: {
    id: 'lost-by-mistake',
    scenario: '`npx skillunit proof` fails: no test left the unit `retry-defaults`, and a refactor in this change deleted its test by mistake. The unit still states the default retry delay.',
    question: 'What should the agent do?',
    options: {
      restore: 'Bring back the test that declares `retry-defaults`',
      remove: 'Remove `{{unit:retry-defaults}}` from the source',
    },
    expect: 'restore',
  },
});

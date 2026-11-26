// The file `testing/proof.md` of the skill: its `setup()`, then its units in the order the file shows them.
import { setup, unit } from 'skillunit/vitest';
import { describe } from 'vitest';

setup('testing-proof', {
  file: 'testing/proof.md',
  title: 'SkillUnit — building the skill',
  when: 'Build the skill with `proof --write`, and act on what proof reports',
  description: 'How the skill folder follows the tests, and what to do when the proof fails.',
});

describe('testing/proof.md', () => {
  unit('edit-the-test-not-the-skill', {
    when: 'the agent changes the text of a skill that SkillUnit builds.',
    do: 'edit the test that declares the unit, or the `setup()` of its file, then run `npx skillunit proof --write`; never edit the skill folder by hand.',
    evenWhen: 'the fix is one word; the next build undoes it, and `npx skillunit proof` fails until then.',
    ask: {
      id: 'edit-the-built-skill',
      scenario: 'The agent finds a typo in a sentence of `skill/features/retries.md`, a file SkillUnit builds from the tests.',
      question: 'Which file should the agent edit?',
      options: {
        test: 'The test that declares the unit, then run `npx skillunit proof --write`',
        skill: '`skill/features/retries.md`, where the typo is',
      },
      expect: 'test',
    },
  });

  unit('rebuild-after-the-code-moved', {
    when: '`npx skillunit proof` reports that a line of the skill is not what the build gives, after a change to the code.',
    do: 'read the line the build gives; when it says what the code now does, run `npx skillunit proof --write` and commit the built skill with the change.',
    evenWhen: 'the tests pass; a sentence built from the code changes without any test failing, and the difference in the skill is the signal.',
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
    evenWhen: 'skipping the test would make the test run pass; the skill would then have a unit no test declares, and the proof fails on it.',
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

  unit('keep-the-unit-until-it-is-meant-to-go', {
    when: '`npx skillunit proof` reports a unit the skill has and no test declares.',
    do: 'bring back the test that declared it; run `npx skillunit proof --write` to take the unit out only when it is no longer meant to be in the skill, and declare it with no body when it became advice.',
    evenWhen: '`--write` would make the proof pass at once; it would also delete a unit whose test was lost by mistake, which is what the report is there to catch.',
    ask: {
      id: 'lost-by-mistake',
      scenario: '`npx skillunit proof` reports that the skill has the unit `retry-defaults` and no test declares it. A refactor in this change deleted its test by mistake.',
      question: 'What should the agent do?',
      options: {
        restore: 'Bring back the test that declares `retry-defaults`',
        write: 'Run `npx skillunit proof --write` to take the unit out of the skill',
      },
      expect: 'restore',
    },
  });
});

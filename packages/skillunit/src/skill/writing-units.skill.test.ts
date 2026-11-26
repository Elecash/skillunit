// The file `writing/units.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:writing-units` is the code under its description; see docs/proof.md.
// #region skill:writing-units
import { unit } from 'skillunit/vitest';
import { expect } from 'vitest';
import { DEFAULT_RETRY_DELAY, RETRY_TIMES, retryWaits } from './retry.js';
// #endregion
import { setup } from 'skillunit/vitest';
import { createUnit } from 'skillunit/unit';
import { describe } from 'vitest';
import { checkSpec, SPEC_KEYS, UNIT_CONTRACT, type UnitRecord } from '../unit/contract.js';
import { and, code, runner } from './helpers.js';

setup('writing-units', {
  file: 'writing/units.md',
  title: 'SkillUnit — units',
  when: 'Write a unit in the test that checks it: its kind, its text and its values',
  description: 'How to declare a unit with `unit()`, and how its text follows the code.',
});

/** Whether `checkSpec` takes the spec, or the start of why it does not. */
const verdict = (spec: object) => {
  try {
    return checkSpec('a-unit', spec);
  } catch (e) {
    return (e as Error).message.replace(/^unit `a-unit`: /, '');
  }
};

describe('writing/units.md', () => {
  unit('pick-a-kind', {
    when: 'the agent turns an instruction of the skill into a unit.',
    decide: 'which kind of unit to write.',
    paths: [
      { path: 'rule', when: 'a constraint on what the agent writes or does: `do`.' },
      { path: 'decision', when: 'the agent chooses between paths that depend on the situation: `paths`, one `{ path, when }` for each, and `decide` for what is chosen.' },
      { path: 'fact', when: 'a value the agent must state exactly, such as a default or a limit: `value`, and `unknown` for what the value does not cover.' },
    ],
    evenWhen: 'a rule seems to need two `do` sentences; that is two rules, or a decision.',
    ask: [
      {
        id: 'default-value',
        scenario: 'The agent writes down that a request waits 10 seconds by default.',
        question: 'Which kind of unit should it write?',
        options: {
          fact: 'A `fact`, with `value` and `unknown`',
          rule: 'A `rule`, with `do`',
          decision: 'A `decision`, with one path',
        },
        expect: 'fact',
      },
      {
        id: 'two-paths',
        scenario: 'The agent writes down that one client is right for many calls to one API, and direct calls for one-off requests.',
        question: 'Which kind of unit should it write?',
        options: {
          decision: 'A `decision`, with one path per case',
          rule: 'One `rule` whose `do` covers both cases',
          fact: 'A `fact`',
        },
        expect: 'decision',
      },
    ],
  });

  unit(
    'spec-keys',
    {
      when: 'the agent writes the spec of a `unit()`.',
      value: `a spec takes ${and(code(SPEC_KEYS))}: \`when\` always, and \`do\` for a rule, \`value\` for a fact, or \`decide\` and \`paths\` for a decision; \`unknown\` goes with a fact, \`evenWhen\` with a rule or a decision, and \`examples\` with a rule or a fact; any other key fails the test that declares the unit.`,
      ask: {
        id: 'two-kinds',
        scenario: 'The agent gives one `unit()` both `do` and `value`.',
        question: 'What happens when its test runs?',
        options: {
          fails: 'The test fails: a unit is of one kind',
          rule: 'The unit becomes a rule, and `value` is left out',
          both: 'The skill shows both sentences',
        },
        expect: 'fails',
      },
    },
    () => {
      const paths = [{ path: 'shared', when: 'x.' }];
      expect(verdict({ do: 'y.' })).toMatch(/`when` is missing/);
      expect([verdict({ when: 'x.', do: 'y.' }), verdict({ when: 'x.', value: 'y.' }), verdict({ when: 'x.', decide: 'y.', paths })]).toEqual(['rule', 'fact', 'decision']);
      expect(verdict({ when: 'x.', do: 'y.', value: 'z.' })).toMatch(/two kinds/);
      expect(verdict({ when: 'x.', value: 'y.', unknown: 'z.' })).toBe('fact');
      expect(verdict({ when: 'x.', do: 'y.', unknown: 'z.' })).toMatch(/`unknown` is for a fact/);
      expect([verdict({ when: 'x.', do: 'y.', evenWhen: 'z.' }), verdict({ when: 'x.', paths, evenWhen: 'z.' })]).toEqual(['rule', 'decision']);
      expect(verdict({ when: 'x.', value: 'y.', evenWhen: 'z.' })).toMatch(/`evenWhen` is for a rule or a decision/);
      const examples = [{ lang: 'sh', text: 'x' }];
      expect([verdict({ when: 'x.', do: 'y.', examples }), verdict({ when: 'x.', value: 'y.', examples })]).toEqual(['rule', 'fact']);
      expect(verdict({ when: 'x.', paths, examples })).toMatch(/`examples` is for a rule or a fact/);
      expect(verdict({ when: 'x.', do: 'y.', description: 'z.' })).toMatch(/unknown key `description`/);
      // Every key of the list is taken, by a kind that has it.
      const ask = { scenario: 's', question: 'q?', expect: 'yes' };
      const takes: Record<string, object> = {
        when: { when: 'x.', do: 'y.' },
        do: { when: 'x.', do: 'y.' },
        value: { when: 'x.', value: 'y.' },
        decide: { when: 'x.', decide: 'y.', paths },
        paths: { when: 'x.', paths },
        unknown: { when: 'x.', value: 'y.', unknown: 'z.' },
        evenWhen: { when: 'x.', do: 'y.', evenWhen: 'z.' },
        values: { when: 'x.', do: 'y.', values: { n: 'one' } },
        ask: { when: 'x.', do: 'y.', ask },
        examples: { when: 'x.', do: 'y.', examples },
      };
      expect(Object.keys(takes)).toEqual([...SPEC_KEYS]);
      for (const spec of Object.values(takes)) expect(['rule', 'fact', 'decision']).toContain(verdict(spec));
    },
  );

  unit('id-names-the-instruction', {
    when: 'the agent names a unit.',
    do: 'use a kebab-case id that names the instruction, such as `retry-idempotent-only`, unique across the units and the `setup()` of the skill.',
  });

  unit('declare-in-the-test-that-checks-it', {
    when: 'a unit states what the code does: a default, which inputs it takes, what it returns or throws.',
    do: 'declare the unit with `unit()` around the test that asserts what it states, in the test file of its file of the skill, run `npx skillunit proof --write`, and commit the test and the built skill together.',
    evenWhen: 'a test on the same topic already exists; wrap it only if it asserts what the unit says.',
    ask: {
      id: 'declare-in-the-test',
      scenario: 'The skill says requests time out after 10 seconds by default, and the project has a test that asserts the default timeout.',
      question: 'How should the agent tie the unit to that test?',
      options: {
        unit: 'Declare the unit with `unit()` around that test',
        comment: 'Name the test file in a sentence of the unit',
        both: 'Declare the unit with no body, and copy its sentence into the title of the test',
      },
      expect: 'unit',
    },
  });

  unit(
    'build-the-sentence-from-the-code',
    {
      when: 'a unit in a test states a value that defines behaviour, such as a default, a limit or how a wait grows.',
      do: 'give the value a name in the code, such as `RETRY_TIMES`; use that name in the code and in the assertion of the test, build the sentence from it in a template string, and list it in `values`. Type no number into the sentence, and no word that stands for one, such as "doubled", "twice" or "half".',
      evenWhen: 'the code has the value only as a literal in an expression: give it a name in the code first, then write the unit. `unit()` fails a unit with a body when its text has a number that none of its `values` is.',
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
    },
    async () => {
      const { unit, records, run } = runner();
      // #region skill:build-the-sentence-from-the-code
      unit(
        'retry-delay',
        {
          when: 'a request sets `retry` and no `retryDelay`.',
          value: `the first new attempt waits ${DEFAULT_RETRY_DELAY} ms, and each next wait is ${RETRY_TIMES}x the one before.`,
          values: { delay: DEFAULT_RETRY_DELAY, times: RETRY_TIMES },
        },
        () => {
          expect(retryWaits(2)).toEqual([DEFAULT_RETRY_DELAY, RETRY_TIMES * DEFAULT_RETRY_DELAY]);
        },
      );
      // #endregion
      expect(await run()).toEqual(['ok']);
      expect((records[0] as UnitRecord & { value: string }).value).toBe(`the first new attempt waits ${DEFAULT_RETRY_DELAY} ms, and each next wait is ${RETRY_TIMES}x the one before.`);
      // The same sentence with the numbers typed in, and no `values`, fails its test.
      unit('retry-delay-typed', { when: 'a request sets `retry`.', value: `the first new attempt waits ${DEFAULT_RETRY_DELAY} ms.` }, () => expect(true).toBe(true));
      expect(await run()).toEqual([expect.stringMatching(new RegExp(`the number ${DEFAULT_RETRY_DELAY} in \`Value\` is none of the unit's \`values\``))]);
    },
  );

  unit('unit-without-a-body', {
    when: 'what a unit says is advice that no test of the code can check, such as how to name things or when to ask the user.',
    do: 'declare it with `unit()` and no body, and give it a question in `ask`, which is all that checks it; keep such units the exception, since a unit that states what the code does has a test.',
    evenWhen: 'a test would be hard to write; a unit with no body can stop being true without any test failing.',
    ask: [
      {
        id: 'advice-unit',
        scenario: 'A unit advises using one client per API. No test of the library can check that, and the project has a test of how a client is created.',
        question: 'Where should the agent declare the unit?',
        options: {
          'no-body': 'In a `unit()` with no body',
          'client-test': 'In a `unit()` around the test of how a client is created',
          description: 'In the `description` of the file',
        },
        expect: 'no-body',
      },
      {
        id: 'state-with-a-test',
        scenario: 'A unit says that a request times out after a default wait. A test of it needs fake timers, which the agent finds slow to write.',
        question: 'How should the agent declare the unit?',
        options: {
          test: 'Around a test that asserts the default, written with fake timers',
          'no-body': 'With no body, since the test is slow to write',
        },
        expect: 'test',
      },
    ],
  });

  unit(
    'other-test-runners',
    {
      when: 'the project tests its code with a runner other than Vitest.',
      value: `declare the files, units and questions with \`createUnit\` from \`skillunit/unit\`, given the runner's \`it\`, or have the tests write their records, at version ${UNIT_CONTRACT} of the contract.`,
      values: { contract: UNIT_CONTRACT },
    },
    async () => {
      const records: UnitRecord[] = [];
      const tests: (() => unknown)[] = [];
      const it = Object.assign((_: string, fn: () => unknown) => void tests.push(fn), { skip: () => {}, only: () => {} });
      const declared = createUnit(it as never, { write: (r) => void records.push(r) });
      declared.unit('a-rule', { when: 'x.', do: 'y.' });
      for (const t of tests) await t();
      expect(records).toMatchObject([{ skillunit: UNIT_CONTRACT, status: 'passed', id: 'a-rule', kind: 'rule' }]);
    },
  );
});

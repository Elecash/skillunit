// The file `writing/files.md` of the skill: its `setup()`, then its units in the order the file shows them.
import { setup, unit } from 'skillunit/vitest';
import { describe, expect } from 'vitest';
import { buildFromRecords } from '../build/from-records.js';
import type { ReadFile, ReadUnit } from '../build/records.js';
import type { Region } from '../proof/regions.js';
import { UNIT_CONTRACT } from '../unit/contract.js';
import { runner } from './helpers.js';

setup('writing-files', {
  file: 'writing/files.md',
  title: 'SkillUnit — the files of a skill',
  when: 'Split a skill into files, and declare each one with `setup()`',
  description: 'How a skill is split into files, and how its tests declare each one.',
});

/** The record a `setup()` leaves, as the build reads it. */
const fileRecord = (id: string, line: number, spec: Record<string, unknown>) =>
  ({ skillunit: UNIT_CONTRACT, status: 'passed', kind: 'file', id, file: `tests/${id}.skill.test.ts`, line, test: `file ${id}`, path: `/records/${id}.json`, abs: `/project/tests/${id}.skill.test.ts`, ...spec }) as unknown as ReadFile;

describe('writing/files.md', () => {
  unit(
    'declare-each-file-with-setup',
    {
      when: 'the agent adds a file to a skill, or starts the tests of one.',
      do: 'declare the file with one `setup()` at the top of its test file, before its units: `file` is its path in the skill folder, `title`, `when` and `description` are one line each, and `SKILL.md` takes `frontmatter` in place of `when`.',
      evenWhen: 'the file has no unit yet; the build writes only the files a `setup()` declares.',
      ask: {
        id: 'new-file',
        scenario: 'The agent adds `features/i18n.md` to a skill that SkillUnit builds from its tests.',
        question: 'What must it write first?',
        options: {
          setup: 'A `setup()` for `features/i18n.md` at the top of a test file of its own',
          markdown: 'The file `features/i18n.md` in the skill folder, by hand',
          index: 'A row for it in the "Where to look" table of `SKILL.md`',
        },
        expect: 'setup',
      },
    },
    async () => {
      const { setup, records, run } = runner();
      // #region skill:declare-each-file-with-setup
      setup('retries', {
        file: 'features/retries.md',
        title: 'tinyfetch — retries',
        when: 'Retry a request that failed',
        description: 'Which failed requests tinyfetch repeats, and how long it waits between attempts.',
      });
      // #endregion
      setup('tinyfetch', { file: 'SKILL.md', title: 'tinyfetch', description: 'A small HTTP client.', frontmatter: { name: 'tinyfetch', description: 'Make HTTP requests with tinyfetch.' } });
      setup('clients', { file: 'features/clients.md', title: 'tinyfetch — clients', description: 'How a client is made.' } as never);
      expect(await run()).toEqual(['ok', 'ok', expect.stringMatching(/`when`/)]);
      expect(records.map((r) => [r.kind, r.status, 'skillFile' in r ? r.skillFile : undefined])).toEqual([
        ['file', 'passed', 'features/retries.md'],
        ['file', 'passed', 'SKILL.md'],
        ['file', 'failed', undefined],
      ]);
      // The build writes the files the records declare, and no other.
      const declared = records.filter((r) => r.status === 'passed').map((r, i) => fileRecord(r.id, i + 1, r as never));
      expect(buildFromRecords({ units: [], files: declared, regions: new Map() }).files.map((f) => f.file)).toEqual(['features/retries.md', 'SKILL.md']);
    },
  );

  unit(
    'what-setup-writes',
    {
      when: 'the agent fills in the keys of a `setup()`.',
      value:
        '`title` is the heading of the file, `description` the line under it, and the region `skill:<setup id>` of its test file the code under that line; `when` is the row of the file in the "Where to look" table of `SKILL.md`, which lists every other file; `frontmatter` is the `name` and `description` an agent reads to pick the skill.',
      ask: {
        id: 'when-of-a-file',
        scenario: 'The agent writes `when` in the `setup()` of `features/retries.md`.',
        question: 'Where does an agent read that text?',
        options: {
          index: 'In the row of `features/retries.md` in the "Where to look" table of `SKILL.md`',
          heading: 'As the heading of `features/retries.md`',
          rules: 'Before each unit of `features/retries.md`',
        },
        expect: 'index',
      },
    },
    () => {
      const files = [
        fileRecord('tinyfetch', 3, { skillFile: 'SKILL.md', title: 'tinyfetch', description: 'A small HTTP client.', frontmatter: { name: 'tinyfetch', description: 'Make HTTP requests with tinyfetch.' } }),
        fileRecord('retries', 4, { skillFile: 'features/retries.md', title: 'tinyfetch — retries', when: 'Retry a request that failed', description: 'Which failed requests tinyfetch repeats.' }),
      ];
      const region: Region = { id: 'retries', file: '/project/tests/retries.skill.test.ts', line: 2, endLine: 4, code: "import { tf } from 'tinyfetch';" };
      const unitRecord = { skillunit: UNIT_CONTRACT, status: 'passed', id: 'retry-get', kind: 'rule', file: 'tests/retries.skill.test.ts', line: 9, test: 'rule retry-get', when: 'x.', do: 'y.', examples: [], setup: 'retries', order: 0, path: '/r/u.json', abs: '/project/tests/retries.skill.test.ts' } as unknown as ReadUnit;
      const build = buildFromRecords({ units: [unitRecord], files, regions: new Map([['retries', region]]) });
      expect(build.problems).toEqual([]);
      const text = (f: string) => build.files.find((x) => x.file === f)!.text.split('\n');
      const index = text('SKILL.md');
      expect(index.slice(0, 4)).toEqual(['---', 'name: tinyfetch', 'description: Make HTTP requests with tinyfetch.', '---']);
      expect(index).toContain('| Retry a request that failed | [features/retries.md](features/retries.md) |');
      // The index lists the other files, and not itself.
      expect(index.filter((l) => l.startsWith('| ') && l.includes('.md'))).toHaveLength(1);
      expect(text('features/retries.md').slice(0, 9)).toEqual(['# tinyfetch — retries', '', 'Which failed requests tinyfetch repeats.', '', '```ts', "import { tf } from 'tinyfetch';", '```', '', '## Rules']);
    },
  );

  unit('one-test-file-per-skill-file', {
    when: 'the agent decides where the `setup()` and the units of a file of the skill go.',
    do: 'put them in one test file of their own, named after the file of the skill, such as `retries.skill.test.ts` for `features/retries.md`.',
    evenWhen: 'the test that checks a unit is in another file; move that test into this file with its unit, and the fixtures it needs into a module both files import.',
    ask: {
      id: 'test-elsewhere',
      scenario: 'The unit `retry-defaults` belongs to `features/retries.md`, and the test that checks it is in `client.test.ts`, which tests other things too.',
      question: 'Where should the agent declare the unit?',
      options: {
        move: 'Move that test into the test file of `features/retries.md`, and declare the unit around it there',
        here: 'Declare it in `client.test.ts`, around the test',
        copy: 'Declare it with no body in the test file of `features/retries.md`',
      },
      expect: 'move',
    },
  });

  unit('behaviour-in-a-unit', {
    when: 'the agent writes the `description` of a file, or wants to say what the code does outside a unit.',
    do: 'keep the `description` to what the file covers; write each sentence about what the code does, and each instruction, as a unit with a test, and an exception to a rule under its `evenWhen`.',
    evenWhen: 'the sentence fits on the line; no test checks the text of a `setup()`, so a sentence there stops being true without failing anything.',
    ask: [
      {
        id: 'behaviour-in-description',
        scenario: 'The agent writes the `description` of `features/timeouts.md`, and wants it to say how long a request waits by default.',
        question: 'Where should that sentence go?',
        options: {
          unit: 'In a fact declared around the test that asserts the default',
          description: 'In the `description`, since that is what the file is about',
        },
        expect: 'unit',
      },
      {
        id: 'exception-placement',
        scenario: 'A unit says to keep the default timeout. Uploads are the exception, and the agent is adding that to the skill.',
        question: 'Where should the exception go?',
        options: {
          inside: 'In the unit, under `evenWhen`',
          description: 'In the `description` of the file',
          comment: 'In a comment next to the `setup()` of the file',
        },
        expect: 'inside',
      },
    ],
  });
});

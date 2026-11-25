import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ReadQuestion, ReadUnit } from '../build/records.js';
import { collectQuestions } from './questions.js';

const skill = mkdtempSync(join(tmpdir(), 'skillunit-questions-'));
afterAll(() => rmSync(skill, { recursive: true, force: true }));
mkdirSync(join(skill, 'features'));
for (const f of ['SKILL.md', 'features/retries.md', 'features/timeouts.md']) writeFileSync(join(skill, f), `# ${f}\n`);

const ask = { scenario: 'A request times out.', question: 'How long did it wait?', options: ['ten', 'thirty'], expect: 'ten' };
const unit = (id: string, line: number, more: Record<string, unknown> = {}): ReadUnit =>
  ({ skillunit: 1, status: 'passed', id, kind: 'fact', file: 'src/a.skill.test.ts', line, test: `fact ${id}`, when: 'x.', value: 'y.', examples: [], path: `/p/${id}.json`, abs: '/project/src/a.skill.test.ts', ...more }) as ReadUnit;
const question = (id: string, line: number, more: Record<string, unknown> = {}): ReadQuestion =>
  ({ skillunit: 1, status: 'passed', kind: 'question', id, file: 'src/b.skill.test.ts', line, test: `question ${id}`, skillFile: 'SKILL.md', ask: [{ id, ...ask }], path: `/p/${id}.json`, abs: '/project/src/b.skill.test.ts', ...more }) as ReadQuestion;
const inSkill = [
  { id: 'default-timeout', file: 'features/timeouts.md' },
  { id: 'retry-defaults', file: 'features/retries.md' },
];

describe('collectQuestions', () => {
  it('asks the questions of a unit about the file that holds it, and those of `ask()` about the file they name', () => {
    const units = [unit('default-timeout', 10, { ask: [{ id: 'default-timeout', ...ask, section: 'Defaults' }, { id: 'default-timeout.2', ...ask, with: 'features/retries.md' }] })];
    const { questions, problems } = collectQuestions(units, [question('which-file', 3, { skillFile: 'features/retries.md' })], skill, inSkill);
    expect(problems).toEqual([]);
    expect(questions.map((q) => [q.id, q.unit, q.file, q.sections, q.withFiles, q.declared.line])).toEqual([
      ['default-timeout', 'default-timeout', 'features/timeouts.md', ['Defaults'], [], 10],
      ['default-timeout.2', 'default-timeout', 'features/timeouts.md', [], ['features/retries.md'], 10],
      ['which-file', undefined, 'features/retries.md', [], [], 3],
    ]);
    expect(questions[0]).toMatchObject({ scenarios: ['A request times out.'], options: { ten: null, thirty: null }, expect: 'ten', declared: { file: '/project/src/a.skill.test.ts', line: 10 } });
  });

  it('fills the default ids of a record that a helper in another language wrote as it was given', () => {
    const units = [unit('default-timeout', 10, { ask: [ask, { ...ask, scenario: ['One.', 'Two.'] }] })];
    const { questions } = collectQuestions(units, [], skill, inSkill);
    expect(questions.map((q) => [q.id, q.scenarios])).toEqual([
      ['default-timeout', ['A request times out.']],
      ['default-timeout.2', ['One.', 'Two.']],
    ]);
  });

  it('a unit with no questions, and a failed record, add nothing', () => {
    const failed = { skillunit: 1, status: 'failed', id: 'retry-defaults', file: 'src/a.skill.test.ts', line: 4, test: 't', error: 'boom', path: '/p/x.json', abs: '/project/src/a.skill.test.ts' } as ReadUnit;
    expect(collectQuestions([unit('default-timeout', 10), failed], [], skill, inSkill)).toEqual({ questions: [], problems: [] });
  });

  it('a question whose unit the skill folder does not have: a problem where it is declared', () => {
    const { questions, problems } = collectQuestions([unit('connect-timeout', 12, { ask })], [], skill, inSkill);
    expect(questions).toEqual([]);
    expect(problems).toEqual([
      { id: 'connect-timeout', unit: 'connect-timeout', declared: { file: '/project/src/a.skill.test.ts', line: 12 }, message: 'the skill folder has no unit `connect-timeout`, which this question is about: build it with `skillunit proof --write`' },
    ]);
  });

  it('a question of `ask()` about a file the skill folder does not have', () => {
    const { problems } = collectQuestions([], [question('which-file', 3, { skillFile: 'features/gone.md' })], skill, inSkill);
    expect(problems.map((p) => p.message)).toEqual(['the question `which-file` is about features/gone.md, which is not a file in the skill folder']);
  });

  it('an id two test files give: the second is a problem that names the first', () => {
    const units = [unit('default-timeout', 10, { ask: { ...ask, id: 'which-file' } })];
    const { questions, problems } = collectQuestions(units, [question('which-file', 3)], skill, inSkill);
    expect(questions.map((q) => q.declared.file)).toEqual(['/project/src/a.skill.test.ts']);
    expect(problems).toEqual([{ id: 'which-file', declared: { file: '/project/src/b.skill.test.ts', line: 3 }, message: 'the question `which-file` is also declared at /project/src/a.skill.test.ts:10; give one of them another `id`' }]);
  });

  it('a path outside the skill folder, in a record that was not checked when it was read: a problem where it is declared', () => {
    const units = [unit('retry-defaults', 5, { ask: { ...ask, with: '../README.md' } })];
    const { questions, problems } = collectQuestions(units, [question('which-file', 3, { skillFile: '../README.md' })], skill, inSkill);
    expect(questions).toEqual([]);
    expect(problems).toEqual([
      { id: 'retry-defaults', unit: 'retry-defaults', declared: { file: '/project/src/a.skill.test.ts', line: 5 }, message: 'unit `retry-defaults`: the question `retry-defaults`: `with` lists ../README.md, which is outside the skill folder; the model reads only files of the skill' },
      { id: 'which-file', declared: { file: '/project/src/b.skill.test.ts', line: 3 }, message: 'the question `which-file` is about ../README.md, which is outside the skill folder' },
    ]);
  });

  it('`with` that lists the file the question of a unit is about', () => {
    const { problems } = collectQuestions([unit('retry-defaults', 5, { ask: { ...ask, with: ['./features/retries.md'] } })], [], skill, inSkill);
    expect(problems.map((p) => p.message)).toEqual(['`with` lists features/retries.md, the file the question is about; remove it']);
  });
});

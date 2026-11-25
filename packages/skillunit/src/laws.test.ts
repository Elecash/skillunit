/**
 * Laws the core of SkillUnit obeys. Each says what holds for every input of a kind, and is checked
 * here on every case of a small grid of them. They were first stated in a model of the code written
 * in Lean, which is not in the repository, where a search found a counter-example to each; these
 * tests are where the laws live now.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildSkill } from './build/build.js';
import { checkRecord, type ReadQuestion, type ReadUnit } from './build/records.js';
import { DEFAULT_THRESHOLDS, loadConfig, type Thresholds } from './config.js';
import type { DecisionModel, DecisionRequest } from './models/types.js';
import { collectQuestions, type TestCase } from './test/questions.js';
import { judge, read } from './test/reader.js';

const root = mkdtempSync(join(tmpdir(), 'skillunit-laws-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const grid = (step: number) => Array.from({ length: Math.round(1 / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100);

/** The thresholds a `skillunit.yaml` may hold, or undefined when it is refused. */
function accepted(thresholds: Partial<Thresholds>): Thresholds | undefined {
  const path = join(root, 'skillunit.yaml');
  writeFileSync(path, `thresholds: ${JSON.stringify(thresholds)}\n`);
  try {
    return loadConfig(path).thresholds;
  } catch {
    return undefined;
  }
}

const choice: TestCase = { id: 'q', scenarios: ['A situation.'], question: 'What now?', options: { a: null, b: null }, expect: 'a' };
const yesNo = (expect: 'yes' | 'no'): TestCase => ({ id: 'q', scenarios: ['A situation.'], question: 'Should it?', expect });

describe('law 1: a verdict does not depend on the order the provider lists the options in', () => {
  it('a tie for the top is not an answer, in either order', () => {
    const first = judge(choice, { probabilities: { a: 0.5, b: 0.5 } }, DEFAULT_THRESHOLDS);
    const second = judge(choice, { probabilities: { b: 0.5, a: 0.5 } }, DEFAULT_THRESHOLDS);
    expect(first).toEqual(second);
    expect(first).toMatchObject({ pass: false, weak: false, answer: 'a', tied: ['a', 'b'] });
    // The expected option is not one of the tied: they are named in the order the question lists them.
    expect(judge(choice, { probabilities: { none: 0.4, b: 0.4, a: 0.2 } }, DEFAULT_THRESHOLDS)).toMatchObject({ pass: false, answer: 'b', tied: ['b', 'none'] });
  });

  it('holds for every pair and triple of probabilities on a grid', () => {
    for (const p of grid(0.05)) {
      for (const q of grid(0.05).filter((q) => p + q <= 1)) {
        const none = Math.round((1 - p - q) * 100) / 100;
        const forward = judge(choice, { probabilities: { a: p, b: q, none } }, DEFAULT_THRESHOLDS);
        const backward = judge(choice, { probabilities: { none, b: q, a: p } }, DEFAULT_THRESHOLDS);
        expect([p, q, forward]).toEqual([p, q, backward]);
      }
    }
  });
});

describe('laws 2 and 3: a yes/no question passes only on the answer it expects', () => {
  it('whatever thresholds the settings accept, a pass was answered with what the question expects', () => {
    for (const yes of grid(0.1)) {
      for (const no of grid(0.1)) {
        const th = accepted({ yes, no });
        if (!th) continue;
        for (const p of grid(0.1)) {
          for (const expect of ['yes', 'no'] as const) {
            const v = judge(yesNo(expect), { probabilities: { yes: p, no: 1 - p } }, th);
            if (v.pass) expect_(v.answer, expect, { yes, no, p });
          }
          const both = judge(yesNo('yes'), { probabilities: { yes: p } }, th).pass && judge(yesNo('no'), { probabilities: { yes: p } }, th).pass;
          expect([yes, no, p, both]).toEqual([yes, no, p, false]);
        }
      }
    }
  });

  it('the settings say which side of one half each threshold is on', () => {
    expect(accepted({ yes: 0.7, no: 0.3 })).toBeDefined();
    expect(accepted({ yes: 0.5, no: 0.49 })).toBeDefined();
    expect(accepted({ yes: 0.4 })).toBeUndefined();
    expect(accepted({ no: 0.5 })).toBeUndefined();
    const path = join(root, 'skillunit.yaml');
    writeFileSync(path, 'thresholds: { yes: 0.3, no: 0.7 }\n');
    expect(() => loadConfig(path)).toThrow(/thresholds\.yes must be 0\.5 or more/);
  });
});

function expect_(answer: string, expected: string, at: unknown): void {
  expect([at, answer]).toEqual([at, expected]);
}

describe('law 4: with several phrasings a question passes exactly when most of them pass', () => {
  const three: TestCase = { ...choice, scenarios: ['One.', 'Two.', 'Three.'] };
  const model = (answers: Record<string, Record<string, number>>): DecisionModel =>
    ({
      id: 'stub',
      limits: { perQuestionTokens: 1e6, perRequestTokens: 1e6 },
      decide: async () => ({ answers: Object.fromEntries(Object.entries(answers).map(([k, probabilities]) => [k, { probabilities }])), usage: { inputTokens: 0, outputTokens: 0 }, model: 'stub' }),
    }) as unknown as DecisionModel;

  it('two phrasings of three pass, so the question passes, also when the failing one ranks between them', async () => {
    const th = { ...DEFAULT_THRESHOLDS, choice: 0.3 };
    const answers = {
      'q#1': { a: 0.35, b: 0.33, none: 0.32 }, // passes: the top, over 0.3
      'q#2': { a: 0.4, b: 0.45, none: 0.15 }, // fails: `b` is the top
      'q#3': { a: 0.6, b: 0.2, none: 0.2 }, // passes
    };
    const { verdicts } = await read(model(answers), {} as DecisionRequest, [three], th);
    expect(verdicts[0]!.pass).toBe(true);
  });

  it('one phrasing of three passes, so the question fails', async () => {
    const th = { ...DEFAULT_THRESHOLDS, choice: 0.3 };
    const answers = {
      'q#1': { a: 0.1, b: 0.8, none: 0.1 },
      'q#2': { a: 0.4, b: 0.45, none: 0.15 },
      'q#3': { a: 0.35, b: 0.33, none: 0.32 },
    };
    const { verdicts } = await read(model(answers), {} as DecisionRequest, [three], th);
    expect(verdicts[0]!.pass).toBe(false);
  });

  it('holds for every pattern of passing phrasings, from one to five', async () => {
    // With `choice: 0.3`, the failing phrasing backs the expected option more than the passing one.
    const th = { ...DEFAULT_THRESHOLDS, choice: 0.3 };
    const passing = { a: 0.35, b: 0.33, none: 0.32 };
    const failing = { a: 0.45, b: 0.5, none: 0.05 };
    for (let n = 1; n <= 5; n++) {
      const test: TestCase = { ...choice, scenarios: Array.from({ length: n }, (_, i) => `Phrasing ${i + 1}.`) };
      for (let mask = 0; mask < 2 ** n; mask++) {
        const passes = Array.from({ length: n }, (_, i) => Boolean(mask & (1 << i)));
        const answers = Object.fromEntries(passes.map((p, i) => [n === 1 ? 'q' : `q#${i + 1}`, p ? passing : failing]));
        const { verdicts } = await read(model(answers), {} as DecisionRequest, [test], th);
        const most = passes.filter(Boolean).length * 2 > n;
        expect([passes, verdicts[0]!.pass]).toEqual([passes, most]);
        if (n > 1) expect(verdicts[0]!.variantsPass).toEqual(passes);
      }
    }
  });
});

/** A record as a helper in another language may write it. */
const record = (value: string, lang: string) => ({
  skillunit: 1,
  status: 'passed',
  id: 'u',
  kind: 'fact',
  file: 'tests/test_u.py',
  line: 3,
  test: 'fact u',
  when: 'the user asks.',
  value: 'ten seconds.',
  values: { n: value },
  examples: [{ lang, text: 'code' }],
});

describe('laws 5 and 6: the built text has one origin per line, and a slot gives one unit', () => {
  const source = join(root, 'source');
  mkdirSync(source);
  writeFileSync(join(source, 'SKILL.md'), ['# Title', '', '| {{value:u.n}} |', '', '{{unit:u}}', '', 'The end.', ''].join('\n'));

  const pool = { values: ['10', 'a\nb'], langs: ['sh', 'a\nb', 'sh\n### rule: injected'] };

  it('holds for every record the reader accepts', () => {
    let acceptedRecords = 0;
    for (const value of pool.values) {
      for (const lang of pool.langs) {
        const raw = record(value, lang);
        if (checkRecord(raw) !== undefined) continue;
        acceptedRecords++;
        const unit = { ...raw, path: '/records/u.json', abs: '/project/tests/test_u.py' } as unknown as ReadUnit;
        const build = buildSkill({ source, records: [unit], regions: new Map(), missingReason: '' });
        const file = build.files.find((f) => f.file === 'SKILL.md')!;
        const lines = file.text!.split('\n');
        expect([value, lang, lines.length]).toEqual([value, lang, file.origins.length]);
        expect([value, lang, lines.filter((l) => l.startsWith('### ')).length]).toEqual([value, lang, 1]);
      }
    }
    expect(acceptedRecords).toBe(1);
  });

  it('a record says why it is refused', () => {
    expect(checkRecord(record('a\nb', 'sh'))).toMatch(/the value `n` has a line break/);
    expect(checkRecord(record('10', 'sh\n### rule: injected'))).toMatch(/fence language/);
  });
});

describe('law 7: whatever the model is sent comes from the skill folder', () => {
  const skill = join(root, 'project', 'skill');
  mkdirSync(skill, { recursive: true });
  writeFileSync(join(skill, 'SKILL.md'), '# Skill\n');
  writeFileSync(join(root, 'project', 'README.md'), '# Outside the skill folder\n');
  writeFileSync(join(root, 'project', '.env'), 'SECRET=1\n');

  const ask = { scenario: 'A request times out.', question: 'How long did it wait?', options: ['ten', 'thirty'], expect: 'ten' };
  const unit = (more: Record<string, unknown>): ReadUnit =>
    ({ skillunit: 1, status: 'passed', id: 'u', kind: 'fact', file: 'src/a.skill.test.ts', line: 1, test: 'fact u', when: 'x.', value: 'y.', examples: [], path: '/p/u.json', abs: '/project/src/a.skill.test.ts', ...more }) as unknown as ReadUnit;
  const question = (skillFile: string): ReadQuestion =>
    ({ skillunit: 1, status: 'passed', kind: 'question', id: 'q', file: 'src/b.skill.test.ts', line: 1, test: 'question q', skillFile, ask: [{ id: 'q', ...ask }], path: '/p/q.json', abs: '/project/src/b.skill.test.ts' }) as unknown as ReadQuestion;

  it('`with` cannot name a file outside the skill folder', () => {
    for (const path of ['../README.md', '../.env', 'features/../../README.md']) {
      const { questions, problems } = collectQuestions([unit({ ask: [{ id: 'u', ...ask, with: path }] })], [], skill, [{ id: 'u', file: 'SKILL.md' }]);
      expect([path, questions.length]).toEqual([path, 0]);
      expect(problems[0]?.message).toMatch(/outside the skill folder/);
    }
  });

  it('`ask()` cannot be about a file outside the skill folder', () => {
    const { questions, problems } = collectQuestions([], [question('../README.md')], skill, []);
    expect(questions).toEqual([]);
    expect(problems[0]?.message).toMatch(/outside the skill folder/);
  });

  it('a path that comes back inside the folder is fine', () => {
    mkdirSync(join(skill, 'features'));
    writeFileSync(join(skill, 'features', 'retries.md'), '# Retries\n');
    const { questions, problems } = collectQuestions([unit({ ask: [{ id: 'u', ...ask, with: 'features/../features/retries.md' }] })], [], skill, [{ id: 'u', file: 'SKILL.md' }]);
    expect(problems).toEqual([]);
    expect(questions).toHaveLength(1);
  });
});

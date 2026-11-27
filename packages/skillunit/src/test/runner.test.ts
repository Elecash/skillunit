import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, type Config } from '../config.js';
import { loadModel, ModelError, PROVIDER_NAMES, PROVIDERS, toTypeSafe, typesafe, type DecisionAnswer, type DecisionModel, type DecisionRequest, type TypeSafeOptions } from '../models/index.js';
import { buildRequest, framing, judge, NONE_DESCRIPTION } from './reader.js';
import { changedSelection, changedSkillFiles } from './changed.js';
import type { Question, TestCase } from './questions.js';
import { runAll } from './runner.js';

/**
 * The only stand-in for a decision model: it answers what a test tells it to, for the cases a
 * real model cannot produce on demand (a value just under a threshold, a missing answer, an error).
 */
function stub(answer: (request: DecisionRequest) => Record<string, DecisionAnswer> | Error, limits: DecisionModel['limits'] = { perQuestionTokens: 32_000, perRequestTokens: 64_000 }) {
  const calls: DecisionRequest[] = [];
  const model: DecisionModel = {
    id: 'stub',
    limits,
    async decide(request) {
      calls.push(request);
      const answers = answer(request);
      if (answers instanceof Error) throw answers;
      return { answers, usage: { inputTokens: 100, outputTokens: 10 }, model: 'stub-1' };
    },
  };
  return { model, calls };
}

const choice: TestCase = { id: 'pick', scenarios: ['A situation.'], question: 'Which one?', options: { a: 'A', b: null }, expect: 'a' };
const yes: TestCase = { id: 'allowed', scenarios: ['A situation.'], question: 'Is it allowed?', expect: 'yes' };
const no: TestCase = { ...yes, expect: 'no' };
const th = DEFAULT_THRESHOLDS;

describe('buildRequest', () => {
  it('adds `none` to every question with options, and sends each phrasing as a question of its own', () => {
    const request = buildRequest('skill text', [{ ...choice, scenarios: ['One.', 'Two.'] }, yes], 'A tiny HTTP client.');
    expect(request.questions.map((q) => q.id)).toEqual(['pick#1', 'pick#2', 'allowed']);
    expect(request.questions[0]).toEqual({
      id: 'pick#1',
      text: 'Situation: One.\nQuestion: Which one?',
      options: [{ id: 'a', description: 'A' }, { id: 'b' }, { id: 'none', description: NONE_DESCRIPTION }],
    });
    expect(request.questions[2]!.options).toBeUndefined();
    expect(request.questions[0]).not.toHaveProperty('instructions');
    expect(request.state).toEqual({ skill: 'skill text' });
    expect(request.instructions).toMatch(/What the skill is about: A tiny HTTP client\.$/);
  });

  it('puts `with` files in the state under references, and says so in the instructions', () => {
    const request = buildRequest('skill text', [yes], undefined, { 'ref.md': 'ref' });
    expect(request.state).toEqual({ skill: 'skill text', references: { 'ref.md': 'ref' } });
    expect(request.instructions).toContain('The `references` in the state');
    expect(request.questions[0]!.instructions).toContain('The `references` in the state');
  });

  it('frames a yes/no question on its own: no `none` to fall back on, and the same probability when the skill is silent', () => {
    const request = buildRequest('skill text', [choice, yes], 'A tiny HTTP client.');
    const yesNo = request.questions.find((q) => q.id === 'allowed')!.instructions!;
    expect(yesNo).toBe(framing('A tiny HTTP client.', false, true));
    expect(yesNo).toContain('If the skill does not settle the question, give yes and no the same probability.');
    expect(yesNo).not.toContain('`none`');
    expect(yesNo).toMatch(/What the skill is about: A tiny HTTP client\.$/);
    expect(request.instructions).toContain('answer `none`');
  });
});

describe('thresholds', () => {
  it('passes a choice at the threshold, and marks it weak just under', () => {
    expect(judge(choice, { probabilities: { a: 0.5, b: 0.3, none: 0.2 } }, th)).toMatchObject({ answer: 'a', confidence: 0.5, pass: true, weak: false });
    expect(judge(choice, { probabilities: { a: 0.4999, b: 0.3, none: 0.2001 } }, th)).toMatchObject({ answer: 'a', pass: false, weak: true });
  });

  it('judges a choice on the probability of the option the model ranks first', () => {
    expect(judge(choice, { probabilities: { a: 0.55, b: 0.45 } }, th)).toMatchObject({ confidence: 0.55, pass: true });
    expect(judge(choice, { probabilities: { a: 0.49, b: 0.3, none: 0.21 } }, th)).toMatchObject({ pass: false, weak: true });
  });

  it('fails a wrong choice without calling it weak, and keeps every probability', () => {
    const v = judge(choice, { probabilities: { a: 0.2, b: 0.7, none: 0.1 } }, th);
    expect(v).toMatchObject({ answer: 'b', expectedProb: 0.2, pass: false, weak: false, probabilities: { a: 0.2, b: 0.7, none: 0.1 } });
  });

  it('passes a yes at 0.7 and a no at 0.3, and fails just past them', () => {
    expect(judge(yes, { probabilities: { yes: 0.7, no: 0.3 } }, th)).toMatchObject({ answer: 'yes', pass: true });
    expect(judge(yes, { probabilities: { yes: 0.69, no: 0.31 } }, th)).toMatchObject({ answer: 'yes', pass: false, weak: true });
    expect(judge(no, { probabilities: { yes: 0.3, no: 0.7 } }, th)).toMatchObject({ answer: 'no', expectedProb: 0.7, pass: true });
    expect(judge(no, { probabilities: { yes: 0.31, no: 0.69 } }, th)).toMatchObject({ answer: 'no', pass: false, weak: true });
    expect(judge(no, { probabilities: { yes: 0.8, no: 0.2 } }, th)).toMatchObject({ answer: 'yes', pass: false, weak: false });
  });

  it('honours other thresholds', () => {
    expect(judge(yes, { probabilities: { yes: 0.75, no: 0.25 } }, { ...th, yes: 0.8 })).toMatchObject({ pass: false });
  });
});

describe('none', () => {
  it('passes a test that expects none when the model picks it, and fails one that does not', () => {
    const silent: TestCase = { ...choice, expect: 'none' };
    expect(judge(silent, { probabilities: { a: 0.1, b: 0.1, none: 0.8 } }, th)).toMatchObject({ answer: 'none', pass: true });
    expect(judge(choice, { probabilities: { a: 0.3, none: 0.7 } }, th)).toMatchObject({ answer: 'none', pass: false, weak: false });
  });
});

describe('missing answers', () => {
  it('fails a test with no answer, an empty answer, or a yes/no answer without yes', () => {
    expect(judge(choice, undefined, th)).toMatchObject({ answer: '(no answer)', pass: false });
    expect(judge(choice, { probabilities: {} }, th)).toMatchObject({ answer: '(no answer)', pass: false });
    expect(judge(yes, { probabilities: { maybe: 1 } }, th)).toMatchObject({ answer: '(no yes/no answer)', pass: false });
  });

  it('fails a refused question with that reason, not as a wrong answer', () => {
    for (const test of [choice, yes]) {
      expect(judge(test, { refused: true }, th)).toMatchObject({ answer: '(refused)', refused: true, pass: false, weak: false, borderline: false });
    }
    expect(judge(choice, { probabilities: { a: 0.9, none: 0.1 } }, th)).not.toHaveProperty('refused');
  });
});

// ---------------------------------------------------------------- runAll on real files

const dir = mkdtempSync(join(tmpdir(), 'skillunit-runner-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function project(): Config {
  const root = mkdtempSync(join(dir, 'p-'));
  writeFileSync(join(root, 'SKILL.md'), '# Skill\n\n## Retries\n\nRetry only GET requests.\n');
  writeFileSync(join(root, 'reference.md'), '# Reference\n\nThe options.\n');
  return { skill: root, model: { provider: 'typesafe' }, thresholds: { ...th } };
}

/** A question as `collectQuestions` gives it: about SKILL.md unless it says. */
const question = (id: string, more: Partial<Question> = {}): Question => ({
  id,
  scenarios: ['s'],
  question: 'q?',
  expect: 'no',
  declared: { file: '/project/src/a.skill.test.ts', line: 10 },
  file: 'SKILL.md',
  sections: [],
  withFiles: [],
  ...more,
});
const collected = (...questions: Question[]) => ({ questions, problems: [] });

const postRetry = question('post-retry', {
  scenarios: ['A POST may be retried.', 'A request that creates a user times out.', 'The user asks to retry a POST.'],
  question: 'What does the skill say?',
  options: { retry: 'Retry it', stop: 'Do not retry it' },
  expect: 'stop',
  sections: ['Retries'],
  unit: 'retry-idempotent-only',
});
const getOk = question('get-ok', { scenarios: ['A GET times out.'], question: 'May the agent retry it?', expect: 'yes', sections: ['Retries'] });

describe('runAll', () => {
  it('sends one request per file and takes the median phrasing', async () => {
    const config = project();
    const { model, calls } = stub(() => ({
      'post-retry#1': { probabilities: { stop: 0.9, retry: 0.05, none: 0.05 } },
      'post-retry#2': { probabilities: { stop: 0.2, retry: 0.7, none: 0.1 } },
      'post-retry#3': { probabilities: { stop: 0.8, retry: 0.1, none: 0.1 } },
      'get-ok': { probabilities: { yes: 0.9, no: 0.1 } },
    }));
    const report = await runAll(config, model, collected(postRetry, getOk));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.state).toEqual({ skill: '## Retries\n\nRetry only GET requests.' });
    expect(report.ok).toBe(true);
    expect(report.requests[0]!.verdicts[0]).toMatchObject({ answer: 'stop', expectedProb: 0.8, variants: [0.9, 0.2, 0.8], unit: 'retry-idempotent-only', declared: { file: '/project/src/a.skill.test.ts', line: 10 } });
    expect(report.requests[0]).toMatchObject({ file: 'SKILL.md', sections: ['Retries'], with: [], model: 'stub-1' });
    expect(report.provider).toBe('stub');
    expect(report.summary).toEqual({ tests: 2, passed: 2, borderline: 0, skipped: 0, leftOut: 0, usage: { input_tokens: 100, output_tokens: 10 } });
  });

  it('asks the questions of two files, or of one file with different `with`, in requests of their own', async () => {
    const config = project();
    const { model, calls } = stub((request) => Object.fromEntries(request.questions.map((q) => [q.id, { probabilities: { yes: 0.1, no: 0.9 } }])));
    const report = await runAll(config, model, collected(question('a'), question('b', { withFiles: ['reference.md'] }), question('c', { file: 'reference.md' }), question('d')));
    expect(calls.map((c) => c.questions.map((q) => q.id))).toEqual([['a', 'd'], ['b'], ['c']]);
    expect(calls[1]!.state).toEqual({ skill: '# Skill\n\n## Retries\n\nRetry only GET requests.', references: { 'reference.md': '# Reference\n\nThe options.' } });
    expect(report.requests.map((r) => [r.file, r.with])).toEqual([['SKILL.md', []], ['SKILL.md', ['reference.md']], ['reference.md', []]]);
    expect(report.ok).toBe(true);
  });

  it('reports a failed request with its questions, and runs the other requests', async () => {
    const config = project();
    const { model, calls } = stub((request) => (request.questions.some((q) => q.id === 't') ? { t: { probabilities: { yes: 0.1, no: 0.9 } } } : new Error('429 rate limited')));
    const report = await runAll(config, model, collected(postRetry, getOk, question('t', { file: 'reference.md' })));
    expect(calls).toHaveLength(2);
    expect(report.ok).toBe(false);
    expect(report.requests.map((r) => r.error ?? 'ran')).toEqual(['429 rate limited', 'ran']);
    expect(report.requests[0]!.questions).toEqual([
      { id: 'post-retry', unit: 'retry-idempotent-only', declared: { file: '/project/src/a.skill.test.ts', line: 10 } },
      { id: 'get-ok', declared: { file: '/project/src/a.skill.test.ts', line: 10 } },
    ]);
    expect(report.summary.passed).toBe(1);
  });

  it('fails on the problems it is given, and on those of the questions', async () => {
    const config = project();
    const { model } = stub(() => ({ t: { probabilities: { yes: 0.1, no: 0.9 } } }));
    const report = await runAll(config, model, { questions: [question('t')], problems: [{ id: 'x', message: 'no unit' }] }, { problems: [{ message: '`proof.run` exited with 1' }] });
    expect(report.ok).toBe(false);
    expect(report.problems.map((p) => p.message)).toEqual(['`proof.run` exited with 1', 'no unit']);
    expect(report.summary).toMatchObject({ tests: 1, passed: 1 });
  });

  it('leaves out what the selection does not keep, and counts it', async () => {
    const config = project();
    const { model, calls } = stub(() => ({ t: { probabilities: { yes: 0.1, no: 0.9 } } }));
    const report = await runAll(config, model, collected(question('t'), question('u', { file: 'reference.md' })), { select: (q) => q.file === 'SKILL.md' });
    expect(calls).toHaveLength(1);
    expect(report.summary).toMatchObject({ tests: 1, skipped: 1 });
  });

  it('refuses a request over the model limits before sending it, naming the model', async () => {
    const config = project();
    const { model, calls } = stub(() => ({}), { perQuestionTokens: 50, perRequestTokens: 64_000 });
    const report = await runAll(config, model, collected(postRetry, getOk));
    expect(calls).toHaveLength(0);
    expect(report.requests[0]!.error).toMatch(/^too large: the skill text plus the longest question is about \d+ tokens; stub takes 50\./);
  });

  it('splits the questions of a file into requests that fit the number the model takes, every phrasing counted', async () => {
    const config = project();
    const limits = { perQuestionTokens: 32_000, perRequestTokens: 64_000 };
    const few = stub(() => new Error('must not be called'), { ...limits, questionsPerRequest: 3 });
    const report = await runAll(config, few.model, collected(postRetry, getOk), { dryRun: true });
    expect(report.ok).toBe(true);
    expect(report.requests.map((r) => r.verdicts.map((v) => v.id))).toEqual([['post-retry'], ['get-ok']]);
    // One question with more phrasings than the model takes cannot be split.
    const two = stub(() => new Error('must not be called'), { ...limits, questionsPerRequest: 2 });
    expect((await runAll(config, two.model, collected(postRetry), { dryRun: true })).requests[0]!.error).toBe('too many phrasings: the question post-retry has 3; stub takes 2 in one request');
    const fewOptions = stub(() => new Error('must not be called'), { ...limits, optionsPerQuestion: 2 });
    expect((await runAll(config, fewOptions.model, collected(postRetry), { dryRun: true })).requests[0]!.error).toBe(
      'too many options: the question post-retry has 3, `none` included; stub takes 2 in one question',
    );
  });

  it('a heading the file does not have is the error of its request, on a dry run too', async () => {
    const config = project();
    const { model } = stub(() => new Error('must not be called'));
    const report = await runAll(config, model, collected(question('t', { sections: ['Timeouts'] })), { dryRun: true });
    expect(report.ok).toBe(false);
    expect(report.requests[0]!.error).toMatch(/^no heading "Timeouts" in SKILL\.md/);
  });

  it('runs a request where the model refused one question, and fails only that question', async () => {
    const config = project();
    const { model } = stub(() => ({ t: { refused: true }, u: { probabilities: { yes: 0.1, no: 0.9 } } }));
    const report = await runAll(config, model, collected(question('t'), question('u', { question: 'r?' })));
    expect(report.requests[0]!.verdicts.map((v) => [v.id, v.answer, v.pass])).toEqual([['t', '(refused)', false], ['u', 'no', true]]);
    expect(report.summary).toMatchObject({ tests: 2, passed: 1 });
  });

  it('a dry run sends nothing, and still fails a question that does not fit', async () => {
    const config = project();
    const { model, calls } = stub(() => new Error('must not be called'));
    const report = await runAll(config, model, collected(postRetry, getOk), { dryRun: true });
    expect(calls).toHaveLength(0);
    expect(report).toMatchObject({ ok: true, dryRun: true });
    const small = stub(() => ({}), { perQuestionTokens: 50, perRequestTokens: 64_000 });
    expect((await runAll(config, small.model, collected(postRetry, getOk), { dryRun: true })).ok).toBe(false);
  });

  it('a dry run gives the estimate of the whole request, every question counted, not the figure the limit checks', async () => {
    const config = project();
    const { model } = stub(() => new Error('must not be called'));
    const one = (await runAll(config, model, collected(postRetry), { dryRun: true })).requests[0]!.estimatedTokens;
    const two = (await runAll(config, model, collected(postRetry, getOk), { dryRun: true })).requests[0]!.estimatedTokens;
    // The second question adds its own tokens, where the longest question alone would not grow.
    expect(two).toBeGreaterThan(one);
  });
});

// ---------------------------------------------------------------- the typesafe adapter

describe('typesafe adapter', () => {
  it('sends each question with the instructions, choices with their options as criteria', () => {
    const request = buildRequest('skill', [choice, yes]);
    const payload = toTypeSafe(request, 'jev-latest');
    expect(payload.model).toBe('jev-latest');
    expect(payload.state).toEqual({ skill: 'skill' });
    expect(payload.questions.pick).toEqual({
      type: 'choice',
      instructions: { framing: request.instructions, question: 'Situation: A situation.\nQuestion: Which one?' },
      criteria: { a: 'A', b: null, none: NONE_DESCRIPTION },
    });
    expect(payload.questions.allowed).toEqual({
      type: 'noul',
      instructions: { framing: request.questions[1]!.instructions, question: 'Situation: A situation.\nQuestion: Is it allowed?' },
    });
    expect(toTypeSafe(request)).not.toHaveProperty('model');
  });

  it("maps choice and yes/no answers and the usage, and leaves out Jev's confidence", async () => {
    const client = {
      systemOne: async () => ({
        model: 'jev-1.13.0',
        usage: { input_tokens: 12, output_tokens: 3 },
        answers: {
          pick: { type: 'choice', choice: 'a', confidence: 0.45, probabilities: { a: 0.59, none: 0.41 } },
          allowed: { type: 'noul', noul: 0.25 },
        },
      }),
    } as unknown as TypeSafeOptions['client'];
    const result = await typesafe({ client }).decide(buildRequest('skill', [choice, yes]));
    expect(result).toEqual({
      model: 'jev-1.13.0',
      usage: { inputTokens: 12, outputTokens: 3 },
      answers: {
        pick: { probabilities: { a: 0.59, none: 0.41 } },
        allowed: { probabilities: { yes: 0.25, no: 0.75 } },
      },
    });
  });
});

describe('loadModel', () => {
  const write = (name: string, text: string) => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };
  const MODEL = "{ id: 'mine', limits: { perQuestionTokens: 1000, perRequestTokens: 2000 }, decide: async () => ({ answers: {}, usage: { inputTokens: 0, outputTokens: 0 }, model: 'm' }) }";

  it('builds the typesafe adapter without a key, and loads a module of the project', async () => {
    expect((await loadModel({ provider: 'typesafe', name: 'jev-latest' })).id).toBe('typesafe');
    expect((await loadModel({ provider: 'module', module: write('a.mjs', `export default ${MODEL};`) })).id).toBe('mine');
    expect((await loadModel({ provider: 'module', module: write('b.mjs', `export const model = ${MODEL};`) })).id).toBe('mine');
    expect((await loadModel({ provider: 'module', module: write('c.mjs', `export default async () => (${MODEL});`) })).id).toBe('mine');
  });

  it('builds every provider that ships, with its default model when no name is given', async () => {
    for (const name of PROVIDER_NAMES) {
      expect(PROVIDERS[name].defaultModel).toBeTruthy();
      expect(PROVIDERS[name].env.length).toBeGreaterThan(0);
      expect((await loadModel({ provider: name })).id).toBe(name);
    }
  });

  it('says what a module must export, and when it cannot be loaded', async () => {
    await expect(loadModel({ provider: 'module', module: write('d.mjs', 'export default { id: 1 };') })).rejects.toThrow(ModelError);
    const badLimit = MODEL.replace('perRequestTokens: 2000', 'perRequestTokens: 2000, questionsPerRequest: 0');
    await expect(loadModel({ provider: 'module', module: write('e.mjs', `export default ${badLimit};`) })).rejects.toThrow(ModelError);
    const limits = MODEL.replace('perRequestTokens: 2000', 'perRequestTokens: 2000, questionsPerRequest: 400, optionsPerQuestion: 255');
    expect((await loadModel({ provider: 'module', module: write('f.mjs', `export default ${limits};`) })).limits).toMatchObject({ questionsPerRequest: 400 });
    await expect(loadModel({ provider: 'module', module: join(dir, 'missing.mjs') })).rejects.toThrow(/could not load the model module/);
  });
});

describe('borderline', () => {
  const m = th.margin;
  it('marks a verdict whose deciding number is within the margin of its threshold, pass or fail', () => {
    const share = (a: number) => ({ probabilities: { a, b: (1 - a) / 2, none: (1 - a) / 2 } });
    expect(judge(choice, share(th.choice + m - 0.01), th)).toMatchObject({ pass: true, borderline: true });
    expect(judge(choice, share(th.choice + m + 0.01), th)).toMatchObject({ pass: true, borderline: false });
    expect(judge(choice, share(th.choice - 0.05), th)).toMatchObject({ pass: false, weak: true, borderline: true });
    expect(judge(yes, { probabilities: { yes: th.yes + 0.1, no: 0.2 } }, th)).toMatchObject({ pass: true, borderline: true });
    expect(judge(yes, { probabilities: { yes: 0.95, no: 0.05 } }, th)).toMatchObject({ pass: true, borderline: false });
    expect(judge(no, { probabilities: { yes: th.no - 0.1, no: 0.8 } }, th)).toMatchObject({ pass: true, borderline: true });
  });

  it('marks a wrong choice borderline when the expected option is close behind the top one', () => {
    expect(judge(choice, { probabilities: { none: 0.55, a: 0.45 } }, th)).toMatchObject({ pass: false, borderline: true });
    expect(judge(choice, { probabilities: { none: 0.8, a: 0.2 } }, th)).toMatchObject({ pass: false, borderline: false });
  });

  it('honours thresholds.margin, and counts borderline verdicts in the summary', async () => {
    expect(judge(yes, { probabilities: { yes: 0.95, no: 0.05 } }, { ...th, margin: 0.3 })).toMatchObject({ borderline: true });
    const config = project();
    const { model } = stub(() => ({
      'post-retry#1': { probabilities: { stop: 0.9, none: 0.1 } },
      'post-retry#2': { probabilities: { stop: 0.9, none: 0.1 } },
      'post-retry#3': { probabilities: { stop: 0.9, none: 0.1 } },
      'get-ok': { probabilities: { yes: 0.75, no: 0.25 } },
    }));
    const report = await runAll(config, model, collected(postRetry, getOk));
    expect(report.summary).toMatchObject({ passed: 2, borderline: 1 });
    expect(report.thresholds).toEqual(th);
  });
});

describe('--changed', () => {
  const changed = (files: string[]) => ({ ref: 'main', commit: 'abc', files });
  const about = (file: string, withFiles: string[] | 'all') => question('t', { file, withFiles });

  it('asks the questions whose skill file or `with` files changed, and leaves the others out', () => {
    const select = changedSelection(changed(['features/retries.md']));
    expect(select(about('features/retries.md', []))).toBe(true);
    expect(select(about('./features/../features/retries.md', []))).toBe(true);
    expect(select(about('SKILL.md', ['features/retries.md']))).toBe(true);
    expect(select(about('SKILL.md', 'all'))).toBe(true);
    expect(select(about('SKILL.md', []))).toBe(false);
    expect(select(about('SKILL.md', ['other.md']))).toBe(false);
    expect(changedSelection(changed([]))(about('SKILL.md', 'all'))).toBe(false);
  });

  it('counts what differs from the merge base in the working tree: edits not committed, and new files that git does not ignore', () => {
    const root = mkdtempSync(join(dir, 'git-'));
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
    mkdirSync(join(root, 'skill/features'), { recursive: true });
    writeFileSync(join(root, 'skill/SKILL.md'), '# Skill\n');
    writeFileSync(join(root, 'skill/features/a.md'), '# A\n');
    writeFileSync(join(root, '.gitignore'), 'skill/ignored.md\n');
    git('init', '-q');
    git('symbolic-ref', 'HEAD', 'refs/heads/main');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    expect(changedSkillFiles(join(root, 'skill'), 'main').files).toEqual([]);
    writeFileSync(join(root, 'skill/features/a.md'), '# A, edited\n');
    writeFileSync(join(root, 'skill/features/new.md'), '# New\n');
    writeFileSync(join(root, 'skill/ignored.md'), '# Ignored\n');
    writeFileSync(join(root, 'outside.md'), '# Outside\n');
    expect(changedSkillFiles(join(root, 'skill'), 'main').files.sort()).toEqual(['features/a.md', 'features/new.md']);
  });
});

// What the tests of the skill share: a runner of their own for the examples that declare units,
// the folders they write, and the fixtures of the units whose tests drive the test layer.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from '../config.js';
import { DEFAULT_THRESHOLDS } from '../config.js';
import type { DecisionAnswer, DecisionModel, DecisionRequest } from '../models/index.js';
import type { Question } from '../test/questions.js';
import type { UnitRecord } from '../unit/contract.js';
import { createUnit, type RunnerIt } from '../unit/create.js';

/** `a`, `a and b`, `a, b and c`. */
export const and = (items: readonly string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
/** `a`, `a or b`, `a, b or c`. */
export const or = (items: readonly string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`);
/** Each item in backticks. */
export const code = (items: readonly string[]) => items.map((i) => `\`${i}\``);

const folders: string[] = [];
/** A new folder for one test. `cleanUp` takes them all away. */
export function scratch(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), `skillunit-skill-${name}-`));
  folders.push(dir);
  return dir;
}
export const cleanUp = () => folders.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));

/**
 * A runner of the test's own, so an example can call `setup()`, `unit()` and `ask()` and the
 * skill of this repository does not get them: `run` runs what they registered and gives each
 * test's error, or `ok`; `records` is what they left.
 */
export function runner() {
  const tests: { fn: (ctx: unknown) => unknown }[] = [];
  const records: UnitRecord[] = [];
  const add = (_name: string, fn: (ctx: unknown) => unknown) => void tests.push({ fn });
  const it = Object.assign(add, { skip: () => {}, only: add }) as unknown as RunnerIt<unknown>;
  const { unit, ask, setup } = createUnit(it, { write: (record) => void records.push(record) });
  const run = async () => {
    const out: string[] = [];
    for (const t of tests.splice(0)) {
      try {
        await t.fn({});
        out.push('ok');
      } catch (e) {
        out.push((e as Error).message);
      }
    }
    return out;
  };
  return { unit, ask, setup, records, run };
}

/** outside/.env  ·  outside/repo/.git  ·  repo/.env  ·  repo/apps/app/.env  ·  repo/apps/other */
export function envLayout() {
  const outside = scratch('env');
  const repo = join(outside, 'repo');
  mkdirSync(join(repo, '.git'), { recursive: true });
  mkdirSync(join(repo, 'apps', 'app'), { recursive: true });
  mkdirSync(join(repo, 'apps', 'other'), { recursive: true });
  writeFileSync(join(outside, '.env'), 'OUTSIDE=1\n');
  writeFileSync(join(repo, '.env'), 'TYPESAFE_API_KEY=root-key\n');
  writeFileSync(join(repo, 'apps', 'app', '.env'), 'TYPESAFE_API_KEY=app-key\n');
  return { outside, repo };
}

/** A decision model that answers what the test tells it to, and keeps each request. */
export function stub(answer: (request: DecisionRequest) => Record<string, DecisionAnswer> | Error, limits: DecisionModel['limits'] = { perQuestionTokens: 32_000, perRequestTokens: 64_000 }) {
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

/** The settings of a skill with one file, `SKILL.md`, whose section "Retries" has one rule. */
export function skillProject(): Config {
  const root = scratch('test');
  writeFileSync(join(root, 'SKILL.md'), '# Skill\n\n## Retries\n\nRetry only GET requests.\n');
  return { skill: root, model: { provider: 'typesafe' }, thresholds: { ...DEFAULT_THRESHOLDS } };
}

/** A question as the test layer collects it: about the section "Retries" of SKILL.md. */
export const question = (id: string, more: Partial<Question> = {}): Question => ({
  id,
  scenarios: ['A GET times out.'],
  question: 'May the agent retry it?',
  expect: 'yes',
  declared: { file: '/project/src/a.skill.test.ts', line: 10 },
  file: 'SKILL.md',
  sections: ['Retries'],
  withFiles: [],
  ...more,
});
export const collected = (...questions: Question[]) => ({ questions, problems: [] });

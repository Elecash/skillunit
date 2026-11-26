// What the tests of the skill share: a runner of their own for the examples that declare units,
// the folders they write, and the fixtures of the units whose tests drive the test layer.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Config } from '../config.js';
import { CONFIG_FILE, DEFAULT_THRESHOLDS, loadConfig } from '../config.js';
import { PROVIDER_NAMES, PROVIDERS } from '../models/providers.js';
import { runProof, type ProofResult } from '../proof/layer.js';
import type { CheckReport } from '../report/types.js';
import { COMMON_OPTIONS, INIT, OPTIONS } from '../commands.js';
import { key } from '../unit/key.js';
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

/** The package's `package.json`: its name, its entry points and its command. */
export const PACKAGE = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { name: string; bin: Record<string, string>; exports: Record<string, unknown> };
/** The command a project runs: `skillunit`. */
export const BIN = Object.keys(PACKAGE.bin)[0]!;
/** An entry point of the package as a project imports it, from its key in `exports`: `skillunit/vitest`. */
export const entry = (key: string) => `${PACKAGE.name}/${key.replace(/^\.\//, '')}`;

const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
const CLI = fileURLToPath(new URL('../cli.ts', import.meta.url));

export interface Ran {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * `skillunit <args>` as a process, from the source, in `cwd`. No key of any provider and no
 * `GITHUB_BASE_REF` reach it unless `env` gives them.
 */
export function cli(cwd: string, args: string[], env: Record<string, string> = {}): Promise<Ran> {
  const clean: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  for (const name of PROVIDER_NAMES) for (const v of PROVIDERS[name].env) delete clean[v];
  delete clean.GITHUB_BASE_REF;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', TSX, CLI, ...args], { cwd, env: { ...clean, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

/** The report a run printed with `--json`. */
export const report = (ran: Ran) => JSON.parse(ran.stdout) as CheckReport;

/** The test file of a project. */
export const TEST_FILE = 'skill.test.ts';

export interface Project {
  root: string;
  /** The skill folder: `skill`. */
  skill: string;
  /** The proof, run in-process with the project's settings. */
  proof(options?: { write?: boolean; noRun?: boolean }): ProofResult;
  read(file: string): string;
  write(file: string, text: string): void;
}

/**
 * A project in a scratch folder: `skillunit.yaml` with `skill: ./skill` and `proof` set, the test
 * file `skill.test.ts` with the text `test`, and in `tmp/skill-units` the records the
 * declarations of `declare` leave, as if that file made them. `proof.run` is not set unless
 * `settings` sets it, so the proof builds from those records. `files` are written too.
 */
export async function project(
  declare: (r: ReturnType<typeof runner>) => void,
  options: { test?: string; settings?: string; files?: Record<string, string> } = {},
): Promise<Project> {
  const root = scratch('project');
  const write = (file: string, text: string) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  write(CONFIG_FILE, options.settings ?? 'skill: ./skill\nproof: {}\n');
  write(TEST_FILE, options.test ?? '');
  for (const [file, text] of Object.entries(options.files ?? {})) write(file, text);
  const r = runner();
  declare(r);
  await r.run();
  r.records.forEach((record, i) => write(`tmp/skill-units/${i}-${record.id}.json`, `${JSON.stringify({ ...record, file: TEST_FILE }, null, 2)}\n`));
  const configFile = join(root, CONFIG_FILE);
  return {
    root,
    skill: join(root, 'skill'),
    proof: (o = {}) => runProof({ skill: join(root, 'skill'), config: loadConfig(configFile).proof!, configFile, write: o.write ?? false, noRun: o.noRun ?? false }).result,
    read: (file) => readFileSync(join(root, file), 'utf8'),
    write,
  };
}

/**
 * A model module for `model: ./model.mjs`: it answers each question with `probabilities`, the
 * same for every question, and writes each request it gets to `requests.json` next to it.
 */
export const modelModule = (probabilities: Record<string, number>) => `import { writeFileSync } from 'node:fs';
export default {
  id: 'fake',
  limits: { perQuestionTokens: 100000, perRequestTokens: 100000 },
  async decide(request) {
    writeFileSync(new URL('./requests.json', import.meta.url), JSON.stringify(request));
    const answers = Object.fromEntries(request.questions.map((q) => [q.id, { probabilities: ${JSON.stringify(probabilities)} }]));
    return { answers, usage: { inputTokens: 1, outputTokens: 1 }, model: 'fake-1' };
  },
};
`;

/** A command of `skillunit`, by a name the command table has. */
export type Command = keyof typeof OPTIONS | typeof INIT;
export const command = key<Record<Command, unknown>>;
/** An option of `command`, by a name the command table gives it. */
export const option = <C extends keyof typeof OPTIONS>(_command: C, flag: (typeof OPTIONS)[C][number] | (typeof COMMON_OPTIONS)[number]) => flag;

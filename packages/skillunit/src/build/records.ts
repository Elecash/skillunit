/**
 * Reads the `proof.units` folder: one record per `.json` file, as `unit()` writes it or a test in
 * another language does. See `unit/contract.ts` for the contract.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkNumbers, checkQuestions, checkSpec, FENCE_LANG, QUESTION_ID, UNIT_CONTRACT, UNIT_ID, type FailedUnit, type PassedQuestion, type PassedUnit, type UnitExample } from '../unit/contract.js';

/** A record, with the absolute path of its test file and of the record itself. */
export type ReadUnit = (PassedUnit | FailedUnit) & { path: string; abs: string };

/** The record of a question declared with `ask()`, passed or failed. */
export type ReadQuestion = (PassedQuestion | (FailedUnit & { kind: 'question' })) & { path: string; abs: string };

export interface RecordProblem {
  /** Absolute path of the record. */
  path: string;
  message: string;
  /** Where the record says it was declared, when it parses and has `file` and `line`: the absolute test file, and the unit when its id is one. */
  test?: { file: string; line: number; unit?: string };
}

export interface Records {
  /** In the order of the test files and their lines. */
  units: ReadUnit[];
  /** The records of `ask()`, in the same order. */
  questions: ReadQuestion[];
  problems: RecordProblem[];
}

/** The records of `dir`. `cwd` is the folder of `skillunit.yaml`, which `file` starts from. */
export function readRecords(dir: string, cwd: string): Records {
  const units: ReadUnit[] = [];
  const questions: ReadQuestion[] = [];
  const problems: RecordProblem[] = [];
  if (!existsSync(dir)) return { units, questions, problems };
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    const path = join(dir, name);
    let raw: unknown;
    const fail = (message: string) => problems.push({ path, message: `${name}: ${message}`, ...declaredAt(raw, cwd) });
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      fail(`not valid JSON (${(e as Error).message})`);
      continue;
    }
    const problem = checkRecord(raw);
    if (problem) {
      fail(problem);
      continue;
    }
    const record = raw as PassedUnit | FailedUnit | PassedQuestion;
    if (record.kind === 'question') questions.push({ ...record, path, abs: resolve(cwd, record.file) } as ReadQuestion);
    else units.push({ ...(record as PassedUnit | FailedUnit), path, abs: resolve(cwd, record.file) });
  }
  const order = (a: ReadUnit | ReadQuestion, b: ReadUnit | ReadQuestion) => a.abs.localeCompare(b.abs) || a.line - b.line || a.id.localeCompare(b.id);
  units.sort(order);
  questions.sort(order);
  return { units, questions, problems };
}

/** Where a record that parsed says it was declared, if it says. */
function declaredAt(raw: unknown, cwd: string): Pick<RecordProblem, 'test'> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  if (typeof r.file !== 'string' || !r.file || typeof r.line !== 'number' || !Number.isInteger(r.line) || r.line < 1) return {};
  const unit = r.kind !== 'question' && typeof r.id === 'string' && UNIT_ID.test(r.id) ? r.id : undefined;
  return { test: { file: resolve(cwd, r.file), line: r.line, ...(unit ? { unit } : {}) } };
}

/** What is wrong with a record, if anything. */
export function checkRecord(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'a unit record is a JSON object';
  const r = raw as Record<string, unknown>;
  if (r.skillunit !== UNIT_CONTRACT) return `\`skillunit\` must be ${UNIT_CONTRACT}, the version of the contract this SkillUnit reads; got ${JSON.stringify(r.skillunit)}`;
  const question = r.kind === 'question';
  if (typeof r.id !== 'string' || !(question ? QUESTION_ID : UNIT_ID).test(r.id)) return `\`id\` must be ${question ? 'a question' : 'a unit'} id in kebab-case; got ${JSON.stringify(r.id)}`;
  if (typeof r.file !== 'string' || !r.file) return '`file` must be the test file, from the folder of skillunit.yaml';
  if (typeof r.line !== 'number' || !Number.isInteger(r.line) || r.line < 0) return '`line` must be the line of the declaration, from 1';
  if (r.test !== undefined && typeof r.test !== 'string') return '`test` must be the title of the test';
  if (r.status === 'failed') return typeof r.error === 'string' ? undefined : '`error` must be the message of what failed';
  if (r.status !== 'passed') return `\`status\` must be "passed" or "failed"; got ${JSON.stringify(r.status)}`;
  if (question) return checkQuestionRecord(r);

  const { skillunit: _v, status: _s, id, kind, file: _f, line: _l, test: _t, examples, error: _e, body, ...spec } = r;
  if (body !== undefined && body !== false) return '`body` is `false` for a unit declared with no body, and absent otherwise';
  let found: string;
  try {
    found = checkSpec(id, spec);
  } catch (e) {
    return (e as Error).message;
  }
  if (kind !== found) return `\`kind\` is ${JSON.stringify(kind)}, and the keys make it a ${found}`;
  if (found === 'fact' && spec.value === undefined) return 'a fact needs `value`';
  // As `unit()` checks it: a unit a test proves has no number its `values` does not have.
  if (body !== false) {
    try {
      checkNumbers(id as string, spec as Parameters<typeof checkNumbers>[1]);
    } catch (e) {
      return (e as Error).message;
    }
  }
  if (!Array.isArray(examples) || examples.some((x) => !x || typeof (x as UnitExample).lang !== 'string' || typeof (x as UnitExample).text !== 'string')) {
    return '`examples` must be a list of `{ "lang": …, "text": … }`';
  }
  // As `unit()` checks it: one word, so it cannot add a line to the built file.
  const lang = (examples as UnitExample[]).find((x) => !FENCE_LANG.test(x.lang))?.lang;
  if (lang !== undefined) return `each example has a fence language in \`lang\`, such as \`sh\` or \`yaml\`; got ${JSON.stringify(lang)}`;
  if (found === 'decision' && examples.length) return 'a decision shows its examples in its paths, from the regions `skill:<id>.<path>`, and has no `examples`';
  return undefined;
}

/** What is wrong with the record of a question declared with `ask()`, if anything. */
function checkQuestionRecord(r: Record<string, unknown>): string | undefined {
  const { skillunit: _v, status: _s, id, kind: _k, file: _f, line: _l, test: _t, skillFile, ask, ...rest } = r;
  const extra = Object.keys(rest)[0];
  if (extra !== undefined) return `a question has no \`${extra}\``;
  if (typeof skillFile !== 'string' || !skillFile.trim()) return '`skillFile` must be the built file the question is about, such as `SKILL.md`';
  try {
    const list = checkQuestions(id as string, ask);
    if (list.length !== 1) return '`ask` of a question holds that one question';
    if (list[0]!.id !== id) return `the question in \`ask\` has the id \`${list[0]!.id}\`, and the record \`${id as string}\``;
  } catch (e) {
    return (e as Error).message;
  }
  return undefined;
}

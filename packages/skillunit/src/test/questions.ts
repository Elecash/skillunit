/**
 * The questions for the decision model, collected from the records the tests left: the `ask` of
 * each unit, and each `ask()`. A question of a unit is about the file of the skill folder that
 * holds the unit; a question of `ask()` names its file.
 *
 * The records were checked when they were read (`build/records.ts`); what is checked here needs
 * the whole run or the skill folder: an id two records give, a unit the skill folder does not
 * have, a file that is not there or is outside the folder.
 */
import { existsSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { ReadQuestion, ReadUnit } from '../build/records.js';
import { checkQuestions, leavesFolder, type AskedQuestion, type PassedQuestion, type PassedUnit } from '../unit/contract.js';

/** One question, as the reader asks it. */
export interface TestCase {
  id: string;
  /**
   * The situation, in one or more phrasings. Each phrasing is asked on its own and the test
   * passes when most of them pass, so one odd wording cannot pass or fail it alone.
   */
  scenarios: string[];
  question: string;
  /** Option label to description. Absent for a yes/no question. */
  options?: Record<string, string | null>;
  /** An option label, `none`, or `yes` / `no` for a yes/no question. */
  expect: string;
  /** The unit the question is about. */
  unit?: string;
  /** Where it is declared: the absolute path of the test file, and the line. */
  declared?: { file: string; line: number };
}

/** A question and what the model reads to answer it. */
export interface Question extends TestCase {
  declared: { file: string; line: number };
  /** The file of the skill folder the question is about, with `/`. */
  file: string;
  /** Headings to cut out of `file`. Empty means the whole file. */
  sections: string[];
  /** Other files of the skill the reader gets too, whole. `all` means every other `.md` file. */
  withFiles: string[] | 'all';
}

/** A question that cannot be asked, and why. */
export interface QuestionProblem {
  id?: string;
  unit?: string;
  /** Where it is declared, when it is: the absolute path of the test file, and the line. */
  declared?: { file: string; line: number };
  message: string;
  /** `proof.run` did not exit with 0: the report shows this first. */
  run?: true;
}

export interface Collected {
  questions: Question[];
  problems: QuestionProblem[];
}

/**
 * The questions of `units` and `asked`, in their order. `skillUnits` are the units of the skill
 * folder, for the file each unit is in.
 */
export function collectQuestions(units: ReadUnit[], asked: ReadQuestion[], skillDir: string, skillUnits: { id: string; file: string }[]): Collected {
  const questions: Question[] = [];
  const problems: QuestionProblem[] = [];
  const first = new Map<string, { file: string; line: number }>();
  const inSkill = new Map<string, string>();
  for (const u of skillUnits) if (!inSkill.has(u.id)) inSkill.set(u.id, u.file);

  const add = (q: AskedQuestion, file: string, declared: { file: string; line: number }, unit?: string) => {
    const problem = (message: string) => problems.push({ id: q.id, ...(unit ? { unit } : {}), declared, message });
    const before = first.get(q.id);
    if (before) return problem(`the question \`${q.id}\` is also declared at ${before.file}:${before.line}; give one of them another \`id\``);
    first.set(q.id, declared);
    const withFiles = q.with === undefined ? [] : q.with === 'all' ? 'all' : Array.isArray(q.with) ? q.with : [q.with];
    if (withFiles !== 'all' && withFiles.map(norm).includes(norm(file))) {
      return problem(`\`with\` lists ${file}, the file the question is about; remove it`);
    }
    questions.push({
      id: q.id,
      scenarios: Array.isArray(q.scenario) ? q.scenario : [q.scenario],
      question: q.question,
      ...(q.options === undefined ? {} : { options: Array.isArray(q.options) ? Object.fromEntries(q.options.map((l) => [l, null])) : q.options }),
      expect: q.expect,
      ...(unit ? { unit } : {}),
      declared,
      file,
      sections: q.section === undefined ? [] : Array.isArray(q.section) ? q.section : [q.section],
      withFiles,
    });
  };

  // `build/records.ts` checked the questions of every record it read, so this throws only for a
  // record that did not come from there; it is a problem of its declaration all the same.
  const checked = (id: string, ask: unknown, declared: { file: string; line: number }, unit?: string) => {
    try {
      return checkQuestions(id, ask);
    } catch (e) {
      problems.push({ id, ...(unit ? { unit } : {}), declared, message: (e as Error).message });
      return undefined;
    }
  };

  // In the order of the test files and their lines, units and `ask()` together.
  const records = [...units, ...asked].sort((a, b) => a.abs.localeCompare(b.abs) || a.line - b.line);
  for (const r of records) {
    if (r.status !== 'passed') continue;
    const declared = { file: r.abs, line: r.line };
    if (r.kind === 'question') {
      const q = r as PassedQuestion & ReadQuestion;
      const file = norm(q.skillFile);
      const where = leavesFolder(file) ? 'outside the skill folder' : !isFile(join(skillDir, file)) ? 'not a file in the skill folder' : undefined;
      if (where) {
        problems.push({ id: q.id, declared, message: `the question \`${q.id}\` is about ${file}, which is ${where}` });
        continue;
      }
      const list = checked(q.id, q.ask, declared);
      if (list) add(list[0]!, file, declared);
      continue;
    }
    const u = r as PassedUnit & ReadUnit;
    if (u.ask === undefined) continue;
    const file = inSkill.get(u.id);
    const list = checked(u.id, u.ask, declared, u.id);
    if (!list) continue;
    if (file === undefined) {
      for (const q of list) {
        problems.push({ id: q.id, unit: u.id, declared, message: `the skill folder has no unit \`${u.id}\`, which this question is about: build it with \`skillunit proof --write\`` });
      }
      continue;
    }
    for (const q of list) add(q, file, declared, u.id);
  }
  return { questions, problems };
}

const norm = (p: string) => posix.normalize(p.split('\\').join('/'));

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

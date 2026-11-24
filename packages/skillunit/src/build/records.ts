/**
 * Reads the `proof.units` folder: one record per `.json` file, as `unit()` writes it or a test in
 * another language does. See `unit/contract.ts` for the contract.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkSpec, UNIT_CONTRACT, UNIT_ID, type FailedUnit, type PassedUnit, type UnitExample } from '../unit/contract.js';

/** A record, with the absolute path of its test file and of the record itself. */
export type ReadUnit = (PassedUnit | FailedUnit) & { path: string; abs: string };

export interface RecordProblem {
  /** Absolute path of the record. */
  path: string;
  message: string;
}

export interface Records {
  /** In the order of the test files and their lines. */
  units: ReadUnit[];
  problems: RecordProblem[];
}

/** The records of `dir`. `cwd` is the folder of `skillunit.yaml`, which `file` starts from. */
export function readRecords(dir: string, cwd: string): Records {
  const units: ReadUnit[] = [];
  const problems: RecordProblem[] = [];
  if (!existsSync(dir)) return { units, problems };
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    const path = join(dir, name);
    const fail = (message: string) => problems.push({ path, message: `${name}: ${message}` });
    let raw: unknown;
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
    const record = raw as PassedUnit | FailedUnit;
    units.push({ ...record, path, abs: resolve(cwd, record.file) });
  }
  units.sort((a, b) => a.abs.localeCompare(b.abs) || a.line - b.line || a.id.localeCompare(b.id));
  return { units, problems };
}

/** What is wrong with a record, if anything. */
export function checkRecord(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'a unit record is a JSON object';
  const r = raw as Record<string, unknown>;
  if (r.skillunit !== UNIT_CONTRACT) return `\`skillunit\` must be ${UNIT_CONTRACT}, the version of the contract this SkillUnit reads; got ${JSON.stringify(r.skillunit)}`;
  if (typeof r.id !== 'string' || !UNIT_ID.test(r.id)) return `\`id\` must be a unit id in kebab-case; got ${JSON.stringify(r.id)}`;
  if (typeof r.file !== 'string' || !r.file) return '`file` must be the test file, from the folder of skillunit.yaml';
  if (typeof r.line !== 'number' || !Number.isInteger(r.line) || r.line < 0) return '`line` must be the line of the declaration, from 1';
  if (r.test !== undefined && typeof r.test !== 'string') return '`test` must be the title of the test';
  if (r.status === 'failed') return typeof r.error === 'string' ? undefined : '`error` must be the message of what failed';
  if (r.status !== 'passed') return `\`status\` must be "passed" or "failed"; got ${JSON.stringify(r.status)}`;

  const { skillunit: _v, status: _s, id, kind, file: _f, line: _l, test: _t, examples, error: _e, ...spec } = r;
  let found: string;
  try {
    found = checkSpec(id, spec);
  } catch (e) {
    return (e as Error).message;
  }
  if (kind !== found) return `\`kind\` is ${JSON.stringify(kind)}, and the keys make it a ${found}`;
  if (found === 'fact' && spec.value === undefined) return 'a fact needs `value`';
  if (!Array.isArray(examples) || examples.some((x) => !x || typeof (x as UnitExample).lang !== 'string' || !(x as UnitExample).lang || typeof (x as UnitExample).text !== 'string')) {
    return '`examples` must be a list of `{ "lang": …, "text": … }`';
  }
  if (found === 'decision' && examples.length) return 'a decision shows its examples in its paths, from the regions `skill:<id>.<path>`, and has no `examples`';
  return undefined;
}

/**
 * Spec files: what they contain and how they are checked when loaded.
 *
 * A spec covers one part of a skill (a heading of SKILL.md, or a whole file) and lists the
 * decisions an agent reading that part must reach. With `with`, the reader also gets other files
 * of the skill, as an agent that opens them would. A spec holds data only, so specs are easy
 * to review in a diff and easy to generate.
 */
import { readFileSync } from 'node:fs';
import { isNode, isSeq, LineCounter, parseDocument } from 'yaml';

/**
 * Label of the option the reader always gets on choice tests, added by SkillUnit.
 * A spec can expect it (`expect: none`) but cannot define it.
 */
export const NONE = 'none';

/** One decision the skill must force. */
export interface TestCase {
  id: string;
  /**
   * The situation, in one or more phrasings. Each phrasing is asked on its own and the test
   * takes the median result, so one odd wording cannot pass or fail it alone.
   */
  scenarios: string[];
  question: string;
  /** Option label to description. Absent for a yes/no test. */
  options?: Record<string, string | null>;
  /** An option label, `none`, or `yes` / `no` for a yes/no test. */
  expect: string;
  /** The unit the test is about. */
  unit?: string;
  /** Line of the test in the spec file, for reports. */
  line?: number;
}

export interface SpecFile {
  /** Where the spec was loaded from, for reports. */
  path: string;
  /** File inside the skill folder that the tests read. */
  file: string;
  /** Headings to cut out of `file`. Empty means the whole file. */
  sections: string[];
  /**
   * Other files of the skill the reader gets too, whole: the files an agent reads next to
   * `file` in the situations the tests describe. `all` means every other `.md` file.
   */
  withFiles: string[] | 'all';
  tests: TestCase[];
}

const SPEC_KEYS = new Set(['file', 'section', 'with', 'tests']);
const TEST_KEYS = new Set(['id', 'scenario', 'question', 'options', 'expect', 'unit']);

export function loadSpec(path: string): SpecFile {
  const lines = new LineCounter();
  const doc = parseDocument(readFileSync(path, 'utf8'), { lineCounter: lines });
  const fail = (msg: string) => new Error(`${path}: ${msg}`);
  if (doc.errors.length) throw fail(doc.errors[0]!.message);
  const raw = doc.toJS();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail('expected a mapping at the top level');

  for (const key of Object.keys(raw)) {
    if (key === 'mutations') {
      throw fail('`mutations` is no longer supported. Delete the block; see "Checking that a test is real" in the README.');
    }
    if (!SPEC_KEYS.has(key)) throw fail(`unknown key \`${key}\` (allowed: file, section, with, tests)`);
  }

  const file = raw.file ?? 'SKILL.md';
  if (typeof file !== 'string') throw fail('`file` must be a path');

  const sections = raw.section === undefined ? [] : Array.isArray(raw.section) ? raw.section : [raw.section];
  if (sections.some((s: unknown) => typeof s !== 'string')) throw fail('`section` must be a heading or a list of headings');

  const withFiles = readWith(raw.with, file, fail);

  if (!Array.isArray(raw.tests) || raw.tests.length === 0) throw fail('`tests` must be a non-empty list');
  const seen = new Set<string>();
  const items = doc.get('tests', true);
  const tests = raw.tests.map((t: unknown, i: number) => {
    const test = loadTest(t, (msg) => fail(`tests[${i}]: ${msg}`), seen);
    const node = isSeq(items) ? items.items[i] : undefined;
    const offset = isNode(node) ? node.range?.[0] : undefined;
    if (offset !== undefined) test.line = lines.linePos(offset).line;
    return test;
  });

  return { path, file, sections, withFiles, tests };
}

/** `with` is `all`, one path, or a list of paths inside the skill folder. */
function readWith(value: unknown, file: string, fail: (msg: string) => Error): string[] | 'all' {
  if (value === undefined) return [];
  if (value === 'all') return 'all';
  const list: unknown[] = Array.isArray(value) ? value : [value];
  if (list.length === 0 || list.some((f) => typeof f !== 'string' || !f.trim())) {
    throw fail('`with` must be `all`, a path, or a list of paths inside the skill folder');
  }
  const paths = list as string[];
  if (paths.includes(file)) throw fail(`\`with\` lists ${file}, which is the file under test; remove it`);
  if (new Set(paths).size !== paths.length) throw fail('`with` lists the same file twice');
  return paths;
}

function loadTest(value: unknown, fail: (msg: string) => Error, seen: Set<string>): TestCase {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('expected a mapping');
  const test = value as Record<string, unknown>;

  for (const key of Object.keys(test)) {
    if (!TEST_KEYS.has(key)) throw fail(`unknown key \`${key}\` (allowed: ${[...TEST_KEYS].join(', ')})`);
  }
  for (const key of ['id', 'question', 'expect'] as const) {
    if (typeof test[key] !== 'string' || !(test[key] as string).trim()) throw fail(`\`${key}\` is required`);
  }

  const id = test.id as string;
  if (seen.has(id)) throw fail(`duplicate id "${id}"`);
  seen.add(id);
  if (test.unit !== undefined && (typeof test.unit !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(test.unit))) {
    throw fail('`unit` must be the id of a unit, in kebab-case');
  }
  const unit = test.unit === undefined ? {} : { unit: test.unit as string };

  const scenarios = Array.isArray(test.scenario) ? test.scenario : [test.scenario];
  if (scenarios.length === 0 || scenarios.some((s) => typeof s !== 'string' || !s.trim())) {
    throw fail('`scenario` must be a sentence or a list of sentences');
  }

  const expect = String(test.expect);
  if (test.options === undefined) {
    const yn = expect.toLowerCase();
    if (yn !== 'yes' && yn !== 'no') throw fail('a test without `options` is a yes/no test, so `expect` must be yes or no');
    return { id, scenarios, question: test.question as string, expect: yn, ...unit };
  }

  const options = readOptions(test.options, fail);
  if (NONE in options) throw fail('`none` is added to every choice test automatically; remove it from `options`');
  if (Object.keys(options).length < 2) throw fail('`options` needs at least two entries');
  if (expect !== NONE && !(expect in options)) {
    throw fail(`\`expect\` is "${expect}", which is not an option (use one of: ${Object.keys(options).join(', ')}, none)`);
  }
  return { id, scenarios, question: test.question as string, options, expect, ...unit };
}

/** Options are either `label: description` pairs or a plain list of labels. */
function readOptions(value: unknown, fail: (msg: string) => Error): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (Array.isArray(value)) {
    for (const label of value) {
      if (typeof label !== 'string') throw fail('each entry in an `options` list must be a label');
      out[label] = null;
    }
    return out;
  }
  if (value && typeof value === 'object') {
    for (const [label, description] of Object.entries(value as Record<string, unknown>)) {
      if (description !== null && typeof description !== 'string') throw fail(`option "${label}" needs a text description`);
      out[label] = description;
    }
    return out;
  }
  throw fail('`options` must be a mapping or a list');
}

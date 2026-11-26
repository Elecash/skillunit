/**
 * The file a test leaves for each unit it declares: the contract between the tests and
 * `skillunit proof`. One JSON object per file, in the `proof.units` folder of the nearest
 * `skillunit.yaml`, under any name that ends in `.json`. A test in another language writes the
 * same object.
 *
 * When the body passed:
 *
 * ```json
 * {
 *   "skillunit": 1,
 *   "status": "passed",
 *   "id": "default-timeout",
 *   "kind": "fact",
 *   "file": "src/tinyfetch.test.ts",
 *   "line": 145,
 *   "test": "fact default-timeout: 10 seconds (`timeout: 10000`), for every method.",
 *   "when": "the user asks how long a request waits by default.",
 *   "value": "10 seconds (`timeout: 10000`), for every method.",
 *   "unknown": "tinyfetch has no separate connect timeout; say so instead of inventing one.",
 *   "values": { "seconds": 10 },
 *   "ask": [
 *     {
 *       "id": "default-timeout",
 *       "scenario": "The user asks how long a request waits when the code sets nothing.",
 *       "question": "What should the agent answer?",
 *       "options": { "right": "10 seconds", "longer": "30 seconds" },
 *       "expect": "right"
 *     }
 *   ],
 *   "examples": []
 * }
 * ```
 *
 * `ask` holds the questions for the decision model, in the form `unit()` takes them: one question
 * or a list, with or without `id`. SkillUnit checks them again when it reads the record.
 *
 * A unit declared with no body, which no test proves, has `"body": false`.
 *
 * A question about the prose of a file, declared with `ask()`, leaves `"kind": "question"`, its
 * own `id`, the built file it is about in `skillFile`, and itself in `ask`:
 *
 * ```json
 * {
 *   "skillunit": 1,
 *   "status": "passed",
 *   "kind": "question",
 *   "id": "which-file-for-retries",
 *   "file": "src/skill.test.ts",
 *   "line": 12,
 *   "test": "question which-file-for-retries: Which file does the agent read?",
 *   "skillFile": "SKILL.md",
 *   "ask": [{ "id": "which-file-for-retries", "scenario": "…", "question": "…", "options": ["retries", "errors"], "expect": "retries" }]
 * }
 * ```
 *
 * When a test threw, or its spec has a mistake, the same `skillunit`, `id`, `file`, `line` and
 * `test`, with `"status": "failed"` and the error's message in `error`; a question keeps
 * `"kind": "question"`. A skipped test leaves nothing.
 *
 * `file` is the test file, from the folder of `skillunit.yaml`, with `/`; `line` is where the
 * unit is declared, from 1. This module imports nothing, so a runner in a browser can use it.
 */

/** Bumped when a field changes meaning or disappears. */
export const UNIT_CONTRACT = 1;

export type UnitKind = 'rule' | 'decision' | 'fact';

/** A path of a decision: `- **<path>** — <when>`. Its example is the region `skill:<id>.<path>`. */
export interface UnitPath {
  path: string;
  when: string;
}

/** What a test declares about its unit. The kind follows from the keys: `do`, `value` or `decide`. */
export interface UnitSpec {
  /** When the unit applies. Every kind has it. */
  when: string;
  /** A rule: what the agent does. */
  do?: string;
  /** A fact: what the agent states. The body may set it instead, with `u.value(text)`. */
  value?: string;
  /** A decision: the text after `Decide:`, if any. Its paths are in `paths`. */
  decide?: string;
  /** A decision: one item per path. */
  paths?: UnitPath[];
  /** A fact: what to say when the value is not known. */
  unknown?: string;
  /** A rule or a decision: the case where it still applies. */
  evenWhen?: string;
  /** Named values the prose of the skill may use, as `{{value:<id>.<name>}}`. */
  values?: Record<string, UnitScalar>;
  /** Questions for the decision model about this unit: one, or a list. */
  ask?: UnitQuestion | UnitQuestion[];
  /**
   * A rule or a fact: blocks to show, such as a command or a config. They come before the blocks
   * of `u.example`, and are how a unit with no body shows an example in a language its file is not.
   */
  examples?: UnitExample[];
}

/**
 * A question for the decision model: given the skill and `scenario`, does it answer `expect`?
 * SkillUnit asks it after the build. The test runner never does.
 */
export interface UnitQuestion {
  /** Defaults to the unit's id for its first question, then `<unit id>.2`, `<unit id>.3`. */
  id?: string;
  /** The situation, or several phrasings of it. Each is asked on its own; the question passes when most of them pass. */
  scenario: string | string[];
  question: string;
  /** Labels and what each means, or labels alone. Without options, the question is yes or no. */
  options?: Record<string, string | null> | string[];
  /** An option, `none` (SkillUnit adds it to every question with options), or `yes` or `no`. */
  expect: string;
  /** Other files of the skill the model reads too: `all`, a path, or a list of paths inside the skill folder. */
  with?: string | string[];
  /** Headings of the built file to cut out for the model. Without it, the model reads the whole file. */
  section?: string | string[];
}

/** What `ask(id, spec)` takes: a question about the prose of `file`, a built file of the skill. */
export interface AskSpec extends Omit<UnitQuestion, 'id'> {
  /** Defaults to `SKILL.md`. */
  file?: string;
}

/** A question as the helper writes it: with its id. */
export interface AskedQuestion extends UnitQuestion {
  id: string;
}

export type UnitScalar = string | number | boolean;

/** A block the body produced, with `u.example(lang, text)`. */
export interface UnitExample {
  lang: string;
  text: string;
}

interface RecordBase {
  skillunit: typeof UNIT_CONTRACT;
  id: string;
  /** The test file. The writer makes it relative to the folder of `skillunit.yaml`. */
  file: string;
  /** Line where the unit is declared, from 1. */
  line: number;
  /** The title the test was registered with. */
  test: string;
}

export interface PassedUnit extends RecordBase {
  status: 'passed';
  kind: UnitKind;
  /** `false` when the unit was declared with no body: no test proves it. */
  body?: false;
  when: string;
  do?: string;
  value?: string;
  decide?: string;
  paths?: UnitPath[];
  unknown?: string;
  evenWhen?: string;
  values?: Record<string, UnitScalar>;
  ask?: AskedQuestion[];
  /** The blocks of `u.example`, in the order of the calls. */
  examples: UnitExample[];
}

export interface FailedUnit extends RecordBase {
  status: 'failed';
  /** Set when the record is of a question declared with `ask()`. */
  kind?: 'question';
  /** The message of what the body or the spec threw. */
  error: string;
}

/** What `ask()` leaves. */
export interface PassedQuestion extends RecordBase {
  status: 'passed';
  kind: 'question';
  /** The built file the question is about, from the skill folder. */
  skillFile: string;
  ask: AskedQuestion[];
}

export type UnitRecord = PassedUnit | FailedUnit | PassedQuestion;

/** A unit id: kebab-case. */
export const UNIT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The name of a path of a decision, or of a value. */
export const UNIT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

/** The id of a question: kebab-case words, and `.` before the number of a default id. */
export const QUESTION_ID = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;
/** The option SkillUnit adds to every question with options. A question may expect it, not list it. */
export const NONE = 'none';

const KEYS = ['when', 'do', 'value', 'decide', 'paths', 'unknown', 'evenWhen', 'values', 'ask', 'examples'] as const;
/** A fence language: what `u.example` and `examples` take. */
export const FENCE_LANG = /^[A-Za-z0-9_+.-]+$/;
const QUESTION_KEYS = ['id', 'scenario', 'question', 'options', 'expect', 'with', 'section'] as const;
/** The file a question about prose reads when it names none. */
export const DEFAULT_SKILL_FILE = 'SKILL.md';

/** The spec has a mistake that the test cannot run with. */
export class UnitSpecError extends Error {
  override name = 'UnitSpecError';
}

/**
 * The kind of a spec, after checking every key. Throws a `UnitSpecError` that says what to fix.
 */
export function checkSpec(id: unknown, spec: unknown): UnitKind {
  const fail = (message: string): never => {
    throw new UnitSpecError(`unit ${typeof id === 'string' ? `\`${id}\`` : String(id)}: ${message}`);
  };
  if (typeof id !== 'string' || !UNIT_ID.test(id)) {
    fail(`the id must be kebab-case, lowercase words joined by hyphens, such as \`default-timeout\``);
  }
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) fail('the spec must be an object, such as `{ when: …, do: … }`');
  const s = spec as Record<string, unknown>;
  const extra = Object.keys(s).find((k) => !(KEYS as readonly string[]).includes(k));
  if (extra !== undefined) fail(`unknown key \`${extra}\` (allowed: ${KEYS.join(', ')})`);

  for (const key of ['when', 'do', 'value', 'decide', 'unknown', 'evenWhen'] as const) {
    const v = s[key];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !v.trim()) fail(`\`${key}\` must be text that is not empty`);
    if (/\n\s*\n/.test(v as string)) fail(`\`${key}\` has a blank line; a label is one paragraph`);
  }
  if (s.when === undefined) fail('`when` is missing: every unit says when it applies');

  const kinds = (['do', 'value', 'decide', 'paths'] as const).filter((k) => s[k] !== undefined);
  const named = [...new Set(kinds.map((k) => (k === 'paths' ? 'decide' : k)))];
  if (named.length > 1) {
    fail(`\`${named[0]}\` and \`${named[1]}\` are two kinds; a unit is one: \`do\` makes a rule, \`value\` a fact, \`decide\` and \`paths\` a decision`);
  }
  const kind: UnitKind = named[0] === 'do' ? 'rule' : named[0] === 'decide' ? 'decision' : 'fact';

  if (kind === 'decision') {
    const paths = s.paths;
    if (!Array.isArray(paths) || !paths.length) fail('a decision needs `paths`, such as `[{ path: \'cache\', when: \'…\' }]`');
    const seen = new Set<string>();
    for (const p of paths as unknown[]) {
      const { path, when, ...rest } = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
      if (typeof path !== 'string' || !UNIT_NAME.test(path)) fail(`each path has a \`path\` in kebab-case, such as \`cache\`; got ${JSON.stringify(path)}`);
      if (typeof when !== 'string' || !when.trim()) fail(`the path \`${path as string}\` needs \`when\`, the condition it is taken on`);
      if (Object.keys(rest).length) fail(`the path \`${path as string}\` has an unknown key \`${Object.keys(rest)[0]}\` (allowed: path, when)`);
      if (seen.has(path as string)) fail(`the path \`${path as string}\` appears twice`);
      seen.add(path as string);
    }
  }
  if (s.unknown !== undefined && kind !== 'fact') fail(`\`unknown\` is for a fact, and this is a ${kind}`);
  if (s.evenWhen !== undefined && kind === 'fact') fail('`evenWhen` is for a rule or a decision, and this is a fact');

  if (s.values !== undefined) {
    if (!s.values || typeof s.values !== 'object' || Array.isArray(s.values)) fail('`values` must be an object of names and values, such as `{ seconds: 10 }`');
    for (const [name, v] of Object.entries(s.values as object)) {
      if (!UNIT_NAME.test(name)) fail(`the value name \`${name}\` must be letters, digits and hyphens, such as \`max-retries\``);
      if (!['string', 'number', 'boolean'].includes(typeof v) || (typeof v === 'number' && !Number.isFinite(v))) {
        fail(`the value \`${name}\` must be text, a finite number or a boolean; got ${JSON.stringify(v) ?? String(v)}`);
      }
      if (typeof v === 'string' && /[\r\n]/.test(v)) fail(`the value \`${name}\` has a line break; a value is one line, since \`{{value:${id as string}.${name}}}\` puts it inside a line`);
    }
  }
  if (s.examples !== undefined) {
    if (kind === 'decision') fail(`a decision shows its examples in its paths, from the regions \`skill:${id as string}.<path>\`; \`examples\` is for a rule or a fact`);
    if (!Array.isArray(s.examples)) fail("`examples` must be a list of `{ lang, text }`, such as `[{ lang: 'sh', text: 'npx skillunit init' }]`");
    for (const x of s.examples as unknown[]) {
      const { lang, text, ...rest } = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
      if (typeof lang !== 'string' || !FENCE_LANG.test(lang)) fail(`each example has a fence language in \`lang\`, such as \`sh\` or \`yaml\`; got ${JSON.stringify(lang)}`);
      if (typeof text !== 'string') fail(`the \`${lang as string}\` example needs its text in \`text\``);
      if (Object.keys(rest).length) fail(`an example has an unknown key \`${Object.keys(rest)[0]}\` (allowed: lang, text)`);
    }
  }
  if (s.ask !== undefined) checkQuestions(id as string, s.ask);
  return kind;
}

/**
 * A number in the text of a unit: digits, with `_` groups and an optional decimal part, not right
 * after a letter, a digit, `_` or `.`. So `300 ms`, `10_000`, `0.5`, `2x` and `5xx` have one,
 * and `utf8`, `h2` and `sha256` do not.
 */
const NUMBER = /(?<![\p{L}\d_.])\d+(?:_\d+)*(?:\.\d+)?/gu;

/** The numbers of `text`, as written, in order. */
export function numbersIn(text: string): string[] {
  return text.match(NUMBER) ?? [];
}

/** Two numbers are the same when they are equal once `_` is taken out. */
const numeric = (written: string) => Number(written.replaceAll('_', ''));

/** The text of a unit the number rule reads, by its label. */
type NumberedText = Pick<UnitSpec, 'when' | 'do' | 'value' | 'decide' | 'paths' | 'unknown' | 'evenWhen' | 'values'>;

/**
 * Throws a `UnitSpecError` when the text of a unit has a number that none of its `values` is:
 * a value that is that number, or text that has it as a number of its own. For a unit with a
 * body, with the `Value` the body set: a number typed into the sentence is one no test checks.
 */
export function checkNumbers(id: string, spec: NumberedText): void {
  const allowed = new Set<number>();
  for (const v of Object.values(spec.values ?? {})) {
    if (typeof v === 'number') allowed.add(v);
    else if (typeof v === 'string') for (const n of numbersIn(v)) allowed.add(numeric(n));
  }
  const labels: [string, string | undefined][] = [
    ['`When`', spec.when],
    ['`Do`', spec.do],
    ['`Value`', spec.value],
    ['`Decide`', spec.decide],
    ...(spec.paths ?? []).map((p): [string, string] => [`the path \`${p.path}\``, p.when]),
    ['`Unknown`', spec.unknown],
    ['`Even when`', spec.evenWhen],
  ];
  for (const [label, text] of labels) {
    if (typeof text !== 'string') continue;
    const typed = numbersIn(text).find((n) => !allowed.has(numeric(n)));
    if (typed === undefined) continue;
    throw new UnitSpecError(
      `unit \`${id}\`: the number ${typed} in ${label} is none of the unit's \`values\`. Give the value a name in the code, build the sentence from that name, and list it in \`values\``,
    );
  }
}

/**
 * The questions of `ask`, each with its id, after checking them. Throws a `UnitSpecError` that
 * names the question and says what to fix.
 */
export function checkQuestions(unitId: string, ask: unknown): AskedQuestion[] {
  const list = Array.isArray(ask) ? ask : [ask];
  const unitFail = (message: string): never => {
    throw new UnitSpecError(`unit \`${unitId}\`: ${message}`);
  };
  if (!list.length) unitFail('`ask` is an empty list; give a question, or leave `ask` out');
  const seen = new Set<string>();
  return list.map((q: unknown, i: number) => {
    if (!q || typeof q !== 'object' || Array.isArray(q)) {
      unitFail(`\`ask\` takes a question, such as \`{ scenario, question, options, expect }\`, or a list of them; item ${i + 1} is ${JSON.stringify(q) ?? String(q)}`);
    }
    const raw = q as Record<string, unknown>;
    if (raw.id !== undefined && (typeof raw.id !== 'string' || !QUESTION_ID.test(raw.id))) {
      unitFail(`question ${i + 1}: \`id\` must be kebab-case, such as \`retry-delay\`; got ${JSON.stringify(raw.id)}`);
    }
    const id = (raw.id as string | undefined) ?? (i ? `${unitId}.${i + 1}` : unitId);
    const fail = (message: string): never => unitFail(`the question \`${id}\`: ${message}`);
    if (seen.has(id)) fail('two questions of the unit have this id; give one of them another `id`');
    seen.add(id);
    return checkQuestion(id, raw, QUESTION_KEYS, fail);
  });
}

/**
 * The file and the question of `ask(id, spec)`, after checking them. Throws a `UnitSpecError`
 * that says what to fix.
 */
export function checkAsk(id: unknown, spec: unknown): { skillFile: string; question: AskedQuestion } {
  const fail = (message: string): never => {
    throw new UnitSpecError(`ask ${typeof id === 'string' ? `\`${id}\`` : String(id)}: ${message}`);
  };
  if (typeof id !== 'string' || !QUESTION_ID.test(id)) fail('the id must be kebab-case, such as `which-file-for-retries`');
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) fail('the spec must be an object, such as `{ file, scenario, question, options, expect }`');
  const { file, ...raw } = spec as Record<string, unknown>;
  if (file !== undefined && (typeof file !== 'string' || !file.trim())) fail('`file` must be the path of a built file of the skill, such as `SKILL.md`');
  const skillFile = (file as string | undefined) ?? DEFAULT_SKILL_FILE;
  if (leavesFolder(skillFile)) fail(`\`file\` is ${skillFile}, which is outside the skill folder; it must be a built file of the skill, such as \`SKILL.md\``);
  const question = checkQuestion(id as string, raw, ['file', ...QUESTION_KEYS.filter((k) => k !== 'id')], fail);
  const others = question.with === undefined ? [] : Array.isArray(question.with) ? question.with : [question.with];
  if (others.includes(skillFile)) fail(`\`with\` lists ${skillFile}, the file the question is about; remove it`);
  return { skillFile, question };
}

/** One question, checked, with `id`. `allowed` is the keys it may have, for the message. */
function checkQuestion(id: string, raw: Record<string, unknown>, allowed: readonly string[], fail: (message: string) => never): AskedQuestion {
  const extra = Object.keys(raw).find((k) => !allowed.includes(k));
  if (extra !== undefined) fail(`unknown key \`${extra}\` (allowed: ${allowed.join(', ')})`);

  const scenario = raw.scenario;
  const scenarios = Array.isArray(scenario) ? scenario : [scenario];
  if (!scenarios.length || scenarios.some((x) => typeof x !== 'string' || !x.trim())) fail('`scenario` must be a sentence or a list of sentences');
  if (typeof raw.question !== 'string' || !raw.question.trim()) fail('`question` must be text that is not empty');
  if (typeof raw.expect !== 'string' || !raw.expect.trim()) fail('`expect` must be an option, `none`, or `yes` or `no` when there are no options');

  const out: AskedQuestion = { id, scenario: Array.isArray(scenario) ? [...(scenario as string[])] : (scenario as string), question: raw.question as string, expect: raw.expect as string };
  if (raw.options === undefined) {
    const expect = out.expect.toLowerCase();
    if (expect !== 'yes' && expect !== 'no') fail(`a question without \`options\` is answered yes or no, so \`expect\` must be \`yes\` or \`no\`; got ${JSON.stringify(raw.expect)}`);
    out.expect = expect;
  } else {
    const labels = optionLabels(raw.options, fail);
    if (labels.includes(NONE)) fail('`none` is added to every question with options; remove it from `options`');
    if (new Set(labels).size !== labels.length) fail('`options` lists a label twice');
    if (labels.length < 2) fail('`options` needs at least two options');
    if (out.expect !== NONE && !labels.includes(out.expect)) fail(`\`expect\` is ${JSON.stringify(out.expect)}, which is not an option (use one of: ${[...labels, NONE].join(', ')})`);
    out.options = Array.isArray(raw.options) ? [...(raw.options as string[])] : { ...(raw.options as Record<string, string | null>) };
  }
  if (raw.with !== undefined) {
    const w = raw.with;
    const paths = Array.isArray(w) ? w : [w];
    if (!paths.length || paths.some((p) => typeof p !== 'string' || !p.trim())) fail('`with` must be `all`, a path, or a list of paths inside the skill folder');
    if (new Set(paths).size !== paths.length) fail('`with` lists the same file twice');
    if (Array.isArray(w) && w.includes('all')) fail('`with: all` stands alone, not in a list');
    const away = (paths as string[]).find(leavesFolder);
    if (away !== undefined) fail(`\`with\` lists ${away}, which is outside the skill folder; the model reads only files of the skill`);
    out.with = Array.isArray(w) ? [...(w as string[])] : (w as string);
  }
  if (raw.section !== undefined) {
    const sec = raw.section;
    const headings = Array.isArray(sec) ? sec : [sec];
    if (!headings.length || headings.some((h) => typeof h !== 'string' || !h.trim())) fail('`section` must be a heading of the built file, or a list of headings');
    out.section = Array.isArray(sec) ? [...(sec as string[])] : (sec as string);
  }
  return out;
}

/**
 * Whether a path from the skill folder leaves it: it is absolute, or its `..` climb above the
 * folder. `features/../SKILL.md` stays in it. With `/` or `\`, as a test on any system writes it.
 */
export function leavesFolder(path: string): boolean {
  const p = path.split('\\').join('/');
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return true;
  let depth = 0;
  for (const part of p.split('/')) {
    if (part === '..') depth--;
    else if (part !== '.' && part !== '') depth++;
    if (depth < 0) return true;
  }
  return false;
}

/** The labels of `options`: the keys of a map, or the items of a list. */
function optionLabels(options: unknown, fail: (message: string) => never): string[] {
  if (Array.isArray(options)) {
    if (options.some((l) => typeof l !== 'string' || !l.trim())) fail('each item of an `options` list is a label');
    return options as string[];
  }
  if (!options || typeof options !== 'object') fail('`options` must be labels and what each means, such as `{ raise: \'…\', off: \'…\' }`, or a list of labels');
  for (const [label, text] of Object.entries(options as object)) {
    if (!label.trim()) fail('an option has an empty label');
    if (text !== null && typeof text !== 'string') fail(`the option \`${label}\` needs text, or \`null\``);
  }
  return Object.keys(options as object);
}

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
 *   "examples": []
 * }
 * ```
 *
 * When it threw, the same `skillunit`, `id`, `file`, `line` and `test`, with
 * `"status": "failed"` and the error's message in `error`. A skipped test leaves nothing.
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
  /** Any kind: ``forbid `/regex/` in <languages>``. */
  check?: string;
  /** Named values the prose of the skill may use, as `{{value:<id>.<name>}}`. */
  values?: Record<string, UnitScalar>;
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
  when: string;
  do?: string;
  value?: string;
  decide?: string;
  paths?: UnitPath[];
  unknown?: string;
  evenWhen?: string;
  check?: string;
  values?: Record<string, UnitScalar>;
  /** The blocks of `u.example`, in the order of the calls. */
  examples: UnitExample[];
}

export interface FailedUnit extends RecordBase {
  status: 'failed';
  /** The message of what the body or the spec threw. */
  error: string;
}

export type UnitRecord = PassedUnit | FailedUnit;

/** A unit id: kebab-case, as lint wants it. */
export const UNIT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The name of a path of a decision, or of a value. */
export const UNIT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

const KEYS = ['when', 'do', 'value', 'decide', 'paths', 'unknown', 'evenWhen', 'check', 'values'] as const;

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

  for (const key of ['when', 'do', 'value', 'decide', 'unknown', 'evenWhen', 'check'] as const) {
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
    }
  }
  return kind;
}

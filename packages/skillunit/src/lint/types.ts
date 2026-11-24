/** What `skillunit lint` reports. */

export type Severity = 'error' | 'warning';

/**
 * The lint rules, by the name each problem is reported under. Any of them can be turned off with
 * `lint: { off: [...] }` in `skillunit.yaml`.
 */
export const LINT_RULES = ['parse', 'structure', 'setup', 'check', 'types', 'command', 'index', 'length', 'fence', 'proof'] as const;

/** The rule that found a problem, for filtering and for reporters. */
export type LintRule = (typeof LINT_RULES)[number];

export interface Problem {
  /** Path in the skill folder, with `/`. */
  file: string;
  line: number;
  /** The unit the line belongs to, if any. */
  unit?: string;
  severity: Severity;
  rule: LintRule;
  message: string;
  /** The TypeScript code, such as `TS2322`, of a problem the type-check found. */
  code?: string;
  /** Markdown line where the example (or `Setup`) the problem is in starts. */
  example?: number;
  /** Where the line comes from, when the skill is built from `source`: the file to edit instead. */
  origin?: Origin;
}

/**
 * Where a line of a built skill comes from: a test that declares a unit, or a file of `source`.
 * `file` is from the skill folder, with `/`, as `Problem.file` is.
 */
export type Origin = { kind: 'test'; file: string; line: number; unit: string } | { kind: 'source'; file: string; line: number };

export interface LintSummary {
  files: number;
  units: number;
  /** TypeScript version that type-checked the examples, when it ran. */
  typescript?: string;
  /** `ts`, `tsx`, `js` and `jsx` fences that went through the type-check, `Setup` blocks included. */
  typeChecked: number;
  /** `ts`, `tsx`, `js` and `jsx` fences that did not parse, or whose `Setup` did not: their types were not checked. */
  notParsed: number;
  /** Fences of other languages run through their configured command. */
  commandChecked: number;
  /** Example fences of other languages that nothing checked, per language: no command is set. */
  unchecked: Record<string, number>;
  /** Fences marked `no-check`. */
  noCheck: number;
  /** `ts`, `tsx`, `js` and `jsx` fences skipped because `examples.ts` is not set. */
  notConfigured: number;
  /** Rules turned off in `skillunit.yaml`: their problems are not reported. */
  off: string[];
  /**
   * Names `tsc` could not find (TS2304, TS2552), with the number of findings each, the most
   * frequent first. A `Setup` block in `SKILL.md` that declares them removes those findings.
   */
  undeclared: { name: string; count: number }[];
}

export interface LintResult {
  /** Absolute path of the skill folder. */
  skill: string;
  /** Every Markdown file of the skill, from the skill folder, clean ones included. */
  files: string[];
  ok: boolean;
  problems: Problem[];
  summary: LintSummary;
}

/** The settings, or the tools they point to, are wrong. The CLI exits with 2. */
export class ConfigError extends Error {}

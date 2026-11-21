/** What `skillunit lint` reports. */

export type Severity = 'error' | 'warning';

/** The rule that found a problem, for filtering and for reporters. `sync` comes from `skillunit sync`. */
export type LintRule = 'parse' | 'structure' | 'check' | 'setup' | 'types' | 'wrong-code' | 'command' | 'index' | 'source' | 'sync';

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
}

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
  wrongCode: {
    /** `Wrong` code that was type-checked or matched by a `Check`. */
    checked: number;
    /** `Wrong` code with no language, or in a language that is not type-checked. */
    unchecked: number;
  };
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

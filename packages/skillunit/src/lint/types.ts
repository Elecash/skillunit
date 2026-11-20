/** What `skillunit lint` reports. */

export type Severity = 'error' | 'warning';

/** The lint rule that found a problem, for filtering and for reporters. */
export type LintRule = 'parse' | 'structure' | 'check' | 'setup' | 'types' | 'wrong-code' | 'command' | 'index';

export interface Problem {
  /** Path in the skill folder, with `/`. */
  file: string;
  line: number;
  /** The unit the line belongs to, if any. */
  unit?: string;
  severity: Severity;
  rule: LintRule;
  message: string;
}

export interface LintSummary {
  files: number;
  units: number;
  /** TypeScript version that type-checked the examples, when it ran. */
  typescript?: string;
  /** `ts`, `tsx`, `js` and `jsx` fences type-checked, `Setup` blocks included. */
  typeChecked: number;
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
  ok: boolean;
  problems: Problem[];
  summary: LintSummary;
}

/** The settings, or the tools they point to, are wrong. The CLI exits with 2. */
export class ConfigError extends Error {}

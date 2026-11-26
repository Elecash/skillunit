/** What the proof reports, and the error for settings that are wrong. */

export type Severity = 'error' | 'warning';

export interface Problem {
  /** Path from the skill folder, with `/`. */
  file: string;
  line: number;
  /** The unit the line belongs to, if any. */
  unit?: string;
  severity: Severity;
  message: string;
  /** Where the line comes from, when the skill is built: the file to edit instead. */
  origin?: Origin;
  /**
   * A line of the skill folder that is not what the build gives: both lines whole, whatever the
   * message shows. Null on the side that has no line there.
   */
  lines?: { build: string | null; skill: string | null };
}

/**
 * Where a line of a built skill comes from: a test that declares a unit, or the `setup()` of its file.
 * For a record that is not valid, the test the record names, with `unit` when its id is one.
 * `file` is from the skill folder, with `/`, as `Problem.file` is.
 */
export type Origin = { kind: 'test'; file: string; line: number; unit?: string };

/** The settings, or the tools they point to, are wrong. The CLI exits with 2. */
export class ConfigError extends Error {}

/**
 * The one report every command builds and every reporter prints: the layers that ran, each with
 * its own result. `--reporter json` prints it as it is.
 */
import type { LintResult } from '../lint/types.js';
import type { ProofResult, ProofSkipped } from '../proof/layer.js';
import type { Report as TestReport } from '../test/runner.js';
import type { UnitKind } from '../units/types.js';

/** Bumped only when a field changes meaning or disappears. */
export const REPORT_SCHEMA = 5;

export type Command = 'lint' | 'proof' | 'test' | 'check';

export interface CheckReport {
  schema: typeof REPORT_SCHEMA;
  command: Command;
  ok: boolean;
  /** Every unit of the skill, in the order of its files, so a tool can join the layers on the id. */
  units?: ReportUnit[];
  lint?: LintResult;
  /** `{ configured: false }` when `check` ran and the settings have no `proof` key. */
  proof?: ProofResult | ProofSkipped;
  test?: TestReport;
}

export interface ReportUnit {
  id: string;
  kind: UnitKind;
  /** From the skill folder. */
  file: string;
  /** Line of the unit's heading. */
  line: number;
}

export const REPORTERS = ['table', 'json', 'junit', 'github'] as const;
export type ReporterName = (typeof REPORTERS)[number];

export interface ReportOptions {
  /** Paths in the output are relative to this folder. */
  cwd: string;
  color: boolean;
  /** The table reporter prints one row per unit. The other reporters ignore it. */
  compact?: boolean;
}

export function buildReport(command: Command, layers: Omit<CheckReport, 'schema' | 'command' | 'ok'>): CheckReport {
  const ok = [layers.lint, layers.proof, layers.test].every((l) => l === undefined || l.ok);
  return { schema: REPORT_SCHEMA, command, ok, ...layers };
}

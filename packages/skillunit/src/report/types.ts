/**
 * The one report every command builds and every reporter prints: the layers that ran, each with
 * its own result. `--reporter json` prints it as it is.
 */
import type { LintResult } from '../lint/types.js';
import type { ProofResult, ProofSkipped } from '../proof/layer.js';
import type { SyncResult } from '../sync/sync.js';
import type { Report as TestReport } from '../test/runner.js';

/**
 * Bumped only when a field changes meaning or disappears. 1 was the `run --json` report; 2 had
 * sync compare git commits; 3 has it compare `skillunit.lock`.
 */
export const REPORT_SCHEMA = 3;

export type Command = 'lint' | 'sync' | 'proof' | 'test' | 'check';

export interface CheckReport {
  schema: typeof REPORT_SCHEMA;
  command: Command;
  ok: boolean;
  lint?: LintResult;
  sync?: SyncResult;
  /** `{ configured: false }` when `check` ran and the settings have no `proof` key. */
  proof?: ProofResult | ProofSkipped;
  test?: TestReport;
}

export const REPORTERS = ['table', 'json', 'junit', 'github'] as const;
export type ReporterName = (typeof REPORTERS)[number];

export interface ReportOptions {
  /** Paths in the output are relative to this folder. */
  cwd: string;
  color: boolean;
}

export function buildReport(command: Command, layers: Omit<CheckReport, 'schema' | 'command' | 'ok'>): CheckReport {
  const ok = [layers.lint, layers.sync, layers.proof, layers.test].every((l) => l === undefined || l.ok);
  return { schema: REPORT_SCHEMA, command, ok, ...layers };
}

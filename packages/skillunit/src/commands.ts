/**
 * The commands of `skillunit`, the options each takes and the codes it exits with. `cli.ts`
 * reads them; they live here so that a test can read them too, since `cli.ts` runs when it is
 * imported.
 */
import type { Command } from './report/types.js';

/** Options every command but `init` takes. */
export const COMMON_OPTIONS = ['--config', '--skill', '--reporter', '--json'] as const;

/** Options each command takes, besides `COMMON_OPTIONS`. */
export const OPTIONS = {
  proof: ['--compact', '--write', '--no-run'],
  test: ['--compact', '--no-run', '--base', '--dry-run', '--changed', '--provider', '--model', '--choice', '--yes', '--no', '--margin'],
  check: ['--compact', '--no-run', '--base', '--dry-run', '--changed', '--provider', '--model', '--choice', '--yes', '--no', '--margin'],
} as const satisfies Record<Command, readonly string[]>;

/** The command that writes the settings; it takes the skill folder, and no option. */
export const INIT = 'init';

/** What the process exits with. */
export const EXIT = {
  /** Every check passed; borderline verdicts allowed. */
  passed: 0,
  /** A check failed. */
  failed: 1,
  /** The command itself was wrong: an unknown option, a missing file, no API key, bad settings. */
  usage: 2,
} as const;

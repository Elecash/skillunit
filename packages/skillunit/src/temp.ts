/**
 * Removing the temporary folders of a run. Deleting can fail where a sandbox forbids it (`EPERM`
 * on `unlink`) or, on Windows, where another process holds a file open (`EPERM`, `EBUSY`). The
 * run has its result by then, so a folder that stays gets one warning and the run goes on.
 */
import { rmSync } from 'node:fs';

export type Warn = (message: string) => void;

const toStderr: Warn = (message) => process.stderr.write(`skillunit: warning: ${message}\n`);

/**
 * Removes `dir` and everything in it. `rmSync` retries `EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY`
 * and `EPERM` up to `maxRetries` times, waiting `retryDelay` (100 ms) longer each time; whatever
 * still fails is a warning, not an error.
 */
export function removeTemp(dir: string, warn: Warn = toStderr): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch (e) {
    const why = (e as NodeJS.ErrnoException).code ?? (e as Error).message;
    warn(`could not remove the temporary folder ${dir} (${why}); delete it yourself`);
  }
}

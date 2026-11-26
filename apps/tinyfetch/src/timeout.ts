import { TimeoutError } from './errors.js';

export const DEFAULT_TIMEOUT = 10_000;
/** The timeout that turns the timeout off: a timeout of this or less never fires. */
export const NO_TIMEOUT = 0;

/**
 * A signal that aborts after `timeout` milliseconds, or when `signal` aborts. A timeout of
 * `NO_TIMEOUT` never fires.
 */
export function withTimeout(timeout: number, signal?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = timeout > NO_TIMEOUT ? setTimeout(() => controller.abort(new TimeoutError(timeout)), timeout) : undefined;
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

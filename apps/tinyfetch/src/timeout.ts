import { TimeoutError } from './errors.js';

export const DEFAULT_TIMEOUT = 10_000;

/**
 * A signal that aborts after `timeout` milliseconds, or when `signal` aborts. A timeout of 0
 * never fires.
 */
export function withTimeout(timeout: number, signal?: AbortSignal): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = timeout > 0 ? setTimeout(() => controller.abort(new TimeoutError(timeout)), timeout) : undefined;
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

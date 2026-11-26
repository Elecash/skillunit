import { isHttpError } from './errors.js';

export const DEFAULT_RETRY = 0;
export const DEFAULT_RETRY_DELAY = 300;
/** Each wait before a new attempt is this many times the one before it. */
export const RETRY_TIMES = 2;
/** The lowest status a request is retried on. */
export const RETRIED_STATUS = 500;

/** What `fetch` threw, carried out of an attempt so `withRetry` can tell a network error from any other. */
export class NetworkFailure {
  constructor(readonly error: unknown) {}
}

/**
 * Runs `attempt`, and again up to `retry` more times after a network error, which the attempt
 * throws as a `NetworkFailure`, or an HttpError with a status of `RETRIED_STATUS` or above;
 * anything else is thrown at once. It
 * waits `retryDelay` ms before the first new attempt and `RETRY_TIMES` times the wait before it
 * before each next one. An abort of `signal` during a wait ends it with the signal's reason. A
 * network error is thrown as `fetch` threw it.
 */
export async function withRetry<T>(attempt: () => Promise<T>, retry = DEFAULT_RETRY, retryDelay = DEFAULT_RETRY_DELAY, signal?: AbortSignal): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await attempt();
    } catch (error) {
      const retryable = error instanceof NetworkFailure || (isHttpError(error) && error.status >= RETRIED_STATUS);
      if (n >= retry || !retryable) throw error instanceof NetworkFailure ? error.error : error;
      await wait(retryDelay * RETRY_TIMES ** n, signal);
    }
  }
}

/** Resolves after `ms`, or rejects with the reason of `signal` when it aborts first. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

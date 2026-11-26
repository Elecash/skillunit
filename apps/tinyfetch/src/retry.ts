import { isHttpError } from './errors.js';

export const DEFAULT_RETRY = 0;
export const DEFAULT_RETRY_DELAY = 300;
/** Each wait before a new attempt is this many times the one before it. */
export const RETRY_TIMES = 2;
/** The lowest status a request is retried on. */
export const RETRIED_STATUS = 500;

/**
 * Runs `attempt`, and again up to `retry` more times after a network error or a status of
 * `RETRIED_STATUS` or above, waiting `retryDelay` ms before the first new attempt and
 * `RETRY_TIMES` times the wait before it before each next one.
 */
export async function withRetry<T>(attempt: () => Promise<T>, retry = DEFAULT_RETRY, retryDelay = DEFAULT_RETRY_DELAY): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await attempt();
    } catch (error) {
      const retryable = !isHttpError(error) || error.status >= RETRIED_STATUS;
      if (n >= retry || !retryable || (error instanceof Error && error.name === 'TimeoutError')) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelay * RETRY_TIMES ** n));
    }
  }
}

import { isHttpError } from './errors.js';

export const DEFAULT_RETRY = 0;
export const DEFAULT_RETRY_DELAY = 300;

/**
 * Runs `attempt`, and again up to `retry` more times after a network error or a 5xx status,
 * waiting `retryDelay` ms before the first new attempt and twice as long before each next one.
 */
export async function withRetry<T>(attempt: () => Promise<T>, retry = DEFAULT_RETRY, retryDelay = DEFAULT_RETRY_DELAY): Promise<T> {
  for (let n = 0; ; n++) {
    try {
      return await attempt();
    } catch (error) {
      const retryable = !isHttpError(error) || error.status >= 500;
      if (n >= retry || !retryable || (error instanceof Error && error.name === 'TimeoutError')) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelay * 2 ** n));
    }
  }
}

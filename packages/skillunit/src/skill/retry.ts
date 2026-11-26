// A stand-in for the code a skill describes, for the examples of this skill: how long a client
// waits before each new attempt of a request.

/** The wait before the first new attempt, in milliseconds. */
export const DEFAULT_RETRY_DELAY = 300;
/** Each next wait is this many times the one before. */
export const RETRY_TIMES = 2;

/** The waits before each of `attempts` new attempts. */
export function retryWaits(attempts: number, delay = DEFAULT_RETRY_DELAY): number[] {
  return Array.from({ length: attempts }, (_, n) => delay * RETRY_TIMES ** n);
}

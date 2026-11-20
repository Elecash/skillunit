/** The server answered with a status outside 200–299. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
  }
}

/** The request took longer than its `timeout`. */
export class TimeoutError extends Error {
  constructor(readonly timeout: number) {
    super(`timed out after ${timeout} ms`);
    this.name = 'TimeoutError';
  }
}

/** True for an HttpError, including one thrown by another copy of tinyfetch. */
export function isHttpError(error: unknown): error is HttpError {
  return error instanceof Error && error.name === 'HttpError' && typeof (error as HttpError).status === 'number';
}

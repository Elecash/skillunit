import { HttpError } from './errors.js';
import { NetworkFailure, withRetry } from './retry.js';
import { DEFAULT_TIMEOUT, withTimeout } from './timeout.js';
import type { ClientOptions, RequestOptions } from './types.js';

export type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** The media type of what tinyfetch sends, and of what it asks for. */
export const JSON_TYPE = 'application/json';
/** A response whose `content-type` has this in it is parsed as JSON. */
export const PARSED_TYPE = 'json';
/** Where a path that is not a whole URL goes when the client has no `baseUrl`. */
export const DEFAULT_BASE = 'http://localhost';
/** A whole URL starts with a scheme, such as `https:`. */
const WHOLE_URL = /^[a-z][a-z\d+.-]*:/i;

/**
 * The URL of a request. A whole URL is used as it is. Any other path goes after `baseUrl`, with
 * one `/` between them, whatever slashes the two have; with no `baseUrl`, it goes to
 * `DEFAULT_BASE`.
 */
export function requestUrl(baseUrl: string | undefined, path: string): URL {
  if (WHOLE_URL.test(path) || baseUrl === undefined) return new URL(path, DEFAULT_BASE);
  return new URL(`${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`);
}

/** A body that says it is JSON is parsed; any other is the text. */
function parse(text: string, response: Response): unknown {
  return text && response.headers.get('content-type')?.includes(PARSED_TYPE) ? JSON.parse(text) : text;
}

/**
 * One request: the path after the client's `baseUrl`, the query encoded, the body sent as JSON,
 * and the response parsed as JSON when it says it is JSON. A response that is not `ok` throws an
 * HttpError with its status, and its body parsed, or its text when it does not parse. The caller's
 * `signal` is honoured before the request, during an attempt and between attempts.
 */
export async function request<T>(client: ClientOptions, method: Method, path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  const url = requestUrl(client.baseUrl, path);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value));
  // `Headers` takes a name in any case as the same header, so a later one replaces an earlier one.
  const headers = new Headers({ accept: JSON_TYPE });
  for (const extra of [client.headers, options.headers]) for (const [name, value] of Object.entries(extra ?? {})) headers.set(name, value);
  if (body !== undefined) headers.set('content-type', JSON_TYPE);

  return withRetry(
    async () => {
      const { signal, done } = withTimeout(options.timeout ?? client.timeout ?? DEFAULT_TIMEOUT, options.signal);
      try {
        signal.throwIfAborted();
        const response = await fetch(url, { method, headers, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }).catch((error: unknown) => {
          throw signal.aborted ? signal.reason : new NetworkFailure(error);
        });
        const text = method === 'HEAD' ? '' : await response.text();
        if (!response.ok) {
          let errorBody: unknown = text;
          try {
            errorBody = parse(text, response);
          } catch {
            // A body that says it is JSON and is not: the HttpError keeps its text.
          }
          throw new HttpError(response.status, errorBody);
        }
        return parse(text, response) as T;
      } catch (error) {
        // Whatever an attempt was doing when its signal aborted, the reason of the abort is what it throws.
        throw signal.aborted && !(error instanceof NetworkFailure) ? signal.reason : error;
      } finally {
        done();
      }
    },
    options.retry,
    options.retryDelay,
    options.signal,
  );
}

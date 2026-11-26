import { HttpError } from './errors.js';
import { withRetry } from './retry.js';
import { DEFAULT_TIMEOUT, withTimeout } from './timeout.js';
import type { ClientOptions, RequestOptions } from './types.js';

export type Method = 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * One request: the path joined to the client's `baseUrl`, the query encoded, the body sent as
 * JSON, and the response parsed as JSON when it is JSON. A response that is not `ok` throws an
 * HttpError.
 */
export async function request<T>(client: ClientOptions, method: Method, path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  const url = new URL(path, client.baseUrl ?? 'http://localhost');
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value));
  const headers: Record<string, string> = { accept: 'application/json', ...client.headers, ...options.headers };
  if (body !== undefined) headers['content-type'] = 'application/json';

  return withRetry(
    async () => {
      const { signal, done } = withTimeout(options.timeout ?? client.timeout ?? DEFAULT_TIMEOUT, options.signal);
      try {
        const response = await fetch(url, { method, headers, signal, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        const text = method === 'HEAD' ? '' : await response.text();
        const parsed: unknown = text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
        if (!response.ok) throw new HttpError(response.status, parsed);
        return parsed as T;
      } catch (error) {
        throw signal.aborted && signal.reason instanceof Error ? signal.reason : error;
      } finally {
        done();
      }
    },
    options.retry,
    options.retryDelay,
  );
}

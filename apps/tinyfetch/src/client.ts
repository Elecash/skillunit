import { request } from './request.js';
import type { ClientOptions, RequestOptions } from './types.js';

export interface Client {
  get<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
  head(path: string, options?: RequestOptions): Promise<void>;
  post<T = unknown>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
  put<T = unknown>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
  patch<T = unknown>(path: string, body: unknown, options?: RequestOptions): Promise<T>;
  delete<T = unknown>(path: string, options?: RequestOptions): Promise<T>;
}

/** A client whose requests share a base URL, headers and timeout. */
export function create(options: ClientOptions = {}): Client {
  return {
    get: (path, o) => request(options, 'GET', path, undefined, o),
    head: async (path, o) => {
      await request(options, 'HEAD', path, undefined, o);
    },
    post: (path, body, o) => request(options, 'POST', path, body, o),
    put: (path, body, o) => request(options, 'PUT', path, body, o),
    patch: (path, body, o) => request(options, 'PATCH', path, body, o),
    delete: (path, o) => request(options, 'DELETE', path, undefined, o),
  };
}

/** The default client, with no base URL, and `create` to make others. */
export const tf: Client & { create: typeof create } = { ...create(), create };

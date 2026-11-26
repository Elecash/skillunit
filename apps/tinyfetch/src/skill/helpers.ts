// What the tests of the skill share: a `fetch` that answers what a test tells it to, and the
// helpers that build sentences. Not a test: it declares nothing.
import { tf } from 'tinyfetch';
import { vi } from 'vitest';

export type Reply = { status?: number; body?: unknown; delay?: number; type?: string } | Error;
export const calls: { url: string; init: RequestInit }[] = [];

/** Replaces `fetch` with one that answers each call with the next reply. */
export function serve(...replies: Reply[]) {
  calls.length = 0;
  vi.stubGlobal('fetch', async (url: URL, init: RequestInit) => {
    calls.push({ url: url.toString(), init });
    const reply = replies.shift() ?? { status: 200 };
    if (reply instanceof Error) throw reply;
    if (reply.delay) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, reply.delay);
        init.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(init.signal!.reason);
        });
      });
    }
    const type = reply.type ?? 'application/json';
    const text = reply.body === undefined ? '' : type.includes('json') ? JSON.stringify(reply.body) : String(reply.body);
    return new Response(text, { status: reply.status ?? 200, headers: { 'content-type': type } });
  });
}

/** Undoes what a test stubbed, mocked or faked. */
export function reset() {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
}

/** 10000 as `10_000`, the way the skill's examples write numbers. */
export const underscored = (n: number) => n.toLocaleString('en-US').replace(/,/g, '_');

/** Each method of the default client, by its name, called on `url`. */
export function methods(url: string): Record<string, () => Promise<unknown>> {
  const { create: _, ...client } = tf;
  return Object.fromEntries(
    Object.entries(client).map(([name, method]) => [name, () => (method.length > 2 ? (method as (p: string, b: unknown) => Promise<unknown>)(url, {}) : (method as (p: string) => Promise<unknown>)(url))]),
  );
}
export const everyMethod = (url: string) => Object.values(methods(url));

/** `a`, `a and b`, `a, b and c`. */
export const and = (items: string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

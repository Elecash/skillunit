import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, isHttpError, tf, TimeoutError } from './index.js';

type Reply = { status?: number; body?: unknown; delay?: number } | Error;
const calls: { url: string; init: RequestInit }[] = [];

/** Replaces `fetch` with one that answers each call with the next reply. */
function serve(...replies: Reply[]) {
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
    return new Response(reply.body === undefined ? '' : JSON.stringify(reply.body), {
      status: reply.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('tinyfetch', () => {
  it('joins the base URL, encodes the query and parses JSON', async () => {
    serve({ body: [{ id: 1 }] });
    const api = tf.create({ baseUrl: 'https://api.example.com/v1/', headers: { authorization: 'Bearer t' } });
    expect(await api.get('users', { query: { page: 2, q: 'a b' } })).toEqual([{ id: 1 }]);
    expect(calls[0]!.url).toBe('https://api.example.com/v1/users?page=2&q=a+b');
    expect(calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer t', accept: 'application/json' });
  });

  it('sends the body as JSON', async () => {
    serve({ status: 201, body: { id: 2 } });
    expect(await tf.post('http://x/users', { name: 'Ada' })).toEqual({ id: 2 });
    expect(calls[0]!.init).toMatchObject({ method: 'POST', body: '{"name":"Ada"}', headers: { 'content-type': 'application/json' } });
  });

  it('throws an HttpError with the status and the parsed body', async () => {
    serve({ status: 404, body: { error: 'not found' } });
    const error = await tf.get('http://x/missing').catch((e: unknown) => e);
    expect(isHttpError(error)).toBe(true);
    expect(error).toMatchObject({ status: 404, body: { error: 'not found' } });
    expect(error).toBeInstanceOf(HttpError);
  });

  it('retries network errors and 5xx, not 4xx', async () => {
    serve(new TypeError('fetch failed'), { status: 503 }, { body: 'ok' });
    expect(await tf.get('http://x/a', { retry: 2, retryDelay: 1 })).toBe('ok');
    expect(calls).toHaveLength(3);
    serve({ status: 400 }, { body: 'never' });
    await expect(tf.get('http://x/a', { retry: 2, retryDelay: 1 })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
  });

  it('times out with a TimeoutError, and never with timeout 0', async () => {
    serve({ delay: 50, body: 'late' });
    await expect(tf.get('http://x/slow', { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
    serve({ delay: 20, body: 'late' });
    expect(await tf.get('http://x/slow', { timeout: 0 })).toBe('late');
  });

  it('cancels with the caller signal', async () => {
    serve({ delay: 50, body: 'late' });
    const controller = new AbortController();
    const pending = tf.get('http://x/slow', { signal: controller.signal });
    controller.abort(new Error('cancelled'));
    await expect(pending).rejects.toThrow('cancelled');
  });
});

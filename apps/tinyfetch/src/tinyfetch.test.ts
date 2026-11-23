// A `[skill:<id>]` in a test's title says the test proves that unit of the skill, and a
// `#region skill:<id>` holds the example `skillunit proof --write` copies into the block flagged
// `proof=<id>`. See docs/proof.md.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, isHttpError, tf, TimeoutError } from './index.js';
import { DEFAULT_RETRY_DELAY } from './retry.js';
import { DEFAULT_TIMEOUT } from './timeout.js';

type Reply = { status?: number; body?: unknown; delay?: number; type?: string } | Error;
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
    const type = reply.type ?? 'application/json';
    const text = reply.body === undefined ? '' : type.includes('json') ? JSON.stringify(reply.body) : String(reply.body);
    return new Response(text, { status: reply.status ?? 200, headers: { 'content-type': type } });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('tinyfetch', () => {
  it('joins the base URL, encodes the query and parses JSON', async () => {
    serve({ body: [{ id: 1 }] });
    const api = tf.create({ baseUrl: 'https://api.example.com/v1/', headers: { authorization: 'Bearer t' } });
    expect(await api.get('users', { query: { page: 2, q: 'a b' } })).toEqual([{ id: 1 }]);
    expect(calls[0]!.url).toBe('https://api.example.com/v1/users?page=2&q=a+b');
    expect(calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer t', accept: 'application/json' });
  });

  it('resolves to the parsed body, so the caller awaits it [skill:await-every-request]', async () => {
    serve({ body: { name: 'Ada' } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    // #region skill:await-every-request
    const user = await tf.get<{ name: string }>('https://api.example.com/users/1');
    console.log(user.name);
    // #endregion
    expect(log).toHaveBeenCalledWith('Ada');
  });

  it('parses a JSON response and returns any other as text [skill:response-body]', async () => {
    serve({ body: { id: 1 } }, { body: 'plain', type: 'text/plain' }, { body: '<p>hi</p>', type: 'text/html' });
    expect(await tf.get('http://x/json')).toEqual({ id: 1 });
    expect(await tf.get('http://x/text')).toBe('plain');
    expect(await tf.get('http://x/html')).toBe('<p>hi</p>');
  });

  it('encodes the query option [skill:query-in-options]', async () => {
    serve({ body: [] });
    // #region skill:query-in-options
    await tf.get('https://api.example.com/users', {
      query: { page: 2, sort: 'name' },
    });
    // #endregion
    expect(calls[0]!.url).toBe('https://api.example.com/users?page=2&sort=name');
  });

  it('sends the body as JSON [skill:body-as-object]', async () => {
    serve({ status: 201, body: { id: 2 } });
    // #region skill:body-as-object
    await tf.post('https://api.example.com/users', { name: 'Ada' });
    // #endregion
    expect(calls[0]!.init).toMatchObject({ method: 'POST', body: '{"name":"Ada"}', headers: { 'content-type': 'application/json' } });
  });

  it('throws an HttpError with the status and the parsed body, and what fetch threw for a network failure [skill:what-a-failed-request-throws]', async () => {
    serve({ status: 404, body: { error: 'not found' } });
    const error = await tf.get('http://x/missing').catch((e: unknown) => e);
    expect(isHttpError(error)).toBe(true);
    expect(error).toMatchObject({ status: 404, body: { error: 'not found' } });
    expect(error).toBeInstanceOf(HttpError);
    serve({ status: 302 });
    await expect(tf.get('http://x/moved')).rejects.toBeInstanceOf(HttpError);
    const failure = new TypeError('fetch failed');
    serve(failure);
    await expect(tf.get('http://x/down')).rejects.toBe(failure);
    serve({ delay: 50 });
    await expect(tf.get('http://x/slow', { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
  });

  it('lets the caller tell a 404 apart with isHttpError [skill:check-with-is-http-error]', async () => {
    serve({ status: 404, body: { error: 'not found' } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    // #region skill:check-with-is-http-error
    try {
      await tf.get('https://api.example.com/users/1');
    } catch (error) {
      if (isHttpError(error) && error.status === 404) console.log('no such user');
      else throw error;
    }
    // #endregion
    expect(log).toHaveBeenCalledWith('no such user');
  });

  it('retries network errors and 5xx, not 4xx or a timeout [skill:what-is-retried]', async () => {
    serve(new TypeError('fetch failed'), { status: 503 }, { body: 'ok' });
    expect(await tf.get('http://x/a', { retry: 2, retryDelay: 1 })).toBe('ok');
    expect(calls).toHaveLength(3);
    serve({ status: 400 }, { body: 'never' });
    await expect(tf.get('http://x/a', { retry: 2, retryDelay: 1 })).rejects.toMatchObject({ status: 400 });
    expect(calls).toHaveLength(1);
    serve({ delay: 50 }, { body: 'never' });
    await expect(tf.get('http://x/a', { retry: 2, retryDelay: 1, timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
    expect(calls).toHaveLength(1);
  });

  it('does not retry by default, and waits 300 ms, then twice as long each time [skill:retry-defaults]', async () => {
    expect(DEFAULT_RETRY_DELAY).toBe(300);
    serve({ status: 503 }, { body: 'never' });
    await expect(tf.get('http://x/a')).rejects.toMatchObject({ status: 503 });
    expect(calls).toHaveLength(1);

    vi.useFakeTimers();
    serve({ status: 503 }, { status: 503 }, { body: 'ok' });
    const pending = tf.get('http://x/a', { retry: 2 });
    await vi.advanceTimersByTimeAsync(299);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(599);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toHaveLength(3);
    expect(await pending).toBe('ok');
  });

  it('times out after 10 seconds when the code sets nothing [skill:default-timeout]', async () => {
    expect(DEFAULT_TIMEOUT).toBe(10_000);
    vi.useFakeTimers();
    serve({ delay: 60_000, body: 'late' });
    const pending = tf.get('http://x/slow').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({ name: 'TimeoutError', timeout: 10_000 });
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

// A `unit()` is a test that declares a unit of the skill: its sentence is built here, from the
// code where the code has the value, and `skillunit proof` puts it where `skill-src` has
// `{{unit:<id>}}`. A `#region skill:<id>` in its body is the unit's example. See docs/proof.md.
import { unit } from 'skillunit/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, isHttpError, tf, TimeoutError } from './index.js';
import { DEFAULT_RETRY, DEFAULT_RETRY_DELAY } from './retry.js';
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

/** 10000 as `10_000`, the way the skill's examples write numbers. */
const underscored = (n: number) => n.toLocaleString('en-US').replace(/,/g, '_');

/** `a`, `a and b`, `a, b and c`. */
const and = (items: string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

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

  unit(
    'await-every-request',
    {
      when: 'the code calls a tinyfetch method.',
      do: '`await` the call, or return its promise: every method returns a promise of the parsed body.',
    },
    async () => {
      serve({ body: { name: 'Ada' } });
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      // #region skill:await-every-request
      const user = await tf.get<{ name: string }>('https://api.example.com/users/1');
      console.log(user.name);
      // #endregion
      expect(log).toHaveBeenCalledWith('Ada');
    },
  );

  unit(
    'response-body',
    {
      when: 'a request resolves.',
      value: 'a response whose `content-type` is JSON comes back parsed; any other comes back as text.',
    },
    async () => {
      serve({ body: { id: 1 } }, { body: 'plain', type: 'text/plain' }, { body: '<p>hi</p>', type: 'text/html' });
      expect(await tf.get('http://x/json')).toEqual({ id: 1 });
      expect(await tf.get('http://x/text')).toBe('plain');
      expect(await tf.get('http://x/html')).toBe('<p>hi</p>');
    },
  );

  unit(
    'query-in-options',
    {
      when: 'a request needs query parameters.',
      do: 'pass them in the `query` option, which encodes each value.',
      check: 'forbid `/\\.(get|head|post|put|patch|delete)(<[^>]*>)?\\(\\s*["\'][^"\']*\\?/` in ts',
    },
    async () => {
      serve({ body: [] });
      // #region skill:query-in-options
      await tf.get('https://api.example.com/users', {
        query: { page: 2, sort: 'name' },
      });
      // #endregion
      expect(calls[0]!.url).toBe('https://api.example.com/users?page=2&sort=name');
    },
  );

  unit(
    'body-as-object',
    {
      when: 'a request sends data.',
      do: 'pass the object itself as the body; tinyfetch serializes it and sets `content-type`.',
      check: 'forbid `/JSON\\.stringify/` in ts',
    },
    async () => {
      serve({ status: 201, body: { id: 2 } });
      // #region skill:body-as-object
      await tf.post('https://api.example.com/users', { name: 'Ada' });
      // #endregion
      expect(calls[0]!.init).toMatchObject({ method: 'POST', body: '{"name":"Ada"}', headers: { 'content-type': 'application/json' } });
    },
  );

  unit(
    'what-a-failed-request-throws',
    {
      when: 'a tinyfetch call fails.',
      value: `a status outside 200–299 throws an \`${HttpError.name}\` with the \`status\` and the parsed \`body\`; a timeout throws a \`${TimeoutError.name}\`; a network failure throws what \`fetch\` threw.`,
    },
    async () => {
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
    },
  );

  unit(
    'check-with-is-http-error',
    {
      when: 'code catches an error from a tinyfetch call and reads its status.',
      do: 'test the error with `isHttpError(error)` before reading `status` or `body`.',
    },
    async () => {
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
    },
  );

  // The sentence is what the body observes, case by case: a change in what is retried shows up as
  // a change in the skill, not as a failed test.
  unit('what-is-retried', { when: 'a request with `retry` fails.' }, async (u) => {
    const cases: [string, Reply][] = [
      ['a network error', new TypeError('fetch failed')],
      ['a 5xx status', { status: 503 }],
      ['a 4xx status', { status: 400 }],
      ['a timeout', { delay: 50 }],
    ];
    const retried: string[] = [];
    const never: string[] = [];
    for (const [name, reply] of cases) {
      serve(reply, { body: 'ok' });
      await tf.get('http://x/a', { retry: 1, retryDelay: 1, timeout: 10 }).catch(() => undefined);
      (calls.length > 1 ? retried : never).push(name);
    }
    expect(retried.length + never.length).toBe(cases.length);
    const parts = [retried.length ? `${and(retried)} ${retried.length > 1 ? 'are' : 'is'} retried` : 'nothing is retried', never.length ? `${and(never)} never ${never.length > 1 ? 'are' : 'is'}` : ''];
    u.value(`${parts.filter(Boolean).join('; ')}.`);
  });

  unit(
    'retry-defaults',
    {
      when: 'a request sets no `retry`, or no `retryDelay`.',
      value: `\`retry\` is ${DEFAULT_RETRY}, ${DEFAULT_RETRY === 0 ? 'so a failed request is not repeated' : `so a failed request is repeated up to ${DEFAULT_RETRY} times`}; \`retryDelay\` is ${DEFAULT_RETRY_DELAY} ms before the first new attempt, doubled before each next one.`,
      values: { retry: DEFAULT_RETRY, 'retry-delay': DEFAULT_RETRY_DELAY },
    },
    async () => {
      vi.useFakeTimers();
      serve(...Array.from({ length: DEFAULT_RETRY + 1 }, () => ({ status: 503 })), { body: 'never' });
      const failed = tf.get('http://x/a').catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      expect(await failed).toMatchObject({ status: 503 });
      expect(calls).toHaveLength(DEFAULT_RETRY + 1);

      serve({ status: 503 }, { status: 503 }, { body: 'ok' });
      const pending = tf.get('http://x/a', { retry: 2 });
      await vi.advanceTimersByTimeAsync(DEFAULT_RETRY_DELAY - 1);
      expect(calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(2 * DEFAULT_RETRY_DELAY - 1);
      expect(calls).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(3);
      expect(await pending).toBe('ok');
    },
  );

  // Declared with its values for the prose; the body makes the sentence true for every method.
  unit(
    'default-timeout',
    {
      when: 'the user asks how long a request waits by default.',
      value: `${DEFAULT_TIMEOUT / 1000} seconds (\`timeout: ${underscored(DEFAULT_TIMEOUT)}\`), for every method.`,
      unknown: 'tinyfetch has no separate connect timeout; say so instead of inventing one.',
      values: { seconds: DEFAULT_TIMEOUT / 1000, ms: underscored(DEFAULT_TIMEOUT) },
    },
    async () => {
      vi.useFakeTimers();
      const methods = [
        () => tf.get('http://x/slow'),
        () => tf.head('http://x/slow'),
        () => tf.post('http://x/slow', {}),
        () => tf.put('http://x/slow', {}),
        () => tf.patch('http://x/slow', {}),
        () => tf.delete('http://x/slow'),
      ];
      serve(...methods.map(() => ({ delay: 10 * DEFAULT_TIMEOUT, body: 'late' })));
      const pending = methods.map((call) => (call() as Promise<unknown>).catch((e: unknown) => e));
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT - 1);
      expect(calls).toHaveLength(methods.length);
      await vi.advanceTimersByTimeAsync(1);
      for (const result of await Promise.all(pending)) expect(result).toMatchObject({ name: 'TimeoutError', timeout: DEFAULT_TIMEOUT });
    },
  );

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

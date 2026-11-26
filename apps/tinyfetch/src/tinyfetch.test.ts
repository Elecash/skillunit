// A `unit()` is a test that declares a unit of the skill: every value it states has a name in the
// code, and the sentence and the assertions use that name. `skillunit proof` puts it where `skill-src` has
// `{{unit:<id>}}`. A `#region skill:<id>` in its body is the unit's example, and its `ask` holds
// the questions for the decision model, with options built from the code too. See docs/proof.md.
import { unit } from 'skillunit/vitest';
import { afterEach, describe, expect, vi } from 'vitest';
import { HttpError, isHttpError, tf, TimeoutError } from './index.js';
import { DEFAULT_RETRY, DEFAULT_RETRY_DELAY, RETRIED_STATUS, RETRY_TIMES } from './retry.js';
import { DEFAULT_TIMEOUT, NO_TIMEOUT } from './timeout.js';

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

/** Each method of the default client, by its name, called on `url`. */
function methods(url: string): Record<string, () => Promise<unknown>> {
  const { create: _, ...client } = tf;
  return Object.fromEntries(
    Object.entries(client).map(([name, method]) => [name, () => (method.length > 2 ? (method as (p: string, b: unknown) => Promise<unknown>)(url, {}) : (method as (p: string) => Promise<unknown>)(url))]),
  );
}
const everyMethod = (url: string) => Object.values(methods(url));

/** `a`, `a and b`, `a, b and c`. */
const and = (items: string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('tinyfetch', () => {
  unit(
    'client-options',
    {
      when: 'the code creates a client with `create`.',
      value: "`baseUrl` is the prefix of every path, `headers` are sent with every request, and `timeout` is the timeout of every request that sets none; a request's own `timeout` wins.",
    },
    async () => {
      serve({ body: [{ id: 1 }] }, { body: [] });
      const api = tf.create({ baseUrl: 'https://api.example.com/v1/', headers: { authorization: 'Bearer t' } });
      expect(await api.get('users', { query: { page: 2, q: 'a b' } })).toEqual([{ id: 1 }]);
      await api.post('orders', {});
      expect(calls.map((c) => c.url)).toEqual(['https://api.example.com/v1/users?page=2&q=a+b', 'https://api.example.com/v1/orders']);
      for (const c of calls) expect(c.init.headers).toMatchObject({ authorization: 'Bearer t', accept: 'application/json' });

      vi.useFakeTimers();
      const slow = tf.create({ timeout: DEFAULT_TIMEOUT / 2 });
      serve({ delay: 10 * DEFAULT_TIMEOUT }, { delay: 10 * DEFAULT_TIMEOUT });
      const fromClient = slow.get('http://x/slow').catch((e: unknown) => e);
      const fromRequest = slow.get('http://x/slow', { timeout: DEFAULT_TIMEOUT / 4 }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT);
      expect(await fromClient).toMatchObject({ name: 'TimeoutError', timeout: DEFAULT_TIMEOUT / 2 });
      expect(await fromRequest).toMatchObject({ name: 'TimeoutError', timeout: DEFAULT_TIMEOUT / 4 });
    },
  );

  unit(
    'await-every-request',
    {
      when: 'the code calls a tinyfetch method.',
      do: '`await` the call, or return its promise: every method returns a promise.',
      ask: {
        id: 'await-the-call',
        scenario: 'The code needs the name of user 1 from the API and logs it.',
        question: 'How should it get the name?',
        options: {
          await: 'Await `tf.get(...)`, then read `name` from the result',
          direct: 'Read `.name` straight off the `tf.get(...)` call',
        },
        expect: 'await',
      },
    },
    async () => {
      serve({ body: { name: 'Ada' } });
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      // #region skill:await-every-request
      const user = await tf.get<{ name: string }>('https://api.example.com/users/1');
      console.log(user.name);
      // #endregion
      expect(log).toHaveBeenCalledWith('Ada');
      for (const call of everyMethod('http://x/a')) {
        serve({ body: { name: 'Ada' } });
        const pending = call();
        expect(pending).toBeInstanceOf(Promise);
        await pending;
      }
    },
  );

  // What each method resolves to, as the body observes it: a method added to the client, or one
  // that changes what it returns, changes the sentence.
  unit('method-results', { when: 'the code reads what a request resolves to.' }, async (u) => {
    const body: string[] = [];
    const nothing: string[] = [];
    for (const [name, call] of Object.entries(methods('http://x/a'))) {
      serve({ body: { id: 1 } });
      const result = await call();
      if (result === undefined) nothing.push(`\`${name}\``);
      else {
        expect(result).toEqual({ id: 1 });
        body.push(`\`${name}\``);
      }
    }
    const parts = [body.length ? `${and(body)} resolve to the body of the response` : '', nothing.length ? `${and(nothing)} ${nothing.length > 1 ? 'resolve' : 'resolves'} to \`undefined\`` : ''];
    u.value(`${parts.filter(Boolean).join('; ')}.`);
  });

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
      ask: {
        id: 'query-parameters',
        scenario: 'The code lists users page by page and must send the page number and a search term typed by the user.',
        question: 'How should it pass them?',
        options: {
          option: 'In the `query` option of the call',
          'by-hand': 'Appended to the path as `?page=...&q=...`',
        },
        expect: 'option',
      },
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
      ask: {
        id: 'send-an-object',
        scenario: 'The code creates a user from a form and has the user as a plain object.',
        question: 'What should it pass as the body of `tf.post`?',
        options: {
          object: 'The object itself',
          string: 'The object passed through `JSON.stringify` first',
        },
        expect: 'object',
      },
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
      value: `a response that is not \`ok\`, as \`fetch\` sets it, throws an \`${HttpError.name}\` with the \`status\` and the parsed \`body\`; a timeout throws a \`${TimeoutError.name}\`; a network failure throws what \`fetch\` threw.`,
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
      ask: {
        id: 'read-status',
        scenario: 'The code must show "not found" when the API answers 404, and catches the error of `tf.get`.',
        question: 'What should it do before reading `error.status`?',
        options: {
          narrow: 'Check the error with `isHttpError(error)`',
          cast: 'Cast the error to `{ status: number }`',
          nothing: 'Read `error.status` straight away',
        },
        expect: 'narrow',
      },
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
  // a change in the skill, not as a failed test. Each case is sampled more than once, and its
  // samples must agree.
  unit('what-is-retried', { when: 'a request with `retry` fails.', values: { 'retried-status': RETRIED_STATUS } }, async (u) => {
    // Statuses an API answers, on the side of the constant each is on, and the two next to it.
    const statuses = [400, 404, 429, 499, 500, 502, 503, 599];
    const above = [RETRIED_STATUS, ...statuses.filter((s) => s >= RETRIED_STATUS)];
    const under = [RETRIED_STATUS - 1, ...statuses.filter((s) => s < RETRIED_STATUS)];
    const cases: [string, Reply[]][] = [
      ['a network error', [new TypeError('fetch failed')]],
      [`a status of ${RETRIED_STATUS} or above`, above.map((status) => ({ status }))],
      [`a status under ${RETRIED_STATUS}`, under.map((status) => ({ status }))],
      ['a timeout', [{ delay: 50 }]],
    ];
    const retried: string[] = [];
    const never: string[] = [];
    for (const [name, replies] of cases) {
      const seen = new Set<boolean>();
      for (const reply of replies) {
        serve(reply, { body: 'ok' });
        await tf.get('http://x/a', { retry: 1, retryDelay: 1, timeout: 10 }).catch(() => undefined);
        seen.add(calls.length > 1);
      }
      expect([...seen], `the samples of ${name} agree`).toHaveLength(1);
      (seen.has(true) ? retried : never).push(name);
    }
    const parts = [retried.length ? `${and(retried)} ${retried.length > 1 ? 'are' : 'is'} retried` : 'nothing is retried', never.length ? `${and(never)} never ${never.length > 1 ? 'are' : 'is'}` : ''];
    u.value(`${parts.filter(Boolean).join('; ')}.`);
  });

  unit(
    'retry-defaults',
    {
      when: 'a request sets no `retry`, or no `retryDelay`.',
      value: `\`retry\` is ${DEFAULT_RETRY}, ${DEFAULT_RETRY === 0 ? 'so a failed request is not repeated' : `so a failed request is repeated up to ${DEFAULT_RETRY} times`}; \`retryDelay\` is ${DEFAULT_RETRY_DELAY} ms before the first new attempt, and each next wait is ${RETRY_TIMES}x the one before.`,
      values: { retry: DEFAULT_RETRY, 'retry-delay': DEFAULT_RETRY_DELAY, 'retry-times': RETRY_TIMES },
      ask: {
        id: 'retry-delay-default',
        scenario: 'The agent sets `retry` and leaves `retryDelay` out.',
        question: 'How long does tinyfetch wait before the first new attempt?',
        options: {
          right: `${DEFAULT_RETRY_DELAY} ms`,
          ms1000: '1 second',
          'none-wait': 'It retries at once',
        },
        expect: 'right',
      },
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
      await vi.advanceTimersByTimeAsync(RETRY_TIMES * DEFAULT_RETRY_DELAY - 1);
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
      ask: [
        {
          scenario: 'The user asks how long a tinyfetch request waits before it gives up, when the code sets nothing.',
          question: 'What should the agent answer?',
          options: {
            right: `${DEFAULT_TIMEOUT / 1000} seconds`,
            longer: `${(3 * DEFAULT_TIMEOUT) / 1000} seconds`,
            forever: 'It waits until the server answers',
          },
          expect: 'right',
        },
        {
          id: 'connect-timeout',
          scenario: 'The user asks which option sets the connect timeout of a tinyfetch request.',
          question: 'What should the agent answer?',
          options: {
            timeout: 'The `timeout` option',
            connect: 'A `connectTimeout` option',
            'none-exists': 'tinyfetch has no separate connect timeout',
          },
          expect: 'none-exists',
        },
      ],
    },
    async () => {
      vi.useFakeTimers();
      const all = everyMethod('http://x/slow');
      serve(...all.map(() => ({ delay: 10 * DEFAULT_TIMEOUT, body: 'late' })));
      const pending = all.map((call) => call().catch((e: unknown) => e));
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT - 1);
      expect(calls).toHaveLength(all.length);
      await vi.advanceTimersByTimeAsync(1);
      for (const result of await Promise.all(pending)) expect(result).toMatchObject({ name: 'TimeoutError', timeout: DEFAULT_TIMEOUT });
    },
  );

  unit(
    'timeout-off',
    {
      when: 'a request sets `timeout`.',
      value: `the request is aborted with a \`${TimeoutError.name}\` after that many milliseconds; a \`timeout\` of ${NO_TIMEOUT} turns the timeout off, and the request waits until the server answers.`,
      values: { off: NO_TIMEOUT },
    },
    async () => {
      vi.useFakeTimers();
      serve({ delay: 10 * DEFAULT_TIMEOUT, body: 'late' }, { delay: 10 * DEFAULT_TIMEOUT, body: 'late' });
      const limited = tf.get('http://x/slow', { timeout: DEFAULT_TIMEOUT / 2 }).catch((e: unknown) => e);
      const off = tf.get('http://x/slow', { timeout: NO_TIMEOUT });
      await vi.advanceTimersByTimeAsync(10 * DEFAULT_TIMEOUT);
      expect(await limited).toMatchObject({ name: TimeoutError.name, timeout: DEFAULT_TIMEOUT / 2 });
      expect(await off).toBe('late');
    },
  );

  unit(
    'cancel-with-signal',
    {
      when: 'the code passes `signal` and aborts it.',
      value: 'the request rejects with the reason the signal was aborted with.',
    },
    async () => {
      serve({ delay: 50, body: 'late' });
      const controller = new AbortController();
      const pending = tf.get('http://x/slow', { signal: controller.signal });
      controller.abort(new Error('cancelled'));
      await expect(pending).rejects.toThrow('cancelled');
    },
  );
});

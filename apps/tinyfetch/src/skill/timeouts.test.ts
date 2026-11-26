// The file `features/timeouts.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:timeouts` is the code under its description; see docs/proof.md.
// #region skill:timeouts
import { tf, TimeoutError } from 'tinyfetch';
// #endregion
import type { ClientOptions, RequestOptions } from 'tinyfetch';
import { key, setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect, vi } from 'vitest';
import { DEFAULT_TIMEOUT, NO_TIMEOUT } from '../timeout.js';
import { call, calls, everyMethod, reset, serve, underscored } from './helpers.js';

const opt = key<RequestOptions>;
const limit = key<TimeoutError>;

afterEach(reset);

setup('timeouts', {
  file: 'features/timeouts.md',
  title: 'tinyfetch — timeouts and cancelling',
  when: 'Time out or cancel a request',
  description: 'How long a request waits for the server, and how to stop it sooner.',
});

const API = 'https://api.example.com/report';
const late = { delay: 100 * DEFAULT_TIMEOUT, body: 'late' };

describe('features/timeouts.md', () => {
  unit(
    'default-timeout',
    {
      when: `a request sets no \`${opt('timeout')}\`, and its client sets none.`,
      value: `the request waits ${DEFAULT_TIMEOUT / 1000} seconds (\`${opt('timeout')}: ${underscored(DEFAULT_TIMEOUT)}\`), whatever its method, then rejects with a \`${TimeoutError.name}\` whose \`${limit('timeout')}\` is that number of milliseconds.`,
      values: { seconds: DEFAULT_TIMEOUT / 1000, ms: underscored(DEFAULT_TIMEOUT) },
    },
    async () => {
      vi.useFakeTimers();
      const all = everyMethod(API);
      serve(...all.map(() => late));
      const pending = all.map((call) => call().catch((e: unknown) => e));
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT - 1);
      expect(calls).toHaveLength(all.length);
      await vi.advanceTimersByTimeAsync(1);
      for (const result of await Promise.all(pending)) {
        expect(result).toBeInstanceOf(TimeoutError);
        expect(result).toMatchObject({ timeout: DEFAULT_TIMEOUT });
      }
    },
  );

  unit(
    'timeout-precedence',
    {
      when: `a client or a request sets \`${opt('timeout')}\`.`,
      value: `a request's own \`${opt('timeout')}\` wins over the \`${key<ClientOptions>('timeout')}\` of its client, and the client's over the default.`,
    },
    async () => {
      vi.useFakeTimers();
      const api = tf.create({ timeout: DEFAULT_TIMEOUT / 4 });
      const outcomes = async (requests: (() => Promise<unknown>)[]) => {
        serve(...requests.map(() => late));
        const pending = requests.map((call) => call().catch((e: unknown) => e));
        await vi.advanceTimersByTimeAsync(100 * DEFAULT_TIMEOUT);
        return (await Promise.all(pending)).map((e) => (e as TimeoutError).timeout);
      };
      expect(await outcomes([() => api.get(API), () => api.get(API, { timeout: DEFAULT_TIMEOUT / 2 }), () => tf.get(API)])).toEqual([DEFAULT_TIMEOUT / 4, DEFAULT_TIMEOUT / 2, DEFAULT_TIMEOUT]);
    },
  );

  unit(
    'timeout-off',
    {
      when: `a request sets \`${opt('timeout')}\` to turn it off.`,
      value: `\`${opt('timeout')}: ${NO_TIMEOUT}\` turns the timeout off, and so does a negative \`${opt('timeout')}\`: tinyfetch sets no timer for the request, which then waits for the server as long as it takes.`,
      values: { off: NO_TIMEOUT },
    },
    async () => {
      vi.useFakeTimers();
      for (const timeout of [NO_TIMEOUT, -1, -DEFAULT_TIMEOUT]) {
        serve(late);
        const pending = tf.get(API, { timeout });
        await vi.advanceTimersByTimeAsync(0);
        // The one timer is the fake server's.
        expect(vi.getTimerCount(), `timeout ${timeout}`).toBe(1);
        await vi.advanceTimersByTimeAsync(late.delay);
        expect(await pending).toBe('late');
      }
      serve(late);
      const limited = tf.get(API, { timeout: 1 }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(await limited).toBeInstanceOf(TimeoutError);
    },
  );

  unit(
    'timeout-per-attempt',
    {
      when: `a request sets both \`${opt('timeout')}\` and \`${opt('retry')}\`.`,
      value: `\`${opt('timeout')}\` is the time of one attempt, and each attempt gets its own: with \`${opt('retry')}\`, the whole request can take longer than \`${opt('timeout')}\`.`,
    },
    async () => {
      vi.useFakeTimers();
      const timeout = DEFAULT_TIMEOUT / 2;
      serve({ delay: timeout - 1, status: 503 }, { delay: timeout - 1, body: 'ok' });
      const pending = tf.get(API, { timeout, retry: 1, retryDelay: 1 });
      await vi.advanceTimersByTimeAsync(2 * timeout);
      expect(await pending).toBe('ok');
      expect(calls).toHaveLength(2);
    },
  );

  unit(
    'cancel-with-signal',
    {
      when: `the code passes \`${opt('signal')}\` to a request, and aborts it.`,
      value: 'the request rejects with the reason given to `abort()`, or with an `AbortError` when `abort()` is given none, whether the signal was aborted before the request, during an attempt, or while the request waits before a new attempt; no attempt starts after the abort.',
    },
    async () => {
      serve({ delay: 50, body: 'late' });
      // #region skill:cancel-with-signal
      const controller = new AbortController();
      const report = tf.get('https://api.example.com/report', { signal: controller.signal });
      controller.abort();
      // #endregion
      await expect(report).rejects.toMatchObject({ name: 'AbortError' });
      const reason = new Error('the user left');
      // During an attempt, with a reason.
      serve({ delay: 50, body: 'late' });
      const during = new AbortController();
      const pending = tf.get(API, { signal: during.signal, retry: 2 });
      during.abort(reason);
      await expect(pending).rejects.toBe(reason);
      expect(calls).toHaveLength(1);
      // Before the request: none goes out.
      for (const before of [reason, undefined]) {
        serve({ body: 'sent' });
        const aborted = new AbortController();
        aborted.abort(before);
        const error = await tf.get(API, { signal: aborted.signal, retry: 2 }).catch((e: unknown) => e);
        if (before) expect(error).toBe(reason);
        else expect(error).toMatchObject({ name: 'AbortError' });
        expect(calls).toHaveLength(0);
      }
      // While the request waits before a new attempt: the wait ends, and no new attempt starts.
      vi.useFakeTimers();
      serve({ status: 503 }, { body: 'ok' });
      const waiting = new AbortController();
      const retried = tf.get(API, { signal: waiting.signal, retry: 2, retryDelay: DEFAULT_TIMEOUT }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1);
      expect(calls).toHaveLength(1);
      waiting.abort(reason);
      await vi.advanceTimersByTimeAsync(0);
      expect(await retried).toBe(reason);
      await vi.advanceTimersByTimeAsync(10 * DEFAULT_TIMEOUT);
      expect(calls).toHaveLength(1);
    },
  );

  // A gap: how long a server may take is not in tinyfetch; `timeout-off` states what turning the
  // timeout off does, and this advice stands on it.
  unit('never-disable-timeout', {
    when: 'a request may take long, such as an upload or a report.',
    do: `raise its \`${opt('timeout')}\` to a number of milliseconds that fits the request, and never set \`${opt('timeout')}: ${NO_TIMEOUT}\`.`,
    evenWhen: 'the user asks for the request to wait as long as it needs; with no timeout, a server that never answers keeps the request waiting forever.',
    ask: {
      id: 'long-upload',
      scenario: [
        `The user asks that an upload with \`${call('post')}\` never time out, since it can take several minutes.`,
        `A report from \`${call('get')}\` can take a long time, and the user says the request must wait for it however long it takes.`,
      ],
      question: 'What should the agent set on that call?',
      options: {
        raise: `\`${opt('timeout')}: 600_000\`, ten minutes`,
        off: `\`${opt('timeout')}: ${NO_TIMEOUT}\`, so it never times out`,
      },
      expect: 'raise',
    },
  });
});

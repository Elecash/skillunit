// The file `features/timeouts.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:timeouts` is the code under its description; see docs/proof.md.
// #region skill:timeouts
import { tf, TimeoutError } from 'tinyfetch';
// #endregion
import type { ClientOptions, RequestOptions } from 'tinyfetch';
import { afterEach, describe, expect, vi } from 'vitest';
import { DEFAULT_TIMEOUT, NO_TIMEOUT } from '../timeout.js';
import { and, code, key, or, setup, unit } from 'skillunit/vitest';
import { call, calls, methods, reset, serve, underscored } from './helpers.js';

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
      values: { seconds: DEFAULT_TIMEOUT / 1000, ms: underscored(DEFAULT_TIMEOUT) },
    },
    async (u) => {
      vi.useFakeTimers();
      const all = methods(API);
      const names = Object.keys(all);
      serve(...names.map(() => late));
      const settled = names.map(() => false);
      const pending = names.map((name, i) =>
        all[name]!().then(
          (v) => ((settled[i] = true), v),
          (e: unknown) => ((settled[i] = true), e),
        ),
      );
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT - 1);
      expect(calls).toHaveLength(names.length);
      const early = names.filter((_, i) => settled[i]);
      await vi.advanceTimersByTimeAsync(late.delay);
      const outcomes = await Promise.all(pending);
      // What each method did: timed out at the default, after it waited that long, or not.
      const timed = names.filter((n, i) => !early.includes(n) && outcomes[i] instanceof TimeoutError && (outcomes[i] as TimeoutError).timeout === DEFAULT_TIMEOUT);
      const other = names.filter((n) => !timed.includes(n));
      const wait = `${DEFAULT_TIMEOUT / 1000} seconds (\`${opt('timeout')}: ${underscored(DEFAULT_TIMEOUT)}\`)`;
      const then = `then rejects with a \`${TimeoutError.name}\` whose \`${limit('timeout')}\` is that number of milliseconds`;
      u.value(other.length ? `a request with ${or(code(timed))} waits ${wait}, ${then}; one with ${or(code(other))} does not.` : `the request waits ${wait}, whatever its method, ${then}.`);
    },
  );

  unit(
    'timeout-precedence',
    {
      when: `a client or a request sets \`${opt('timeout')}\`.`,
    },
    async (u) => {
      vi.useFakeTimers();
      const [ofClient, ofRequest] = [DEFAULT_TIMEOUT / 4, DEFAULT_TIMEOUT / 2];
      const api = tf.create({ timeout: ofClient });
      serve(late, late, late);
      const pending = [api.get(API, { timeout: ofRequest }), api.get(API), tf.get(API)].map((p) => p.catch((e: unknown) => e));
      await vi.advanceTimersByTimeAsync(100 * DEFAULT_TIMEOUT);
      const [both, client, neither] = (await Promise.all(pending)).map((e) => (e as TimeoutError).timeout);
      // Which setting a request waited for, by the time it timed out after.
      const source = (ms: number | undefined) =>
        ({ [ofRequest]: `its own \`${opt('timeout')}\``, [ofClient]: `the \`${key<ClientOptions>('timeout')}\` of its client`, [DEFAULT_TIMEOUT]: 'the default' })[ms ?? -1] ?? 'none of them';
      expect([both, client, neither].every((ms) => [ofRequest, ofClient, DEFAULT_TIMEOUT].includes(ms!))).toBe(true);
      u.value(`a request that sets \`${opt('timeout')}\`, on a client that sets one too, waits for ${source(both)}; a request that sets none waits for ${source(client)}, and one whose client sets none either, for ${source(neither)}.`);
    },
  );

  unit(
    'timeout-off',
    {
      when: `a request sets \`${opt('timeout')}\` to turn it off.`,
      values: { off: NO_TIMEOUT },
    },
    async (u) => {
      vi.useFakeTimers();
      /** Whether a request with `timeout` sets no timer of its own and waits for the server's late answer. */
      const off = async (timeout: number) => {
        serve(late);
        const pending = tf.get(API, { timeout }).catch((e: unknown) => e);
        await vi.advanceTimersByTimeAsync(0);
        // The fake server's timer is the one there should be.
        const timers = vi.getTimerCount();
        await vi.advanceTimersByTimeAsync(late.delay);
        return timers === 1 && (await pending) === 'late';
      };
      // The way the timers are counted tells a timer apart: a positive timeout sets one.
      expect(await off(1)).toBe(false);
      const cases: [string, number[]][] = [
        [`\`${opt('timeout')}: ${NO_TIMEOUT}\``, [NO_TIMEOUT]],
        [`a negative \`${opt('timeout')}\``, [-1, -DEFAULT_TIMEOUT]],
      ];
      const yes: string[] = [];
      const no: string[] = [];
      for (const [name, tries] of cases) {
        const seen = new Set<boolean>();
        for (const timeout of tries) seen.add(await off(timeout));
        expect([...seen], `the tries of ${name} agree`).toHaveLength(1);
        (seen.has(true) ? yes : no).push(name);
      }
      const verb = (names: string[]) => (names.length > 1 ? 'turn' : 'turns');
      u.value(
        `${yes.length ? `${and(yes)} ${verb(yes)} the timeout off: tinyfetch sets no timer for the request, which then waits for the server as long as it takes` : 'no `timeout` turns the timeout off'}${no.length ? `; ${and(no)} ${no.length > 1 ? 'do' : 'does'} not` : ''}.`,
      );
    },
  );

  unit(
    'timeout-per-attempt',
    {
      when: `a request sets both \`${opt('timeout')}\` and \`${opt('retry')}\`.`,
    },
    async (u) => {
      vi.useFakeTimers();
      const timeout = DEFAULT_TIMEOUT / 2;
      // Two attempts, each just under `timeout`: together they take longer than it.
      serve({ delay: timeout - 1, status: 503 }, { delay: timeout - 1, body: 'ok' });
      const pending = tf.get(API, { timeout, retry: 1, retryDelay: 1 }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(2 * timeout);
      const result = await pending;
      expect(calls.length).toBeGreaterThan(0);
      u.value(
        result === 'ok' && calls.length === 2
          ? `\`${opt('timeout')}\` is the time of one attempt, and each attempt gets its own: with \`${opt('retry')}\`, the whole request can take longer than \`${opt('timeout')}\`.`
          : `\`${opt('timeout')}\` is the time of the whole request, its attempts and the waits between them together: with \`${opt('retry')}\`, a new attempt has what is left of it, and the request rejects with ${result instanceof Error ? `a \`${result.name}\`` : 'what it got'} when it runs out.`,
      );
    },
  );

  unit(
    'cancel-with-signal',
    {
      when: `the code passes \`${opt('signal')}\` to a request, and aborts it.`,
    },
    async (u) => {
      serve({ delay: 50, body: 'late' });
      // #region skill:cancel-with-signal
      const controller = new AbortController();
      const report = tf.get('https://api.example.com/report', { signal: controller.signal });
      controller.abort();
      // #endregion
      await report.catch(() => undefined);
      vi.useFakeTimers();
      /**
       * A request aborted at `when`, with `reason` or with none: what it rejected with, whether it
       * did so at the abort, and how many attempts started after it.
       */
      const aborted = async (when: 'before' | 'during' | 'waiting', reason?: unknown) => {
        serve({ delay: 50, status: 503 }, { body: 'ok' }, { body: 'ok' });
        const signal = new AbortController();
        if (when === 'before') signal.abort(reason);
        let settled = false;
        const pending = tf.get(API, { signal: signal.signal, retry: 2, retryDelay: DEFAULT_TIMEOUT }).catch((e: unknown) => e).finally(() => (settled = true));
        // During the first attempt, or in the wait after it.
        await vi.advanceTimersByTimeAsync(when === 'waiting' ? 51 : 1);
        const before = calls.length;
        if (when !== 'before') signal.abort(reason);
        await vi.advanceTimersByTimeAsync(0);
        const atOnce = settled;
        await vi.advanceTimersByTimeAsync(10 * DEFAULT_TIMEOUT);
        return { error: await pending, atOnce, after: calls.length - before };
      };
      const reason = new Error('the user left');
      const cases = { before: 'before the request', during: 'during an attempt', waiting: 'while the request waits before a new attempt' } as const;
      const right: string[] = [];
      const wrong: string[] = [];
      const got = new Set<string>();
      const slow: string[] = [];
      let started = false;
      for (const [when, name] of Object.entries(cases) as [keyof typeof cases, string][]) {
        const given = await aborted(when, reason);
        const none = await aborted(when);
        expect(given.error, name).toBeInstanceOf(Error);
        if (given.error === reason && (none.error as Error).name === 'AbortError') right.push(name);
        else wrong.push(name), got.add(given.error === reason ? `an error that is not an \`AbortError\` when \`abort()\` is given none` : `${(given.error as Error).name === 'AbortError' ? 'an' : 'a'} \`${(given.error as Error).name}\` when \`abort()\` is given a reason`);
        if (!given.atOnce || !none.atOnce) slow.push(name);
        if (given.after || none.after) started = true;
      }
      u.value(
        `${right.length ? `the request rejects with the reason given to \`abort()\`, or with an \`AbortError\` when \`abort()\` is given none, ${right.length > 1 ? 'whether' : 'when'} the signal was aborted ${or(right)}` : 'the request does not reject with the reason given to `abort()`'}${wrong.length ? `; aborted ${or(wrong)}, it rejects with ${or([...got])}` : ''}${slow.length ? `; aborted ${or(slow)}, it rejects only when the attempt or the wait ends` : ''}; ${started ? 'an attempt can start after the abort' : 'no attempt starts after the abort'}.`,
      );
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

// The file `features/retries.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:retries` is the code under its description; see docs/proof.md.
// #region skill:retries
import { tf } from 'tinyfetch';
// #endregion
import { setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect, vi } from 'vitest';
import { DEFAULT_RETRY, DEFAULT_RETRY_DELAY, RETRIED_STATUS, RETRY_TIMES } from '../retry.js';
import { and, calls, reset, serve, type Reply } from './helpers.js';

afterEach(reset);

setup('retries', {
  file: 'features/retries.md',
  title: 'tinyfetch — retries',
  when: 'Retry a request that failed',
  description: 'Which failed requests tinyfetch repeats, and how long it waits between attempts.',
});

// Examples of the units with no body: type-checked with the tests, and never run.
export async function examples() {
  // #region skill:retry-idempotent-only
  await tf.get('https://api.example.com/users', { retry: 3 });
  // #endregion
}

describe('features/retries.md', () => {
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
      serve({ body: [] });
      // #region skill:retry-defaults
      await tf.get('https://api.example.com/users', { retry: 3, retryDelay: 500 });
      // #endregion
      expect(calls).toHaveLength(1);

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

  unit('retry-idempotent-only', {
    when: 'a request may be retried.',
    do: 'enable `retry` only for GET, HEAD, PUT and DELETE.',
    ask: [
      {
        id: 'post-no-retry',
        scenario: [
          'An order is created with `tf.post`, and the network drops now and then.',
          'A payment is sent with `tf.post` to an API that sometimes answers 503.',
        ],
        question: 'Should the agent pass `retry` to that call?',
        options: {
          retry: 'Pass `retry` to the `tf.post` call',
          'no-retry': 'Leave `retry` off the `tf.post` call',
        },
        expect: 'no-retry',
      },
      {
        id: 'patch-no-retry',
        scenario: [
          'A user profile is updated with `tf.patch`, and the API sometimes answers 503.',
          'A stock count is decreased with `tf.patch`, and the network drops now and then.',
        ],
        question: 'Should the agent pass `retry` to that call?',
        options: {
          retry: 'Pass `retry` to the `tf.patch` call',
          'no-retry': 'Leave `retry` off the `tf.patch` call',
        },
        expect: 'no-retry',
      },
      {
        id: 'retry-methods',
        scenario: 'The agent adds `retry` to the calls of a client that uses every method tinyfetch has.',
        question: 'Which methods may get `retry`?',
        options: {
          idempotent: 'GET, HEAD, PUT and DELETE',
          all: 'Every method, POST and PATCH included',
          reads: 'GET and HEAD only',
        },
        expect: 'idempotent',
      },
      {
        id: 'put-may-retry',
        scenario: 'A settings document is replaced with `tf.put`, and the API sometimes answers 503.',
        question: 'Should the agent pass `retry` to that call?',
        options: {
          retry: 'Yes, `retry` is allowed for this method',
          'no-retry': 'No, leave `retry` off for this method',
        },
        expect: 'retry',
      },
      {
        id: 'get-may-retry',
        scenario: 'A list of users is read with `tf.get`, and the API sometimes answers 503.',
        question: 'May the agent pass `retry` to that call?',
        expect: 'yes',
      },
    ],
  });
});

// The file `features/retries.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:retries` is the code under its description; see docs/proof.md.
// #region skill:retries
import { tf } from 'tinyfetch';
// #endregion
import { and, code, key, setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect, vi } from 'vitest';
import { DEFAULT_RETRY, DEFAULT_RETRY_DELAY, RETRIED_STATUS, RETRY_TIMES } from '../retry.js';
import type { RequestOptions } from 'tinyfetch';
import { call, calls, methods, reset, serve, verb, type Reply } from './helpers.js';

const opt = key<RequestOptions>;

afterEach(reset);

setup('retries', {
  file: 'features/retries.md',
  title: 'tinyfetch — retries',
  when: 'Retry a request that failed',
  description: 'Which failed requests tinyfetch sends again, how often, and how long it waits in between.',
});

const API = 'https://api.example.com/users';

describe('features/retries.md', () => {
  unit(
    'retry-count',
    {
      when: `a request sets \`${opt('retry')}\`, or sets none.`,
      value: `\`${opt('retry')}\` is how many more attempts tinyfetch makes after the first one fails; it is ${DEFAULT_RETRY} by default${DEFAULT_RETRY === 0 ? ', so a failed request is not sent again' : ''}.`,
      values: { retry: DEFAULT_RETRY },
    },
    async () => {
      vi.useFakeTimers();
      serve(...Array.from({ length: DEFAULT_RETRY + 5 }, () => ({ status: 503 })));
      const failed = tf.get(API).catch((e: unknown) => e);
      await vi.runAllTimersAsync();
      expect(await failed).toMatchObject({ status: 503 });
      expect(calls).toHaveLength(DEFAULT_RETRY + 1);
      for (const retry of [1, 3]) {
        serve(...Array.from({ length: retry + 5 }, () => ({ status: 503 })));
        const pending = tf.get(API, { retry }).catch((e: unknown) => e);
        await vi.runAllTimersAsync();
        await pending;
        expect(calls).toHaveLength(retry + 1);
      }
    },
  );

  unit(
    'retry-delay',
    {
      when: `a request with \`${opt('retry')}\` fails and is sent again.`,
      value: `before the first new attempt tinyfetch waits \`${opt('retryDelay')}\`, ${DEFAULT_RETRY_DELAY} ms by default, and before each next one ${RETRY_TIMES}x the wait before it.`,
      values: { delay: DEFAULT_RETRY_DELAY, times: RETRY_TIMES },
    },
    async () => {
      vi.useFakeTimers();
      /** Checks the waits of `pending`, whose first attempt and three new ones fail but the last. */
      const waits = async (pending: Promise<unknown>, first: number) => {
        for (const [n, wait] of [first, first * RETRY_TIMES, first * RETRY_TIMES ** 2].entries()) {
          await vi.advanceTimersByTimeAsync(wait - 1);
          expect(calls).toHaveLength(n + 1);
          await vi.advanceTimersByTimeAsync(1);
          expect(calls).toHaveLength(n + 2);
        }
        expect(await pending).toBe('ok');
      };
      serve({ status: 503 }, { status: 503 }, { status: 503 }, { body: 'ok' });
      await waits(tf.get(API, { retry: 3 }), DEFAULT_RETRY_DELAY);
      serve({ status: 503 }, { status: 503 }, { status: 503 }, { body: 'ok' });
      // #region skill:retry-delay
      const users = tf.get('https://api.example.com/users', { retry: 3, retryDelay: 1_000 });
      // #endregion
      await waits(users, 1_000);
    },
  );

  // The sentence is what the body observes, case by case: each case is tried more than once, and
  // its tries must agree.
  unit(
    'what-is-retried',
    {
      when: `a request with \`${opt('retry')}\` fails.`,
      values: { 'retried-status': RETRIED_STATUS },
      // A case to place: a status the sentence does not name.
      ask: {
        id: 'retry-on-429',
        scenario: `A request sets \`${opt('retry')}: 3\`, and the API answers it with 429 Too Many Requests every time.`,
        question: 'How many times does tinyfetch send the request?',
        options: {
          once: 'Once: tinyfetch does not retry a 429',
          four: 'Four times: the first attempt and three more',
          until: 'Until the API answers with another status',
        },
        expect: 'once',
      },
    },
    async (u) => {
      const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
      const answer = (reply: Reply) => () => retried(reply);
      const cases: [string, (() => Promise<boolean>)[]][] = [
        ['a network error', [answer(new TypeError('fetch failed')), answer(new TypeError('socket hang up'))]],
        [`a status of ${RETRIED_STATUS} or above with any body`, [...range(RETRIED_STATUS, 599).map((status) => answer({ status })), answer({ status: 503, raw: '{' })]],
        [`a status under ${RETRIED_STATUS}`, range(300, RETRIED_STATUS - 1).map((status) => answer({ status }))],
        ['a timeout', [answer({ delay: 50 }), answer({ delay: 80 })]],
        ['an abort', [() => retried({ delay: 50 }, new Error('the user left')), () => retried({ delay: 50 }, undefined)]],
        ['an `ok` response that says it is JSON and does not parse', [answer({ raw: '{' }), answer({ raw: 'not json' })]],
      ];
      const yes: string[] = [];
      const no: string[] = [];
      for (const [name, tries] of cases) {
        const seen = new Set<boolean>();
        for (const attempt of tries) seen.add(await attempt());
        expect([...seen], `the tries of ${name} agree`).toHaveLength(1);
        (seen.has(true) ? yes : no).push(name);
      }
      u.value(`${yes.length ? `${and(yes)} ${yes.length > 1 ? 'are' : 'is'} retried` : 'nothing is retried'}${no.length ? `; ${and(no)} never ${no.length > 1 ? 'are' : 'is'}` : ''}.`);
    },
  );

  unit('retry-any-method', { when: `the code passes \`${opt('retry')}\` to a request.` }, async (u) => {
    const all = methods(API);
    for (const name of Object.keys(all)) {
      serve({ status: 503 }, { body: {} });
      await retryCall(name);
      expect(calls, name).toHaveLength(2);
    }
    u.value(`\`${opt('retry')}\` sends a request again whatever its method, ${and(code(Object.keys(all)))} alike: tinyfetch does not check whether a method is safe to repeat.`);
  });

  // A gap: whether the server can take a request twice is not in tinyfetch; `retry-any-method`
  // is the part a test states, and this advice stands on it.
  unit('retry-idempotent-only', {
    when: `the code adds \`${opt('retry')}\` to a request.`,
    do: `pass \`${opt('retry')}\` only to ${and([verb('GET'), verb('HEAD'), verb('PUT'), verb('DELETE')])}, which a server can receive twice with the same result; leave it off ${and([verb('POST'), verb('PATCH')])}, where a repeated request can create or change something twice.`,
    evenWhen: `the network drops now and then, or the API answers 503 now and then; tinyfetch sends a ${verb('POST')} again like any other request, so only the code keeps it from being sent twice.`,
    ask: [
      {
        id: 'post-no-retry',
        scenario: [
          `An order is created with \`${call('post')}\`, and the network drops now and then.`,
          `A payment is sent with \`${call('post')}\` to an API that sometimes answers 503.`,
        ],
        ...retryOrNot('post'),
        expect: 'no-retry',
      },
      {
        id: 'patch-no-retry',
        scenario: `A stock count is decreased with \`${call('patch')}\`, and the API sometimes answers 503.`,
        ...retryOrNot('patch'),
        expect: 'no-retry',
      },
      {
        id: 'put-may-retry',
        scenario: `A settings document is replaced with \`${call('put')}\`, and the API sometimes answers 503.`,
        ...retryOrNot('put'),
        expect: 'retry',
      },
    ],
  });
});

/** The question and options of whether to pass `retry` to a call of `name`. */
function retryOrNot(name: Parameters<typeof call>[0]) {
  return {
    question: `Should the agent pass \`${opt('retry')}\` to that call?`,
    options: {
      retry: `Pass \`${opt('retry')}\` to the \`${call(name)}\` call`,
      'no-retry': `Leave \`${opt('retry')}\` off the \`${call(name)}\` call`,
    },
  };
}

/**
 * Whether a request whose first attempt gets `reply`, with `retry: 1`, is sent a second time.
 * With `abort`, the request's signal is aborted while the first attempt waits for its answer:
 * with that reason, or with none when it is `undefined`.
 */
async function retried(reply: Reply, ...abort: [unknown?]): Promise<boolean> {
  serve(reply, { body: 'ok' });
  const controller = new AbortController();
  const pending = tf.get(API, { retry: 1, retryDelay: 1, timeout: 20, signal: controller.signal }).catch(() => undefined);
  if (abort.length) setTimeout(() => controller.abort(abort[0]), 5);
  await pending;
  return calls.length > 1;
}

/** The method `name` of `tf`, called with `retry: 1`. */
function retryCall(name: string): Promise<unknown> {
  const { create: _, ...client } = tf;
  const method = client[name as keyof typeof client] as (...args: unknown[]) => Promise<unknown>;
  const options = { retry: 1, retryDelay: 1 };
  return method.length > 2 ? method(API, {}, options) : method(API, options);
}

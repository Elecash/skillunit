// The file `features/retries.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:retries` is the code under its description; see docs/proof.md.
// #region skill:retries
import { tf } from 'tinyfetch';
// #endregion
import { and, code, key, or, setup, unit } from 'skillunit/vitest';
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
      values: { retry: DEFAULT_RETRY },
    },
    async (u) => {
      vi.useFakeTimers();
      /** How many attempts after the first a request makes when every attempt fails, less `retry`. */
      const extra = async (retry?: number) => {
        serve(...Array.from({ length: (retry ?? DEFAULT_RETRY) + 5 }, () => ({ status: 503 })));
        const pending = tf.get(API, retry === undefined ? {} : { retry }).catch((e: unknown) => e);
        await vi.runAllTimersAsync();
        expect(await pending).toMatchObject({ status: 503 });
        return calls.length - 1 - (retry ?? DEFAULT_RETRY);
      };
      const seen = new Set([await extra(), await extra(1), await extra(3)]);
      expect(seen.size, 'the requests agree').toBe(1);
      const [more] = [...seen];
      const words: Record<number, string> = { 1: 'one attempt more', 2: 'two attempts more', [-1]: 'one attempt fewer' };
      const how = more === 0 ? 'how many more attempts tinyfetch makes after the first one fails' : `not how many more attempts tinyfetch makes after the first one fails: it makes ${words[more!] ?? (more! > 0 ? 'more' : 'fewer')}`;
      u.value(`\`${opt('retry')}\` is ${how}; it is ${DEFAULT_RETRY} by default${DEFAULT_RETRY === 0 && more === 0 ? ', so a failed request is not sent again' : ''}.`);
    },
  );

  unit(
    'retry-delay',
    {
      when: `a request with \`${opt('retry')}\` fails and is sent again.`,
      value: `before the first new attempt tinyfetch waits \`${opt('retryDelay')}\`, ${DEFAULT_RETRY_DELAY} ms by default, and before each next one ${RETRY_TIMES}x the wait before it.`,
      values: { delay: DEFAULT_RETRY_DELAY, times: RETRY_TIMES },
    },
    async (u) => {
      vi.useFakeTimers();
      /** The wait before each new attempt of `pending`, whose first attempt and the next two fail. */
      const waits = async (pending: Promise<unknown>) => {
        const out: number[] = [];
        let last = Date.now();
        while (calls.length < 4) {
          const before = calls.length;
          await vi.advanceTimersToNextTimerAsync();
          if (calls.length > before) out.push(Date.now() - last), (last = Date.now());
        }
        expect(await pending).toBe('ok');
        return out;
      };
      serve({ status: 503 }, { status: 503 }, { status: 503 }, { body: 'ok' });
      const byDefault = await waits(tf.get(API, { retry: 3 }));
      serve({ status: 503 }, { status: 503 }, { status: 503 }, { body: 'ok' });
      // #region skill:retry-delay
      const users = tf.get('https://api.example.com/users', { retry: 3, retryDelay: 1_000 });
      // #endregion
      const set = await waits(users);
      expect([byDefault, set].map((w) => w.length)).toEqual([3, 3]);
      // The first wait as a multiple of the delay asked for, the same with and without `retryDelay`, and how each next one grows.
      const factors = new Set([set[0]! / 1_000, byDefault[0]! / DEFAULT_RETRY_DELAY]);
      expect(factors.size, 'the first wait follows the delay the same way with and without `retryDelay`').toBe(1);
      const [factor] = [...factors];
      const times = factor === 1 ? '' : factor === RETRY_TIMES ? `${RETRY_TIMES}x ` : undefined;
      const grows = [byDefault, set].every((w) => w.every((ms, i) => i === 0 || ms === w[i - 1]! * RETRY_TIMES));
      u.value(
        `before the first new attempt tinyfetch ${times === undefined ? `does not wait \`${opt('retryDelay')}\`, whose default is ${DEFAULT_RETRY_DELAY} ms` : `waits ${times}\`${opt('retryDelay')}\`, ${times}${DEFAULT_RETRY_DELAY} ms by default`}, and before each next one ${grows ? `${RETRY_TIMES}x the wait before it` : `a wait that is not ${RETRY_TIMES}x the one before it`}.`,
      );
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
      /** A try of a case: its name in the example, and whether it was sent again. */
      const answer = (name: string, reply: Reply): [string, () => Promise<boolean>] => [name, () => retried(reply)];
      const cases: [string, [string, () => Promise<boolean>][]][] = [
        ['a network error', [answer('fetch failed', new TypeError('fetch failed')), answer('socket hang up', new TypeError('socket hang up'))]],
        [`a status of ${RETRIED_STATUS} or above with any body`, [...range(RETRIED_STATUS, 599).map((status) => answer(String(status), { status })), answer('503 with the body {', { status: 503, raw: '{' })]],
        [`a status under ${RETRIED_STATUS}`, range(300, RETRIED_STATUS - 1).map((status) => answer(String(status), { status }))],
        ['a timeout', [answer('a timeout', { delay: 50 }), answer('a later timeout', { delay: 80 })]],
        ['an abort', [['an abort with a reason', () => retried({ delay: 50 }, new Error('the user left'))], ['an abort with none', () => retried({ delay: 50 }, undefined)]]],
        ['an `ok` response that says it is JSON and does not parse', [answer('the body {', { raw: '{' }), answer('the body not json', { raw: 'not json' })]],
      ];
      const [yes, no, some, most]: [string[], string[], string[], string[]] = [[], [], [], []];
      for (const [name, tries] of cases) {
        const again: string[] = [];
        for (const [label, attempt] of tries) if (await attempt()) again.push(label);
        expect(tries.length, name).toBeGreaterThan(0);
        if (again.length === tries.length) yes.push(name);
        else if (!again.length) no.push(name);
        else {
          // The shorter list: the tries that were sent again, or the ones that were not.
          const not = tries.map(([label]) => label).filter((label) => !again.includes(label));
          (again.length <= not.length ? some : most).push(name);
          u.example('text', again.length <= not.length ? `${name}, retried: ${again.join(', ')}` : `${name}, not retried: ${not.join(', ')}`);
        }
      }
      u.value(
        `${yes.length ? `${and(yes)} ${yes.length > 1 ? 'are' : 'is'} retried` : 'nothing is retried'}${no.length ? `; ${and(no)} never ${no.length > 1 ? 'are' : 'is'}` : ''}${some.length ? `; of ${and(some)}, only the ones the example lists are` : ''}${most.length ? `; of ${and(most)}, all but the ones the example lists are` : ''}.`,
      );
    },
  );

  unit('retry-any-method', { when: `the code passes \`${opt('retry')}\` to a request.` }, async (u) => {
    const all = methods(API);
    const [again, once]: [string[], string[]] = [[], []];
    for (const name of Object.keys(all)) {
      serve({ status: 503 }, { body: {} });
      await retryCall(name).catch(() => undefined);
      expect(calls.length, name).toBeGreaterThan(0);
      (calls.length > 1 ? again : once).push(name);
    }
    u.value(
      once.length
        ? `\`${opt('retry')}\` sends a request with ${or(code(again))} again, and one with ${or(code(once))} only once: tinyfetch leaves those out of the retry.`
        : `\`${opt('retry')}\` sends a request again whatever its method, ${and(code(again))} alike: tinyfetch does not check whether a method is safe to repeat.`,
    );
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

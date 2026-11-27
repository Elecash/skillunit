// The file `features/errors.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:errors` is the code under its description; see docs/proof.md.
// #region skill:errors
import { isHttpError, tf } from 'tinyfetch';
// #endregion
import { HttpError, TimeoutError, type RequestOptions } from 'tinyfetch';
import { key, setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect } from 'vitest';
import { RETRIED_STATUS } from '../retry.js';
import { calls, reset, serve, type Reply } from './helpers.js';

const field = key<HttpError>;
const opt = key<RequestOptions>;

afterEach(reset);

setup('errors', {
  file: 'features/errors.md',
  title: 'tinyfetch — errors',
  when: 'Handle a request that failed',
  description: 'What a failed request rejects with, and how to tell one failure from another.',
});

const API = 'https://api.example.com/users/9';
/** Every status a response can have, and the ones `fetch` calls `ok`. */
const STATUSES = Array.from({ length: 400 }, (_, i) => 200 + i);
const OK = STATUSES.filter((status) => new Response(null, { status }).ok);
const [lowest, highest] = [Math.min(...OK), Math.max(...OK)];
/** A status whose response cannot have a body, such as 204. */
const bodiless = (status: number) => {
  try {
    new Response('x', { status });
    return false;
  } catch {
    return true;
  }
};

describe('features/errors.md', () => {
  unit(
    'what-a-failed-request-throws',
    {
      when: 'a request fails, or the server answers it with a status.',
      values: { lowest, highest },
      // Two parts to combine: a status that is not `ok`, and a body that does not parse.
      ask: {
        id: 'html-not-found',
        scenario: 'The API answers a request with a 404 whose `content-type` says JSON and whose body is an HTML page.',
        question: 'What does the request reject with?',
        options: {
          http: `An \`${HttpError.name}\` with \`${field('status')}\` 404, and the HTML as its \`${field('body')}\``,
          syntax: `A \`${SyntaxError.name}\`, since the body does not parse`,
          resolves: 'Nothing: the call resolves to the HTML',
        },
        expect: 'http',
      },
    },
    async (u) => {
      // Each answer is given again to every attempt, so the outcome is the same whatever the default of `retry`.
      const again = (...replies: Reply[]) => serve(...replies.flatMap((r) => Array.from({ length: 5 }, () => r)));
      // A wait of 1 ms before a new attempt, so the outcome comes at once if the default of `retry` sends one.
      const outcome = () =>
        tf.get(API, { retryDelay: 1 }).then(
          () => null,
          (e: unknown) => e,
        );
      const resolved: number[] = [];
      for (const status of STATUSES) {
        const body = bodiless(status) ? '' : { status };
        again(body === '' ? { status } : { status, body });
        const e = await outcome();
        if (e === null) resolved.push(status);
        else expect(e).toMatchObject({ name: HttpError.name, status, body });
      }
      // The statuses that resolve are the ones `fetch` calls `ok`, one run from the lowest to the highest.
      expect(resolved).toEqual(OK);
      expect(OK).toEqual(STATUSES.filter((s) => s >= lowest && s <= highest));
      // A body that is not JSON, and one that says it is and does not parse: the status stays, with the text.
      again({ status: 503, body: 'down', type: 'text/plain' });
      expect(await outcome()).toMatchObject({ name: HttpError.name, status: 503, body: 'down' });
      again({ status: 404, raw: '<html>not found</html>' });
      expect(await outcome()).toMatchObject({ name: HttpError.name, status: 404, body: '<html>not found</html>' });
      // No response at all: what `fetch` threw.
      const down = new TypeError('fetch failed');
      again(down);
      expect(await outcome()).toBe(down);
      // An `ok` response that says it is JSON and does not parse.
      again({ raw: '{"id": 1' });
      const parse = await outcome();
      expect(parse).toBeInstanceOf(SyntaxError);
      u.value(
        `a response with a status from ${lowest} to ${highest} resolves; any other status rejects with an \`${HttpError.name}\` whose \`${field('status')}\` is the status and whose \`${field('body')}\` is the body parsed as JSON when it says it is JSON and parses, and its text when it does not; a request that gets no response rejects with the error \`fetch\` threw, such as a \`TypeError\`; an \`ok\` response that says it is JSON and does not parse rejects with the \`${(parse as Error).name}\` of the parse.`,
      );
    },
  );

  unit(
    'what-a-retried-request-throws',
    {
      when: `a request with \`${opt('retry')}\` fails on every attempt.`,
      value: `it rejects as a request with no \`${opt('retry')}\` does, with the error of its last attempt: an \`${HttpError.name}\` with the status and body of the last response, or the error \`fetch\` threw the last time.`,
    },
    async () => {
      serve({ status: RETRIED_STATUS, body: 'first' }, { status: RETRIED_STATUS, body: 'last' });
      await expect(tf.get(API, { retry: 1, retryDelay: 1 })).rejects.toMatchObject({ name: HttpError.name, status: RETRIED_STATUS, body: 'last' });
      expect(calls).toHaveLength(2);
      const [first, last] = [new TypeError('fetch failed'), new TypeError('fetch failed')];
      serve(first, last);
      expect(await tf.get(API, { retry: 1, retryDelay: 1 }).catch((e: unknown) => e)).toBe(last);
      expect(calls).toHaveLength(2);
    },
  );

  unit(
    'is-http-error',
    {
      when: 'the code catches the error of a request.',
      do: `test it with \`${isHttpError.name}(error)\`, not \`instanceof ${HttpError.name}\`: \`${isHttpError.name}\` is also true for an \`${HttpError.name}\` of another copy of tinyfetch, and it is false for a \`${TimeoutError.name}\`, a \`TypeError\` of the network, \`null\`, and an object with a \`${field('status')}\` that is not an \`Error\`.`,
    },
    async () => {
      serve({ status: 404, body: { error: 'not found' } });
      const find = async () => {
        // #region skill:is-http-error
        try {
          return await tf.get('https://api.example.com/users/9');
        } catch (error) {
          if (isHttpError(error) && error.status === 404) return null;
          throw error;
        }
        // #endregion
      };
      expect(await find()).toBeNull();
      // An HttpError of another copy: another class, the same name and a numeric status.
      class OtherHttpError extends Error {
        override name = 'HttpError';
        constructor(readonly status: number) {
          super('other copy');
        }
      }
      const other = new OtherHttpError(404);
      expect([isHttpError(other), other instanceof HttpError]).toEqual([true, false]);
      for (const no of [new TimeoutError(10), new TypeError('fetch failed'), null, { status: 404 }]) expect(isHttpError(no)).toBe(false);
    },
  );
});

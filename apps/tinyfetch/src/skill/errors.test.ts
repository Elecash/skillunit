// The file `features/errors.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:errors` is the code under its description; see docs/proof.md.
// #region skill:errors
import { isHttpError, tf } from 'tinyfetch';
// #endregion
import { HttpError, TimeoutError, type RequestOptions } from 'tinyfetch';
import { key, setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect } from 'vitest';
import { RETRIED_STATUS } from '../retry.js';
import { reset, serve, type Reply } from './helpers.js';

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
      const outcome = (options?: RequestOptions) =>
        tf.get(API, { retryDelay: 1, ...options }).then(
          () => null,
          (e: unknown) => e,
        );
      const resolved: number[] = [];
      /** Whether each status that rejects does so with an `HttpError` of that status, with the body parsed. */
      let asHttp = true;
      for (const status of STATUSES) {
        const body = bodiless(status) ? '' : { status };
        again(body === '' ? { status } : { status, body });
        const e = await outcome();
        if (e === null) resolved.push(status);
        else asHttp &&= isHttpError(e) && e.status === status && JSON.stringify(e.body) === JSON.stringify(body);
      }
      // The statuses `fetch` calls `ok` are one run, from the lowest to the highest.
      expect(OK).toEqual(STATUSES.filter((s) => s >= lowest && s <= highest));
      expect(resolved.length).toBeGreaterThan(0);
      // A body that is not JSON, and one that says it is and does not parse.
      again({ status: 503, body: 'down', type: 'text/plain' });
      const text = await outcome();
      again({ status: 404, raw: '<html>not found</html>' });
      const broken = await outcome();
      const keepsText = [[text, 'down'], [broken, '<html>not found</html>']].every(([e, body]) => isHttpError(e) && e.body === body);
      // No response at all, once and after each attempt of a retry.
      const down = new TypeError('fetch failed');
      again(down);
      const network = await outcome();
      again({ raw: '{"id": 1' });
      const parse = await outcome();
      // The last attempt's answer is the one the fake server gives after the first, however many attempts there are.
      serve({ status: RETRIED_STATUS, body: 'first' }, ...Array.from({ length: 5 }, () => ({ status: RETRIED_STATUS, body: 'last' })));
      const retried = await outcome({ retry: 1, retryDelay: 1 });
      const lost = new TypeError('fetch failed');
      serve(new TypeError('fetch failed'), ...Array.from({ length: 5 }, () => lost));
      const lostRetried = await outcome({ retry: 1, retryDelay: 1 });
      for (const e of [network, parse, retried, lostRetried]) expect(e).toBeInstanceOf(Error);
      /** What a request rejected with, said from the error `fetch` threw. */
      const name = (e: unknown) => `${(e as Error).name === HttpError.name ? 'an' : 'a'} \`${(e as Error).name}\``;
      const fromFetch = (e: unknown, thrown: unknown) => (e === thrown ? 'the error `fetch` threw, such as a `TypeError`' : `${name(e)}${(e as Error).cause === thrown ? ' whose `cause` is the error `fetch` threw' : ''}`);
      const statuses = resolved.length === OK.length && resolved.every((s, i) => s === OK[i]) ? `a status from ${lowest} to ${highest}` : 'a status the example lists';
      if (statuses !== `a status from ${lowest} to ${highest}`) u.example('text', `resolves: ${resolved.join(', ')}`);
      const last = isHttpError(retried) && retried.body === 'last' ? `${name(retried)} for a status` : `${name(retried)} that is not the one of the last attempt, for a status`;
      u.value(
        `a response with ${statuses} resolves; any other status rejects with ${asHttp ? `an \`${HttpError.name}\` whose \`${field('status')}\` is the status and whose \`${field('body')}\` is the body parsed as JSON when it says it is JSON and parses${keepsText ? ', and its text when it does not' : ''}` : `an error that is not always an \`${HttpError.name}\` with that status and that body`}${keepsText ? '' : `; one whose body is not JSON rejects with ${isHttpError(broken) ? `an \`${HttpError.name}\` whose \`${field('body')}\` is not its text` : name(broken)}`}; a request that gets no response rejects with ${fromFetch(network, down)}; an \`ok\` response that says it is JSON and does not parse rejects with the \`${(parse as Error).name}\` of the parse. A request with \`${opt('retry')}\` whose every attempt fails rejects the same way, with the error of its last attempt: ${last}, ${fromFetch(lostRetried, lost).replace(', such as a `TypeError`', '')} for no response.`,
      );
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

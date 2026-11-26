// The file `features/clients.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:clients` is the code under its description; see docs/proof.md.
// #region skill:clients
import { create } from 'tinyfetch';
// #endregion
import { tf } from 'tinyfetch';
import { setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect, vi } from 'vitest';
import { DEFAULT_TIMEOUT } from '../timeout.js';
import { calls, reset, serve } from './helpers.js';

afterEach(reset);

setup('clients', {
  file: 'features/clients.md',
  title: 'tinyfetch — clients',
  when: 'Make many requests to one API',
  description: 'Make many requests to one API through a client.',
});

// Examples of the units with no body: type-checked with the tests, and never run.
export async function examples() {
  // #region skill:one-client-per-api.shared
  const api = create({ baseUrl: 'https://api.example.com/v1/' });
  await api.get('users');
  await api.get('orders');
  // #endregion
}

describe('features/clients.md', () => {
  unit(
    'client-options',
    {
      when: 'the code creates a client with `create`.',
      value: "`baseUrl` is the prefix of every path, `headers` are sent with every request, and `timeout` is the timeout of every request that sets none; a request's own `timeout` wins.",
    },
    async () => {
      serve({ body: [{ id: 1 }] });
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      // #region skill:client-options
      const api = create({
        baseUrl: 'https://api.example.com/v1/',
        headers: { authorization: 'Bearer token' },
      });
      const orders = await api.get<{ id: number }[]>('orders');
      console.log(orders.length);
      // #endregion
      expect(log).toHaveBeenCalledWith(1);
      expect(calls[0]).toMatchObject({ url: 'https://api.example.com/v1/orders', init: { headers: { authorization: 'Bearer token' } } });

      serve({ body: [{ id: 1 }] }, { body: [] });
      const shared = tf.create({ baseUrl: 'https://api.example.com/v1/', headers: { authorization: 'Bearer t' } });
      expect(await shared.get('users', { query: { page: 2, q: 'a b' } })).toEqual([{ id: 1 }]);
      await shared.post('orders', {});
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

  unit('one-client-per-api', {
    when: 'the code makes several requests to the same API.',
    decide: 'whether to create a client.',
    paths: [
      { path: 'shared', when: 'the requests share a base URL or headers: create one client with `create` and reuse it.' },
      { path: 'direct', when: 'one request, or requests to unrelated hosts: call `tf` with full URLs.' },
    ],
    evenWhen: 'the requests sit in different files: export the client from one module and import it.',
    ask: [
      {
        id: 'several-calls-same-api',
        scenario: [
          'A service calls three endpoints of the same API, all with the same bearer token.',
          'Two modules of the app read from one billing API with the same base URL.',
        ],
        question: 'How should the code make these requests?',
        options: {
          shared: 'Create one client with `create` and reuse it',
          each: 'Create a client next to each request',
          direct: 'Call `tf` with full URLs and repeat the headers',
        },
        expect: 'shared',
      },
      {
        id: 'single-call-other-host',
        scenario: 'A script makes one request to a weather API, once.',
        question: 'How should the agent make this request?',
        options: {
          client: 'Create a client with `create` and call it',
          direct: 'Call `tf` with the full URL',
        },
        expect: 'direct',
      },
    ],
  });
});

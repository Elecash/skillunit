// The file `features/requests.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:requests` is the code under its description; see docs/proof.md.
// #region skill:requests
import { tf } from 'tinyfetch';
// #endregion
import type { ClientOptions, RequestOptions } from 'tinyfetch';
import { and, code, key, or, setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect } from 'vitest';
import { JSON_TYPE, PARSED_TYPE } from '../request.js';
import { call, calls, method, methods, reset, serve } from './helpers.js';

afterEach(reset);

const opt = key<RequestOptions>;

setup('requests', {
  file: 'features/requests.md',
  title: 'tinyfetch — requests',
  when: `Send a request: its method, path, body, ${and([opt('headers'), opt('query')])}`,
  description: 'What a request sends, and what its call resolves to.',
});

const API = 'https://api.example.com/users';
const clientOpt = key<ClientOptions>;
/** The methods of a client, and how many arguments each takes before its options. */
const { create: _create, ...client } = tf;
const withBody = Object.entries(client).filter(([, m]) => m.length > 2).map(([n]) => n);
const withoutBody = Object.entries(client).filter(([, m]) => m.length <= 2).map(([n]) => n);
const header = (i: number, name: string) => (calls[i]!.init.headers as Record<string, string>)[name];

describe('features/requests.md', () => {
  unit('methods', { when: 'the code sends a request.' }, async (u) => {
    for (const [name, call] of Object.entries(methods(API))) {
      serve({ body: {} });
      await call();
      expect(calls[0]!.init.method, name).toBe(name.toUpperCase());
      expect(calls[0]!.init.body === undefined, name).toBe(withoutBody.includes(name));
    }
    u.value(`a client has the methods ${and(code(Object.keys(client)))}, and each sends the HTTP method of its name; ${and(code(withBody))} take \`(path, body, options)\`, and ${and(code(withoutBody))} take \`(path, options)\`.`);
  });

  unit(
    'request-options',
    {
      when: 'the code passes options to a request.',
    },
    async (u) => {
      // Typed against the type: a key added to `RequestOptions` fails the type-check until it is here.
      const every: Required<RequestOptions> = { headers: {}, query: {}, timeout: 1_000, retry: 0, retryDelay: 1, signal: new AbortController().signal };
      serve({ body: {} });
      await expect(tf.get(API, every)).resolves.toEqual({});
      u.value(`the options of a request are ${and(code(Object.keys(every)))}, and no other.`);
    },
  );

  unit(
    'send-a-body',
    {
      when: `the code sends data with ${or(code(withBody))}.`,
      do: `pass the value itself as \`body\`, not \`JSON.stringify(value)\`: tinyfetch sends \`JSON.stringify(body)\`, so a string is sent as a quoted JSON string.`,
    },
    async () => {
      serve({ body: {} });
      // #region skill:send-a-body
      await tf.post('https://api.example.com/users', { name: 'Ada' });
      // #endregion
      expect(calls[0]!.init.body).toBe(JSON.stringify({ name: 'Ada' }));
      for (const name of withBody) {
        const send = client[name as keyof typeof client] as (p: string, b: unknown) => Promise<unknown>;
        serve({ body: {} }, { body: {} });
        await send(API, { name: 'Ada' });
        await send(API, JSON.stringify({ name: 'Ada' }));
        expect(calls.map((c) => c.init.body), name).toEqual([JSON.stringify({ name: 'Ada' }), JSON.stringify(JSON.stringify({ name: 'Ada' }))]);
      }
    },
  );

  unit(
    'content-type',
    {
      when: `the code sets \`content-type\` in \`${opt('headers')}\`.`,
      value: `a request with a body sends \`content-type: ${JSON_TYPE}\`, which replaces a \`content-type\` of \`${opt('headers')}\`, so tinyfetch sends no other kind of body; a request with no body sends the \`content-type\` of \`${opt('headers')}\` as it is.`,
      // An exception to apply: a header the code sets that tinyfetch replaces.
      ask: {
        id: 'send-csv',
        scenario: `The code uploads a CSV file with \`${call('post')}\`, and sets \`content-type: text/csv\` in \`${opt('headers')}\`.`,
        question: 'Which `content-type` does the request send?',
        options: {
          json: `\`${JSON_TYPE}\``,
          csv: `\`text/csv\`, as \`${opt('headers')}\` says`,
        },
        expect: 'json',
      },
    },
    async () => {
      const headers = { 'content-type': 'text/plain' };
      for (const name of withBody) {
        serve({ body: {} });
        await (client[name as keyof typeof client] as (p: string, b: unknown, o: RequestOptions) => Promise<unknown>)(API, 'x', { headers });
        expect(header(0, 'content-type'), name).toBe(JSON_TYPE);
      }
      for (const name of withoutBody) {
        serve({ body: {} });
        await (client[name as keyof typeof client] as (p: string, o: RequestOptions) => Promise<unknown>)(API, { headers });
        expect(header(0, 'content-type'), name).toBe('text/plain');
        serve({ body: {} });
        await (client[name as keyof typeof client] as (p: string) => Promise<unknown>)(API);
        expect(header(0, 'content-type'), name).toBeUndefined();
      }
    },
  );

  unit(
    'headers',
    {
      when: 'the code sets headers on a client or a request.',
      value: `a request sends \`accept: ${JSON_TYPE}\`, then the \`${clientOpt('headers')}\` of its client, then its own: a later one replaces an earlier one of the same name, \`accept\` included.`,
    },
    async () => {
      const api = tf.create({ headers: { 'x-team': 'a', 'x-client': 'c' } });
      for (const call of Object.values(methods(API))) {
        serve({ body: {} });
        await call();
        expect(header(0, 'accept')).toBe(JSON_TYPE);
      }
      serve({ body: {} });
      await api.get(API, { headers: { 'x-team': 'b' } });
      expect([header(0, 'accept'), header(0, 'x-team'), header(0, 'x-client')]).toEqual([JSON_TYPE, 'b', 'c']);
      serve({ body: {} });
      await tf.create({ headers: { accept: 'text/csv' } }).get(API);
      expect(header(0, 'accept')).toBe('text/csv');
      serve({ body: {} });
      await tf.get(API, { headers: { accept: 'text/csv' } });
      expect(header(0, 'accept')).toBe('text/csv');
    },
  );

  unit(
    'query',
    {
      when: `the code passes \`${opt('query')}\`.`,
      value: `each key of \`${opt('query')}\` is set on the query string of the URL, as \`String(value)\` and encoded; a key the path already has takes the new value, and the other keys of the path stay.`,
    },
    async () => {
      serve({ body: [] });
      // #region skill:query
      await tf.get('https://api.example.com/users', { query: { role: 'admin', page: 2 } });
      // #endregion
      expect(calls[0]!.url).toBe('https://api.example.com/users?role=admin&page=2');
      serve({ body: [] });
      await tf.get(`${API}?page=1&sort=name`, { query: { page: 3, active: true, q: 'a b&c' } });
      const url = new URL(calls[0]!.url);
      const params: Record<string, string> = {};
      url.searchParams.forEach((value, key) => (params[key] = value));
      expect(params).toEqual({ page: '3', sort: 'name', active: 'true', q: 'a b&c' });
      // Replaced: the key is there once.
      expect(url.searchParams.getAll('page')).toEqual(['3']);
      expect(url.search).toContain('q=a+b%26c');
    },
  );

  unit(
    'response-value',
    {
      when: 'the code uses what a call resolves to.',
      value: `a call resolves to the body parsed as JSON when the \`content-type\` of the response has \`${PARSED_TYPE}\` in it, to the text of the body when it does not, and to an empty string when the body is empty; \`${method('head')}\` resolves to \`undefined\`.`,
      // A case to place: a response with no body, from a method that is not `head`.
      ask: {
        id: 'delete-no-content',
        scenario: `The code awaits \`${call('delete')}(...)\` on an API that answers 204 No Content.`,
        question: 'What does the call resolve to?',
        options: {
          empty: 'An empty string',
          undef: '`undefined`',
          nothing: '`null`',
        },
        expect: 'empty',
      },
    },
    async () => {
      serve({ body: { id: 1 } });
      expect(await tf.get(API)).toEqual({ id: 1 });
      serve({ body: { id: 1 }, type: 'application/problem+json' });
      expect(await tf.get(API)).toEqual({ id: 1 });
      serve({ body: 'id,name', type: 'text/csv' });
      expect(await tf.get(API)).toBe('id,name');
      serve({}, { type: 'text/plain' });
      expect([await tf.delete(API), await tf.get(API)]).toEqual(['', '']);
      serve({ body: { id: 1 } });
      expect(await tf.head(API)).toBeUndefined();
    },
  );
});

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
    const other: string[] = [];
    for (const [name, call] of Object.entries(methods(API))) {
      serve({ body: {} });
      await call();
      expect(calls[0]!.init.body === undefined, name).toBe(withoutBody.includes(name));
      if (calls[0]!.init.method !== name.toUpperCase()) other.push(`\`${name}\` sends \`${calls[0]!.init.method}\``);
    }
    const sends = other.length ? `each sends the HTTP method of its name but this: ${and(other)}` : 'each sends the HTTP method of its name';
    u.value(`a client has the methods ${and(code(Object.keys(client)))}, and ${sends}; ${and(code(withBody))} take \`(path, body, options)\`, and ${and(code(withoutBody))} take \`(path, options)\`.`);
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
    async (u) => {
      const headers = { 'content-type': 'text/plain' };
      const [withSet, withoutSet, withoutNone] = [new Set<unknown>(), new Set<unknown>(), new Set<unknown>()];
      for (const name of withBody) {
        serve({ body: {} });
        await (client[name as keyof typeof client] as (p: string, b: unknown, o: RequestOptions) => Promise<unknown>)(API, 'x', { headers });
        withSet.add(header(0, 'content-type'));
      }
      for (const name of withoutBody) {
        serve({ body: {} });
        await (client[name as keyof typeof client] as (p: string, o: RequestOptions) => Promise<unknown>)(API, { headers });
        withoutSet.add(header(0, 'content-type'));
        serve({ body: {} });
        await (client[name as keyof typeof client] as (p: string) => Promise<unknown>)(API);
        withoutNone.add(header(0, 'content-type'));
      }
      // Every method of a kind sends the same.
      expect([withSet.size, withoutSet.size, withoutNone.size]).toEqual([1, 1, 1]);
      const [sent] = [...withSet];
      const withABody =
        sent === JSON_TYPE
          ? `a request with a body sends \`content-type: ${JSON_TYPE}\`, which replaces a \`content-type\` of \`${opt('headers')}\`, so tinyfetch sends no other kind of body`
          : sent === headers['content-type']
            ? `a request with a body sends the \`content-type\` of \`${opt('headers')}\` when it sets one`
            : `a request with a body sends \`content-type: ${String(sent)}\``;
      const [kept] = [...withoutSet];
      u.value(`${withABody}; a request with no body sends ${kept === headers['content-type'] ? `the \`content-type\` of \`${opt('headers')}\` as it is` : `another \`content-type\` than the one of \`${opt('headers')}\``}${[...withoutNone][0] === undefined ? ', and none when it sets none' : ''}.`);
    },
  );

  unit(
    'headers',
    {
      when: 'the code sets headers on a client or a request.',
    },
    async (u) => {
      const accept = new Set<unknown>();
      for (const call of Object.values(methods(API))) {
        serve({ body: {} });
        await call();
        accept.add(header(0, 'accept'));
      }
      expect(accept.size, 'every method sends the same `accept`').toBe(1);
      const api = tf.create({ headers: { 'x-team': 'a', 'x-client': 'c' } });
      serve({ body: {} });
      await api.get(API, { headers: { 'x-team': 'b' } });
      const [team, kept] = [header(0, 'x-team'), header(0, 'x-client')];
      serve({ body: {} });
      await tf.create({ headers: { accept: 'text/csv' } }).get(API);
      const byClient = header(0, 'accept');
      serve({ body: {} });
      await tf.get(API, { headers: { accept: 'text/csv' } });
      const byRequest = header(0, 'accept');
      expect(kept, "a header only the client sets").toBe('c');
      // The order the headers are put together in: a later one replaces an earlier one.
      const order = [`\`accept: ${[...accept][0]}\``, ...(team === 'b' ? [`the \`${clientOpt('headers')}\` of its client`, 'its own'] : ['its own', `the \`${clientOpt('headers')}\` of its client`])];
      const acceptToo = byClient === 'text/csv' && byRequest === 'text/csv';
      u.value(`a request sends ${order[0]}, then ${order[1]}, then ${order[2]}: a later one replaces an earlier one of the same name, \`accept\` ${acceptToo ? 'included' : 'excepted'}.`);
    },
  );

  unit(
    'query',
    {
      when: `the code passes \`${opt('query')}\`.`,
    },
    async (u) => {
      serve({ body: [] });
      // #region skill:query
      await tf.get('https://api.example.com/users', { query: { role: 'admin', page: 2 } });
      // #endregion
      expect(new URL(calls[0]!.url).searchParams.get('role')).toBe('admin');
      serve({ body: [] });
      await tf.get(`${API}?page=1&sort=name`, { query: { page: 3, active: true, q: 'a b&c' } });
      const url = new URL(calls[0]!.url);
      expect(url.searchParams.get('active')).toBe('true');
      const encoded = url.searchParams.get('q') === 'a b&c' && url.search.includes('q=a+b%26c');
      const pages = url.searchParams.getAll('page');
      const replaced = pages.length === 1 && pages[0] === '3' ? 'takes the new value' : pages.length > 1 ? 'keeps its value, and the new one is added after it' : 'keeps its value';
      u.value(
        `each key of \`${opt('query')}\` is set on the query string of the URL, as \`String(value)\`${encoded ? ' and encoded' : ', not encoded'}; a key the path already has ${replaced}, and the other keys of the path ${url.searchParams.get('sort') === 'name' ? 'stay' : 'go'}.`,
      );
    },
  );

  unit(
    'response-value',
    {
      when: 'the code uses what a call resolves to.',
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
    async (u) => {
      /** What a call resolved to, said from the body the server sent. */
      const what = (value: unknown, body: { id: number } | string) =>
        value === undefined ? '`undefined`' : value === null ? '`null`' : value === '' ? 'an empty string' : typeof body !== 'string' && JSON.stringify(value) === JSON.stringify(body) ? 'the body parsed as JSON' : value === (typeof body === 'string' ? body : JSON.stringify(body)) ? 'the text of the body' : 'something else';
      const json = { id: 1 };
      const seen = new Set<string>();
      for (const type of ['application/json', 'application/problem+json']) {
        serve({ body: json, type });
        seen.add(what(await tf.get(API), json));
      }
      expect(seen.size, 'the two kinds of JSON agree').toBe(1);
      serve({ body: 'id,name', type: 'text/csv' });
      const text = what(await tf.get(API), 'id,name');
      serve({}, { type: 'text/plain' });
      const empty = new Set([what(await tf.delete(API), ''), what(await tf.get(API), '')]);
      expect(empty.size, 'an empty body resolves the same with JSON and with text').toBe(1);
      serve({ body: json });
      const head = what(await tf.head(API), json);
      u.value(
        `a call resolves to ${[...seen][0]} when the \`content-type\` of the response has \`${PARSED_TYPE}\` in it, to ${text} when it does not, and to ${[...empty][0]} when the body is empty; \`${method('head')}\` resolves to ${head}.`,
      );
    },
  );
});

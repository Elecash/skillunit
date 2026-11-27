// The file `features/clients.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:clients` is the code under its description; see docs/proof.md.
// #region skill:clients
import { create } from 'tinyfetch';
// #endregion
import { tf, type ClientOptions, type RequestOptions } from 'tinyfetch';
import { and, code, key, setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect } from 'vitest';
import { DEFAULT_BASE, JSON_TYPE } from '../request.js';
import { calls, exported, method, reset, serve } from './helpers.js';

afterEach(reset);

setup('clients', {
  file: 'features/clients.md',
  title: 'tinyfetch — clients',
  when: 'Make many requests to one API with a client',
  description: `What a client made with \`${exported('create')}\` shares between its requests.`,
});

const clientOpt = key<ClientOptions>;
const reqOpt = key<RequestOptions>;
/** A base URL with a query string, as an agent writes it to set a key once. */
const KEYED = 'https://api.example.com/v1?api_key=K';
/** Every option of a client, typed against the type: a key added to `ClientOptions` fails the type-check until it is here. */
const EVERY: Required<ClientOptions> = { baseUrl: 'https://api.example.com', headers: { 'x-team': 'a' }, timeout: 1_000 };

describe('features/clients.md', () => {
  unit('client-options', { when: `the code makes a client with \`${exported('create')}\`.` }, async (u) => {
    const every = EVERY;
    serve({ body: {} });
    // The call as an agent writes it, with every option: a change to the signature changes the example.
    // #region skill:client-options
    const api = create({ baseUrl: 'https://api.example.com', headers: { 'x-team': 'a' }, timeout: 1_000 });
    // #endregion
    await api.get('/users');
    expect(calls[0]!.url).toBe(`${every.baseUrl}/users`);
    // What `tf` sends, next to a client made with nothing.
    serve({ body: {} }, { body: {} });
    await tf.get('/users');
    await create().get('/users');
    expect(calls.map((c) => [c.url, Object.fromEntries(new Headers(c.init.headers))])).toEqual([
      [`${DEFAULT_BASE}/users`, { accept: JSON_TYPE }],
      [`${DEFAULT_BASE}/users`, { accept: JSON_TYPE }],
    ]);
    expect(tf.create).toBe(create);
    const [made, byDefault] = [exported('create'), exported('tf')];
    u.value(`\`${made}\` makes a client whose requests share the options ${and(code(Object.keys(every)))}, as in the example; \`${byDefault}\` is a client made with none, and \`${byDefault}.${made}\` is \`${made}\`.`);
  });

  unit(
    'base-url',
    {
      when: `the code sets \`${clientOpt('baseUrl')}\`, or calls a client with a path.`,
      // A path to join: a base with a path of its own, and a path that starts with `/`.
      ask: {
        id: 'base-with-a-path',
        scenario: `The code makes a client with \`${exported('create')}({ ${clientOpt('baseUrl')}: "https://api.example.com/v1" })\` and calls \`${method('get')}("/users")\` on it.`,
        question: 'Which URL does the request go to?',
        options: {
          joined: '`https://api.example.com/v1/users`',
          root: '`https://api.example.com/users`',
        },
        expect: 'joined',
      },
    },
    async (u) => {
      serve({ body: [] });
      // #region skill:base-url
      const api = create({ baseUrl: 'https://api.example.com/v1' });
      await api.get('/users');
      // #endregion
      const sent: string[] = [];
      for (const baseUrl of ['https://api.example.com/v1', 'https://api.example.com/v1/']) {
        for (const path of ['users', '/users']) {
          serve({ body: [] });
          await create({ baseUrl }).get(path);
          sent.push(calls[0]!.url);
        }
      }
      expect(sent).toEqual(Array.from({ length: 4 }, () => 'https://api.example.com/v1/users'));
      serve({ body: [] });
      await api.get('https://other.example.com/x');
      expect(calls[0]!.url).toBe('https://other.example.com/x');
      serve({ body: [] });
      await tf.get('/users');
      const fallback = calls[0]!.url;
      u.value(
        `a path that is not a whole URL goes after \`${clientOpt('baseUrl')}\`, with one \`/\` between them, whether or not \`${clientOpt('baseUrl')}\` ends with \`/\` and whether or not the path starts with one; a whole URL, such as \`https://other.example.com/x\`, is sent as it is; a client with no \`${clientOpt('baseUrl')}\`, \`${exported('tf')}\` among them, sends \`/users\` to \`${fallback}\`.`,
      );
    },
  );
  unit(
    'no-query-in-base-url',
    {
      when: `a key or another query parameter goes on every request of a client.`,
      do: `pass it in the \`${reqOpt('query')}\` of each request, or in the \`${clientOpt('headers')}\` of the client when the API takes it as a header; never put it at the end of \`${clientOpt('baseUrl')}\`. A path is joined after the whole of \`${clientOpt('baseUrl')}\` as text: with \`${clientOpt('baseUrl')}: "${KEYED}"\`, \`${method('get')}("/users")\` goes to \`/v1\` with \`api_key\` set to \`K/users\`.`,
      evenWhen: `the user asks for the key to be set once, on the client: a client takes ${and(code(Object.keys(EVERY)))}, and no \`${reqOpt('query')}\`.`,
      // What an agent did: it put a key every request needs at the end of `baseUrl`.
      ask: {
        id: 'key-in-the-query',
        scenario: `Every request to an API needs the query parameter \`api_key\`. The code makes one client with \`${exported('create')}\` for that API, and the user asks for the key to be set once, on the client.`,
        question: 'Where does the agent put the key?',
        options: {
          base: `At the end of \`${clientOpt('baseUrl')}\`: \`"${KEYED}"\``,
          query: `In the \`${reqOpt('query')}\` of each request: \`{ ${reqOpt('query')}: { api_key: K } }\``,
        },
        expect: 'query',
      },
    },
    async () => {
      serve({ body: [] });
      await create({ baseUrl: KEYED }).get('/users');
      const url = new URL(calls[0]!.url);
      expect([url.pathname, url.searchParams.get('api_key')]).toEqual(['/v1', 'K/users']);
      serve({ body: [] });
      await create({ baseUrl: 'https://api.example.com/v1' }).get('/users', { query: { api_key: 'K' } });
      expect(calls[0]!.url).toBe('https://api.example.com/v1/users?api_key=K');
      expect(Object.keys(EVERY)).not.toContain(reqOpt('query'));
    },
  );
});

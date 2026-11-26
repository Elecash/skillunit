// The file `features/clients.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:clients` is the code under its description; see docs/proof.md.
// #region skill:clients
import { create } from 'tinyfetch';
// #endregion
import { tf, type ClientOptions } from 'tinyfetch';
import { key, setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect } from 'vitest';
import { DEFAULT_BASE, JSON_TYPE } from '../request.js';
import { and, calls, exported, method, reset, serve } from './helpers.js';

afterEach(reset);

setup('clients', {
  file: 'features/clients.md',
  title: 'tinyfetch — clients',
  when: 'Make many requests to one API with a client',
  description: `What a client made with \`${exported('create')}\` shares between its requests.`,
});

const code = (items: string[]) => items.map((i) => `\`${i}\``);
const clientOpt = key<ClientOptions>;

describe('features/clients.md', () => {
  unit('client-options', { when: `the code makes a client with \`${exported('create')}\`.` }, async (u) => {
    // Typed against the type: a key added to `ClientOptions` fails the type-check until it is here.
    const every: Required<ClientOptions> = { baseUrl: 'https://api.example.com', headers: { 'x-team': 'a' }, timeout: 1_000 };
    serve({ body: {} });
    await create(every).get('/users');
    expect(calls[0]!.url).toBe('https://api.example.com/users');
    expect(tf.create).toBe(create);
    // No headers of its own, and no base URL: what `create()` with nothing gives.
    serve({ body: {} }, { body: {} });
    await tf.get('/users');
    await create().get('/users');
    expect(calls.map((c) => [c.url, c.init.headers])).toEqual([
      [`${DEFAULT_BASE}/users`, { accept: JSON_TYPE }],
      [`${DEFAULT_BASE}/users`, { accept: JSON_TYPE }],
    ]);
    const [made, byDefault] = [exported('create'), exported('tf')];
    u.value(`\`${made}(options)\` makes a client whose requests share the options ${and(code(Object.keys(every)))}; \`${byDefault}\` is a client made with none, and \`${byDefault}.${made}\` is \`${made}\`.`);
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
      expect(new Set(sent)).toEqual(new Set(['https://api.example.com/v1/users']));
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
});

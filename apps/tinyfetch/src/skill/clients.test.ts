// The file `features/clients.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:clients` is the code under its description; see docs/proof.md.
// #region skill:clients
import { create } from 'tinyfetch';
// #endregion
import { tf, type ClientOptions } from 'tinyfetch';
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

describe('features/clients.md', () => {
  unit('client-options', { when: `the code makes a client with \`${exported('create')}\`.` }, async (u) => {
    // Typed against the type: a key added to `ClientOptions` fails the type-check until it is here.
    const every: Required<ClientOptions> = { baseUrl: 'https://api.example.com', headers: { 'x-team': 'a' }, timeout: 1_000 };
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
    const [ofTf, ofNone] = calls.map((c) => JSON.stringify([c.url, c.init.headers]));
    expect(ofNone).toBe(JSON.stringify([`${DEFAULT_BASE}/users`, { accept: JSON_TYPE }]));
    const [made, byDefault] = [exported('create'), exported('tf')];
    const tfIs = ofTf === ofNone ? 'a client made with none' : `a client made with options of its own, which sends \`${ofTf}\``;
    u.value(`\`${made}\` makes a client whose requests share the options ${and(code(Object.keys(every)))}, as in the example; \`${byDefault}\` is ${tfIs}, and \`${byDefault}.${made}\` ${tf.create === create ? 'is' : 'is not'} \`${made}\`.`);
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
      expect(sent).toHaveLength(4);
      const joined = new Set(sent).size === 1 && sent[0] === 'https://api.example.com/v1/users';
      if (!joined) u.example('text', sent.join('\n'));
      serve({ body: [] });
      await api.get('https://other.example.com/x');
      const whole = calls[0]!.url;
      serve({ body: [] });
      await tf.get('/users');
      const fallback = calls[0]!.url;
      u.value(
        `${joined ? `a path that is not a whole URL goes after \`${clientOpt('baseUrl')}\`, with one \`/\` between them, whether or not \`${clientOpt('baseUrl')}\` ends with \`/\` and whether or not the path starts with one` : `a path that is not a whole URL is joined to \`${clientOpt('baseUrl')}\` as the example shows, for \`${clientOpt('baseUrl')}\` with and without \`/\` at its end and a path with and without one at its start`}; a whole URL, such as \`https://other.example.com/x\`, ${whole === 'https://other.example.com/x' ? 'is sent as it is' : `is sent to \`${whole}\``}; a client with no \`${clientOpt('baseUrl')}\`, \`${exported('tf')}\` among them, sends \`/users\` to \`${fallback}\`.`,
      );
    },
  );
});

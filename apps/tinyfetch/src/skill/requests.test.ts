// The file `features/requests.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:requests` is the code under its description; see docs/proof.md.
// #region skill:requests
import { tf } from 'tinyfetch';
// #endregion
import { setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect } from 'vitest';
import { and, calls, methods, reset, serve } from './helpers.js';

afterEach(reset);

setup('requests', {
  file: 'features/requests.md',
  title: 'tinyfetch — requests',
  when: 'Send a request, read the response, pass query parameters or a body',
  description: 'Send a request and read its response: the methods, query parameters and JSON bodies.',
});

describe('features/requests.md', () => {
  // What each method resolves to, as the body observes it: a method added to the client, or one
  // that changes what it returns, changes the sentence.
  unit('method-results', { when: 'the code reads what a request resolves to.' }, async (u) => {
    const body: string[] = [];
    const nothing: string[] = [];
    for (const [name, call] of Object.entries(methods('http://x/a'))) {
      serve({ body: { id: 1 } });
      const result = await call();
      if (result === undefined) nothing.push(`\`${name}\``);
      else {
        expect(result).toEqual({ id: 1 });
        body.push(`\`${name}\``);
      }
    }
    const parts = [body.length ? `${and(body)} resolve to the body of the response` : '', nothing.length ? `${and(nothing)} ${nothing.length > 1 ? 'resolve' : 'resolves'} to \`undefined\`` : ''];
    u.value(`${parts.filter(Boolean).join('; ')}.`);
  });

  unit(
    'response-body',
    {
      when: 'a request resolves.',
      value: 'a response whose `content-type` is JSON comes back parsed; any other comes back as text.',
    },
    async () => {
      serve({ body: { id: 1 } }, { body: 'plain', type: 'text/plain' }, { body: '<p>hi</p>', type: 'text/html' });
      expect(await tf.get('http://x/json')).toEqual({ id: 1 });
      expect(await tf.get('http://x/text')).toBe('plain');
      expect(await tf.get('http://x/html')).toBe('<p>hi</p>');
    },
  );

  unit(
    'query-in-options',
    {
      when: 'a request needs query parameters.',
      do: 'pass them in the `query` option, which encodes each value.',
      ask: {
        id: 'query-parameters',
        scenario: 'The code lists users page by page and must send the page number and a search term typed by the user.',
        question: 'How should it pass them?',
        options: {
          option: 'In the `query` option of the call',
          'by-hand': 'Appended to the path as `?page=...&q=...`',
        },
        expect: 'option',
      },
    },
    async () => {
      serve({ body: [] });
      // #region skill:query-in-options
      await tf.get('https://api.example.com/users', {
        query: { page: 2, sort: 'name' },
      });
      // #endregion
      expect(calls[0]!.url).toBe('https://api.example.com/users?page=2&sort=name');
    },
  );

  unit(
    'body-as-object',
    {
      when: 'a request sends data.',
      do: 'pass the object itself as the body; tinyfetch serializes it and sets `content-type`.',
      ask: {
        id: 'send-an-object',
        scenario: 'The code creates a user from a form and has the user as a plain object.',
        question: 'What should it pass as the body of `tf.post`?',
        options: {
          object: 'The object itself',
          string: 'The object passed through `JSON.stringify` first',
        },
        expect: 'object',
      },
    },
    async () => {
      serve({ status: 201, body: { id: 2 } });
      // #region skill:body-as-object
      await tf.post('https://api.example.com/users', { name: 'Ada' });
      // #endregion
      expect(calls[0]!.init).toMatchObject({ method: 'POST', body: '{"name":"Ada"}', headers: { 'content-type': 'application/json' } });
    },
  );
});

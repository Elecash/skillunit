// The file `SKILL.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:tinyfetch` is the code under its description; see docs/proof.md.
// #region skill:tinyfetch
import { tf } from 'tinyfetch';
// #endregion
import { ask, setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect, vi } from 'vitest';
import { everyMethod, reset, serve } from './helpers.js';

afterEach(reset);

setup('tinyfetch', {
  file: 'SKILL.md',
  title: 'tinyfetch',
  description: 'tinyfetch is a small HTTP client for JSON APIs, built on `fetch`.',
  frontmatter: {
    name: 'tinyfetch',
    description: 'Make HTTP requests to JSON APIs with tinyfetch. Use when code calls an HTTP API through tinyfetch, or when the user asks for retries, timeouts or error handling on such calls.',
  },
});

describe('SKILL.md', () => {
  unit(
    'await-every-request',
    {
      when: 'the code calls a tinyfetch method.',
      do: '`await` the call, or return its promise: every method returns a promise.',
      ask: {
        id: 'await-the-call',
        scenario: 'The code needs the name of user 1 from the API and logs it.',
        question: 'How should it get the name?',
        options: {
          await: 'Await `tf.get(...)`, then read `name` from the result',
          direct: 'Read `.name` straight off the `tf.get(...)` call',
        },
        expect: 'await',
      },
    },
    async () => {
      serve({ body: { name: 'Ada' } });
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      // #region skill:await-every-request
      const user = await tf.get<{ name: string }>('https://api.example.com/users/1');
      console.log(user.name);
      // #endregion
      expect(log).toHaveBeenCalledWith('Ada');
      serve({ body: [{ id: 1 }, { id: 2 }] });
      // #region skill:await-every-request.list
      const users = await tf.get<{ id: number }[]>('https://api.example.com/users');
      console.log(users.length);
      // #endregion
      expect(log).toHaveBeenCalledWith(2);
      for (const call of everyMethod('http://x/a')) {
        serve({ body: { name: 'Ada' } });
        const pending = call();
        expect(pending).toBeInstanceOf(Promise);
        await pending;
      }
    },
  );

  ask('which-file-for-retries', {
    file: 'SKILL.md',
    scenario: 'The agent must add retries to a tinyfetch call.',
    question: 'Which file of the skill should it read?',
    options: {
      retries: 'features/retries.md',
      requests: 'features/requests.md',
      errors: 'features/errors.md',
    },
    expect: 'retries',
  });
});

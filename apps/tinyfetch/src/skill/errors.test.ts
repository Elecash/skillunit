// The file `features/errors.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:errors` is the code under its description; see docs/proof.md.
// #region skill:errors
import { isHttpError, tf } from 'tinyfetch';
// #endregion
import { HttpError, TimeoutError } from 'tinyfetch';
import { setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect, vi } from 'vitest';
import { reset, serve } from './helpers.js';

afterEach(reset);

setup('errors', {
  file: 'features/errors.md',
  title: 'tinyfetch — errors',
  when: 'Handle a request that failed',
  description: 'What a request that fails throws, and how to tell the errors apart.',
});

describe('features/errors.md', () => {
  unit(
    'what-a-failed-request-throws',
    {
      when: 'a tinyfetch call fails.',
      value: `a response that is not \`ok\`, as \`fetch\` sets it, throws an \`${HttpError.name}\` with the \`status\` and the parsed \`body\`; a timeout throws a \`${TimeoutError.name}\`; a network failure throws what \`fetch\` threw.`,
    },
    async () => {
      serve({ status: 404, body: { error: 'not found' } });
      const error = await tf.get('http://x/missing').catch((e: unknown) => e);
      expect(isHttpError(error)).toBe(true);
      expect(error).toMatchObject({ status: 404, body: { error: 'not found' } });
      expect(error).toBeInstanceOf(HttpError);
      serve({ status: 302 });
      await expect(tf.get('http://x/moved')).rejects.toBeInstanceOf(HttpError);
      const failure = new TypeError('fetch failed');
      serve(failure);
      await expect(tf.get('http://x/down')).rejects.toBe(failure);
      serve({ delay: 50 });
      await expect(tf.get('http://x/slow', { timeout: 10 })).rejects.toBeInstanceOf(TimeoutError);
    },
  );

  unit(
    'check-with-is-http-error',
    {
      when: 'code catches an error from a tinyfetch call and reads its status.',
      do: 'test the error with `isHttpError(error)` before reading `status` or `body`.',
      ask: {
        id: 'read-status',
        scenario: 'The code must show "not found" when the API answers 404, and catches the error of `tf.get`.',
        question: 'What should it do before reading `error.status`?',
        options: {
          narrow: 'Check the error with `isHttpError(error)`',
          cast: 'Cast the error to `{ status: number }`',
          nothing: 'Read `error.status` straight away',
        },
        expect: 'narrow',
      },
    },
    async () => {
      serve({ status: 404, body: { error: 'not found' } });
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      // #region skill:check-with-is-http-error
      try {
        await tf.get('https://api.example.com/users/1');
      } catch (error) {
        if (isHttpError(error) && error.status === 404) console.log('no such user');
        else throw error;
      }
      // #endregion
      expect(log).toHaveBeenCalledWith('no such user');
    },
  );
});

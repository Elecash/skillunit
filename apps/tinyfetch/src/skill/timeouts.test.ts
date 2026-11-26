// The file `features/timeouts.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:timeouts` is the code under its description; see docs/proof.md.
// #region skill:timeouts
import { tf, TimeoutError } from 'tinyfetch';
// #endregion
import { setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect, vi } from 'vitest';
import { DEFAULT_TIMEOUT, NO_TIMEOUT } from '../timeout.js';
import { calls, everyMethod, reset, serve, underscored } from './helpers.js';

afterEach(reset);

setup('timeouts', {
  file: 'features/timeouts.md',
  title: 'tinyfetch — timeouts and cancelling',
  when: 'Time out or cancel a request',
  description: 'How long a request waits, and how to cancel it.',
});

// Examples of the units with no body: type-checked with the tests, and never run.
export async function examples() {
  // #region skill:never-disable-timeout
  await tf.post('https://api.example.com/uploads', { size: 1 }, { timeout: 120_000 });
  // #endregion
}

describe('features/timeouts.md', () => {
  // Declared with its values for the prose; the body makes the sentence true for every method.
  unit(
    'default-timeout',
    {
      when: 'the user asks how long a request waits by default.',
      value: `${DEFAULT_TIMEOUT / 1000} seconds (\`timeout: ${underscored(DEFAULT_TIMEOUT)}\`), for every method.`,
      unknown: 'tinyfetch has no separate connect timeout; say so instead of inventing one.',
      values: { seconds: DEFAULT_TIMEOUT / 1000, ms: underscored(DEFAULT_TIMEOUT) },
      ask: [
        {
          scenario: 'The user asks how long a tinyfetch request waits before it gives up, when the code sets nothing.',
          question: 'What should the agent answer?',
          options: {
            right: `${DEFAULT_TIMEOUT / 1000} seconds`,
            longer: `${(3 * DEFAULT_TIMEOUT) / 1000} seconds`,
            forever: 'It waits until the server answers',
          },
          expect: 'right',
        },
        {
          id: 'connect-timeout',
          scenario: 'The user asks which option sets the connect timeout of a tinyfetch request.',
          question: 'What should the agent answer?',
          options: {
            timeout: 'The `timeout` option',
            connect: 'A `connectTimeout` option',
            'none-exists': 'tinyfetch has no separate connect timeout',
          },
          expect: 'none-exists',
        },
      ],
    },
    async () => {
      vi.useFakeTimers();
      const all = everyMethod('http://x/slow');
      serve(...all.map(() => ({ delay: 10 * DEFAULT_TIMEOUT, body: 'late' })));
      const pending = all.map((call) => call().catch((e: unknown) => e));
      await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT - 1);
      expect(calls).toHaveLength(all.length);
      await vi.advanceTimersByTimeAsync(1);
      for (const result of await Promise.all(pending)) expect(result).toMatchObject({ name: 'TimeoutError', timeout: DEFAULT_TIMEOUT });
    },
  );

  unit(
    'timeout-off',
    {
      when: 'a request sets `timeout`.',
      value: `the request is aborted with a \`${TimeoutError.name}\` after that many milliseconds; a \`timeout\` of ${NO_TIMEOUT} turns the timeout off, and the request waits until the server answers.`,
      values: { off: NO_TIMEOUT },
    },
    async () => {
      vi.useFakeTimers();
      serve({ delay: 10 * DEFAULT_TIMEOUT, body: 'late' }, { delay: 10 * DEFAULT_TIMEOUT, body: 'late' });
      const limited = tf.get('http://x/slow', { timeout: DEFAULT_TIMEOUT / 2 }).catch((e: unknown) => e);
      const off = tf.get('http://x/slow', { timeout: NO_TIMEOUT });
      await vi.advanceTimersByTimeAsync(10 * DEFAULT_TIMEOUT);
      expect(await limited).toMatchObject({ name: TimeoutError.name, timeout: DEFAULT_TIMEOUT / 2 });
      expect(await off).toBe('late');

      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      serve({ delay: 10 * DEFAULT_TIMEOUT });
      const example = async () => {
        // #region skill:timeout-off
        try {
          await tf.get('https://api.example.com/slow', { timeout: 2_000 });
        } catch (error) {
          if (error instanceof TimeoutError) console.log('gave up after', error.timeout, 'ms');
        }
        // #endregion
      };
      const done = example();
      await vi.advanceTimersByTimeAsync(2_000);
      await done;
      expect(log).toHaveBeenCalledWith('gave up after', 2_000, 'ms');
    },
  );

  unit('never-disable-timeout', {
    when: 'a request may take long, such as an upload or a report.',
    do: `raise \`timeout\` to a number of milliseconds that fits the request, and never set it to \`${NO_TIMEOUT}\`.`,
    ask: {
      id: 'long-upload',
      scenario: 'An upload with `tf.post` can take up to two minutes.',
      question: 'What should the agent set?',
      options: {
        raise: '`timeout: 120_000`',
        off: `\`timeout: ${NO_TIMEOUT}\`, so the upload never times out`,
      },
      expect: 'raise',
    },
  });

  unit(
    'cancel-with-signal',
    {
      when: 'the code passes `signal` and aborts it.',
      value: 'the request rejects with the reason the signal was aborted with.',
    },
    async () => {
      serve({ delay: 50, body: 'late' });
      // #region skill:cancel-with-signal
      const controller = new AbortController();
      const report = tf.get('https://api.example.com/report', {
        signal: controller.signal,
      });
      controller.abort();
      await report.catch(() => undefined);
      // #endregion
      await expect(report).rejects.toMatchObject({ name: 'AbortError' });

      serve({ delay: 50, body: 'late' });
      const other = new AbortController();
      const pending = tf.get('http://x/slow', { signal: other.signal });
      other.abort(new Error('cancelled'));
      await expect(pending).rejects.toThrow('cancelled');
    },
  );
});

// The file `SKILL.md` of the skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:tinyfetch` is the code under its description; see docs/proof.md.
// #region skill:tinyfetch
import { tf } from 'tinyfetch';
// #endregion
import * as tinyfetch from 'tinyfetch';
import { exportNames } from 'skillunit/typescript';
import { setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect, vi } from 'vitest';
import { and, methods, reset, serve } from './helpers.js';

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

/** The name of the package, typed: a package renamed fails the import of this file first. */
const PACKAGE = 'tinyfetch';

describe('SKILL.md', () => {
  unit('exports', { when: 'the code imports from tinyfetch.' }, (u) => {
    const { values, types } = exportNames(new URL('../index.ts', import.meta.url));
    expect(values).toEqual(Object.keys(tinyfetch).sort());
    for (const name of values) expect(tinyfetch[name as keyof typeof tinyfetch]).toBeDefined();
    const code = (n: string) => `\`${n}\``;
    u.value(`\`${PACKAGE}\` exports ${and(values.map(code))}${types.length ? `, and the type${types.length > 1 ? 's' : ''} ${and(types.map(code))}` : ''}.`);
  });

  unit(
    'await-every-request',
    {
      when: 'the code calls a method of a client.',
      do: '`await` the call, or return its promise: every method returns a promise, and the value is what it resolves to.',
    },
    async () => {
      serve({ body: { name: 'Ada' } });
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      // #region skill:await-every-request
      const user = await tf.get<{ name: string }>('https://api.example.com/users/1');
      console.log(user.name);
      // #endregion
      expect(log).toHaveBeenCalledWith('Ada');
      const all = methods('https://api.example.com/users/1');
      for (const [name, call] of Object.entries(all)) {
        serve({ body: { name: 'Ada' } });
        const pending = call();
        expect(pending, name).toBeInstanceOf(Promise);
        await pending;
      }
    },
  );
});

/**
 * The acceptance scenarios: each changes tinyfetch or its skill in a copy of the app, and lists
 * what SkillUnit must report. Findings are written `rule file unit code`, the code being a
 * TypeScript code when there is one; proof findings are unit ids, or the file for one about no
 * unit; model findings are test ids. `check` runs the app's tests itself, through `proof.run`.
 * A change to the skill is made in the tests, then built with `proof --write`, as people do.
 * Anything reported that is not listed fails the scenario, as does anything listed that is not
 * reported.
 */
import type { App } from './app.js';

export interface Expected {
  /** Proof errors, by unit id, or by file for one about no unit (a line of prose, the settings). */
  proof?: string[];
  proofWarnings?: string[];
  /** Tests that must fail. Only scenarios that need the model. */
  failing?: string[];
  /** Tests that may fail too: the change touches what they ask about. */
  mayFail?: string[];
  /** At least one of these tests must fail; any of them may. For a change several tests ask about, each near its threshold. */
  oneFails?: string[];
}

export interface Scenario {
  name: string;
  /** What the change is, as the plan's table says it. */
  change: string;
  /**
   * `required`: runs `check` against the decision model, and only with an API key.
   * `optional`: the same with a key, a dry run without one. Left out: a dry run.
   */
  model?: 'required' | 'optional';
  apply(app: App): void | Promise<void>;
  expect: Expected;
}


/** The tests of tinyfetch, one per file of its skill, by the file of the skill. */
const TESTS = { index: 'src/skill/index.test.ts', clients: 'src/skill/clients.test.ts', errors: 'src/skill/errors.test.ts', requests: 'src/skill/requests.test.ts', retries: 'src/skill/retries.test.ts', timeouts: 'src/skill/timeouts.test.ts' };

/** The `unit(...)` call of `id` in the tests, from its line to the line after it ends. */
function unitCall(text: string, id: string): { start: number; end: number } {
  const start = text.indexOf(`  unit(\n    '${id}',`) >= 0 ? text.indexOf(`  unit(\n    '${id}',`) : text.indexOf(`  unit('${id}',`);
  if (start < 0) throw new Error(`scenario edit: no unit(${id})`);
  const close = text.indexOf('\n  );\n', start);
  const short = text.indexOf('\n  });\n', start);
  const end = [close, short].filter((i) => i >= 0).sort((a, b) => a - b)[0]!;
  return { start, end: end + (end === close ? '\n  );\n'.length : '\n  });\n'.length) };
}

export const scenarios: Scenario[] = [
  {
    name: 'removed option',
    change: 'delete `retryDelay` from the code, leave the skill',
    apply(app) {
      app.edit('src/types.ts', '  /** Milliseconds to wait before the first new attempt; each next wait is `RETRY_TIMES` times the one before. Default `DEFAULT_RETRY_DELAY`. */\n  retryDelay?: number;\n', '');
      app.edit('src/request.ts', '    options.retry,\n    options.retryDelay,\n', '    options.retry,\n');
      app.edit('src/retry.ts', 'retry = DEFAULT_RETRY, retryDelay = DEFAULT_RETRY_DELAY): Promise<T> {', 'retry = DEFAULT_RETRY): Promise<T> {\n  const retryDelay = DEFAULT_RETRY_DELAY;');
      app.commit('Drop retryDelay');
    },
    // Nothing reports it: the example that passes `retryDelay` is in the source, and nothing
    // type-checks the source.
    expect: {},
  },
  {
    name: 'renamed function',
    change: 'rename `create` to `createClient` in the code, leave the skill',
    apply(app) {
      app.edit('src/client.ts', 'export function create(', 'export function createClient(');
      app.edit('src/client.ts', 'export const tf: Client & { create: typeof create } = { ...create(), create };', 'export const tf: Client & { createClient: typeof createClient } = { ...createClient(), createClient };');
      app.edit('src/index.ts', 'export { create, tf,', 'export { createClient, tf,');
      app.commit('Rename create to createClient');
    },
    // The units whose bodies call `tf.create`, or every method of `tf`, fail, so the run does.
    expect: { proof: ['await-every-request', 'client-options', 'default-timeout', 'method-results', '../skillunit.yaml'] },
  },

  {
    name: 'removed option used by examples',
    change: 'remove the `query` option, which the examples of two units pass',
    apply(app) {
      app.edit('src/types.ts', '  /** Query parameters, encoded and appended to the path. */\n  query?: Record<string, string | number | boolean>;\n', '');
      app.edit('src/request.ts', '  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value));\n', '');
      app.commit('Drop query');
    },
    // The tests that declare `query-in-options` and `client-options` fail without the option, and
    // so does the run.
    expect: { proof: ['client-options', 'query-in-options', '../skillunit.yaml'] },
  },




  {
    name: 'wrong package',
    change: 'change the package name in the import of the test of a file, which is its code',
    apply(app) {
      app.edit(TESTS.timeouts, "import { tf, TimeoutError } from 'tinyfetch';", "import { tf, TimeoutError } from 'tiny-fetch';");
      app.build();
      app.commit('Typo in the package name');
    },
    // The test file does not load, so it leaves no record: the run fails, and nothing declares the
    // file of the skill.
    expect: { proof: ['../skillunit.yaml', 'features/timeouts.md'] },
  },
  {
    name: 'contradicting prose',
    change: 'replace the description of a file with a sentence that contradicts a rule',
    model: 'required',
    apply(app) {
      app.edit(
        TESTS.retries,
        "description: 'Which failed requests tinyfetch repeats, and how long it waits between attempts.',",
        "description: 'The server never applies the same request twice: retrying is safe for every method, and `retry` belongs on POST and PATCH calls as much as on GET.',",
      );
      app.build();
      app.commit('Say retries are always safe');
    },
    // The sentence replaces the one that points to the rules. Measured on Jev on 2026-11-26, over
    // five runs: post-no-retry ended at 0.50 to 0.58 and patch-no-retry at 0.50 to 0.57, borderline
    // passes, since the rule wins; retry-methods passed at 0.74 to 0.77. Either may fail on a run.
    expect: { mayFail: ['post-no-retry', 'patch-no-retry', 'retry-methods'] },
  },
  // A unit with no body is declared in code like any other: its sentence changes there, and the
  // skill follows only after a build.
  {
    name: 'ambiguous rule, not rebuilt',
    change: "weaken the wording of a unit with no body, and leave the skill",
    apply(app) {
      app.edit(TESTS.retries, "do: 'enable `retry` only for GET, HEAD, PUT and DELETE.',", "do: 'think about whether `retry` suits the method before you enable it.',");
      app.commit('Soften the retry rule');
    },
    expect: { proof: ['retry-idempotent-only'] },
  },
  {
    name: 'ambiguous rule',
    change: "weaken the wording of a unit with no body, then `skillunit proof --write`",
    model: 'required',
    apply(app) {
      app.edit(TESTS.retries, "do: 'enable `retry` only for GET, HEAD, PUT and DELETE.',", "do: 'think about whether `retry` suits the method before you enable it.',");
      app.build();
      app.commit('Soften the retry rule');
    },
    // The weakened rule names no method, so the test that asks for the list fails too. Measured on
    // Jev on 2026-11-26, over four runs: retry-methods answered `none` at 0.63 to 0.75 and
    // put-may-retry `no-retry` at 0.66 to 0.71, wrong answers every time. This is the README's
    // example of the test layer.
    expect: { failing: ['put-may-retry', 'retry-methods'], mayFail: ['post-no-retry', 'patch-no-retry'] },
  },
  {
    name: 'unit declared with no body',
    change: 'declare a fact that no test proves, at the end of the test of its file',
    apply(app) {
      const unit = "\nunit('timeout-error-names-its-limit', {\n  when: 'code reads a `TimeoutError`.',\n  value: '`error.timeout` is the limit in milliseconds that the request went over.',\n});\n";
      app.write(TESTS.timeouts, app.read(TESTS.timeouts) + unit);
      app.build();
      app.commit('Add a unit about TimeoutError');
    },
    // A unit no test proves is counted, not reported.
    expect: {},
  },

  {
    name: 'question with no right option',
    change: 'rename the option that the `expect` of a question names',
    apply(app) {
      app.edit(TESTS.retries, 'right: `${DEFAULT_RETRY_DELAY} ms`,', 'default: `${DEFAULT_RETRY_DELAY} ms`,');
      app.commit('Rename an option');
    },
    // The test of the unit fails, so the unit is not built, and the run does not exit with 0.
    expect: { proof: ['retry-defaults', '../skillunit.yaml'] },
  },
  // The experiments of the README's "Try it" section, change for change, so CI fails when one
  // stops reporting what the README shows. The vague rule is the scenario `ambiguous rule` above.
  {
    name: 'README 1: renamed option',
    change: 'in `src/types.ts`, rename the option `retryDelay` to `backoff`',
    apply(app) {
      app.edit('src/types.ts', '  retryDelay?: number;', '  backoff?: number;');
      app.commit('Rename retryDelay to backoff');
    },
    // Nothing reports it: the example that passes `retryDelay` is a region of a test, and the tests
    // run without a type-check. The project's type-check of its tests reports it.
    expect: {},
  },
  {
    name: 'README 2: Right example that breaks its rule',
    change: 'turn the `Right` example of `retry-idempotent-only` into a retried POST',
    apply(app) {
      // The example is the region of the unit, where it is declared.
      app.edit(TESTS.retries, "await tf.get('https://api.example.com/users', { retry: 3 });", "await tf.post('https://api.example.com/orders', { item: 42 }, { retry: 3 });");
      app.build();
      app.commit('Retry a POST in the Right example');
    },
    // Nothing reports it: a unit has no `Check`, and the example is a region of a test.
    expect: {},
  },
  // The agents' case: a default changed, and no test edited, since the test builds the sentence
  // from the same constant. The tests pass; the skill still says 10 seconds.
  {
    name: 'README 4: default changed',
    change: 'in `src/timeout.ts`, change `DEFAULT_TIMEOUT` from `10_000` to `5_000`',
    apply(app) {
      app.edit('src/timeout.ts', 'export const DEFAULT_TIMEOUT = 10_000;', 'export const DEFAULT_TIMEOUT = 5_000;');
      app.commit('Lower the default timeout');
    },
    // The `Value` of the unit.
    expect: { proof: ['default-timeout'] },
  },
  // With a key, the question about the default is asked too: its options are built from the
  // same constant, so it passes with no edit.
  {
    name: 'README 4: default changed, skill rebuilt',
    change: 'the same change, then `skillunit proof --write`',
    model: 'optional',
    apply(app) {
      app.edit('src/timeout.ts', 'export const DEFAULT_TIMEOUT = 10_000;', 'export const DEFAULT_TIMEOUT = 5_000;');
      app.build();
      app.commit('Lower the default timeout');
    },
    expect: {},
  },
  {
    name: 'proof 1: default changed under a fact and a table',
    change: 'in `src/retry.ts`, change `DEFAULT_RETRY_DELAY` from 300 to 500, leave the skill and the tests',
    apply(app) {
      app.edit('src/retry.ts', 'export const DEFAULT_RETRY_DELAY = 300;', 'export const DEFAULT_RETRY_DELAY = 500;');
      app.commit('Raise the retry delay');
    },
    expect: { proof: ['retry-defaults'] },
  },
  {
    name: 'proof 2: a 4xx is now retried',
    change: 'in `src/retry.ts`, lower `RETRIED_STATUS` to 400, leave the skill and the tests',
    apply(app) {
      app.edit('src/retry.ts', 'export const RETRIED_STATUS = 500;', 'export const RETRIED_STATUS = 400;');
      app.commit('Retry 4xx');
    },
    // The sentence of `what-is-retried` is built from the constant and what the body observes, so
    // no test fails: the sentence changes.
    expect: { proof: ['what-is-retried'] },
  },
  {
    name: 'proof 2b: one status retried by a literal',
    change: 'in `src/retry.ts`, retry a 429 too, past the constant, leave the skill and the tests',
    apply(app) {
      app.edit('src/retry.ts', 'error.status >= RETRIED_STATUS;', 'error.status >= RETRIED_STATUS || error.status === 429;');
      app.commit('Retry 429');
    },
    // The body samples 429 among the statuses under the constant, and they no longer agree.
    expect: { proof: ['what-is-retried', '../skillunit.yaml'] },
  },
  {
    name: 'body that asserts nothing',
    change: 'empty the body of `response-body`, so it calls tinyfetch and asserts nothing',
    apply(app) {
      app.edit(
        TESTS.requests,
        "      expect(await tf.get('http://x/json')).toEqual({ id: 1 });\n      expect(await tf.get('http://x/text')).toBe('plain');\n      expect(await tf.get('http://x/html')).toBe('<p>hi</p>');\n",
        "      await tf.get('http://x/json');\n",
      );
      app.commit('Assert nothing');
    },
    // `skillunit/vitest` counts the assertions of the body: none, so the test fails and the unit
    // is not built.
    expect: { proof: ['response-body', '../skillunit.yaml'] },
  },
  {
    name: 'no value typed twice 1: the constant changes',
    change: 'in `src/retry.ts`, change `RETRY_TIMES` from 2 to 3, and edit nothing else',
    apply(app) {
      app.edit('src/retry.ts', 'export const RETRY_TIMES = 2;', 'export const RETRY_TIMES = 3;');
      app.commit('Triple the wait');
    },
    // No test fails: the assertion uses the constant. The Value changes.
    expect: { proof: ['retry-defaults'] },
  },
  {
    name: 'no value typed twice 2: a number typed into a sentence',
    change: 'type a number into the Value of `cancel-with-signal`',
    apply(app) {
      app.edit(TESTS.timeouts, "value: 'the request rejects with the reason the signal was aborted with.',", "value: 'the request rejects with the reason the signal was aborted with, within 5 ms.',");
      app.commit('Type a number');
    },
    // The test of the unit fails on the number, so the unit is not built, and the run fails.
    expect: { proof: ['cancel-with-signal', '../skillunit.yaml'] },
  },
  {
    name: 'proof 3: a unit from a test edited in skill/',
    change: 'edit the `Value` of `default-timeout` in the built skill',
    apply(app) {
      app.edit('skill/features/timeouts.md', 'Value: 10 seconds', 'Value: 30 seconds');
      app.commit('Say 30 seconds');
    },
    expect: { proof: ['default-timeout'] },
  },
  {
    name: 'proof 4: the test of a unit deleted, and one skipped',
    change: 'delete the `unit()` of `body-as-object`, and turn the one of `response-body` into `unit.skip`',
    apply(app) {
      const text = app.read(TESTS.requests);
      const { start, end } = unitCall(text, 'body-as-object');
      app.write(TESTS.requests, text.slice(0, start) + text.slice(end).replace(/^\n/, ''));
      app.edit(TESTS.requests, "  unit(\n    'response-body',", "  unit.skip(\n    'response-body',");
      app.commit('Drop one test, skip another');
    },
    // A unit deleted with its test, and one skipped, leave no record; the skill still has them, and
    // the proof names each by its heading.
    expect: { proof: ['body-as-object', 'response-body'] },
  },
  {
    name: 'proof 5: a body that fails',
    change: 'make the assertion of `body-as-object` expect another body',
    apply(app) {
      app.edit(TESTS.requests, `body: '{"name":"Ada"}'`, `body: '{"name":"Bob"}'`);
      app.commit('Expect Bob');
    },
    // The unit, and the run, which did not exit with 0.
    expect: { proof: ['body-as-object', '../skillunit.yaml'] },
  },
  {
    name: 'proof 10: an ordinary test fails',
    change: 'add a test that declares no unit and fails',
    apply(app) {
      app.edit(TESTS.timeouts, "  unit(\n    'cancel-with-signal',", "  it('fails on purpose', () => {\n    expect(1).toBe(2);\n  });\n\n  unit(\n    'cancel-with-signal',");
      app.edit(TESTS.timeouts, "import { afterEach, describe, expect, vi } from 'vitest';", "import { afterEach, describe, expect, it, vi } from 'vitest';");
      app.commit('A failing test');
    },
    expect: { proof: ['../skillunit.yaml'] },
  },



  {
    name: 'proof 9: a file in skill/ that no setup() declares',
    change: 'add `skill/notes.txt`',
    apply(app) {
      app.write('skill/notes.txt', 'notes\n');
      app.commit('Notes');
    },
    expect: { proof: ['notes.txt'] },
  },
  {
    name: 'setup 1: a unit with no setup()',
    change: 'add a test file that declares a unit and no file of the skill',
    apply(app) {
      app.write('src/skill/extra.test.ts', "import { unit } from 'skillunit/vitest';\nimport { expect } from 'vitest';\n\nunit('orphan', { when: 'x.', do: 'y.' }, () => {\n  expect(1).toBe(1);\n});\n");
      app.commit('A unit with no file');
    },
    expect: { proof: ['orphan'] },
  },
  {
    name: 'setup 2: two setup() for one file',
    change: 'add a test file that declares `features/clients.md` again',
    apply(app) {
      app.write('src/skill/extra.test.ts', "import { setup } from 'skillunit/vitest';\n\nsetup('more-clients', { file: 'features/clients.md', title: 'More clients', when: 'Make more clients', description: 'More clients.' });\n");
      app.commit('A second setup for clients.md');
    },
    expect: { proof: ['../src/skill/extra.test.ts'] },
  },
  {
    name: 'setup 3: a number in the description of a file',
    change: 'type a number into the description of `features/retries.md`',
    apply(app) {
      app.edit(TESTS.retries, "description: 'Which failed requests tinyfetch repeats, and how long it waits between attempts.',", "description: 'Which failed requests tinyfetch repeats, up to 3 times.',");
      app.commit('A number in a description');
    },
    // The test of the `setup()` fails on the number, so the file is not built, its row leaves the
    // index of SKILL.md, and the run fails.
    expect: { proof: ['../src/skill/retries.test.ts', '../skillunit.yaml', 'SKILL.md', 'features/retries.md'] },
  },
  {
    name: 'clean',
    change: 'no change',
    model: 'optional',
    apply(app) {
      app.commit('Nothing');
    },
    expect: {},
  },
];

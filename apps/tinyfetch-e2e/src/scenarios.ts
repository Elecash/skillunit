/**
 * The acceptance scenarios: each changes tinyfetch or its skill in a copy of the app, and lists
 * what SkillUnit must report. Findings are written `rule file unit code`, the code being a
 * TypeScript code when there is one; proof findings are unit ids, or the file for one about no
 * unit; model findings are test ids. Before `check`, the app's tests run, as in CI, and write the report proof reads.
 * Anything reported that is not listed fails the scenario, as does anything listed that is not
 * reported.
 */
import { format } from 'prettier';
import type { App } from './app.js';

export interface Expected {
  /** Lint errors. */
  lint?: string[];
  lintWarnings?: string[];
  /** Proof errors, by unit id, or by file for one about no unit (a report, a test file). */
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

const RETRY_SETUP = 'Setup:\n\n```ts\nimport { tf } from "tinyfetch";\n```\n\n';
const TIMEOUT_SETUP = 'Setup:\n\n```ts\nimport { tf, TimeoutError } from "tinyfetch";\n```\n\n';

/** Prettier over every Markdown file of the skill. */
async function prettier(app: App, files: string[], proseWrap: 'preserve' | 'always' | 'never') {
  for (const file of files) app.write(file, await format(app.read(file), { parser: 'markdown', proseWrap }));
}

/** The tests of tinyfetch, which prove units of its skill. */
const TEST = 'src/tinyfetch.test.ts';

const SKILL_FILES = ['skill/SKILL.md', ...['clients', 'errors', 'requests', 'retries', 'timeouts'].map((f) => `skill/features/${f}.md`)];

export const scenarios: Scenario[] = [
  {
    name: 'removed option',
    change: 'delete `retryDelay` from the code, leave the skill',
    apply(app) {
      app.edit('src/types.ts', '  /** Milliseconds to wait before the first new attempt, doubled each time. Default 300. */\n  retryDelay?: number;\n', '');
      app.edit('src/request.ts', '    options.retry,\n    options.retryDelay,\n', '    options.retry,\n');
      app.edit('src/retry.ts', 'retry = 0, retryDelay = DEFAULT_RETRY_DELAY): Promise<T> {', 'retry = 0): Promise<T> {\n  const retryDelay = DEFAULT_RETRY_DELAY;');
      app.commit('Drop retryDelay');
    },
    expect: { lint: ['types skill/features/retries.md - TS2353'] },
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
    expect: { lint: ['types skill/features/clients.md - TS2305'] },
  },
  {
    name: 'stale example',
    change: 'fix a rule (tinyfetch sets content-type, so a Check now forbids setting it), leave an old example that sets it',
    apply(app) {
      app.edit('skill/features/requests.md', 'Check: forbid `/JSON\\.stringify/` in ts\n', 'Check: forbid `/JSON\\.stringify/` in ts\n\nCheck: forbid `/["\']content-type["\']\\s*:/` in ts\n');
      app.commit('body-as-object: do not set content-type');
    },
    expect: { lint: ['check skill/features/clients.md -'] },
  },
  {
    name: 'broken example next to a stale one',
    change: 'add an example that does not parse, and remove the `query` option another example uses',
    apply(app) {
      app.edit('skill/features/requests.md', '## Rules\n', '```ts\nawait tf.get("https://api.example.com/users", {\n```\n\n## Rules\n');
      app.edit('src/types.ts', '  /** Query parameters, encoded and appended to the path. */\n  query?: Record<string, string | number | boolean>;\n', '');
      app.edit('src/request.ts', '  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, String(value));\n', '');
      app.commit('Drop query, add an example');
    },
    expect: {
      lint: ['types skill/features/requests.md - TS1005', 'types skill/features/requests.md query-in-options TS2353'],
      // The test that proves `query-in-options` fails without the option.
      proof: ['query-in-options'],
    },
  },
  {
    name: 'example without its import',
    change: "delete the `Setup` of a file that needs more than the `Setup` of `SKILL.md`",
    apply(app) {
      app.edit('skill/features/timeouts.md', TIMEOUT_SETUP, '');
      app.commit('Drop the timeouts Setup');
    },
    // `tf` still comes from `SKILL.md`; `TimeoutError` does not, so `instanceof` no longer
    // narrows `error` either.
    expect: { lint: ['types skill/features/timeouts.md - TS18046', 'types skill/features/timeouts.md - TS2304'] },
  },
  {
    name: 'Setup moved to SKILL.md',
    change: "move a file's `Setup` to `SKILL.md`, which then covers that file",
    apply(app) {
      app.edit('skill/features/timeouts.md', TIMEOUT_SETUP, '');
      app.edit('skill/SKILL.md', 'Setup:\n\n```ts\nimport { tf } from "tinyfetch";\n```', 'Setup:\n\n```ts\nimport { tf, TimeoutError } from "tinyfetch";\n```');
      app.commit('One Setup for the skill');
    },
    expect: {},
  },
  {
    name: 'Setup the same as SKILL.md',
    change: "delete a file's `Setup` that only repeats the one of `SKILL.md`",
    apply(app) {
      app.edit('skill/features/retries.md', RETRY_SETUP, '');
      app.commit('Drop the retries Setup');
    },
    expect: {},
  },
  {
    name: 'wrong package',
    change: 'change the package name in a `Setup`',
    apply(app) {
      app.edit('skill/features/timeouts.md', 'import { tf, TimeoutError } from "tinyfetch";', 'import { tf, TimeoutError } from "tiny-fetch";');
      app.commit('Typo in the package name');
    },
    // With the import broken, `instanceof TimeoutError` no longer narrows `error`, so reading
    // `error.timeout` fails too.
    expect: { lint: ['types skill/features/timeouts.md - TS2307', 'types skill/features/timeouts.md - TS18046'] },
  },
  {
    name: 'contradicting prose',
    change: 'replace a sentence with one that contradicts a rule',
    model: 'required',
    apply(app) {
      app.edit(
        'skill/features/retries.md',
        'Which failures it repeats, and how long it waits, are in the rules below.',
        'The server never applies the same request twice: retrying is safe for every method, and `retry` belongs on POST and PATCH calls as much as on GET.',
      );
      app.commit('Say retries are always safe');
    },
    // The sentence replaces the one that points to the rules. Measured on Jev over five runs:
    // post-no-retry ends at 0.35 to 0.43 and patch-no-retry at 0.41 to 0.49, so both failed every
    // time; patch-no-retry is close enough to its threshold to pass one day. retry-methods, which
    // asks about every method, passed at 0.63 to 0.73.
    expect: { failing: ['post-no-retry'], mayFail: ['patch-no-retry', 'retry-methods'] },
  },
  {
    name: 'ambiguous rule',
    change: "weaken a rule's wording",
    model: 'required',
    apply(app) {
      app.edit('skill/features/retries.md', 'Do: enable `retry` only for GET, HEAD, PUT and DELETE.', 'Do: think about whether `retry` suits the method before you enable it.');
      app.commit('Soften the retry rule');
    },
    // The weakened rule names no method, so the test that asks for the list fails too.
    expect: { failing: ['put-may-retry', 'retry-methods'], mayFail: ['post-no-retry', 'patch-no-retry'] },
  },
  {
    name: 'unit added with no test',
    change: 'add a fact that no test proves',
    apply(app) {
      const unit =
        '\n### fact: timeout-error-names-its-limit\n\nWhen: code reads a `TimeoutError`.\n\nValue: `error.timeout` is the limit in milliseconds that the request went over.\n';
      app.write('skill/features/timeouts.md', app.read('skill/features/timeouts.md') + unit);
      app.commit('Add a unit about TimeoutError');
    },
    // An unproved unit is counted, not reported: the lock does not list it.
    expect: {},
  },
  ...(['preserve', 'always', 'never'] as const).map(
    (proseWrap): Scenario => ({
      name: `formatter run (proseWrap: ${proseWrap})`,
      change: `run Prettier over the skill with proseWrap ${proseWrap}`,
      async apply(app) {
        await prettier(app, SKILL_FILES, proseWrap);
        app.commit(`Format the skill (${proseWrap})`);
      },
      // Formatting changes no unit, no example and no block a test produced.
      expect: {},
    }),
  ),
  {
    name: 'formatter that joins lines',
    change: 'write a unit with its labels on consecutive lines, then run Prettier with proseWrap always',
    async apply(app) {
      const compact =
        '\n### rule: log-failed-requests\nWhen: code logs a failed tinyfetch request.\nDo: log the method, the URL and `error.status` together.\n';
      app.write('skill/features/errors.md', app.read('skill/features/errors.md') + compact);
      await prettier(app, ['skill/features/errors.md'], 'always');
      app.commit('Add a unit, format');
    },
    expect: {
      // `When:` and `Do:` share a line, so the rule has no `Do` of its own any more.
      lint: ['structure skill/features/errors.md log-failed-requests', 'structure skill/features/errors.md log-failed-requests'],
    },
  },
  // The experiments of the README's "Try it" section, change for change, so CI fails when one
  // stops reporting what the README shows. The contradicting sentence is the scenario
  // `contradicting prose` above.
  {
    name: 'README 1: renamed option',
    change: 'in `src/types.ts`, rename the option `retryDelay` to `backoff`',
    apply(app) {
      app.edit('src/types.ts', '  retryDelay?: number;', '  backoff?: number;');
      app.commit('Rename retryDelay to backoff');
    },
    expect: { lint: ['types skill/features/retries.md - TS2353'] },
  },
  {
    name: 'README 2: Right example that breaks its rule',
    change: 'turn the `Right` example of `retry-idempotent-only` into a retried POST',
    apply(app) {
      app.edit(
        'skill/features/retries.md',
        'Right:\n\n```ts\nawait tf.get("https://api.example.com/users", { retry: 3 });\n```',
        'Right:\n\n```ts\nawait tf.post("https://api.example.com/orders", { item: 42 }, { retry: 3 });\n```',
      );
      app.commit('Retry a POST in the Right example');
    },
    expect: { lint: ['check skill/features/retries.md retry-idempotent-only'] },
  },
  {
    name: 'README 4: default changed',
    change: 'in `src/timeout.ts`, change `DEFAULT_TIMEOUT` from `10_000` to `5_000`',
    apply(app) {
      app.edit('src/timeout.ts', 'export const DEFAULT_TIMEOUT = 10_000;', 'export const DEFAULT_TIMEOUT = 5_000;');
      app.commit('Lower the default timeout');
    },
    // The test tagged `[skill:default-timeout]` fails too: it asserts 10 seconds.
    expect: { proof: ['default-timeout'] },
  },
  {
    name: 'README 4: default changed, unit and test edited',
    change: 'the same change, then edit the `Value` of `default-timeout` and the test that proves it',
    apply(app) {
      app.edit('src/timeout.ts', 'export const DEFAULT_TIMEOUT = 10_000;', 'export const DEFAULT_TIMEOUT = 5_000;');
      app.edit('skill/features/timeouts.md', 'Value: 10 seconds (`timeout: 10_000`), for every method.', 'Value: 5 seconds (`timeout: 5_000`), for every method.');
      // The test that proves `default-timeout` asserts the value too.
      app.write(TEST, app.read(TEST).replace('times out after 10 seconds', 'times out after 5 seconds').replaceAll('10_000', '5_000').replace('9_999', '4_999'));
      app.commit('Lower the default timeout');
    },
    expect: {},
  },
  {
    name: 'proof 1: default changed under a proved fact',
    change: 'in `src/retry.ts`, change `DEFAULT_RETRY_DELAY` from 300 to 500, leave the skill and the tests',
    apply(app) {
      app.edit('src/retry.ts', 'export const DEFAULT_RETRY_DELAY = 300;', 'export const DEFAULT_RETRY_DELAY = 500;');
      app.commit('Raise the retry delay');
    },
    // The test tagged `[skill:retry-defaults]` fails, and proof names the unit.
    expect: { proof: ['retry-defaults'] },
  },
  {
    name: 'proof 2: region changed without --write',
    change: 'change the code inside the region of `query-in-options` and its assertion, and leave the skill',
    apply(app) {
      app.edit(TEST, "query: { page: 2, sort: 'name' },", "query: { page: 2, sort: 'email' },");
      app.edit(TEST, 'users?page=2&sort=name', 'users?page=2&sort=email');
      app.commit('Sort by email');
    },
    expect: { proof: ['query-in-options'] },
  },
  {
    name: 'proof 3: tagged test deleted',
    change: 'delete the test that proves `body-as-object`, with its region',
    apply(app) {
      const text = app.read(TEST);
      const start = text.indexOf("  it('sends the body as JSON [skill:body-as-object]'");
      const end = text.indexOf('  it(', start + 1);
      app.write(TEST, text.slice(0, start) + text.slice(end));
      app.commit('Drop a test');
    },
    // The block has no source any more, and the lock lists a unit no test proves.
    expect: { proof: ['body-as-object', 'body-as-object'] },
  },
  {
    name: 'proof 4: tagged test skipped',
    change: 'skip the test that proves `body-as-object`',
    apply(app) {
      app.edit(TEST, "  it('sends the body as JSON [skill:body-as-object]'", "  it.skip('sends the body as JSON [skill:body-as-object]'");
      app.commit('Skip a test');
    },
    // The lock lists the unit, and its only test was skipped.
    expect: { proof: ['body-as-object'] },
  },
  {
    name: 'proof 5: tag with no unit',
    change: 'tag a test with an id that no unit has',
    apply(app) {
      app.edit(TEST, "it('cancels with the caller signal'", "it('cancels with the caller signal [skill:cancel-with-signal]'");
      app.commit('Tag a test');
    },
    expect: { proof: ['../reports/junit.xml'] },
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

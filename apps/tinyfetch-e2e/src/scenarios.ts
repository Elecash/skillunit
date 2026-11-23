/**
 * The acceptance scenarios: each changes tinyfetch or its skill in a copy of the app, and lists
 * what SkillUnit must report. Findings are written `rule file unit code`, the code being a
 * TypeScript code when there is one; sync findings are unit ids (`lock` for one about the lock
 * itself); proof findings are unit ids, or the file for one about no unit; model findings are
 * test ids. Before `check`, the app's tests run, as in CI, and write the report proof reads.
 * Anything reported that is not listed fails the scenario, as does anything listed that is not
 * reported.
 */
import { format } from 'prettier';
import type { App } from './app.js';

export interface Expected {
  /** Lint errors. */
  lint?: string[];
  lintWarnings?: string[];
  /** Units sync reports for review: stale or new, and `lock` when there is no lock. */
  sync?: string[];
  /** Orphan entries sync warns about, by unit id. */
  syncWarnings?: string[];
  /** Proof errors, by unit id, or by file for one about no unit (a report, a test file). */
  proof?: string[];
  proofWarnings?: string[];
  /** Tests that must fail. Only scenarios that need the model. */
  failing?: string[];
  /** Tests that may fail too: the change touches what they ask about. */
  mayFail?: string[];
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
    expect: {
      lint: ['types skill/features/retries.md - TS2353'],
      sync: ['body-as-object', 'query-in-options', 'retry-idempotent-only'],
    },
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
    expect: {
      lint: ['types skill/features/clients.md - TS2305', 'source skill/features/clients.md one-client-per-api'],
      sync: ['await-every-request', 'one-client-per-api'],
    },
  },
  {
    name: 'stale example',
    change: 'fix a rule (tinyfetch sets content-type, so a Check now forbids setting it), leave an old example that sets it',
    apply(app) {
      const wrong = '- Doing: `tf.post("https://api.example.com/users", JSON.stringify({ name: "Ada" }))`\n\n  Because: the server receives a JSON string instead of an object.\n';
      app.edit(
        'skill/features/requests.md',
        wrong,
        `${wrong}\n- Doing: \`tf.post("https://api.example.com/users", { name: "Ada" }, { headers: { "content-type": "application/json" } })\`\n\n  Because: tinyfetch sets \`content-type\` itself, and a second value can disagree with the body.\n`,
      );
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
      sync: ['body-as-object', 'query-in-options'],
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
    name: 'unguarded rule',
    change: 'remove the `Check` of a rule whose `Wrong` code compiles',
    apply(app) {
      app.edit('skill/features/retries.md', 'Check: forbid `/\\.(post|patch)\\([^)]*retry/` in ts\n\n', '');
      app.commit('Drop the retry Check');
    },
    expect: { lintWarnings: ['wrong-code skill/features/retries.md retry-idempotent-only'] },
  },
  {
    name: 'mistyped Check',
    change: 'change a `forbid` regex so it no longer matches its own `Wrong` code',
    apply(app) {
      app.edit('skill/features/retries.md', 'Check: forbid `/\\.(post|patch)\\([^)]*retry/` in ts', 'Check: forbid `/\\.(post|patch)\\(\\s*retry/` in ts');
      app.commit('Mistype the retry Check');
    },
    expect: {
      lint: ['check skill/features/retries.md retry-idempotent-only'],
      // The regex no longer matches the Wrong code, so nothing guards it either.
      lintWarnings: ['wrong-code skill/features/retries.md retry-idempotent-only'],
    },
  },
  {
    name: 'contradicting prose',
    change: 'add a sentence that contradicts a rule',
    model: 'required',
    apply(app) {
      app.edit(
        'skill/features/retries.md',
        'Which failures it repeats, and how long it waits, are in the rules below.',
        'Which failures it repeats, and how long it waits, are in the rules below. tinyfetch sends an `Idempotency-Key` header with every POST and PATCH, and repeats it on each retry, so the server never applies the same request twice: retrying is safe for every method, and `retry` belongs on POST and PATCH calls as much as on GET.',
      );
      app.commit('Say retries are always safe');
    },
    expect: { failing: ['post-no-retry'], mayFail: ['patch-no-retry'] },
  },
  {
    name: 'ambiguous rule',
    change: "weaken a rule's wording",
    model: 'required',
    apply(app) {
      app.edit('skill/features/retries.md', 'Do: enable `retry` only for GET, HEAD, PUT and DELETE.', 'Do: think about whether `retry` suits the method before you enable it.');
      app.commit('Soften the retry rule');
    },
    expect: { failing: ['put-may-retry'], mayFail: ['post-no-retry', 'patch-no-retry'] },
  },
  {
    name: 'comment-only change',
    change: 'edit a comment in a `Source` file: its fingerprint leaves comments out',
    apply(app) {
      app.edit('src/retry.ts', 'export const DEFAULT_RETRY_DELAY = 300;', '// Milliseconds.\nexport const DEFAULT_RETRY_DELAY = 300;');
      app.commit('Comment');
    },
    expect: {},
  },
  {
    name: 'other declaration of a #symbol file',
    change: 'change `HttpError` in `src/errors.ts`, where a unit points at `#isHttpError` only',
    apply(app) {
      app.edit('src/errors.ts', 'super(`HTTP ${status}`);', 'super(`HTTP status ${status}`);');
      app.commit('Reword the HttpError message');
    },
    expect: {},
  },
  {
    name: 'changed symbol',
    change: 'change `isHttpError` itself, which a unit points at with `#isHttpError`',
    apply(app) {
      app.edit('src/errors.ts', "error.name === 'HttpError' &&", "(error.name === 'HttpError' || error instanceof HttpError) &&");
      app.commit('Accept a local HttpError too');
    },
    expect: { sync: ['check-with-is-http-error'] },
  },
  {
    name: 'unit added without a review',
    change: 'add a unit with a `Source`, and do not accept it',
    apply(app) {
      const unit =
        '\n### fact: timeout-error-names-its-limit\n\nWhen: code reads a `TimeoutError`.\n\nValue: `error.timeout` is the limit in milliseconds that the request went over.\n\nApplies: timeouts, errors\n\nSource: src/errors.ts#TimeoutError\n';
      app.write('skill/features/timeouts.md', app.read('skill/features/timeouts.md') + unit);
      app.commit('Add a unit about TimeoutError');
    },
    // With `require` on, a new unit that no test proves and with no `Proof: none` is an error.
    expect: { sync: ['timeout-error-names-its-limit'], proof: ['timeout-error-names-its-limit'] },
  },
  {
    name: 'orphan entry',
    change: 'delete a unit and its test; the lock still has its entry',
    apply(app) {
      const file = app.read('skill/features/timeouts.md');
      const start = file.indexOf('### rule: never-disable-timeout');
      const after = file.indexOf('\n### ', start + 1);
      app.write('skill/features/timeouts.md', file.slice(0, start) + (after < 0 ? '' : file.slice(after + 1)));
      const spec = app.read('specs/timeouts.yaml');
      const test = spec.indexOf('  - id: long-upload');
      const next = spec.indexOf('\n  - id:', test + 1);
      app.write('specs/timeouts.yaml', spec.slice(0, test) + (next < 0 ? '' : spec.slice(next + 1)));
      app.commit('Drop the never-disable-timeout rule');
    },
    expect: { syncWarnings: ['never-disable-timeout'] },
  },
  {
    name: 'missing lock',
    change: 'delete `skillunit.lock`',
    apply(app) {
      app.remove('skillunit.lock');
      app.commit('Drop the lock');
    },
    expect: { sync: ['lock'] },
  },
  {
    name: 'reviewed refactor',
    change: 'change a `Source`, then `skillunit review --accept` its unit',
    apply(app) {
      app.edit('src/retry.ts', 'const retryable = !isHttpError(error) || error.status >= 500;', 'const serverSide = !isHttpError(error) || error.status >= 500;');
      app.edit('src/retry.ts', '!retryable ||', '!serverSide ||');
      app.accept('retry-idempotent-only');
      app.commit('Rename a variable\n\nThe behaviour is the same.');
    },
    expect: {},
  },
  ...(['preserve', 'always', 'never'] as const).map(
    (proseWrap): Scenario => ({
      name: `formatter run (proseWrap: ${proseWrap})`,
      change: `run Prettier over the skill with proseWrap ${proseWrap}, next to a change in a Source file`,
      async apply(app) {
        app.edit('src/timeout.ts', 'export const DEFAULT_TIMEOUT = 10_000;', 'export const DEFAULT_TIMEOUT = 10000;');
        await prettier(app, SKILL_FILES, proseWrap);
        app.commit(`Format the skill (${proseWrap})`);
      },
      // The units of the changed Source are still to review: formatting is not an edit.
      expect: { sync: ['default-timeout', 'never-disable-timeout'] },
    }),
  ),
  {
    name: 'formatter that joins lines',
    change: 'write a unit with its labels on consecutive lines, then run Prettier with proseWrap always',
    async apply(app) {
      const compact =
        '\n### rule: log-failed-requests\nWhen: code logs a failed tinyfetch request.\nDo: log the method, the URL and `error.status` together.\nApplies: errors\n';
      app.write('skill/features/errors.md', app.read('skill/features/errors.md') + compact);
      await prettier(app, ['skill/features/errors.md'], 'always');
      app.commit('Add a unit, format');
    },
    expect: {
      // `When:` and `Do:` share a line; the rule has no `Do` and no `Applies` of its own any more.
      lint: [
        'structure skill/features/errors.md log-failed-requests',
        'structure skill/features/errors.md log-failed-requests',
        'structure skill/features/errors.md log-failed-requests',
      ],
      // A new unit that no test proves, with `require` on.
      proof: ['log-failed-requests'],
    },
  },
  // The experiments of the README's "Try it" section, change for change, so CI fails when one
  // stops reporting what the README shows. Its fifth, the contradicting sentence, is the
  // scenario `contradicting prose` above.
  {
    name: 'README 1: renamed option',
    change: 'in `src/types.ts`, rename the option `retryDelay` to `backoff`',
    apply(app) {
      app.edit('src/types.ts', '  retryDelay?: number;', '  backoff?: number;');
      app.commit('Rename retryDelay to backoff');
    },
    // No unit has `src/types.ts` as its `Source`, so sync reports nothing.
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
    name: 'README 3: comment reworded',
    change: 'in `src/timeout.ts`, reword the comment above `withTimeout`',
    apply(app) {
      app.edit(
        'src/timeout.ts',
        ' * A signal that aborts after `timeout` milliseconds, or when `signal` aborts. A timeout of 0\n * never fires.',
        ' * Returns a signal that aborts once `timeout` milliseconds pass, or as soon as `signal` aborts.\n * A timeout of 0 never fires.',
      );
      app.commit('Reword a comment');
    },
    expect: {},
  },
  {
    name: 'README 4: default changed',
    change: 'in `src/timeout.ts`, change `DEFAULT_TIMEOUT` from `10_000` to `5_000`',
    apply(app) {
      app.edit('src/timeout.ts', 'export const DEFAULT_TIMEOUT = 10_000;', 'export const DEFAULT_TIMEOUT = 5_000;');
      app.commit('Lower the default timeout');
    },
    // The test tagged `[skill:default-timeout]` fails too: it asserts 10 seconds.
    expect: { sync: ['default-timeout', 'never-disable-timeout'], proof: ['default-timeout'] },
  },
  {
    name: 'README 4: default changed, unit edited and accepted',
    change: 'the same change, then edit `default-timeout` and `skillunit review --accept` both units',
    apply(app) {
      app.edit('src/timeout.ts', 'export const DEFAULT_TIMEOUT = 10_000;', 'export const DEFAULT_TIMEOUT = 5_000;');
      app.edit('skill/features/timeouts.md', 'Value: 10 seconds (`timeout: 10_000`), for every method.', 'Value: 5 seconds (`timeout: 5_000`), for every method.');
      // The test that proves `default-timeout` asserts the value too.
      app.write(TEST, app.read(TEST).replace('times out after 10 seconds', 'times out after 5 seconds').replaceAll('10_000', '5_000').replace('9_999', '4_999'));
      app.accept('default-timeout', 'never-disable-timeout');
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
    expect: { sync: ['retry-idempotent-only'], proof: ['retry-defaults'] },
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
    // The block has no source any more, and with `require` the unit is unproved.
    expect: { proof: ['body-as-object', 'body-as-object'] },
  },
  {
    name: 'proof 4: tagged test skipped',
    change: 'skip the test that proves `body-as-object`',
    apply(app) {
      app.edit(TEST, "  it('sends the body as JSON [skill:body-as-object]'", "  it.skip('sends the body as JSON [skill:body-as-object]'");
      app.commit('Skip a test');
    },
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

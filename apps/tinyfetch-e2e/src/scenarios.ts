/**
 * The acceptance scenarios: each changes tinyfetch or its skill in a copy of the app, and lists
 * what SkillUnit must report. Findings are written `rule file unit code`, the code being a
 * TypeScript code when there is one; sync findings are unit ids; model findings are test ids.
 * Anything reported that is not listed fails the scenario, as does anything listed that is not
 * reported.
 */
import { format } from 'prettier';
import type { App } from './app.js';

export interface Expected {
  /** Lint errors. */
  lint?: string[];
  lintWarnings?: string[];
  /** Units sync reports for review. */
  sync?: string[];
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

/** Prettier over every Markdown file of the skill. */
async function prettier(app: App, files: string[], proseWrap: 'preserve' | 'always' | 'never') {
  for (const file of files) app.write(file, await format(app.read(file), { parser: 'markdown', proseWrap }));
}

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
    },
  },
  {
    name: 'example without its import',
    change: "delete a file's `Setup`",
    apply(app) {
      app.edit('skill/features/retries.md', RETRY_SETUP, '');
      app.commit('Drop the retries Setup');
    },
    expect: {
      lint: [
        'types skill/features/retries.md - TS2304',
        'types skill/features/retries.md retry-idempotent-only TS2304',
        'wrong-code skill/features/retries.md retry-idempotent-only TS2304',
      ],
    },
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
        'It never retries a 4xx status or a timeout.',
        'It never retries a 4xx status or a timeout. Retrying is safe for every method, POST included, so turn `retry` on wherever a request may fail.',
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
    },
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

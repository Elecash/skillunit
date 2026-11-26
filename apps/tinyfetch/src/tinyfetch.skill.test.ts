// The units of the skill that no test proves: advice, declared with `unit()` and no body, and a
// question about the index of the skill. Their examples are the regions below, type-checked with
// the tests and never run. See docs/proof.md.
import { ask, unit } from 'skillunit/vitest';
import { create, tf } from './index.js';
import { NO_TIMEOUT } from './timeout.js';

export async function examples() {
  // #region skill:one-client-per-api.shared
  const api = create({ baseUrl: 'https://api.example.com/v1/' });
  await api.get('users');
  await api.get('orders');
  // #endregion

  // #region skill:retry-idempotent-only
  await tf.get('https://api.example.com/users', { retry: 3 });
  // #endregion

  // #region skill:never-disable-timeout
  await tf.post('https://api.example.com/uploads', { size: 1 }, { timeout: 120_000 });
  // #endregion
}

unit('one-client-per-api', {
  when: 'the code makes several requests to the same API.',
  decide: 'whether to create a client.',
  paths: [
    { path: 'shared', when: 'the requests share a base URL or headers: create one client with `create` and reuse it.' },
    { path: 'direct', when: 'one request, or requests to unrelated hosts: call `tf` with full URLs.' },
  ],
  evenWhen: 'the requests sit in different files: export the client from one module and import it.',
  ask: [
    {
      id: 'several-calls-same-api',
      scenario: [
        'A service calls three endpoints of the same API, all with the same bearer token.',
        'Two modules of the app read from one billing API with the same base URL.',
      ],
      question: 'How should the code make these requests?',
      options: {
        shared: 'Create one client with `create` and reuse it',
        each: 'Create a client next to each request',
        direct: 'Call `tf` with full URLs and repeat the headers',
      },
      expect: 'shared',
    },
    {
      id: 'single-call-other-host',
      scenario: 'A script makes one request to a weather API, once.',
      question: 'How should the agent make this request?',
      options: {
        client: 'Create a client with `create` and call it',
        direct: 'Call `tf` with the full URL',
      },
      expect: 'direct',
    },
  ],
});

unit('retry-idempotent-only', {
  when: 'a request may be retried.',
  do: 'enable `retry` only for GET, HEAD, PUT and DELETE.',
  check: 'forbid `/\\.(post|patch)\\([^)]*retry/` in ts',
  ask: [
    {
      id: 'post-no-retry',
      scenario: [
        'An order is created with `tf.post`, and the network drops now and then.',
        'A payment is sent with `tf.post` to an API that sometimes answers 503.',
      ],
      question: 'Should the agent pass `retry` to that call?',
      options: {
        retry: 'Pass `retry` to the `tf.post` call',
        'no-retry': 'Leave `retry` off the `tf.post` call',
      },
      expect: 'no-retry',
    },
    {
      id: 'patch-no-retry',
      scenario: [
        'A user profile is updated with `tf.patch`, and the API sometimes answers 503.',
        'A stock count is decreased with `tf.patch`, and the network drops now and then.',
      ],
      question: 'Should the agent pass `retry` to that call?',
      options: {
        retry: 'Pass `retry` to the `tf.patch` call',
        'no-retry': 'Leave `retry` off the `tf.patch` call',
      },
      expect: 'no-retry',
    },
    {
      id: 'retry-methods',
      scenario: 'The agent adds `retry` to the calls of a client that uses every method tinyfetch has.',
      question: 'Which methods may get `retry`?',
      options: {
        idempotent: 'GET, HEAD, PUT and DELETE',
        all: 'Every method, POST and PATCH included',
        reads: 'GET and HEAD only',
      },
      expect: 'idempotent',
    },
    {
      id: 'put-may-retry',
      scenario: 'A settings document is replaced with `tf.put`, and the API sometimes answers 503.',
      question: 'Should the agent pass `retry` to that call?',
      options: {
        retry: 'Yes, `retry` is allowed for this method',
        'no-retry': 'No, leave `retry` off for this method',
      },
      expect: 'retry',
    },
    {
      id: 'get-may-retry',
      scenario: 'A list of users is read with `tf.get`, and the API sometimes answers 503.',
      question: 'May the agent pass `retry` to that call?',
      expect: 'yes',
    },
  ],
});

unit('never-disable-timeout', {
  when: 'a request may take long, such as an upload or a report.',
  do: `raise \`timeout\` to a number of milliseconds that fits the request, and never set it to \`${NO_TIMEOUT}\`.`,
  check: `forbid \`/timeout:\\s*${NO_TIMEOUT}\\b/\` in ts`,
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

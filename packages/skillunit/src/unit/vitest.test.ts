/**
 * `skillunit/vitest` in a real Vitest run: a project in a temporary folder, with its own
 * `skillunit.yaml`, whose tests declare units. Vitest runs there, so the units go to that
 * project's `proof.units` folder and not to this repository's.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { UnitRecord } from './contract.js';

const require = createRequire(import.meta.url);
const VITEST = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const ENTRY = fileURLToPath(new URL('../vitest.ts', import.meta.url));
const API = fileURLToPath(import.meta.resolve('vitest'));

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** Runs Vitest on `files` in a new project; returns its exit code and the records it left, by id. */
function vitest(files: Record<string, string>, more = '') {
  const yaml = 'skill: ./skill\nproof:\n  units: ./out/units\n';
  const root = mkdtempSync(join(tmpdir(), 'skillunit-vitest-'));
  roots.push(root);
  writeFileSync(join(root, 'skillunit.yaml'), yaml);
  writeFileSync(join(root, 'vitest.config.mjs'), `export default { test: { include: ["tests/**/*.test.ts"]${more} } };\n`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text.replaceAll('$ENTRY', JSON.stringify(ENTRY)).replaceAll('$API', JSON.stringify(API)));
  }
  const run = spawnSync(process.execPath, [VITEST, 'run', '--allowOnly'], { cwd: root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
  const dir = join(root, 'out/units');
  const names = (() => {
    try {
      return readdirSync(dir).sort();
    } catch {
      return [];
    }
  })();
  const records = names.map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')) as UnitRecord);
  return { status: run.status, output: `${run.stdout}${run.stderr}`, names, records, byId: (id: string) => records.filter((r) => r.id === id) };
}

const lineOf = (text: string, needle: string) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;

const TEST = `import { beforeEach, describe, expect } from $API;
import { unit } from $ENTRY;

const DEFAULT_TIMEOUT = 10_000;
let calls: string[] = [];

unit(
  'default-timeout',
  {
    when: 'the user asks how long a request waits by default.',
    value: \`\${DEFAULT_TIMEOUT / 1000} seconds (\\\`timeout: \${DEFAULT_TIMEOUT}\\\`), for every method.\`,
    values: { seconds: DEFAULT_TIMEOUT / 1000, ms: DEFAULT_TIMEOUT },
  },
  () => {
    expect(DEFAULT_TIMEOUT).toBe(10_000);
  },
);

describe('retries', () => {
  beforeEach(() => {
    calls = ['setup'];
  });

  for (const status of [503, 404]) {
    unit(\`status-\${status}\`, { when: \`the server answers \${status}.\`, do: 'read the status first.', values: { status } }, () => {
      expect(calls).toEqual(['setup']);
      calls.push(String(status));
    });
  }

  unit('what-is-retried', { when: 'the user asks which failures are retried.' }, (u) => {
    expect(calls).toEqual(['setup']);
    u.value('network errors and server errors are retried; client errors are not.');
    u.example('text', 'network error  retried\\n404            not retried');
  });
});

unit('retry-delay', { when: 'no delay is set.', value: '300 ms.' }, () => {
  expect(300).toBe(500);
});

unit('soft-check', { when: 'x.', value: 'y.' }, () => {
  expect.soft(1).toBe(2);
});

unit.skip('one-client', { when: 'x.', do: 'y.' }, () => {});

unit('skipped-inside', { when: 'x.', do: 'y.' }, (_u, ctx) => {
  ctx.skip();
});

unit('bad-spec', { when: 'x.', do: 'y.', value: 'z.' } as never, () => {});
`;

describe('skillunit/vitest', () => {
  const run = vitest({ 'tests/a.test.ts': TEST, 'tests/b.test.ts': `import { expect } from $API;\nimport { unit } from $ENTRY;\nunit.only('only-one', { when: 'x.', do: 'y.' }, () => expect(1).toBe(1));\nunit('not-this', { when: 'x.', do: 'y.' }, () => {});\n` });

  it('runs every unit as a test, and fails the run when one fails', () => {
    expect(run.status, run.output).toBe(1);
    expect(run.output).toMatch(/× fact retry-delay: 300 ms\./);
    expect(run.output).toMatch(/expected 300 to be 500/);
  });

  it('leaves a passed unit with its file, from the project, and the line of its declaration', () => {
    expect(run.byId('default-timeout')).toEqual([
      {
        skillunit: 2,
        id: 'default-timeout',
        file: 'tests/a.test.ts',
        line: lineOf(TEST, "'default-timeout',") - 1,
        test: 'fact default-timeout: 10 seconds (`timeout: 10000`), for every method.',
        status: 'passed',
        kind: 'fact',
        when: 'the user asks how long a request waits by default.',
        value: '10 seconds (`timeout: 10000`), for every method.',
        values: { seconds: 10, ms: 10000 },
        examples: [],
      },
    ]);
    expect(run.names.find((n) => n.startsWith('default-timeout.'))).toMatch(/^default-timeout\.[0-9a-f]{8}\.json$/);
  });

  it('a unit in a loop, under `describe` with `beforeEach`', () => {
    const line = lineOf(TEST, 'unit(`status-');
    expect(run.byId('status-503')).toEqual([expect.objectContaining({ status: 'passed', kind: 'rule', when: 'the server answers 503.', line })]);
    expect(run.byId('status-404')).toEqual([expect.objectContaining({ status: 'passed', line })]);
  });

  it('a body that sets the value and adds a block', () => {
    expect(run.byId('what-is-retried')).toEqual([
      expect.objectContaining({
        status: 'passed',
        value: 'network errors and server errors are retried; client errors are not.',
        examples: [{ lang: 'text', text: 'network error  retried\n404            not retried' }],
      }),
    ]);
  });

  it('a failed assertion, a soft one and a spec with two kinds leave a failure record', () => {
    expect(run.byId('retry-delay')).toEqual([expect.objectContaining({ status: 'failed', error: 'expected 300 to be 500 // Object.is equality', line: lineOf(TEST, "unit('retry-delay'") })]);
    expect(run.byId('soft-check')).toEqual([expect.objectContaining({ status: 'failed', error: 'expected 1 to be 2 // Object.is equality' })]);
    expect(run.byId('bad-spec')).toEqual([expect.objectContaining({ status: 'failed', error: expect.stringMatching(/`do` and `value` are two kinds/) })]);
  });

  it('a test skipped with `unit.skip`, with `ctx.skip()` or left out by `unit.only` writes nothing', () => {
    expect(run.byId('one-client')).toEqual([]);
    expect(run.byId('skipped-inside')).toEqual([]);
    expect(run.byId('not-this')).toEqual([]);
    expect(run.byId('only-one')).toEqual([expect.objectContaining({ status: 'passed', file: 'tests/b.test.ts', line: 3 })]);
  });

  it('a body that asserts nothing fails, unless it builds the sentence with `u.value()`; with only `u.example()` it is declared', () => {
    const r = vitest({
      'tests/a.test.ts': `import { beforeEach, describe, expect } from $API;
import { unit } from $ENTRY;

unit('empty-body', { when: 'x.', do: 'y.' }, () => {});
unit('soft-pass', { when: 'x.', do: 'y.' }, () => {
  expect.soft(1).toBe(1);
});
unit('context-expect', { when: 'x.', do: 'y.' }, (_u, { expect }) => {
  expect(1).toBe(1);
});
unit('sets-value', { when: 'x.' }, (u) => u.value('what the body saw.'));
unit('adds-example', { when: 'x.', value: 'y.' }, (u) => u.example('text', 'z'));
unit('declared', { when: 'x.', do: 'y.' });

describe('a hook', () => {
  beforeEach(() => {
    expect(1).toBe(1);
  });
  unit('hook-only', { when: 'x.', do: 'y.' }, () => {});
});
`,
    });
    expect(r.status, r.output).toBe(1);
    const state = Object.fromEntries(r.records.map((x) => [x.id, x.status === 'failed' ? x.error : x.status]));
    const none = 'the body made no assertion, so no test proves this unit. Assert in the body what the unit says, or declare it with no body: `unit(id, spec)` is a unit no test proves';
    expect(state).toEqual({
      'empty-body': `unit \`empty-body\`: ${none}`,
      'hook-only': `unit \`hook-only\`: ${none}`,
      'soft-pass': 'passed',
      'context-expect': 'passed',
      'sets-value': 'passed',
      'adds-example': 'passed',
      declared: 'passed',
    });
    expect(r.records.find((x) => x.id === 'adds-example')).toMatchObject({ body: false, examples: [{ lang: 'text', text: 'z' }] });
    expect(r.records.find((x) => x.id === 'sets-value')).not.toHaveProperty('body');
  });

  it('takes the line from Vitest when it gives it', () => {
    const located = vitest(
      // The call spans lines: the stack gives the line of \`unit(\`, Vitest the line of the test.
      { 'tests/a.test.ts': `import { unit } from $ENTRY;\n\nunit(\n  'one-client',\n  { when: 'x.', do: 'y.' },\n  (_u, { expect }) => expect(1).toBe(1),\n);\n` },
      ', includeTaskLocation: true',
    );
    expect(located.records).toEqual([expect.objectContaining({ id: 'one-client', file: 'tests/a.test.ts', line: 3 })]);
  });
  it('writes the questions in the records, with options built from the code, and asks nothing', () => {
    const test = `import { ask as question, unit } from $ENTRY;
const DEFAULT_TIMEOUT = 10_000;
const ask = (expect: string) => ({
  scenario: 'The user asks how long a request waits when the code sets nothing.',
  question: 'What should the agent answer?',
  options: { right: \`\${DEFAULT_TIMEOUT / 1000} seconds\`, longer: \`\${(3 * DEFAULT_TIMEOUT) / 1000} seconds\` },
  expect,
});
unit('default-timeout', { when: 'x.', value: 'y.', ask: ask('right') }, (_u, { expect }) => expect(1).toBe(1));
unit('retry-delay', { when: 'x.', value: 'y.', ask: ask('shorter') }, () => {});
unit('never-disable-timeout', { when: 'x.', do: 'y.', ask: { ...ask('right'), id: 'upload-timeout' } });
question('which-file', { file: 'features/index.md', scenario: 's.', question: 'Which file?', options: ['retries', 'errors'], expect: 'retries' });
`;
    // No key for any model: the run must not need one.
    const env = Object.keys(process.env).filter((k) => /_API_KEY$/.test(k));
    const saved = env.map((k) => [k, process.env[k]] as const);
    env.forEach((k) => delete process.env[k]);
    let r: ReturnType<typeof vitest>;
    try {
      r = vitest({ 'tests/a.test.ts': test });
    } finally {
      saved.forEach(([k, v]) => (process.env[k] = v));
    }
    expect(r.status).toBe(1);
    expect(r.byId('default-timeout')).toEqual([
      expect.objectContaining({
        status: 'passed',
        ask: [{ id: 'default-timeout', scenario: expect.any(String), question: 'What should the agent answer?', options: { right: '10 seconds', longer: '30 seconds' }, expect: 'right' }],
      }),
    ]);
    expect(r.byId('retry-delay')).toEqual([expect.objectContaining({ status: 'failed', error: expect.stringContaining('`expect` is "shorter", which is not an option') })]);
    expect(r.byId('never-disable-timeout')).toEqual([expect.objectContaining({ status: 'passed', body: false, line: 11, ask: [expect.objectContaining({ id: 'upload-timeout' })] })]);
    expect(r.byId('which-file')).toEqual([expect.objectContaining({ status: 'passed', kind: 'question', line: 12, skillFile: 'features/index.md', ask: [expect.objectContaining({ id: 'which-file' })] })]);
    expect(r.output).toContain('`expect` is "shorter", which is not an option (use one of: right, longer, none)');
  });
});

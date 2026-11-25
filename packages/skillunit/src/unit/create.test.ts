import { describe, expect, it } from 'vitest';
import type { UnitRecord, UnitSpec } from './contract.js';
import { callerPlace, createUnit, pathOf, type RunnerIt, type UnitBody } from './create.js';

interface Registered {
  name: string;
  fn: (ctx: { n: number }) => unknown;
  how: '' | 'skip' | 'only';
  rest: unknown[];
}

/** A runner of our own: `it` records each test, and `run` runs them as a runner would. */
function runner(options: { skip?: boolean; only?: boolean } = {}) {
  const tests: Registered[] = [];
  const records: { record: UnitRecord; key: string }[] = [];
  const add = (how: Registered['how']) => (name: string, fn: Registered['fn'], ...rest: unknown[]) => void tests.push({ name, fn, how, rest });
  const fake = add('') as RunnerIt<{ n: number }>;
  if (options.skip !== false) fake.skip = add('skip');
  if (options.only !== false) fake.only = add('only');
  const unit = createUnit(fake, { write: (record, key) => void records.push({ record, key }) });
  /** Runs every test that is not skipped; returns each one's error message, or `ok`. */
  const run = async () => {
    const out: string[] = [];
    for (const t of tests.filter((t) => t.how !== 'skip')) {
      try {
        await t.fn({ n: 1 });
        out.push('ok');
      } catch (e) {
        out.push((e as Error).message);
      }
    }
    return out;
  };
  return { unit, tests, records, run };
}

const noop: UnitBody<unknown> = () => {};

describe('each kind, from the keys of the spec', () => {
  it('a rule from `do`, a fact from `value`, a decision from `decide` and `paths`', async () => {
    const r = runner();
    r.unit('check-status', { when: 'a request failed.', do: 'test the error with `isHttpError` first.', evenWhen: 'the status is known.', check: 'forbid `/\\.status\\b/` in ts' }, noop);
    r.unit('default-timeout', { when: 'the user asks how long a request waits.', value: '10 seconds.', unknown: 'say there is no connect timeout.', values: { seconds: 10, exact: true, unit: 's' } }, noop);
    r.unit('cache-or-not', { when: 'a response repeats.', decide: 'pick one path.', paths: [{ path: 'cache', when: 'the response is the same.' }, { path: 'none', when: 'it changes.' }] }, noop);
    expect(r.tests.map((t) => t.name)).toEqual([
      'rule check-status: test the error with `isHttpError` first.',
      'fact default-timeout: 10 seconds.',
      'decision cache-or-not: pick one path.',
    ]);
    expect(await r.run()).toEqual(['ok', 'ok', 'ok']);
    const [rule, fact, decision] = r.records.map((x) => x.record);
    expect(rule).toEqual({
      skillunit: 1,
      id: 'check-status',
      file: expect.stringMatching(/create\.test\.ts$/),
      line: expect.any(Number),
      test: 'rule check-status: test the error with `isHttpError` first.',
      status: 'passed',
      kind: 'rule',
      when: 'a request failed.',
      do: 'test the error with `isHttpError` first.',
      evenWhen: 'the status is known.',
      check: 'forbid `/\\.status\\b/` in ts',
      examples: [],
    });
    expect(fact).toMatchObject({ kind: 'fact', value: '10 seconds.', unknown: 'say there is no connect timeout.', values: { seconds: 10, exact: true, unit: 's' } });
    expect(decision).toMatchObject({ kind: 'decision', decide: 'pick one path.', paths: [{ path: 'cache', when: 'the response is the same.' }, { path: 'none', when: 'it changes.' }] });
    expect(decision).not.toHaveProperty('value');
  });

  it('a decision with paths and no text after `Decide:`', async () => {
    const r = runner();
    r.unit('cache-or-not', { when: 'a response repeats.', paths: [{ path: 'cache', when: 'always.' }] }, noop);
    expect(r.tests[0]!.name).toBe('decision cache-or-not: a response repeats.');
    expect(await r.run()).toEqual(['ok']);
    expect(r.records[0]!.record).toMatchObject({ kind: 'decision', paths: [{ path: 'cache', when: 'always.' }] });
  });

  it('the line of the call to `unit`, in this file', async () => {
    const r = runner();
    const line = Number(new Error().stack!.split('\n')[1]!.match(/:(\d+):\d+\)?$/)![1]) + 1;
    r.unit('one-client', { when: 'calling one API many times.', do: 'reuse one client.' }, noop);
    await r.run();
    expect(r.records[0]!.record).toMatchObject({ file: pathOf(import.meta.url), line });
  });
});

describe('what the body gives', () => {
  it('sets the value of a fact, over the one of the spec', async () => {
    const r = runner();
    r.unit('what-is-retried', { when: 'the user asks which failures are retried.' }, (u) => u.value('network errors and 5xx.'));
    r.unit('retry-delay', { when: 'no delay is set.', value: 'from the spec.' }, (u) => u.value('from the body.'));
    expect(r.tests.map((t) => t.name)).toEqual(['fact what-is-retried: the user asks which failures are retried.', 'fact retry-delay: from the spec.']);
    expect(await r.run()).toEqual(['ok', 'ok']);
    expect(r.records.map((x) => (x.record as { value?: string }).value)).toEqual(['network errors and 5xx.', 'from the body.']);
  });

  it('adds blocks, in the order of the calls', async () => {
    const r = runner();
    r.unit('what-is-retried', { when: 'the user asks.', value: 'some are.' }, async (u) => {
      u.example('text', 'network error  retried\n503            retried');
      await Promise.resolve();
      u.example('json', '{ "retries": 2 }');
    });
    await r.run();
    expect(r.records[0]!.record).toMatchObject({ examples: [{ lang: 'text', text: 'network error  retried\n503            retried' }, { lang: 'json', text: '{ "retries": 2 }' }] });
  });

  it('passes the runner\'s own context to the body', async () => {
    const r = runner();
    let seen: unknown;
    r.unit('one-client', { when: 'x.', do: 'y.' }, (_u, ctx) => void (seen = ctx));
    await r.run();
    expect(seen).toEqual({ n: 1 });
  });

  it('a body that throws: a record with the message, and the error thrown again', async () => {
    const r = runner();
    r.unit('default-timeout', { when: 'x.', value: '10 seconds.' }, () => {
      throw new Error('expected 5000 to be 10000');
    });
    r.unit('retry-delay', { when: 'x.', value: 'y.' }, () => Promise.reject('a string'));
    expect(await r.run()).toEqual(['expected 5000 to be 10000', undefined]);
    expect(r.records.map((x) => x.record)).toEqual([
      { skillunit: 1, id: 'default-timeout', file: expect.any(String), line: expect.any(Number), test: 'fact default-timeout: 10 seconds.', status: 'failed', error: 'expected 5000 to be 10000' },
      expect.objectContaining({ id: 'retry-delay', status: 'failed', error: 'a string' }),
    ]);
  });

  it('a fact whose value nobody sets fails, and so does `u.value` in a rule', async () => {
    const r = runner();
    r.unit('what-is-retried', { when: 'x.' }, noop);
    r.unit('one-client', { when: 'x.', do: 'y.' }, (u) => u.value('z.'));
    r.unit('retry-delay', { when: 'x.' }, (u) => u.value('  '));
    r.unit('outcomes', { when: 'x.', value: 'y.' }, (u) => u.example('two words', 'z'));
    expect(await r.run()).toEqual([
      'unit `what-is-retried`: the fact has no Value; give `value` in its spec or call `u.value(text)` in its body',
      'unit `one-client`: `u.value` sets the Value of a fact, and this is a rule',
      'unit `retry-delay`: `u.value` takes text that is not empty',
      'unit `outcomes`: `u.example` takes a fence language first, such as `text` or `json`; got "two words"',
    ]);
    expect(r.records.map((x) => x.record.status)).toEqual(['failed', 'failed', 'failed', 'failed']);
  });
});

describe('a spec with a mistake', () => {
  const fails = async (id: string, spec: unknown) => {
    const r = runner();
    r.unit(id, spec as UnitSpec, noop);
    const [message] = await r.run();
    return { message, title: r.tests[0]!.name, records: r.records.map((x) => x.record) };
  };

  it('registers a test that fails with what to fix, and leaves a record of it', async () => {
    const both = await fails('default-timeout', { when: 'x.', do: 'y.', value: 'z.' });
    expect(both.title).toBe('unit default-timeout');
    expect(both.message).toBe('unit `default-timeout`: `do` and `value` are two kinds; a unit is one: `do` makes a rule, `value` a fact, `decide` and `paths` a decision');
    expect(both.records).toEqual([expect.objectContaining({ id: 'default-timeout', status: 'failed', error: both.message })]);
  });

  it('an id that is not kebab-case fails, and leaves no record, since no slot can name it', async () => {
    for (const id of ['defaultTimeout', 'default timeout', 'default.timeout', '']) {
      const r = await fails(id, { when: 'x.', do: 'y.' });
      expect(r.message).toMatch(/the id must be kebab-case/);
      expect(r.records).toEqual([]);
    }
  });

  it('says what is wrong with each key', async () => {
    const message = async (spec: unknown) => (await fails('a-unit', spec)).message;
    expect(await message(null)).toBe('unit `a-unit`: the spec must be an object, such as `{ when: …, do: … }`');
    expect(await message({ do: 'y.' })).toBe('unit `a-unit`: `when` is missing: every unit says when it applies');
    expect(await message({ when: 'x.', Do: 'y.' })).toBe('unit `a-unit`: unknown key `Do` (allowed: when, do, value, decide, paths, unknown, evenWhen, check, values)');
    expect(await message({ when: '', do: 'y.' })).toBe('unit `a-unit`: `when` must be text that is not empty');
    expect(await message({ when: 'x.', do: 'one.\n\ntwo.' })).toBe('unit `a-unit`: `do` has a blank line; a label is one paragraph');
    expect(await message({ when: 'x.', do: 'y.', paths: [] })).toMatch(/`do` and `decide` are two kinds/);
    expect(await message({ when: 'x.', decide: 'y.' })).toBe("unit `a-unit`: a decision needs `paths`, such as `[{ path: 'cache', when: '…' }]`");
    expect(await message({ when: 'x.', paths: [{ path: 'Two words', when: 'y.' }] })).toBe('unit `a-unit`: each path has a `path` in kebab-case, such as `cache`; got "Two words"');
    expect(await message({ when: 'x.', paths: [{ path: 'cache' }] })).toBe('unit `a-unit`: the path `cache` needs `when`, the condition it is taken on');
    expect(await message({ when: 'x.', paths: [{ path: 'cache', when: 'y.', code: 'z' }] })).toBe('unit `a-unit`: the path `cache` has an unknown key `code` (allowed: path, when)');
    expect(await message({ when: 'x.', paths: [{ path: 'cache', when: 'y.' }, { path: 'cache', when: 'z.' }] })).toBe('unit `a-unit`: the path `cache` appears twice');
    expect(await message({ when: 'x.', do: 'y.', unknown: 'z.' })).toBe('unit `a-unit`: `unknown` is for a fact, and this is a rule');
    expect(await message({ when: 'x.', value: 'y.', evenWhen: 'z.' })).toBe('unit `a-unit`: `evenWhen` is for a rule or a decision, and this is a fact');
    expect(await message({ when: 'x.', value: 'y.', values: [1] })).toBe('unit `a-unit`: `values` must be an object of names and values, such as `{ seconds: 10 }`');
    expect(await message({ when: 'x.', value: 'y.', values: { 'a.b': 1 } })).toBe('unit `a-unit`: the value name `a.b` must be letters, digits and hyphens, such as `max-retries`');
    expect(await message({ when: 'x.', value: 'y.', values: { n: Infinity } })).toBe('unit `a-unit`: the value `n` must be text, a finite number or a boolean; got null');
    expect(await message({ when: 'x.', value: 'y.', values: { n: { a: 1 } } })).toBe('unit `a-unit`: the value `n` must be text, a finite number or a boolean; got {"a":1}');
  });
});

describe('skip, only, and the runner', () => {
  it('pass through to the runner\'s own `skip` and `only`; a skipped test writes nothing', async () => {
    const r = runner();
    r.unit.skip('one-client', { when: 'x.', do: 'y.' }, noop);
    r.unit.only('retry-delay', { when: 'x.', value: 'y.' }, noop);
    expect(r.tests.map((t) => `${t.how} ${t.name}`)).toEqual(['skip rule one-client: y.', 'only fact retry-delay: y.']);
    await r.run();
    expect(r.records.map((x) => x.record.id)).toEqual(['retry-delay']);
  });

  it('a runner without `skip` says so when it is used', () => {
    const r = runner({ skip: false });
    expect(() => r.unit.skip('one-client', { when: 'x.', do: 'y.' }, noop)).toThrow("unit.skip: the runner's `it` has no `skip`");
  });

  it('passes what follows the body to the runner, such as a timeout', () => {
    const r = runner();
    r.unit('one-client', { when: 'x.', do: 'y.' }, noop, 5000);
    expect(r.tests[0]!.rest).toEqual([5000]);
  });

  it('gives each declaration a key of its own, a loop that repeats an id included', async () => {
    const r = runner();
    for (const code of [503, 503, 404]) r.unit(`status-${code}`, { when: 'x.', value: `${code}.` }, noop);
    r.unit('status-503', { when: 'x.', value: 'y.' }, noop);
    await r.run();
    const keys = r.records.map((x) => x.key);
    expect(new Set(keys).size).toBe(4);
    expect(r.records.map((x) => x.record.id)).toEqual(['status-503', 'status-503', 'status-404', 'status-503']);
  });
});

describe('the place in a stack', () => {
  it('skips the frames of the helper and of Node, and reads V8 and other engines', () => {
    const own = pathOf(new URL('./create.ts', import.meta.url).href);
    const v8 = ['Error', `    at unit (${own}:80:21)`, '    at /p/src/a.test.ts:12:3', '    at node:internal/modules:1:1'].join('\n');
    expect(callerPlace(v8)).toEqual({ file: '/p/src/a.test.ts', line: 12 });
    expect(callerPlace(['Error', '    at Object.<anonymous> (file:///p/my%20tests/a.test.ts:7:5)'].join('\n'))).toEqual({ file: '/p/my tests/a.test.ts', line: 7 });
    expect(callerPlace(['unit@http://localhost/x.js:1:1', 'suite@file:///p/b.test.js:30:9'].join('\n'))).toEqual({ file: 'http://localhost/x.js', line: 1 });
    expect(callerPlace(['    at node:internal/x:1:1', '    at <anonymous>'].join('\n'))).toBeUndefined();
    expect(callerPlace(undefined)).toBeUndefined();
  });

  it('reads a Windows file URL as a Windows path', () => {
    expect(pathOf('file:///C:/p/a.test.ts')).toBe('C:/p/a.test.ts');
    expect(pathOf('/p/a.test.ts')).toBe('/p/a.test.ts');
  });
});

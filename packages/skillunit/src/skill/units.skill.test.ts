// The file `units.md` of SkillUnit's own skill: its `setup()`, then its units in the order the file shows them.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ask, key, setup, unit, type SetupSpec, type UnitContext } from 'skillunit/vitest';
import { afterEach, describe, expect } from 'vitest';
import { fenceLang } from '../build/render.js';
import { exportNames, type ExportNames } from '../typescript.js';
import { checkNumbers, checkQuestions, checkSpec, numbersIn, SETUP_KEYS, SKILL_INDEX, SPEC_KEYS, UNIT_CONTRACT, type UnitKind, type UnitRecord, type UnitSpec } from '../unit/contract.js';
import { createUnit } from '../unit/create.js';
import { vitestOptions } from '../unit/vitest-options.js';
import { and, cleanUp, code, entry, or, PACKAGE, project, runner, scratch } from './helpers.js';
import { DEFAULT_RETRY_DELAY, retryWaits } from './retry.js';

afterEach(cleanUp);

setup('units', {
  file: 'units.md',
  title: 'SkillUnit — files and units in tests',
  when: 'Declare a file or a unit of the skill in a test',
  description: 'How a test declares the files of the skill and the units in them, and what the build makes of them.',
});

const spec = key<UnitSpec>;
const setupKey = key<SetupSpec>;
const ctx = key<UnitContext>;
const INDEX = { file: SKILL_INDEX, title: 'Demo', description: 'A skill to try SkillUnit on.', frontmatter: { name: 'demo', description: 'Use it to try SkillUnit.' } };
const VITEST = entry('./vitest');
const UNIT = entry('./unit');
const TYPESCRIPT = entry('./typescript');
const vitestNames = exportNames(new URL('../vitest.ts', import.meta.url)).values;
const unitNames = exportNames(new URL('../unit/index.ts', import.meta.url)).values;

describe('units.md', () => {
  unit('setup-a-file', { when: `a test declares a file of the skill with \`${setup.name}()\`.` }, async (u) => {
    const r = runner();
    {
      const { setup, unit } = r;
      // #region skill:units
      setup('retries', { file: 'features/retries.md', title: 'Retries', when: 'Retry a request that failed', description: 'Which requests the client sends again.' });
      unit('retry-delay', { when: 'a request is sent again.', values: { delay: DEFAULT_RETRY_DELAY } }, (u) => {
        expect(retryWaits(1)).toEqual([DEFAULT_RETRY_DELAY]);
        u.value(`the client waits ${DEFAULT_RETRY_DELAY} ms before the first new attempt.`);
      });
      // #endregion
    }
    expect(await r.run()).toEqual(['ok', 'ok']);
    expect(r.records.map((x) => [x.kind, x.status])).toEqual([['file', 'passed'], ['fact', 'passed']]);
    const refused = async (id: string, s: object) => {
      const t = runner();
      t.setup(id, s as SetupSpec);
      return (await t.run())[0];
    };
    const { frontmatter, ...noFrontmatter } = INDEX;
    expect(await refused('a', noFrontmatter)).toContain('needs `frontmatter: { name, description }`');
    expect(await refused('b', { ...INDEX, when: 'Read it' })).toContain('has no row in it and no `when`');
    expect(await refused('c', { file: 'retries.md', title: 'Retries', description: 'How requests are retried.' })).toContain('`when` must be text');
    expect(await refused('d', { file: 'retries.md', title: 'Retries in 2 steps', when: 'Retry a request', description: 'How requests are retried.' })).toContain('the number 2 in `title`');
    const p = await project((r) => {
      r.setup('demo', INDEX);
      r.setup('retries', { file: 'retries.md', title: 'Retries', when: 'Retry a request that failed', description: 'How requests are retried.' });
    });
    p.proof({ write: true });
    expect(p.read('skill/SKILL.md')).toContain('| Retry a request that failed | [retries.md](retries.md) |');
    void frontmatter;
    u.value(
      `\`${setup.name}(id, spec)\` declares a file of the skill; its spec takes ${and(code(SETUP_KEYS))}. \`${SKILL_INDEX}\` needs \`${setupKey('frontmatter')}\`, the name and description of the skill, and takes no \`${setupKey('when')}\`. Any other file needs \`${setupKey('when')}\`: the task its row in the table of \`${SKILL_INDEX}\` names. The text of a \`${setup.name}()\` has no number.`,
    );
  });

  unit(
    'units-belong',
    {
      when: `a test file declares units and questions after a \`${setup.name}()\`.`,
      value: `each unit and question belongs to the file of the last \`${setup.name}()\` before it in its test file, in the order they are declared. A unit with no \`${setup.name}()\` before it fails the build.`,
    },
    async () => {
      const p = await project((r) => {
        r.setup('demo', INDEX);
        r.unit('first-rule', { when: 'one.', do: 'a.' });
        r.unit('second-rule', { when: 'two.', do: 'b.' });
        r.setup('retries', { file: 'retries.md', title: 'Retries', when: 'Retry a request', description: 'How requests are retried.' });
        r.unit('third-rule', { when: 'three.', do: 'c.' });
      });
      p.proof({ write: true });
      const headings = (file: string) => p.read(file).split('\n').filter((l) => l.startsWith('### '));
      expect(headings('skill/SKILL.md')).toEqual(['### rule: first-rule', '### rule: second-rule']);
      expect(headings('skill/retries.md')).toEqual(['### rule: third-rule']);
      const lost = await project((r) => {
        r.unit('lost-rule', { when: 'one.', do: 'a.' });
        r.setup('demo', INDEX);
      });
      expect(lost.proof({ write: true }).problems.map((x) => x.message)).toEqual([expect.stringContaining('the unit `lost-rule` belongs to no file of the skill')]);
    },
  );

  unit(
    'which-entry',
    {
      when: 'a project declares the units of its skill in its tests.',
      decide: 'where `unit()` comes from.',
      paths: [
        { path: 'vitest', when: `the tests run on Vitest: import ${and(code(vitestNames))} from \`${VITEST}\`.` },
        { path: 'other-runner', when: `another JavaScript runner: \`${createUnit.name}(it)\` from \`${UNIT}\` gives \`${unit.name}\`, \`${ask.name}\` and \`${setup.name}\` for that runner's \`it\`.` },
        { path: 'other-language', when: `another language: each test writes its record itself, one JSON file per unit in \`proof.units\`, in version ${UNIT_CONTRACT} of the contract, whose types \`${UNIT}\` exports.` },
      ],
      values: { contract: UNIT_CONTRACT },
    },
    async () => {
      expect(Object.keys(PACKAGE.exports)).toEqual(expect.arrayContaining(['./vitest', './unit']));
      expect(vitestNames).toEqual(expect.arrayContaining([unit.name, setup.name, ask.name]));
      expect(unitNames).toEqual(expect.arrayContaining([createUnit.name, 'UNIT_CONTRACT']));
      const tests: ((ctx: unknown) => unknown)[] = [];
      const records: UnitRecord[] = [];
      const made = createUnit((_name: string, fn: (ctx: unknown) => unknown) => void tests.push(fn), { write: (r) => void records.push(r) });
      expect(Object.keys(made).sort()).toEqual(['ask', 'setup', 'unit']);
      made.unit('own-runner', { when: 'x.', do: 'y.' });
      for (const t of tests) await t({});
      expect(records[0]).toMatchObject({ skillunit: UNIT_CONTRACT, id: 'own-runner', status: 'passed' });
      // A record written by hand, as a test in another language writes it, builds.
      const p = await project((r) => r.setup('demo', INDEX));
      p.write('tmp/skill-units/by-hand.json', JSON.stringify({ skillunit: UNIT_CONTRACT, status: 'passed', id: 'by-hand', kind: 'rule', file: 'skill.test.ts', line: 1, test: 'rule by-hand', setup: 'demo', order: 0, when: 'x.', do: 'y.', examples: [] }));
      p.proof({ write: true });
      expect(p.read('skill/SKILL.md')).toContain('### rule: by-hand');
    },
  );

  unit('unit-kinds', { when: `a test declares a unit with \`${unit.name}(id, spec, body)\`.` }, (u) => {
    const kinds: [string, UnitSpec, UnitKind][] = [
      [`\`${spec('do')}\``, { when: 'x.', do: 'y.' }, 'rule'],
      [`\`${spec('value')}\``, { when: 'x.', value: 'y.' }, 'fact'],
      [`\`${spec('decide')}\` with \`${spec('paths')}\``, { when: 'x.', decide: 'y.', paths: [{ path: 'a', when: 'z.' }] }, 'decision'],
    ];
    for (const [, s, kind] of kinds) expect(checkSpec('a', s)).toBe(kind);
    expect(() => checkSpec('a', { when: 'x.', do: 'y.', value: 'z.' })).toThrow('are two kinds');
    u.value(`the keys of its spec make the kind of a unit: ${and(kinds.map(([keys, , kind]) => `${keys} a ${kind}`))}. A spec with two of them is refused.`);
  });

  unit('unit-spec', { when: 'a test writes the spec of a unit.' }, (u) => {
    const sample: Record<(typeof SPEC_KEYS)[number], unknown> = {
      when: 'x.',
      do: 'y.',
      value: 'y.',
      decide: 'y.',
      paths: [{ path: 'a', when: 'z.' }],
      unknown: 'u.',
      evenWhen: 'e.',
      values: { n: 1 },
      ask: { scenario: 's.', question: 'q?', expect: 'yes' },
      examples: [{ lang: 'sh', text: 'ls' }],
    };
    const bases: [UnitKind, object][] = [
      ['rule', { when: sample.when, do: sample.do }],
      ['fact', { when: sample.when, value: sample.value }],
      ['decision', { when: sample.when, decide: sample.decide, paths: sample.paths }],
    ];
    const defining = new Set(['when', 'do', 'value', 'decide', 'paths']);
    const only: string[] = [];
    for (const k of SPEC_KEYS.filter((k) => !defining.has(k))) {
      const takes = bases.filter(([, base]) => {
        try {
          checkSpec('a', { ...base, [k]: sample[k] });
          return true;
        } catch {
          return false;
        }
      });
      if (takes.length < bases.length) only.push(`\`${k}\` goes only with ${or(takes.map(([kind]) => `a ${kind}`))}`);
    }
    expect(only.length).toBeGreaterThan(0);
    expect(() => checkSpec('a', { do: 'y.' })).toThrow('`when` is missing');
    expect(() => checkSpec('a', { when: 'x.', do: 'y.', note: 'z' })).toThrow('unknown key `note`');
    u.value(`a spec takes ${and(code(SPEC_KEYS))}, and no other key; every unit has \`${spec('when')}\`. ${and(only)}.`);
  });

  unit(
    'ids',
    {
      when: 'a test gives the id of a file, a unit or a question.',
      value: `an id is kebab-case, such as \`retry-delay\`. Files and units share one space of ids, and each is declared once across the tests; so is each question id. A unit's first question takes the unit's id unless it gives \`id\`, and the next ones \`<id>.2\`, \`<id>.3\`.`,
    },
    async () => {
      const first = async (declare: (r: ReturnType<typeof runner>) => void) => {
        const r = runner();
        declare(r);
        return (await r.run()).find((m) => m !== 'ok');
      };
      expect(await first((r) => r.unit('Retry_Delay', { when: 'x.', do: 'y.' }))).toContain('the id must be kebab-case');
      expect(await first((r) => (r.setup('retries', INDEX), r.unit('retries', { when: 'x.', do: 'y.' })))).toContain('files of the skill and units share one space of ids');
      const ask = { scenario: 's.', question: 'q?', expect: 'yes' };
      expect(await first((r) => (r.unit('a', { when: 'x.', do: 'y.', ask: { ...ask, id: 'same' } }), r.unit('b', { when: 'x.', do: 'y.', ask: { ...ask, id: 'same' } })))).toContain('has the id of a question');
      expect(checkQuestions('retry-delay', [ask, ask, ask]).map((q) => q.id)).toEqual(['retry-delay', 'retry-delay.2', 'retry-delay.3']);
      const p = await project((r) => {
        r.setup('demo', INDEX);
        r.unit('twice', { when: 'x.', do: 'y.' });
        r.unit('twice', { when: 'x.', do: 'z.' });
      });
      expect(p.proof({ write: true }).problems.map((x) => x.message)).toEqual([expect.stringContaining('the unit `twice` is also declared at')]);
    },
  );

  unit(
    'body-asserts',
    {
      when: `the body of a unit makes no assertion.`,
      value: `with \`${VITEST}\`, a body that makes no assertion and calls neither \`u.${ctx('value')}\` nor \`u.${ctx('example')}\` fails its test, so its unit is not built. A unit that no test proves is declared with no body.`,
    },
    async (_u, outer) => {
      const tests: ((ctx: never) => unknown)[] = [];
      const made = createUnit((_name: string, fn: (ctx: never) => unknown) => void tests.push(fn), { ...vitestOptions, write: () => {} } as never);
      made.unit('asserts-nothing', { when: 'x.', do: 'y.' }, () => {});
      made.unit('asserts', { when: 'x.', do: 'y.' }, () => expect(1).toBe(1));
      made.unit('builds-its-value', { when: 'x.' }, (u) => u.value('y.'));
      const results: string[] = [];
      for (const t of tests) {
        try {
          await t(outer as never);
          results.push('ok');
        } catch (e) {
          results.push((e as Error).message);
        }
      }
      expect(results[0]).toContain('the body made no assertion');
      expect(results.slice(1)).toEqual(['ok', 'ok']);
    },
  );

  unit(
    'no-body',
    {
      when: 'a unit is something no test can state, such as advice.',
      value: `\`${unit.name}(id, spec)\` with no body declares a unit no test proves. The build writes it as it writes any unit, and the proof counts it as declared, not proved. A fact with no body gives \`${spec('value')}\` in its spec.`,
    },
    async () => {
      const p = await project((r) => {
        r.setup('demo', INDEX);
        r.unit('advice', { when: 'x.', do: 'y.' });
      });
      const result = p.proof({ write: true });
      expect(result.summary).toMatchObject({ units: 1, proved: 0, declared: 1 });
      expect(result.units[0]).toMatchObject({ id: 'advice', from: 'declared' });
      expect(p.read('skill/SKILL.md')).toContain('### rule: advice\n\nWhen: x.\n\nDo: y.');
      const r = runner();
      r.unit('no-value', { when: 'x.' });
      expect((await r.run())[0]).toContain('a unit with no body gives `value` in its spec');
    },
  );

  unit(
    'u-value',
    {
      when: 'the body of a fact observes the value it states.',
      value: `\`u.${ctx('value')}(text)\` in a body sets the value of a fact from what the body observed, in place of \`${spec('value')}\` in the spec. A rule or a decision refuses it.`,
    },
    async () => {
      const r = runner();
      r.unit('observed', { when: 'x.', value: 'typed.' }, (u) => u.value('observed.'));
      r.unit('a-rule', { when: 'x.', do: 'y.' }, (u) => u.value('observed.'));
      expect((await r.run())[1]).toContain('sets the Value of a fact, and this is a rule');
      expect(r.records[0]).toMatchObject({ id: 'observed', value: 'observed.' });
    },
  );

  unit('u-example', { when: 'the body of a unit produces a block worth showing: an output, a config, a table.' }, async (u) => {
    const p = await project(
      (r) => {
        r.setup('demo', INDEX);
        r.unit('a-rule', { when: 'x.', do: 'y.' }, (u) => u.example('text', 'from the body'));
        r.unit('a-fact', { when: 'x.', value: 'v.' }, (u) => u.example('text', 'from the body'));
      },
      { test: '// #region skill:a-rule\nregion();\n// #endregion\n' },
    );
    expect(p.proof({ write: true }).ok).toBe(true);
    const r = runner();
    r.unit('a-decision', { when: 'x.', decide: 'y.', paths: [{ path: 'a', when: 'z.' }] }, (u) => u.example('text', 'from the body'));
    expect((await r.run())[0]).toContain('a decision shows its examples in its paths');
    const text = p.read('skill/SKILL.md');
    const rule = text.slice(text.indexOf('### rule: a-rule'), text.indexOf('### fact: a-fact'));
    const label = rule.split('\n').find((l) => l.endsWith(':') && !l.startsWith('#'))!;
    expect(rule.indexOf('region();')).toBeLessThan(rule.indexOf('from the body'));
    expect(rule.indexOf(label)).toBeLessThan(rule.indexOf('region();'));
    const fact = text.slice(text.indexOf('### fact: a-fact'));
    expect(fact).toMatch(/Value: v\.\n\n```text\nfrom the body\n```/);
    u.value(`\`u.${ctx('example')}(lang, text)\` adds a fenced block the body produced, after the unit's regions: under \`${label}\` in a rule, and under the value of a fact. A decision refuses it.`);
  });

  unit(
    'regions',
    {
      when: 'a unit or a file of the skill shows code.',
      value: `the lines between \`// #region skill:<id>\` and \`// #endregion\` in a test file are an example: of the unit \`<id>\`; of the path \`<path>\` of a decision, as \`skill:<id>.<path>\`; or, with the id of a \`${setup.name}()\`, the code under the description of its file. The fence takes the language of the test file, such as \`${fenceLang('test_units.py')}\` for a \`.py\` file, and each region id is in one place only.`,
    },
    async () => {
      const test = ['// #region skill:demo', "import { get } from 'demo';", '// #endregion', '// #region skill:a-rule', 'await get();', '// #endregion', '// #region skill:pick.cache', 'cache();', '// #endregion', ''].join('\n');
      const p = await project(
        (r) => {
          r.setup('demo', INDEX);
          r.unit('a-rule', { when: 'x.', do: 'y.' });
          r.unit('pick', { when: 'x.', decide: 'which.', paths: [{ path: 'cache', when: 'z.' }] });
        },
        { test },
      );
      expect(p.proof({ write: true }).ok).toBe(true);
      const text = p.read('skill/SKILL.md');
      expect(text).toContain("A skill to try SkillUnit on.\n\n```ts\nimport { get } from 'demo';\n```");
      expect(text).toContain('Right:\n\n```ts\nawait get();\n```');
      expect(text).toContain('- **cache** — z.\n\n  ```ts\n  cache();\n  ```');
      p.write('skill.test.ts', `${test}// #region skill:a-rule\nagain();\n// #endregion\n`);
      expect(p.proof().problems.map((x) => x.message)).toEqual([expect.stringContaining('the region `skill:a-rule` is also at line 4')]);
    },
  );

  unit(
    'number-rule',
    {
      when: 'the text of a unit with a body has a number.',
      value: `a number in the text of a unit with a body must be one of its \`${spec('values')}\`, named in the spec, or its test fails; a unit with no body is not checked. A number is digits that do not follow a letter, a digit, \`_\` or \`.\`: \`utf8\` and \`h2\` have none, and \`2x\` has one.`,
      values: { example: '2x' },
    },
    async () => {
      expect([numbersIn('utf8'), numbersIn('h2'), numbersIn('2x'), numbersIn('v1.5')]).toEqual([[], [], ['2'], []]);
      expect(() => checkNumbers('a', { when: 'x.', value: `waits ${DEFAULT_RETRY_DELAY} ms.` })).toThrow(`the number ${DEFAULT_RETRY_DELAY} in \`Value\` is none of the unit's \`values\``);
      expect(() => checkNumbers('a', { when: 'x.', value: `waits ${DEFAULT_RETRY_DELAY} ms.`, values: { delay: DEFAULT_RETRY_DELAY } })).not.toThrow();
      const r = runner();
      r.unit('typed', { when: 'x.', value: `waits ${DEFAULT_RETRY_DELAY} ms.` }, () => {});
      r.unit('advice', { when: `wait ${DEFAULT_RETRY_DELAY} ms.`, do: 'y.' });
      const [typed, advice] = await r.run();
      expect(typed).toContain(`the number ${DEFAULT_RETRY_DELAY}`);
      expect(advice).toBe('ok');
    },
  );

  unit(
    'failed-body',
    {
      when: 'the body of a unit throws, or fails an assertion.',
      value: 'its test fails and leaves no unit. The proof reports the test with its error, and leaves the file the unit belongs to as it is: it neither compares nor writes it.',
    },
    async () => {
      const p = await project((r) => {
        r.setup('demo', INDEX);
        r.unit('broken', { when: 'x.', do: 'y.' }, () => {
          throw new Error('the code changed');
        });
      });
      const result = p.proof({ write: true });
      expect(result.problems.map((x) => x.message)).toEqual([expect.stringMatching(/the test of `broken` .* failed, so it left no unit: the code changed/)]);
      expect(result.files).toEqual([{ file: 'SKILL.md', state: 'broken' }]);
      expect(() => p.read('skill/SKILL.md')).toThrow();
    },
  );

  unit('export-names', { when: 'a sentence names what a TypeScript file exports.' }, (u) => {
    const dir = scratch('exports');
    const files: Record<string, string> = {
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', paths: { retry: ['./src/retry.ts'] } } }),
      'src/errors.ts': 'export class HttpError extends Error {}\nexport class TimeoutError extends Error {}\n',
      'src/client.ts': 'export function create() {}\nexport interface Client { get(): void }\n',
      'src/retry.ts': 'export const DEFAULT_RETRY = 0;\n',
      'src/index.ts': "export * from './client.js';\nexport { HttpError } from './errors.js';\nexport type { TimeoutError } from './errors.js';\nexport * from 'retry';\n",
    };
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true });
      writeFileSync(join(dir, name), text);
    }
    const names = exportNames(pathToFileURL(join(dir, 'src', 'index.ts')));
    expect(names).toEqual({ values: ['DEFAULT_RETRY', 'HttpError', 'create'], types: ['Client', 'TimeoutError'] });
    expect(exportNames(join(dir, 'src', 'index.ts'))).toEqual(names);
    const field = key<ExportNames>;
    u.value(
      `\`${exportNames.name}(entry)\` from \`${TYPESCRIPT}\` gives the names a TypeScript file exports, as the compiler sees them, \`${field('values')}\` and \`${field('types')}\` apart: a class exported with \`export type\` is a type, and \`export *\` brings the names of its module. It takes a path or a \`file:\` URL, and resolves modules with the \`tsconfig.json\` above the file, its \`paths\` included.`,
    );
  });

  unit('key', { when: 'a sentence names a key of a type of the code: an option, a method, a field.' }, (u) => {
    type Options = { retry?: number; timeout?: number };
    expect(key<Options>('retry')).toBe('retry');
    // @ts-expect-error `delay` is not a key of `Options`.
    expect(key<Options>('delay')).toBe('delay');
    expect(vitestNames).toContain(key.name);
    expect(unitNames).toContain(key.name);
    u.value(`\`${key.name}<T>(name)\` from \`${VITEST}\` or \`${UNIT}\` returns \`name\` and accepts only a key of \`T\`, so a key renamed in the code fails the type-check of each test that still names it.`);
  });
});

// The file `units.md` of SkillUnit's own skill: its `setup()`, then its units in the order the file shows them.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { and, ask, code, key, or, setup, type SetupSpec, type UnitContext, unit } from 'skillunit/vitest';
import { afterEach, describe, expect } from 'vitest';
import { fenceLang } from '../build/render.js';
import { exportNames, loadTypeScript, type ExportNames } from '../typescript.js';
import { checkNumbers, checkQuestions, checkSpec, numbersIn, SETUP_KEYS, SKILL_INDEX, SPEC_KEYS, UNIT_CONTRACT, type UnitKind, type UnitRecord, type UnitSpec } from '../unit/contract.js';
import { createUnit } from '../unit/create.js';
import type * as UnitEntry from '../unit/index.js';
import { suggestedRun } from '../init.js';
import { vitestOptions } from '../unit/vitest-options.js';
import { cleanUp, cli, command, entry, memoryWriter, option, PACKAGE, project, report, runner, scratch, TEST_FILE } from './helpers.js';
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
const require = createRequire(import.meta.url);
/** TypeScript 7, which the repository installs as `typescript-7`: its package exports no compiler API. */
const seven = require('typescript-7') as { version: string };
const SEVEN = Number(seven.version.split('.')[0]);

/**
 * `unit()` as `skillunit/vitest` makes it, assertions counted, with a writer of its own so the
 * units it declares stay out of this skill. `run(ctx)` runs them in the test that calls it.
 */
function counted() {
  const tests: ((ctx: never) => unknown)[] = [];
  const { records, write } = memoryWriter();
  const made = createUnit((_name: string, fn: (ctx: never) => unknown) => void tests.push(fn), { ...vitestOptions, write } as never);
  const run = async (ctx: unknown) => {
    const out: string[] = [];
    for (const t of tests.splice(0)) {
      try {
        await t(ctx as never);
        out.push('ok');
      } catch (e) {
        out.push((e as Error).message);
      }
    }
    return out;
  };
  return { unit: made.unit, setup: made.setup, records, run };
}

describe('units.md', () => {
  // A gap: how a project chose its units is not in SkillUnit's code, so no test of it can state
  // this. `setup-a-file` and the facts after it are what a test can state about a unit.
  unit('start-from-the-code', {
    when: 'a skill is written, or its units are chosen.',
    do: 'read the source of the code first, and list what an agent that writes code with it needs to know and can get wrong; then write a unit for each row of the list, or say why the row is left out.',
    evenWhen: 'the project has a skill or a README already: units copied from them say what the old text said, not what the code does.',
    ask: {
      id: 'units-from-the-code',
      scenario: [
        'The user asks the agent to add SkillUnit to a library that has a hand-written skill already, and to be quick about it.',
        'A library has a README with a section per feature. The user asks for its skill to be built with SkillUnit, starting today.',
      ],
      question: 'Where does the agent take the units from?',
      options: {
        code: 'The source of the library: a list of what an agent needs to know and can get wrong, then a unit for each row',
        old: 'The text that is there already: one unit for each section of the skill or the README',
      },
      expect: 'code',
    },
  });

  unit('setup-a-file', { when: `a test declares a file of the skill with \`${setup.name}()\`.` }, async (u) => {
    const r = runner();
    {
      const { setup, unit } = r;
      // #region skill:units
      setup('retries', { file: 'features/retries.md', title: 'Retries', when: 'Retry a request that failed', description: 'Which requests the client sends again.' });
      unit('retry-delay', { when: 'a request is sent again.', value: `the client waits ${DEFAULT_RETRY_DELAY} ms before the first new attempt.`, values: { delay: DEFAULT_RETRY_DELAY } }, () => {
        expect(retryWaits(1)).toEqual([DEFAULT_RETRY_DELAY]);
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
      const { records, write } = memoryWriter();
      const made = createUnit((_name: string, fn: (ctx: unknown) => unknown) => void tests.push(fn), { write });
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

  // A gap: the build checks the text of a `setup()` for numbers only, so only the type-check of a
  // name built from the code catches a rename in it.
  unit('setup-text-from-code', {
    when: `a test writes the text of a \`${setup.name}()\`: the description of its file, the \`${setupKey('when')}\` of its row in the index, the description of the frontmatter.`,
    do: `build each name of the code in it from the code, with \`${key.name}()\` or a \`name\`, as in the sentence of a unit, and declare what it uses before the \`${setup.name}()\`, which runs when the file loads.`,
    evenWhen: 'the text is a short row of the index: one that said "…headers and query" kept `query` after the option and its unit were gone, and every check passed.',
  });

  unit(
    'import-by-name',
    {
      when: 'a test inside a package imports the package by its name, as the examples of the skill do.',
      value: 'Node resolves the name of a package from inside it through the `exports` of its `package.json`, with no link in `node_modules`, and Vitest and TypeScript with `NodeNext` do the same. With `exports` pointing at the source, the tests run the code as it is, with no build and no alias.',
    },
    async () => {
      const dir = scratch('by-name');
      const files: Record<string, string> = {
        'package.json': JSON.stringify({ name: 'demo-lib', type: 'module', exports: './src/index.ts' }),
        'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', allowImportingTsExtensions: true, noEmit: true, strict: true, types: [] }, include: ['src'] }),
        'src/index.ts': "export const answer = 'ok';\n",
        'src/a.test.ts': "import { answer } from 'demo-lib';\nimport { expect, test } from 'vitest';\ntest('by name', () => expect(answer).toBe('ok'));\n",
      };
      for (const [name, text] of Object.entries(files)) {
        mkdirSync(join(dir, name, '..'), { recursive: true });
        writeFileSync(join(dir, name), text);
      }
      const vitest = join(require.resolve('vitest/package.json'), '..');
      mkdirSync(join(dir, 'node_modules'));
      symlinkSync(vitest, join(dir, 'node_modules', 'vitest'), 'dir');
      const tsc = require.resolve('typescript/bin/tsc');
      const run = (args: string[]) => spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
      const tests = () => run([join(vitest, 'vitest.mjs'), 'run']);
      const types = () => run([tsc, '--noEmit', '--pretty', 'false']);
      expect([tests().status, types().status]).toEqual([0, 0]);
      // Without `exports`, neither finds the package by its name. Vitest's cache of modules would
      // keep the one it resolved before.
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo-lib', type: 'module' }));
      for (const cache of ['.vite', '.vitest-cache']) rmSync(join(dir, 'node_modules', cache), { recursive: true, force: true });
      const failed = [tests(), types()];
      expect(failed.map((r) => r.status === 0)).toEqual([false, false]);
      expect(failed[0]!.stdout + failed[0]!.stderr).toContain("Cannot find package 'demo-lib'");
      expect(failed[1]!.stdout).toContain("Cannot find module 'demo-lib'");
    },
  );

  unit('unit-kinds', { when: `a test declares a unit with \`${unit.name}(id, spec, body)\`.` }, (u) => {
    const kinds: [string, UnitSpec, UnitKind][] = [
      [`\`${spec('do')}\``, { when: 'x.', do: 'y.' }, 'rule'],
      [`\`${spec('value')}\``, { when: 'x.', value: 'y.' }, 'fact'],
      [`\`${spec('decide')}\` with \`${spec('paths')}\``, { when: 'x.', decide: 'y.', paths: [{ path: 'a', when: 'z.' }] }, 'decision'],
    ];
    const made = kinds.map(([keys, s]) => `${keys} a ${checkSpec('a', s)}`);
    expect(made).toHaveLength(kinds.length);
    expect(() => checkSpec('a', { when: 'x.', do: 'y.', value: 'z.' })).toThrow('are two kinds');
    u.value(`the keys of its spec make the kind of a unit: ${and(made)}. A spec with two of them is refused.`);
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
      value: `an id is kebab-case, such as \`retry-delay\`. Files and units share one space of ids, and each is declared once across the tests; so is each question id. A unit's first question takes the unit's id unless it gives \`id\`, and the next ones \`<id>.2\` and \`<id>.3\`.`,
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
      value: `with \`${VITEST}\`, a body proves its unit when it makes an assertion or calls \`u.${ctx('value')}\`. A body that only calls \`u.${ctx('example')}\` builds its unit, counted as declared: no test proves it. A body that does none of the three fails its test, so its unit is not built.`,
    },
    async (_u, outer) => {
      const made = counted();
      made.unit('asserts-nothing', { when: 'x.', do: 'y.' }, () => {});
      made.unit('only-an-example', { when: 'x.', do: 'y.' }, (u) => u.example('bash', 'a command typed here'));
      made.unit('asserts', { when: 'x.', do: 'y.' }, () => expect(1).toBe(1));
      made.unit('builds-its-value', { when: 'x.' }, (u) => u.value('y.'));
      made.unit('asserts-and-shows', { when: 'x.', do: 'y.' }, (u) => (expect(1).toBe(1), u.example('bash', 'ls')));
      const results = await made.run(outer);
      expect(results[0]).toContain('the body made no assertion');
      expect(results.slice(1)).toEqual(['ok', 'ok', 'ok', 'ok']);
      const declared = (id: string) => (made.records.find((r) => r.id === id) as { body?: false }).body === false;
      expect(['only-an-example', 'asserts', 'builds-its-value', 'asserts-and-shows'].map(declared)).toEqual([true, false, false, false]);
    },
  );

  unit(
    'no-body',
    {
      when: 'a unit is something no test can state, such as advice.',
      value: `\`${unit.name}(id, spec)\` with no body declares a unit no test proves. The build writes it as it writes any unit, and the proof counts it as declared, not proved. A fact with no body gives \`${spec('value')}\` in its spec. A unit with no body shows no block, since only a body calls \`u.${ctx('example')}\`; a body that only shows blocks is how advice shows one.`,
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
      expect(() => checkSpec('a', { when: 'x.', do: 'y.', examples: [{ lang: 'bash', text: 'ls' }] })).toThrow('unknown key `examples`');
      const advice = counted();
      advice.unit('advice-with-a-block', { when: 'x.', do: 'y.' }, (u) => u.example('bash', 'ls'));
      expect(await advice.run({ expect, task: {} })).toEqual(['ok']);
      expect(advice.records[0]).toMatchObject({ body: false, examples: [{ lang: 'bash', text: 'ls' }] });
    },
  );

  unit(
    'u-value',
    {
      when: 'the body of a fact goes through a list of cases and says which did what.',
      value: `\`u.${ctx('value')}(text)\` in a body sets the value of a fact from what the body found, in place of \`${spec('value')}\` in the spec. A rule or a decision refuses it.`,
    },
    async () => {
      const r = runner();
      r.unit('observed', { when: 'x.', value: 'typed.' }, (u) => u.value('observed.'));
      r.unit('a-rule', { when: 'x.', do: 'y.' }, (u) => u.value('observed.'));
      expect((await r.run())[1]).toContain('sets the Value of a fact, and this is a rule');
      expect(r.records[0]).toMatchObject({ id: 'observed', value: 'observed.' });
    },
  );

  unit(
    'sentence-and-assertion',
    {
      when: 'a test writes the sentence of a fact about what the code does.',
      do: `put the sentence in \`${spec('value')}\`, its numbers from constants and its names from the types, and assert in the body what it says. Build it with \`u.${ctx('value')}()\` only when the body goes through a list of cases and the sentence says which did what; its words then come from that list or from a constant, never from an outcome the code does not have.`,
      evenWhen: 'a sentence built from the outcome would be shorter to write: a test that goes red when the behaviour changes is what tells a regression from a change that is meant.',
    },
    async () => {
      // The code is `winner`; a change to it turns the request's own timeout into the client's.
      const typed = (winner: string) => (r: ReturnType<typeof runner>) => {
        r.setup('demo', INDEX);
        r.unit('timeout-precedence', { when: 'a request sets a timeout.', value: "a request's own timeout wins over its client's." }, () => expect(winner).toBe('its own'));
      };
      const p = await project(typed('its own'));
      p.proof({ write: true });
      const before = p.read('skill/SKILL.md');
      // The tests run again after the change: the test is red, and the skill is left as it was.
      const next = await project(typed("its client's"));
      rmSync(join(p.root, 'tmp/skill-units'), { recursive: true, force: true });
      cpSync(join(next.root, 'tmp/skill-units'), join(p.root, 'tmp/skill-units'), { recursive: true });
      const result = p.proof({ write: true });
      expect(result.units[0]).toMatchObject({ id: 'timeout-precedence', state: 'failed' });
      expect(p.read('skill/SKILL.md')).toBe(before);
    },
  );

  unit('u-example', { when: 'the body of a unit produces a block worth showing: a command, a config, an output.' }, async (u, outer) => {
    const made = counted();
    {
      const { unit } = made;
      const pkg = PACKAGE;
      // #region skill:u-example
      unit('install-the-server', { when: 'the server is not installed.', do: 'run it with `npx`, so nothing is installed for good.' }, (u) => {
        const config = { servers: { example: { command: 'npx', args: ['-y', pkg.name] } } };
        expect(pkg.bin).toBeDefined(); // `npx` can run the package
        u.example('bash', `npx -y ${pkg.name}`);
        u.example('json', JSON.stringify(config, null, 2));
      });
      // #endregion
    }
    made.setup('demo', INDEX);
    made.unit('show-the-command', { when: 'x.', do: 'y.' }, (u) => u.example('bash', `npx -y ${PACKAGE.name}`));
    expect(await made.run(outer)).toEqual(['ok', 'ok', 'ok']);
    expect(made.records[0]).toMatchObject({ examples: [{ lang: 'bash', text: `npx -y ${PACKAGE.name}` }, { lang: 'json' }] });
    // The setup comes first in the file, so both units belong to it.
    const shown = await project(() => {});
    [made.records[1]!, { ...made.records[0]!, setup: 'demo', order: 0 }, made.records[2]!].forEach((r, i) => shown.write(`tmp/skill-units/${i}.json`, JSON.stringify({ ...r, file: 'skill.test.ts' })));
    const built = shown.proof({ write: true });
    const units = report(await cli(shown.root, [command('proof'), '--json'])).units!;
    expect(units.map((x) => x.id).sort()).toEqual(['install-the-server', 'show-the-command']);
    const printed = async (reporter: string) => (await cli(shown.root, [command('proof'), option('proof', '--reporter'), reporter])).stdout;
    expect(built.summary).toMatchObject({ proved: 1, declared: 1 });
    expect(units.find((x) => x.id === 'show-the-command')?.from).toBe('declared');
    expect(await printed('table')).toMatch(/declared, no test/);
    expect(await printed('junit')).toMatch(/name="from" value="declared"/);
    expect(await printed('github')).toContain('1 declared without one');
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
    /** The section of a unit, from its heading to the next one. */
    const section = (heading: string) => {
      const from = text.indexOf(heading);
      const next = text.indexOf('\n### ', from + 1);
      return text.slice(from, next < 0 ? undefined : next);
    };
    const rule = section('### rule: a-rule');
    const label = rule.split('\n').find((l) => l.endsWith(':') && !l.startsWith('#'))!;
    expect(rule.indexOf(label), 'the blocks are under the label').toBeLessThan(Math.min(rule.indexOf('region();'), rule.indexOf('from the body')));
    expect(rule.indexOf('region();'), 'the regions come first').toBeLessThan(rule.indexOf('from the body'));
    const fact = section('### fact: a-fact');
    expect(fact).toMatch(/Value: v\.\n\n```text\nfrom the body\n```/);
    u.value(
      `\`u.${ctx('example')}(lang, text)\` adds a fenced block the body produced, after the unit's regions: under \`${label}\` in a rule, and under the value of a fact. A decision refuses it. \`u.${ctx('example')}\` is no assertion: with one, as above, the unit is proved; with none, the unit is built and counted as declared, in the proof's summary and in every report.`,
    );
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
      // The words the sentence shows as examples, so the sentence states them whatever the rule counts in them.
      values: { example: '2x', letters: 'utf8', short: 'h2' },
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
      expect(existsSync(join(p.skill, 'SKILL.md'))).toBe(false);
    },
  );

  unit('export-names', { when: 'a sentence names what a TypeScript file exports.', values: { 'typescript-major': SEVEN } }, (u) => {
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
    expect(names.values, 'a value it exports by name').toContain('HttpError');
    expect(names.values, 'a module the `paths` of the tsconfig name').toContain('DEFAULT_RETRY');
    expect([names.types, names.values]).toEqual([expect.arrayContaining(['TimeoutError']), expect.not.arrayContaining(['TimeoutError'])]);
    expect([names.values, names.types]).toEqual([expect.arrayContaining(['create']), expect.arrayContaining(['Client'])]);
    expect(exportNames(join(dir, 'src', 'index.ts'))).toEqual(names);
    // A project on TypeScript 7: its `typescript` is passed over for SkillUnit's own.
    const own = fileURLToPath(new URL('../typescript.ts', import.meta.url));
    const used = loadTypeScript([join(dir, 'src', 'index.ts'), own], (place) => (place === own ? require('typescript') : seven) as never);
    expect(seven).not.toHaveProperty('createProgram');
    expect(used.version).toBe((require('typescript') as { version: string }).version);
    const field = key<ExportNames>;
    u.value(
      `\`${exportNames.name}(entry)\` from \`${TYPESCRIPT}\` gives the names a TypeScript file exports, as the compiler sees them, \`${field('values')}\` and \`${field('types')}\` apart: a class exported with \`export type\` is a type, and \`export *\` brings the names of its module. It takes a path or a \`file:\` URL, and resolves modules with the \`tsconfig.json\` above the file, its \`paths\` included. It uses the project's \`typescript\` when that package has the compiler API, and SkillUnit's own when it does not, as with TypeScript ${SEVEN}, which exports only its version from \`typescript\`: nothing to install.`,
    );
  });

  unit('key', { when: 'a sentence names a key of a type of the code: an option, a method, a field.' }, (u) => {
    type Options = { retry?: number; timeout?: number };
    expect(key<Options>('retry')).toBe('retry');
    // @ts-expect-error `delay` is not a key of `Options`.
    expect(key<Options>('delay')).toBe('delay');
    expect(vitestNames).toContain(key.name);
    expect(unitNames).toContain(key.name);
    // The type of a module: its keys are the names it exports.
    const exported = key<typeof UnitEntry>;
    expect(exported('createUnit')).toBe('createUnit');
    // @ts-expect-error `makeUnit` is not an export of the module.
    expect(exported('makeUnit')).toBe('makeUnit');
    u.value(
      `\`${key.name}<T>(name)\` from \`${VITEST}\` or \`${UNIT}\` returns \`name\` and accepts only a key of \`T\`, so a key renamed in the code fails the type-check of each test that still names it. With the type of a module, \`${key.name}<typeof Module>(name)\` after \`import type * as Module from '<library>'\`, it accepts only a name the module exports, so a renamed export fails the same way.`,
    );
  });

  unit('text-helpers', { when: 'a sentence lists names or values the body read.' }, (u) => {
    expect(and(['a', 'b', 'c'])).toBe('a, b and c');
    expect(or(['a', 'b'])).toBe('a or b');
    expect([and(['a']), and([])]).toEqual(['a', '']);
    expect(code(['retry', 'timeout'])).toEqual(['`retry`', '`timeout`']);
    for (const name of [and.name, or.name, code.name]) {
      expect(vitestNames).toContain(name);
      expect(unitNames).toContain(name);
    }
    u.value(
      `\`${and.name}(items)\` and \`${or.name}(items)\`, from \`${VITEST}\` or \`${UNIT}\` next to \`${key.name}\`, join a list as a sentence does: \`${and.name}(['a', 'b', 'c'])\` is "${and(['a', 'b', 'c'])}", and \`${or.name}\` joins the last two with "or". \`${code.name}(items)\` puts each item in backticks, so \`${and.name}(${code.name}(['retry', 'timeout']))\` is ${and(code(['retry', 'timeout']))}.`,
    );
  });

  // A gap: only a reader can compare a sentence with what its body checks.
  unit('say-no-more', {
    when: 'a test writes the sentence of a unit with a body.',
    do: 'write no more than the body checks: "every", "any", "always" and "never" need a body that goes through every case, or the sentence names the cases the body tried.',
    evenWhen: 'the sentence is what the docs of the code say: a body that tries one form proves that form only.',
    ask: {
      id: 'every-case-or-name-them',
      scenario: 'A body checks that a base URL that ends in `/` and a path that does not start with one are joined. The user wants the unit to say what the docs say: "`baseUrl` is the prefix of every path".',
      question: 'What does the agent do?',
      options: {
        cases: 'Try every form of the slashes in the body, or have the sentence name the one form it tried',
        docs: 'Keep the sentence of the docs: the body passes, and the docs are the reference for the code',
      },
      expect: 'cases',
    },
  });

  // A gap: what belongs in a region is judgement; `regions` says how a region is copied.
  unit('example-is-library-code', {
    when: 'a test marks a region for the skill.',
    do: 'put in it only the code an agent would write with the library: no assertion, no helper of the test, no fake server.',
    evenWhen: 'the whole test would show that the example works: set up before the `#region` line, and assert after `#endregion`.',
    ask: {
      id: 'region-around-the-call',
      scenario: 'A test starts a fake server, calls `client.get(url)`, and asserts on what it returns. The user wants the skill to show the whole test, so readers see that the example works.',
      question: 'What does the agent put between `#region` and `#endregion`?',
      options: {
        call: 'The call to the library only; the fake server and the assertion stay outside the region',
        whole: 'The whole test: the fake server, the call and the assertion',
      },
      expect: 'call',
    },
  });

  // A gap: the type-check is the project's to set up; `key` says what fails in it.
  unit('type-check-the-tests', {
    when: `the tests of the skill use \`${key.name}()\` or an object typed against a type of the code.`,
    do: `start \`proof.run\` with a type-check that includes the test files, as \`${suggestedRun(true)}\`: a key renamed in the code fails there, and only there.`,
    evenWhen: 'the tests pass: a test run that strips the types, as Vitest does, does not check them.',
    ask: {
      id: 'type-check-test-files',
      scenario: `The project's type-check leaves out the \`*.test.ts\` files, to be fast, \`proof.run\` is \`${suggestedRun(false)}\`, and the tests of the skill use \`${key.name}()\`. The user asks to leave it all as it is.`,
      question: 'What does the agent do with the type-check?',
      options: {
        add: 'Start `proof.run` with a type-check that includes the test files of the skill',
        leave: 'Leave it as it is: the tests run, and a test fails when a key it names is wrong',
      },
      expect: 'add',
    },
  });

  // A gap: the change to make runs on the user's code, not on SkillUnit's.
  unit('prove-with-a-change', {
    when: 'a unit and its body are written, and the body passes.',
    do: `make the smallest change to the code that makes the sentence false, run the tests and \`${command('check')} ${option('check', '--dry-run')}\`, and undo the change: something must go red. A unit where nothing goes red is not done.`,
    evenWhen: 'the body looks right: two bodies of this skill passed and proved nothing, until a change to the code showed it.',
    ask: {
      id: 'break-the-code',
      scenario: 'The agent wrote a unit, and its body passes. The user asks to move on to the next unit.',
      question: 'What does the agent do first?',
      options: {
        change: 'Change the code so the sentence is false, check that something goes red, and undo the change',
        next: 'Move on: the body passes, so the code does what the sentence says',
        reread: 'Read the body again next to the sentence, and move on when they match',
      },
      expect: 'change',
    },
  });
});

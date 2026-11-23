/**
 * Which diagnostics are parse errors is decided by what `tsc` did, not by their code: a parse
 * error outside TS1000–TS1999 must not hide the type errors of other blocks, and a TS1xxx code
 * that `tsc` reports while type-checking must not drop the type errors of its block.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { lint } from './lint.js';
import { F, lineOf } from './testing.js';
import { ConfigError, type LintResult } from './types.js';

const require = createRequire(import.meta.url);
const COMPILERS = [
  ['typescript 5', dirname(require.resolve('typescript/package.json'))],
  ['typescript 7', dirname(require.resolve('typescript-7/package.json'))],
] as const;

const TSCONFIG = {
  compilerOptions: {
    strict: true,
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    jsx: 'preserve',
    types: [],
    paths: { lib: ['./src/lib.ts'] },
  },
  include: ['src'],
};

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function project(typescript: string, skill: string, tsconfig: object = TSCONFIG): string {
  const root = mkdtempSync(join(tmpdir(), 'skillunit-passes-'));
  roots.push(root);
  mkdirSync(join(root, 'node_modules'));
  symlinkSync(typescript, join(root, 'node_modules', 'typescript'), 'dir');
  mkdirSync(join(root, 'src'));
  writeFileSync(
    join(root, 'src', 'lib.ts'),
    'export const named = 1;\nexport class Client { send(to: string): number { return to.length; } }\nexport function pick(a: { id: number }): number;\nexport function pick(a: { name: string }): string;\nexport function pick(a: { id?: number; name?: string }): number | string { return a.id ?? a.name ?? 0; }\n',
  );
  // Lets `<div />` type-check with no React installed.
  writeFileSync(join(root, 'src', 'jsx.d.ts'), 'declare global { namespace JSX { interface IntrinsicElements { [name: string]: unknown } } }\nexport {};\n');
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(tsconfig));
  mkdirSync(join(root, 'skill'));
  writeFileSync(join(root, 'skill', 'SKILL.md'), skill);
  return root;
}

const run = (root: string) => lint(join(root, 'skill'), { examples: { ts: { tsconfig: join(root, 'tsconfig.json') }, commands: {}, cwd: root } });

/** `line TSnnnn label`, sorted by line. */
const show = (r: LintResult) =>
  r.problems
    .map((p) => `${p.line} ${p.message.match(/TS\d+/)?.[0] ?? '-'} ${/does not parse/.test(p.message) ? 'parse' : /does not type-check/.test(p.message) ? 'types' : p.message}`)
    .sort((a, b) => parseInt(a) - parseInt(b));

const TYPE_ERROR = 'const n: number = "x";';

const adjacent = `# Skill\n\n${F}ts\n${TYPE_ERROR}\n${F}\n\n${F}tsx\nconst a = <div /><div />;\n${F}\n`;
const unclosed = `# Skill\n\n${F}ts\n${TYPE_ERROR}\n${F}\n\n${F}tsx\nconst a = <div>;\n${F}\n`;
const topReturn = `# Skill\n\n${F}ts\n${TYPE_ERROR}\nreturn n;\n${F}\n`;
const noDefault = `# Skill\n\n${F}ts\nimport lib from "lib";\nconst m: number = lib;\n${TYPE_ERROR}\n${F}\n`;

describe.each(COMPILERS)('parse or type errors, with %s', (_, typescript) => {
  it('a JSX parse error (TS2657) does not hide the type error of another block', () => {
    const r = run(project(typescript, adjacent));
    expect(show(r)).toEqual([`${lineOf(adjacent, TYPE_ERROR)} TS2322 types`, `${lineOf(adjacent, '<div /><div />')} TS2657 parse`]);
    expect(r.summary.typeChecked).toBe(1);
    expect(r.summary.notParsed).toBe(1);
  });

  it('nor does an unclosed JSX element (TS17008)', () => {
    const r = run(project(typescript, unclosed));
    const seen = show(r);
    expect(seen[0]).toBe(`${lineOf(unclosed, TYPE_ERROR)} TS2322 types`);
    expect(seen.slice(1).every((l) => l.startsWith(`${lineOf(unclosed, '<div>;')} `) && l.endsWith(' parse'))).toBe(true);
    expect(seen.some((l) => l.includes('TS17008'))).toBe(true);
    expect(r.summary).toMatchObject({ typeChecked: 1, notParsed: 1 });
  });

  it('a top-level return (TS1108) keeps the type errors of its block', () => {
    const r = run(project(typescript, topReturn));
    expect(show(r)).toEqual([`${lineOf(topReturn, TYPE_ERROR)} TS2322 types`, `${lineOf(topReturn, 'return n;')} TS1108 types`]);
    expect(r.summary).toMatchObject({ typeChecked: 1, notParsed: 0 });
  });

  it('a default import from a module without one (TS1192) is a type error, and the block is still checked', () => {
    const r = run(project(typescript, noDefault));
    expect(show(r)).toEqual([`${lineOf(noDefault, 'import lib')} TS1192 types`, `${lineOf(noDefault, TYPE_ERROR)} TS2322 types`]);
    expect(r.summary).toMatchObject({ typeChecked: 1, notParsed: 0 });
  });

  it('lists the names that nothing declares, the most frequent first', () => {
    const skill = `# Skill\n\n${F}ts\nalpha.send();\nalpha.list();\nbeta.get();\n${F}\n\n${F}ts\nalpha.x();\nbeta.y();\nconsol.log(1);\ngamma();\n${F}\n`;
    const r = run(project(typescript, skill));
    expect(r.summary.undeclared).toEqual([
      { name: 'alpha', count: 3 },
      { name: 'beta', count: 2 },
      { name: 'consol', count: 1 },
      { name: 'gamma', count: 1 },
    ]);
    // "Cannot find name 'consol'. Did you mean 'console'?" has a code of its own.
    expect(r.problems.find((p) => p.message.includes("'consol'"))?.code).toBe('TS2552');
    expect(r.problems).toHaveLength(7);
  });

  it('lists no names when every name is declared', () => {
    const r = run(project(typescript, topReturn));
    expect(r.problems.length).toBeGreaterThan(0);
    expect(r.summary.undeclared).toEqual([]);
  });

  it('keeps the whole message, and the code in a field of its own', () => {
    const skill = `# Skill\n\n${F}ts\nimport { pick } from "lib";\npick({ title: "x" });\n${F}\n`;
    const r = run(project(typescript, skill));
    expect(r.problems).toHaveLength(1);
    const p = r.problems[0]!;
    expect(p.code).toBe('TS2769');
    expect(p.message).toMatch(/^does not type-check: TS2769 No overload matches this call\. .*title/);
  });

  it('a tsconfig that turns the type-check off is a settings error, not a clean run', () => {
    const root = project(typescript, `# Skill\n\n${F}ts\n${TYPE_ERROR}\n${F}\n`, { ...TSCONFIG, compilerOptions: { ...TSCONFIG.compilerOptions, noCheck: true } });
    expect(() => run(root)).toThrow(ConfigError);
    expect(() => run(root)).toThrow(/did not check types/);
  });

  it('says a ts block that does not parse and looks like JSX should be tsx', () => {
    const skill = `# Skill\n\n${F}ts\nconst a = <div className="x">hi</div>;\n${F}\n\n${F}ts\nconst list: Array<string> = [1];\n${F}\n`;
    const r = run(project(typescript, skill));
    const parse = r.problems.filter((p) => /does not parse/.test(p.message));
    expect(parse.length).toBeGreaterThan(0);
    expect(parse[0]!.message).toMatch(/this block looks like JSX, which parses only in a `tsx` fence\)$/);
    expect(parse.slice(1).every((p) => !p.message.includes('looks like JSX'))).toBe(true);
    // The generic in the other block is not JSX; that block reaches the type-check.
    expect(r.problems.find((p) => p.code === 'TS2322')?.message).not.toContain('JSX');
  });

  it('finds a relative entry of `types` from the folder of the tsconfig', () => {
    const tsconfig = { ...TSCONFIG, compilerOptions: { ...TSCONFIG.compilerOptions, types: ['./types/globals'] } };
    const root = project(typescript, `# Skill\n\n${F}ts\nconst s: number = GLOBAL_NAME;\n${F}\n`, tsconfig);
    mkdirSync(join(root, 'types', 'globals'), { recursive: true });
    writeFileSync(join(root, 'types', 'globals', 'index.d.ts'), 'declare const GLOBAL_NAME: string;\n');
    // GLOBAL_NAME is found, so the one error is the string assigned to a number.
    expect(show(run(root))).toEqual(['4 TS2322 types']);
  });

  it('runs a block with `declare module` or `declare global` on its own, so it changes no other block', () => {
    const skill = [
      '# Skill',
      `${F}ts\ndeclare global { interface Array<T> { first(): T } }\nexport {};\nconst a: number = [1].first();\n${F}`,
      `${F}ts\ndeclare module "lib" { export const extra: number; }\nimport { extra } from "lib";\nconst e: number = extra;\n${F}`,
      // Compiles alone only without the two declarations above.
      `${F}ts\nconst first = [1].first;\nimport { extra } from "lib";\n${F}`,
    ].join('\n\n') + '\n';
    const r = run(project(typescript, skill));
    const first = lineOf(skill, 'const first');
    expect(r.problems.map((p) => `${p.line} ${p.code}`)).toEqual([`${first} TS2339`, `${lineOf(skill, 'import { extra }', first)} TS2305`]);
    expect(r.summary).toMatchObject({ typeChecked: 3, notParsed: 0 });
  });
});

/** A file whose `Setup` declares `Client` and `client`, then the examples. */
const withSetup = (setup: string, ...examples: string[]) =>
  [`# Skill`, `Setup:`, `${F}ts\n${setup}\n${F}`, ...examples.map((e) => `${F}ts\n${e}\n${F}`)].join('\n\n') + '\n';
const SETUP = 'import { Client, named } from "lib";\ndeclare const client: Client;';
const complete = 'import { Client } from "lib";\nconst client = new Client();\nclient.send("a");';
const fragment = 'client.send("b");\nconst n: number = named;';
const codes = (r: LintResult) => r.problems.map((p) => `${p.line} ${p.code ?? p.rule}`);

describe.each(COMPILERS)('an example that declares a name of the Setup, with %s', (_, typescript) => {
  it('takes the name from the example: no duplicate, and a fragment next to it still gets the Setup', () => {
    const r = run(project(typescript, withSetup(SETUP, complete, fragment)));
    expect(codes(r)).toEqual([]);
    expect(r.summary.typeChecked).toBe(3);
  });

  it('keeps the other specifier of an import the example declares one of', () => {
    const skill = withSetup(SETUP, `${complete}\nconst m: string = named;`);
    // `named` still comes from the Setup: a number, so the one error is its type.
    expect(codes(run(project(typescript, skill)))).toEqual([`${lineOf(skill, 'const m: string')} TS2322`]);
  });

  it('leaves the Setup whole when the example declares the name inside a function', () => {
    const skill = withSetup(SETUP, 'function local() {\n  const client = 1;\n  return client;\n}\nclient.send(local());');
    expect(codes(run(project(typescript, skill)))).toEqual([`${lineOf(skill, 'client.send(local())')} TS2345`]);
  });

  it('still reports an example that declares a name twice itself', () => {
    const skill = withSetup(SETUP, 'const twice = 1;\nconst twice = 2;');
    expect(codes(run(project(typescript, skill)))).toEqual([`${lineOf(skill, 'const twice = 1')} TS2451`, `${lineOf(skill, 'const twice = 2')} TS2451`]);
  });

  it('keeps every line where it was: errors after a declaration it leaves out are on their own lines', () => {
    const setup = 'import { Client } from "lib";\ndeclare const client:\n  Client;\nconst broken: string = 1;';
    const skill = withSetup(setup, `${complete}\nconst s: string = client.send("c");`);
    expect(codes(run(project(typescript, skill)))).toEqual([`${lineOf(skill, 'const broken')} TS2322`, `${lineOf(skill, 'const s: string')} TS2322`]);
  });

  it('reports an error inside the Setup once, at the Setup, whichever examples show it', () => {
    const skill = withSetup(`${SETUP}\nconst broken: string = 1;`, complete, fragment, 'client.send("d");');
    const r = run(project(typescript, skill));
    expect(codes(r)).toEqual([`${lineOf(skill, 'const broken')} TS2322`]);
    expect(r.problems[0]!.message).toMatch(/^the Setup does not type-check/);
  });

  it('type-checks a fence flagged proof=, in a Right or a Decide path, like any other example', () => {
    const unit = [
      '# Rules',
      '## Rules',
      '### decision: pick',
      'When: a choice.',
      `Decide:\n\n- **one** — first.\n\n  ${F}ts proof=pick.one\n  ${TYPE_ERROR}\n  ${F}`,
      'Applies: lib',
      '### rule: r',
      'When: a.',
      'Do: b.',
      `Right:\n\n${F}ts proof=r\n${TYPE_ERROR}\n${F}`,
      'Applies: lib',
    ].join('\n\n') + '\n';
    const r = run(project(typescript, unit));
    expect(r.summary.typeChecked).toBe(2);
    expect(r.problems.map((p) => `${p.line} ${p.unit} ${p.code}`)).toEqual([`${lineOf(unit, '  const n')} pick TS2322`, `${lineOf(unit, 'const n', lineOf(unit, 'proof=r'))} r TS2322`]);
  });

  it('gives Wrong code the same treatment', () => {
    const unit = [
      '# Rules',
      'Setup:',
      `${F}ts\n${SETUP}\n${F}`,
      '## Rules',
      '### rule: one-client',
      'When: code sends a message.',
      'Do: use `client`.',
      `Wrong:\n\n- Doing: creating a client of its own.\n\n  ${F}ts\n  import { Client } from "lib";\n  const client = new Client();\n  client.send("x");\n  ${F}\n\n  Because: it opens a second connection.`,
      'Applies: lib',
    ].join('\n\n') + '\n';
    const r = run(project(typescript, unit));
    // It compiles once `client` is its own, so the types do not catch the mistake, and lint says so.
    expect(r.problems.map((p) => `${p.rule} ${p.severity}`)).toEqual(['wrong-code warning']);
  });
});

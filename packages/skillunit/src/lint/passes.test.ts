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
    'export const named = 1;\nexport function pick(a: { id: number }): number;\nexport function pick(a: { name: string }): string;\nexport function pick(a: { id?: number; name?: string }): number | string { return a.id ?? a.name ?? 0; }\n',
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
});

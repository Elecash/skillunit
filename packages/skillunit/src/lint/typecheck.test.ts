import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { lint } from './lint.js';
import { F, lineOf } from './testing.js';
import { ConfigError, type LintResult } from './types.js';

const require = createRequire(import.meta.url);
/** Two installed compilers: the workspace's 5.x and 7.x under an npm alias. */
const COMPILERS = [
  ['typescript 5', dirname(require.resolve('typescript/package.json'))],
  ['typescript 7', dirname(require.resolve('typescript-7/package.json'))],
] as const;

const LIBRARY = `export interface Options { retry?: number; timeout?: number }
export const tf = {
  get(url: string, options?: Options): Promise<string> { return Promise.resolve(url + (options?.retry ?? 0)); },
  post(url: string, body: unknown, options?: Options): Promise<string> { return Promise.resolve(url + String(body) + (options?.timeout ?? 0)); },
};
`;

const TSCONFIG = {
  compilerOptions: {
    strict: true,
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'NodeNext',
    rootDir: 'src',
    outDir: 'dist',
    noUnusedLocals: true,
    types: [],
    paths: { tinyfetch: ['./src/index.ts'] },
  },
  include: ['src'],
};

const SKILL = `# tinyfetch

Setup:

${F}ts
import { tf } from 'tinyfetch';
${F}

${F}ts
tf.get('/a', { retry: 1 });
${F}

${F}ts
tf.get('/a', { retries: 1 });
${F}

${F}ts
missing('/a');
${F}

${F}ts no-check
get(url: string): Promise<string>
${F}

${F}js
const n = 1;
n.toFixed(2).foo();
${F}

More in [the broken file](features/broken.md) and [the fragment](features/syntax.md).

## Rules

### rule: retry-idempotent-only

When: a request may be retried.

Do: enable \`retry\` only for GET.

Right:

${F}ts
tf.post('/users', { name: 'Ada' });
${F}

Wrong:

- Doing: \`tf.post('/users', {}, { retry: 3 })\`

  Because: a retried POST can create the same resource twice.

- Doing: \`tf.post('/users', {}, { retires: 3 })\`

  Because: a typo.

Applies: retries

Check: forbid \`/post\\([^)]*retry/\` in ts

### rule: set-a-timeout

When: a request may hang.

Do: set \`timeout\`.

Right:

${F}ts
tf.get('/a', { timeout: 5000 });
${F}

Wrong:

- Doing: \`tf.get('/a', { timeout: 0 })\`

  Because: zero waits forever.

- Doing: \`fetchAll('/a')\`

  Because: it does not exist.

Applies: timeouts

### decision: pick-a-call

When: making a call.

Decide:

- **direct** — one call.

  ${F}ts
  tf.get('/b');
  ${F}

- **typo** — a call with a typo.

  ${F}ts
  tf.gett('/b');
  ${F}

Applies: calls
`;

const BROKEN = `# Broken Setup

Setup:

${F}ts
import { tf } from 'tinyfetch';
import { nope } from 'not-installed';
${F}

${F}ts
tf.get('/x');
${F}

${F}ts
tf.get('/y');
${F}
`;

/** One `Wrong` fragment that does not parse, and an example with a type error, in one run. */
const SYNTAX = `# Fragments

Setup:

${F}ts
import { tf } from 'tinyfetch';
${F}

${F}ts
tf.get('/a', { bogus: 1 });
${F}

## Rules

### rule: no-fragments

When: a request is made.

Do: call \`tf.get\`.

Right:

${F}ts
tf.get('/a');
${F}

Wrong:

- Doing: \`tf.get('/a', { retry: 3,\`

  Because: it is cut short.

Applies: requests
`;

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A project with the library, a tsconfig and a skill; `typescript` linked in if given. */
function project(typescript: string | null, tsconfig: object = TSCONFIG): string {
  const root = mkdtempSync(join(tmpdir(), 'skillunit-lint-'));
  roots.push(root);
  mkdirSync(join(root, 'node_modules'));
  if (typescript) symlinkSync(typescript, join(root, 'node_modules', 'typescript'), 'dir');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'index.ts'), LIBRARY);
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(tsconfig));
  mkdirSync(join(root, 'skill', 'features'), { recursive: true });
  writeFileSync(join(root, 'skill', 'SKILL.md'), SKILL);
  writeFileSync(join(root, 'skill', 'features', 'broken.md'), BROKEN);
  writeFileSync(join(root, 'skill', 'features', 'syntax.md'), SYNTAX);
  return root;
}

const run = (root: string, tsconfig = join(root, 'tsconfig.json')) =>
  lint(join(root, 'skill'), { examples: { ts: { tsconfig }, commands: {}, cwd: root } });

/** `file:line unit rule severity TSnnnn`: what the assertions compare. */
const show = (r: LintResult) =>
  r.problems.map((p) => `${p.file}:${p.line} ${p.unit ?? '-'} ${p.rule} ${p.severity} ${p.message.match(/TS\d+/)?.[0] ?? ''}`.trim());

describe.each(COMPILERS)('type-check with %s', (_, typescript) => {
  const root = project(typescript);
  const result = run(root);

  it('reports every example that does not compile, at its Markdown line', () => {
    expect(show(result)).toEqual([
      `features/broken.md:${lineOf(BROKEN, "from 'not-installed'")} - types error TS2307`,
      `features/syntax.md:${lineOf(SYNTAX, 'bogus: 1')} - types error TS2353`,
      `features/syntax.md:${lineOf(SYNTAX, 'Doing: `tf.get')} no-fragments wrong-code error TS1005`,
      `SKILL.md:${lineOf(SKILL, 'retries: 1')} - types error TS2353`,
      `SKILL.md:${lineOf(SKILL, "missing('/a')")} - types error TS2304`,
      `SKILL.md:${lineOf(SKILL, 'n.toFixed(2).foo()')} - types error TS2339`,
      `SKILL.md:${lineOf(SKILL, "Doing: `tf.get('/a', { timeout: 0 })`")} set-a-timeout wrong-code warning`,
      `SKILL.md:${lineOf(SKILL, 'Doing: `fetchAll')} set-a-timeout wrong-code error TS2304`,
      `SKILL.md:${lineOf(SKILL, "tf.gett('/b')")} pick-a-call types error TS2551`,
    ]);
  });

  it('says why: unguarded, does not parse, and undefined name in Wrong code', () => {
    const wrongCode = (unit: string) => result.problems.filter((p) => p.rule === 'wrong-code' && p.unit === unit).map((p) => p.message);
    expect(wrongCode('set-a-timeout')).toEqual([
      'this `Wrong` code compiles and no `Check` of the unit matches it: nothing reports an example that makes this mistake',
      expect.stringMatching(/^this `Wrong` code uses a name that is not defined \(TS2304 Cannot find name 'fetchAll'\.\)/),
    ]);
    expect(wrongCode('no-fragments')).toEqual([
      expect.stringMatching(/^this `Wrong` code does not parse \(TS1005 .*\); write it as complete code, or describe the mistake in prose$/),
    ]);
  });

  it('counts what it checked and what it skipped', () => {
    expect(result.ok).toBe(false);
    expect(result.summary).toMatchObject({
      files: 3,
      units: 4,
      typeChecked: 15,
      noCheck: 1,
      notConfigured: 0,
      unchecked: {},
      wrongCode: { checked: 5, unchecked: 0 },
    });
    expect(result.summary.typescript).toMatch(_ === 'typescript 5' ? /^5\./ : /^7\./);
  });

  it('removes the generated files', () => {
    expect(readdirSync(join(root, 'node_modules', '.cache', 'skillunit'))).toEqual([]);
  });

  it('reports a configuration error when tsc rejects the settings', () => {
    const bad = project(typescript, { compilerOptions: { notAnOption: true } });
    expect(() => run(bad)).toThrow(ConfigError);
  });
});

describe('type-check settings', () => {
  it('skips ts and js fences when examples.ts is not set, and says how many', () => {
    const root = project(null);
    const result = lint(join(root, 'skill'));
    expect(result.summary).toMatchObject({ typeChecked: 0, notConfigured: 15, noCheck: 1, wrongCode: { checked: 1, unchecked: 4 } });
    expect(result.problems.filter((p) => p.rule === 'types' || p.rule === 'wrong-code')).toEqual([]);
  });

  it('reports a configuration error for a missing tsconfig or a missing typescript', () => {
    const root = project(null);
    expect(() => run(root, join(root, 'nope.json'))).toThrow(/points to .*nope\.json, which does not exist/);
    expect(() => run(root)).toThrow(/`typescript` is not installed in a node_modules folder at or above/);
  });
});

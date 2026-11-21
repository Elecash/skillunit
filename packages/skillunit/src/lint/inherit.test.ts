/**
 * A file with no `Setup` of its own for a language uses the one of the nearest `SKILL.md` above it
 * that has one for that language.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseSkill } from '../units/index.js';
import { runCommands } from './commands.js';
import { lint } from './lint.js';
import { F, lineOf } from './testing.js';
import type { LintResult } from './types.js';

const require = createRequire(import.meta.url);
const COMPILERS = [
  ['typescript 5', dirname(require.resolve('typescript/package.json'))],
  ['typescript 7', dirname(require.resolve('typescript-7/package.json'))],
] as const;

const TSCONFIG = {
  compilerOptions: { strict: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', types: [], paths: { lib: ['./src/lib.ts'] } },
  include: ['src'],
};

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A project whose skill is `files`, by path in the skill folder. */
function project(typescript: string | null, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'skillunit-inherit-'));
  roots.push(root);
  mkdirSync(join(root, 'node_modules'));
  if (typescript) symlinkSync(typescript, join(root, 'node_modules', 'typescript'), 'dir');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'lib.ts'), 'export const answer = 1;\n');
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify(TSCONFIG));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, 'skill', path)), { recursive: true });
    writeFileSync(join(root, 'skill', path), text);
  }
  return root;
}

const run = (root: string) => lint(join(root, 'skill'), { examples: { ts: { tsconfig: join(root, 'tsconfig.json') }, commands: {}, cwd: root } });

/** `file:line TSnnnn` of each type problem. */
const types = (r: LintResult) => r.problems.filter((p) => p.rule === 'types' || p.rule === 'wrong-code').map((p) => `${p.file}:${p.line} ${p.code ?? p.rule}`);

const ROOT = `# Skill\n\nSee [a](features/a.md), [b](features/b.md) and [the nested skill](nested/SKILL.md).\n\nSetup:\n\n${F}ts\nimport { answer } from "lib";\n${F}\n`;
// No Setup: `answer` comes from SKILL.md, so the only error is the string.
const A = `# A\n\n${F}ts\nconst s: string = answer;\n${F}\n`;
// Its own Setup, without `answer`: SKILL.md's is not added to it.
const B = `# B\n\nSetup:\n\n${F}ts\nconst other = 1;\n${F}\n\n${F}ts\nconsole.log(other, answer);\n${F}\n`;
const NESTED = `# Nested\n\nSee [c](c.md).\n\nSetup:\n\n${F}ts\ndeclare const thing: number;\n${F}\n`;
// Under the nested SKILL.md: `thing` is declared, `answer` is not.
const C = `# C\n\n${F}ts\nthing.toFixed(1);\nconsole.log(answer);\n${F}\n`;

describe.each(COMPILERS)('the Setup of SKILL.md, with %s', (_, typescript) => {
  const result = run(project(typescript, { 'SKILL.md': ROOT, 'features/a.md': A, 'features/b.md': B, 'nested/SKILL.md': NESTED, 'nested/c.md': C }));

  it('a file with no Setup uses the one of SKILL.md; one with its own, or under a nested SKILL.md, does not', () => {
    expect(types(result)).toEqual([
      `features/a.md:${lineOf(A, 'const s')} TS2322`,
      `features/b.md:${lineOf(B, 'console.log(other, answer)')} TS2304`,
      `nested/c.md:${lineOf(C, 'console.log(answer)')} TS2304`,
    ]);
  });

  it('an error in an inherited Setup is reported once, at SKILL.md', () => {
    const broken = ROOT.replace('import { answer } from "lib";', 'import { answer, missing } from "lib";');
    const r = run(project(typescript, { 'SKILL.md': broken, 'features/a.md': A, 'features/b.md': A.replace('# A', '# B') }));
    expect(types(r).filter((l) => l.includes('TS2305'))).toEqual([`SKILL.md:${lineOf(broken, 'import { answer, missing }')} TS2305`]);
  });

  it('gives Wrong code its language from an inherited Setup', () => {
    const unit = `# Rules file\n\n## Rules\n\n### rule: use-answer\n\nWhen: code needs the number.\n\nDo: read \`answer\`.\n\nWrong:\n\n- Doing: \`answer.toUpperCase()\`\n\n  Because: it is a number.\n\nApplies: lib\n`;
    const r = run(project(typescript, { 'SKILL.md': ROOT.replace('[a](features/a.md)', '[a](features/a.md), [rules](features/rules.md)'), 'features/a.md': A, 'features/b.md': B, 'features/rules.md': unit }));
    // Type-checked with `answer` in scope: the mistake is caught by the types, so there is no warning.
    expect(r.summary.wrongCode).toEqual({ checked: 1, unchecked: 0 });
    expect(r.problems.filter((p) => p.file === 'features/rules.md')).toEqual([]);
  });
});

describe.each(COMPILERS)('a nested skill with no Setup, with %s', (_, typescript) => {
  // `answer` is a number: when the root's Setup applies, the error is TS2322, not TS2304.
  const uses = `${F}ts\nconst s: string = answer;\n${F}\n`;
  const root = `# Skill\n\nSee [outer](outer/SKILL.md).\n\nSetup:\n\n${F}ts\nimport { answer } from "lib";\n${F}\n`;

  it('uses the Setup of the skill above it, in its SKILL.md and in its files', () => {
    const nested = `# Outer\n\nSee [d](d.md).\n\n${uses}`;
    const r = run(project(typescript, { 'SKILL.md': root, 'outer/SKILL.md': nested, 'outer/d.md': `# D\n\n${uses}` }));
    expect(types(r)).toEqual(['outer/d.md:4 TS2322', `outer/SKILL.md:${lineOf(nested, 'const s')} TS2322`]);
  });

  it('finds it two levels down, through a SKILL.md that has none', () => {
    const r = run(
      project(typescript, {
        'SKILL.md': root,
        'outer/SKILL.md': '# Outer\n\nSee [inner](inner/SKILL.md).\n',
        'outer/inner/SKILL.md': '# Inner\n\nSee [deep](deep.md).\n',
        'outer/inner/deep.md': `# Deep\n\n${uses}`,
      }),
    );
    expect(types(r)).toEqual(['outer/inner/deep.md:4 TS2322']);
  });

  it('takes it per language: its own ts Setup, and the sh Setup of the skill above', () => {
    const files = {
      'SKILL.md': `${root}\nSetup:\n\n${F}sh\nGREETING=hello\n${F}\n`,
      'outer/SKILL.md': `# Outer\n\nSetup:\n\n${F}ts\ndeclare const thing: number;\n${F}\n\n${F}ts\nthing.toFixed(1);\nconsole.log(answer);\n${F}\n\n${F}sh\ntest "$GREETING" = hello\n${F}\n`,
    };
    const dir = project(typescript, files);
    // `thing` from its own ts Setup, and not `answer` from the root's: one Setup, never two.
    expect(types(run(dir))).toEqual([`outer/SKILL.md:${lineOf(files['outer/SKILL.md'], 'console.log(answer)')} TS2304`]);
    expect(runCommands(parseSkill(join(dir, 'skill')), { commands: { sh: 'sh {file}' }, cwd: dir }).problems).toEqual([]);
  });
});

describe('the Setup of SKILL.md in the command check', () => {
  it('runs before an example of another file', () => {
    const root = project(null, {
      'SKILL.md': `# Skill\n\nSee [a](a.md).\n\nSetup:\n\n${F}sh\nGREETING=hello\n${F}\n`,
      'a.md': `# A\n\n${F}sh\ntest "$GREETING" = hello\n${F}\n`,
    });
    const result = runCommands(parseSkill(join(root, 'skill')), { commands: { sh: 'sh {file}' }, cwd: root });
    expect(result).toEqual({ problems: [], checked: 2, noCheck: 0 });
  });
});

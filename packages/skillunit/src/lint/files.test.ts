import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseSkill } from '../units/index.js';
import { runCommands } from './commands.js';
import { formatLint, formatProblem } from './format.js';
import { index } from './links.js';
import { lint } from './lint.js';
import { F } from './testing.js';
import type { Problem } from './types.js';

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function skillDir(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'skillunit-files-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const show = (p: Problem) => `${p.file}:${p.line} ${p.severity}: ${p.message}`;
const indexOf = (files: Record<string, string>) => index(parseSkill(skillDir(files))).map(show);

describe('index', () => {
  it('passes a skill whose files are all reachable and whose links resolve', () => {
    expect(
      indexOf({
        'SKILL.md': '# T\n\n| Task | File |\n|---|---|\n| Retry | [retries](features/retries.md) |\n\nSee [the guide][g] and [online](https://example.com).\n\n[g]: guide.md\n',
        'features/retries.md': '# Retries\n\nBack to [the index](../SKILL.md#index), or [the logo](../img/logo.png).\n',
        'guide.md': '# Guide\n\n[this section](#usage)\n',
        'img/logo.png': 'png',
      }),
    ).toEqual([]);
  });

  it('reports a link to a file that does not exist, but not links in code', () => {
    expect(
      indexOf({
        'SKILL.md': `# T\n\n[gone](features/gone.md#a) and \`[not a link](x.md)\`.\n\n${F}md\n[also not](y.md)\n${F}\n`,
      }),
    ).toEqual(['SKILL.md:3 error: the link to `features/gone.md#a` does not resolve']);
  });

  it('reports files no link leads to from SKILL.md, following links through other files', () => {
    expect(
      indexOf({
        'SKILL.md': '# T\n\n[a](a.md)\n',
        'a.md': '# A\n\n[b](sub/b.md)\n',
        'sub/b.md': '# B\n',
        'orphan.md': '# O\n\n[a](a.md)\n',
      }),
    ).toEqual(['orphan.md:1 error: no link leads here from `SKILL.md`; add this file to the index']);
  });

  it('reports a skill with no SKILL.md, and warns about a long file', () => {
    expect(indexOf({ 'a.md': '# A\n' })).toEqual(['SKILL.md:1 error: the skill has no `SKILL.md`, so no file is reachable from an index']);
    expect(indexOf({ 'SKILL.md': `# T\n${'line\n'.repeat(300)}` })).toEqual([
      'SKILL.md:1 warning: 301 lines; above about 300, look for a split into files of one task each',
    ]);
    expect(indexOf({ 'SKILL.md': `# T\n${'line\n'.repeat(299)}` })).toEqual([]);
  });
});

describe('examples in other languages', () => {
  const skill = `# Shell

Setup:

${F}sh
greet() { echo "hi $1"; }
${F}

${F}sh
greet you
${F}

${F}sh
if then fi
${F}

${F}sh no-check
if then
${F}

${F}py
not checked: no command for py
${F}
`;

  it('runs the command on each fence after its Setup, and reports the ones that fail', () => {
    const root = skillDir({ 'SKILL.md': skill });
    const result = runCommands(parseSkill(root), { commands: { sh: 'sh -n {file}' }, cwd: root });
    expect(result.checked).toBe(3);
    expect(result.noCheck).toBe(1);
    expect(result.problems.map((p) => `${p.line} ${p.rule}`)).toEqual(['13 command']);
    expect(result.problems[0]!.message).toMatch(/^this `sh` example fails `sh -n \{file\}` \(exit 2\): /);
  });

  it('reports a failing Setup', () => {
    const root = skillDir({ 'SKILL.md': `# T\n\nSetup:\n\n${F}sh\nfi\n${F}\n` });
    const result = runCommands(parseSkill(root), { commands: { sh: 'sh -n {file}' }, cwd: root });
    expect(result.problems.map((p) => p.line)).toEqual([5]);
  });
});

describe('output', () => {
  it('prints `file:line  unit-id  what is wrong`, with - when there is no unit', () => {
    expect(formatProblem({ file: 'a.md', line: 3, unit: 'r', severity: 'error', rule: 'structure', message: 'a rule needs `Do`' })).toBe(
      'a.md:3  r  a rule needs `Do`',
    );
    expect(formatProblem({ file: 'a.md', line: 1, severity: 'warning', rule: 'index', message: 'long' })).toBe('a.md:1  -  warning: long');
  });

  it('ends with a summary', () => {
    const root = skillDir({ 'SKILL.md': `# T\n\n${F}ts\nconst a = 1;\n${F}\n\n[x](missing.md)\n` });
    const result = lint(root);
    expect(result.ok).toBe(false);
    expect(formatLint(result)).toBe(
      [
        'SKILL.md:7  -  the link to `missing.md` does not resolve',
        '',
        '1 file, 0 units · 1 ts/js not type-checked: set `examples.ts` in skillunit.yaml',
        '1 error, 0 warnings',
        '',
      ].join('\n'),
    );
    expect(formatLint(lint(skillDir({ 'SKILL.md': '# T\n' })))).toBe('1 file, 0 units\nlint ok\n');
  });
});

describe('lint as a whole', () => {
  it('fails on a parse error, and prints it with the other findings', () => {
    const root = skillDir({ 'SKILL.md': '# T\n\n## Rules\n\n### rule: r\n\nWhen: x\n\nDo: y\n\nApplies: a\n\nnot a label\n' });
    const result = lint(root);
    expect(result.ok).toBe(false);
    expect(formatLint(result).split('\n')[0]).toBe(
      'SKILL.md:13  r  this paragraph is not a label; a unit holds only labels (When, Do, Decide, Value, Unknown, Even when, Right, Wrong, Applies, Check, Source)',
    );
  });

  it('lists, per language, the example fences no checker ran on', () => {
    const root = skillDir({
      'SKILL.md': `# T\n\n${F}py\nx = 1\n${F}\n\n${F}py\ny = 2\n${F}\n\n${F}sh\nls\n${F}\n\n${F}sh no-check\nls\n${F}\n\n${F}\nplain output\n${F}\n`,
    });
    const result = lint(root);
    expect(result.summary.unchecked).toEqual({ py: 2, sh: 1 });
    expect(formatLint(result)).toContain('not checked, no command set: 2 py, 1 sh');
    const withSh = lint(root, { examples: { commands: { sh: 'sh -n {file}' }, cwd: root } });
    expect(withSh.summary.unchecked).toEqual({ py: 2 });
    expect(withSh.summary).toMatchObject({ commandChecked: 1, noCheck: 1 });
  });
});

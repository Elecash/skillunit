import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseSkill } from '../units/index.js';
import { runCommands } from './commands.js';
import { buildReport, render } from '../report/index.js';
import { index } from './links.js';
import { lint } from './lint.js';
import { F } from './testing.js';
import type { Problem } from './types.js';
import { unit } from '../vitest.js';

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

  unit('index-every-file', {
      when: 'the agent adds a file to a skill.',
      do: 'add a row for it to the "Where to look" table of `SKILL.md`, from the task to the file, with a relative link.',
      ask: {
        id: 'new-file-index',
        scenario: 'The agent adds `features/i18n.md` to a skill.',
        question: 'Where must a link to it go?',
        options: {
          index: 'In the "Where to look" table of `SKILL.md`, as a row from the task to the file',
          sibling: 'In the file that covers the closest feature',
          nowhere: 'Nowhere; agents search the folder',
        },
        expect: 'index',
      },
    }, (u) => {
    u.example('md', '| Retry a request that failed | [features/retries.md](features/retries.md) |');
    expect(
      indexOf({
        'SKILL.md': '# T\n\n[a](a.md)\n',
        'a.md': '# A\n\n[b](sub/b.md)\n',
        'sub/b.md': '# B\n',
        'orphan.md': '# O\n\n[a](a.md)\n',
      }),
    ).toEqual(['orphan.md:1 error: no link or path leads here from `SKILL.md`; add this file to its index']);
  });

  it('counts a path written in a code span or in plain text, but not a URL', () => {
    expect(
      indexOf({
        'SKILL.md': '# T\n\n| Rule | File |\n|---|---|\n| Timing | `rules/timing.md` |\n\nRead rules/fonts.md first. Online: https://example.com/rules/web.md\n',
        'rules/timing.md': '# Timing\n\nSee also `rules/easing.md`.\n',
        'rules/easing.md': '# Easing\n',
        'rules/fonts.md': '# Fonts\n',
        'rules/web.md': '# Web\n',
      }),
    ).toEqual(['rules/web.md:1 error: no link or path leads here from `SKILL.md`; add this file to its index']);
  });

  it('counts a path in a fence with no language or `text`, but not in a code example', () => {
    const lost = 'no link or path leads here from `SKILL.md`; add this file to its index';
    expect(
      indexOf({
        'SKILL.md': `# T\n\n${F}\nreferences/filters.md            - Filter conditions and operators\n${F}\n\nSee references/more.md.\n`,
        'references/filters.md': '# Filters\n',
        'references/more.md': `# More\n\n${F}text\nreferences/fields.md   - Fields\n${F}\n\n${F}ts\nimport text from "./code.md";\n${F}\n`,
        'references/fields.md': '# Fields\n',
        'references/code.md': '# Code\n',
      }),
    ).toEqual([`references/code.md:1 error: ${lost}`]);
  });

  it('counts a bare file name when exactly one file of the skill has it', () => {
    const lost = 'no link or path leads here from `SKILL.md`; add this file to its index';
    expect(
      indexOf({
        'SKILL.md': '# T\n\n### Data Structures (data-structures/)\n\n- **strings.md** - GET, SET\n- **notes.md** - which one?\n',
        'data-structures/strings.md': '# Strings\n',
        'a/notes.md': '# Notes\n',
        'b/notes.md': '# Notes\n',
      }),
    ).toEqual([`a/notes.md:1 error: ${lost}`, `b/notes.md:1 error: ${lost}`]);
  });

  it('treats a folder with its own SKILL.md as a skill of its own, and names it', () => {
    expect(
      indexOf({
        'SKILL.md': '# T\n',
        'nested/SKILL.md': '# Nested\n\n[a](a.md)\n',
        'nested/a.md': '# A\n',
        'nested/lost.md': '# Lost\n',
      }),
    ).toEqual(['nested/lost.md:1 error: no link or path leads here from `nested/SKILL.md`; add this file to its index']);
  });

  it('reports a skill with no SKILL.md, and warns about a long file', () => {
    expect(indexOf({ 'a.md': '# A\n' })).toEqual(['SKILL.md:1 error: the skill has no `SKILL.md`, so no file is reachable from an index']);
    expect(indexOf({ 'SKILL.md': `# T\n${'line\n'.repeat(300)}` })).toEqual([
      'SKILL.md:1 warning: 301 lines; above about 300, look for a split into files of one task each',
    ]);
    expect(indexOf({ 'SKILL.md': `# T\n${'line\n'.repeat(299)}` })).toEqual([]);
  });

  it('reports the long-file warning as `length`, which `off` turns off', () => {
    const root = skillDir({ 'SKILL.md': `# T\n${'line\n'.repeat(300)}`, 'orphan.md': '# O\n' });
    expect(lint(root).problems.map((p) => p.rule).sort()).toEqual(['index', 'length']);
    const off = lint(root, { off: ['length'] });
    expect(off.problems.map((p) => p.rule)).toEqual(['index']);
    expect(off.summary.off).toEqual(['length']);
    expect(lint(root, { off: ['length', 'index'] }).ok).toBe(true);
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
    expect(result.problems[0]!.message).toMatch(/^this `sh` example fails `sh -n \{file\}` \(exit 2\):\n/);
    // The temp file is gone, so the output names the example in the skill.
    expect(result.problems[0]!.message).toContain('SKILL.md:13');
    expect(result.problems[0]!.message).not.toMatch(/skillunit-examples-/);
  });

  it('keeps every line the command prints, up to twelve', () => {
    const root = skillDir({ 'SKILL.md': `# T\n\n${F}sh\necho hi\n${F}\n` });
    const banner = 'printf "Banner line\\n\\nError: the schema is invalid\\n  at %s\\n" {file}; exit 1';
    const result = runCommands(parseSkill(root), { commands: { sh: banner }, cwd: root });
    expect(result.problems[0]!.message).toBe('this `sh` example fails `' + banner + '` (exit 1):\nBanner line\nError: the schema is invalid\n  at SKILL.md:3');
    const long = runCommands(parseSkill(root), { commands: { sh: 'seq 1 20; exit 1' }, cwd: root });
    expect(long.problems[0]!.message.split('\n').slice(-2)).toEqual(['12', '(8 more lines)']);
  });

  it('names a line of the output by its line in the skill: in the example, or in the Setup above it', () => {
    const root = skillDir({ 'SKILL.md': `# T\n\nSetup:\n\n${F}sh\na=1\nb=2\n${F}\n\n${F}sh\necho x\necho y\n${F}\n` });
    // A checker that reports line 4 and line 2 of the file it is given, as mypy does.
    const command = "printf '%s:4: bad\\n%s:2: worse\\n' {file} {file}; exit 1";
    const [setup, example] = runCommands(parseSkill(root), { commands: { sh: command }, cwd: root }).problems;
    // The temporary file is the Setup's two lines, then the example's: line 4 is `echo y`.
    expect(example!.message.split('\n').slice(1)).toEqual(['SKILL.md:12: bad', 'SKILL.md:7 (Setup): worse']);
    // The Setup runs on its own: line 2 is its last, and line 4 is past it.
    expect(setup!.message.split('\n').slice(1)).toEqual(['SKILL.md:7: bad', 'SKILL.md:7: worse']);
  });

  it('runs the command on a block under the Value of a fact like any other example', () => {
    const unit = `# T\n\n## Rules\n\n### fact: r\n\nWhen: a.\n\nValue: b.\n\n${F}sh\nif then fi\n${F}\n`;
    const root = skillDir({ 'SKILL.md': unit });
    const result = runCommands(parseSkill(root), { commands: { sh: 'sh -n {file}' }, cwd: root });
    expect(result.checked).toBe(1);
    expect(result.problems.map((p) => `${p.line} ${p.unit} ${p.rule}`)).toEqual(['11 r command']);
  });

  it('runs the command of a language on a fence that names it another way', () => {
    const skill = `# T\n\n${F}python\nprint(1\n${F}\n\n${F}bash\nif then fi\n${F}\n\n${F}yml\na: [\n${F}\n`;
    const root = skillDir({ 'SKILL.md': skill });
    const result = runCommands(parseSkill(root), { commands: { py: 'exit 1 # {file}', sh: 'exit 2 # {file}', yaml: 'exit 3 # {file}' }, cwd: root });
    expect(result.checked).toBe(3);
    expect(result.problems.map((p) => p.message)).toEqual([
      'this `py` example fails `exit 1 # {file}` (exit 1)',
      'this `sh` example fails `exit 2 # {file}` (exit 2)',
      'this `yaml` example fails `exit 3 # {file}` (exit 3)',
    ]);
  });

  it('warns about a language set in the settings that no block is in', () => {
    const root = skillDir({ 'SKILL.md': `# T\n\n${F}py\nprint(1)\n${F}\n`, 'skillunit.yaml': 'examples:\n  ruby: { command: "ruby -c {file}" }\n  py: { command: "true {file}" }\n' });
    const place = { file: join(root, 'skillunit.yaml'), lines: { ruby: 2, py: 3 } };
    const r = lint(root, { examples: { commands: { ruby: 'ruby -c {file}', py: 'true {file}' }, cwd: root, place } });
    expect(r.problems.map(show)).toEqual(['skillunit.yaml:2 warning: `examples.ruby` is set, and no block of the skill is in `ruby`, so its command never runs. The blocks are in `py`']);
    const sh = lint(root, { examples: { commands: { sh: 'true {file}' }, cwd: root, place: { ...place, lines: { sh: 2 } } } });
    expect(sh.problems.map(show)).toEqual(['skillunit.yaml:2 warning: `examples.sh` is set, and no block of the skill is in `sh` or `bash` or `shell`, so its command never runs. The blocks are in `py`']);
  });

  it('reports a failing Setup', () => {
    const root = skillDir({ 'SKILL.md': `# T\n\nSetup:\n\n${F}sh\nfi\n${F}\n` });
    const result = runCommands(parseSkill(root), { commands: { sh: 'sh -n {file}' }, cwd: root });
    expect(result.problems.map((p) => p.line)).toEqual([5]);
  });
});

describe('output', () => {
  const table = (result: ReturnType<typeof lint>, cwd: string) => render(buildReport('lint', { lint: result }), 'table', { cwd, color: false });

  it('prints each finding as `file:line  unit-id  what is wrong`, with - when there is no unit', () => {
    const root = skillDir({ 'SKILL.md': `# T\n\n${F}ts\nconst a = 1;\n${F}\n\n[x](missing.md)\n` });
    const result = lint(root);
    expect(result.ok).toBe(false);
    const text = table(result, root);
    expect(text).toContain('\n  1) SKILL.md:7  -  the link to `missing.md` does not resolve\n');
    expect(text).toContain('1 ts/js not type-checked: set `examples.ts` in skillunit.yaml');
    expect(text.trimEnd().split('\n').at(-1)).toBe('FAILED  lint 1 error, 0 warnings');
    expect(table(lint(skillDir({ 'SKILL.md': '# T\n' })), root).trimEnd().split('\n').at(-1)).toBe('OK  lint ok');
  });
});

describe('lint as a whole', () => {
  it('fails on a parse error, and prints it with the other findings', () => {
    const root = skillDir({ 'SKILL.md': '# T\n\n## Rules\n\n### rule: r\n\nWhen: x\n\nDo: y\n\nnot a label\n' });
    const result = lint(root);
    expect(result.ok).toBe(false);
    expect(render(buildReport('lint', { lint: result }), 'table', { cwd: root, color: false })).toContain(
      '1) SKILL.md:11  r  this paragraph is not a label; a unit holds only labels (When, Do, Decide, Value, Unknown, Even when, Right, Check)',
    );
  });

  it('lists, per language, the example fences no checker ran on', () => {
    const root = skillDir({
      'SKILL.md': `# T\n\n${F}py\nx = 1\n${F}\n\n${F}py\ny = 2\n${F}\n\n${F}sh\nls\n${F}\n\n${F}sh no-check\nls\n${F}\n\n${F}\nplain output\n${F}\n`,
    });
    const result = lint(root);
    expect(result.summary.unchecked).toEqual({ py: 2, sh: 1 });
    expect(render(buildReport('lint', { lint: result }), 'table', { cwd: root, color: false })).toContain('not checked, no command set: 2 py, 1 sh');
    const withSh = lint(root, { examples: { commands: { sh: 'sh -n {file}' }, cwd: root } });
    expect(withSh.summary.unchecked).toEqual({ py: 2 });
    expect(withSh.summary).toMatchObject({ commandChecked: 1, noCheck: 1 });
  });
});

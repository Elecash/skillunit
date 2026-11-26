/**
 * The pytest helper of docs/proof.md, run as a project runs it: SkillUnit reads the records it
 * writes, and refuses what `unit()` would refuse. Skipped where pytest is not installed.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readRecords } from './records.js';

const DOC = fileURLToPath(new URL('../../../../docs/proof.md', import.meta.url));
const pytest = spawnSync('python3', ['-m', 'pytest', '--version'], { encoding: 'utf8' }).status === 0;

describe.skipIf(!pytest)('the pytest helper of docs/proof.md', () => {
  const root = mkdtempSync(join(tmpdir(), 'skillunit-pytest-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('writes records SkillUnit reads, and a value with a line break or a fence language that is not one is refused', () => {
    const helper = /```python\n([\s\S]*?)```/.exec(readFileSync(DOC, 'utf8'))![1]!;
    writeFileSync(join(root, 'conftest.py'), helper);
    writeFileSync(
      join(root, 'test_units.py'),
      [
        'def test_default_timeout(unit):',
        '    unit("default-timeout", when="the user asks.", value="10 seconds.", values={"seconds": 10}, examples=[{"lang": "sh", "text": "curl x"}])',
        '',
        '',
        'def test_two_lines(unit):',
        '    unit("two-lines", when="the user asks.", value="10 seconds.", values={"n": "ten\\nseconds"})',
        '',
        '',
        'def test_typed_number(unit):',
        '    unit("typed-number", when="the user asks.", value="a 5xx status is retried.")',
        '',
        '',
        'def test_bad_lang(unit):',
        '    unit("bad-lang", when="the user asks.", do="run it.", examples=[{"lang": "sh\\n### rule: injected", "text": "x"}])',
        '',
      ].join('\n'),
    );
    const run = spawnSync('python3', ['-m', 'pytest', '-q', '-p', 'no:cacheprovider'], { cwd: root, encoding: 'utf8' });
    expect(run.status, run.stdout + run.stderr).toBe(0);

    const records = readRecords(join(root, 'tmp', 'skill-units'), root);
    expect(records.units.map((u) => [u.id, u.status, u.file, u.line])).toEqual([['default-timeout', 'passed', 'test_units.py', 1]]);
    expect(records.problems.map((p) => p.message.replace(/^[\w-]+\.[0-9a-f]{8}\.json: /, ''))).toEqual([
      'each example has a fence language in `lang`, such as `sh` or `yaml`; got "sh\\n### rule: injected"',
      'unit `two-lines`: the value `n` has a line break; a value is one line, since `{{value:two-lines.n}}` puts it inside a line',
      "unit `typed-number`: the number 5 in `Value` is none of the unit's `values`. Give the value a name in the code, build the sentence from that name, and list it in `values`",
    ]);
  });

  it('refuses a second unit() in one test, and a red test keeps the message of its assertion', () => {
    const dir = mkdtempSync(join(root, 'red-'));
    writeFileSync(join(dir, 'conftest.py'), /```python\n([\s\S]*?)```/.exec(readFileSync(DOC, 'utf8'))![1]!);
    writeFileSync(
      join(dir, 'test_red.py'),
      [
        'def test_twice(unit):',
        '    unit("first", when="the user asks.", value="10 seconds.")',
        '    unit("second", when="the user asks.", value="20 seconds.")',
        '',
        '',
        'def test_red(unit):',
        '    unit("red", when="the user asks.", value="10 seconds.")',
        '    assert 1 + 1 == 3, "the timeout is not 10 seconds"',
        '',
      ].join('\n'),
    );
    const run = spawnSync('python3', ['-m', 'pytest', '-q', '-p', 'no:cacheprovider'], { cwd: dir, encoding: 'utf8' });
    expect(run.status, run.stdout + run.stderr).toBe(1);
    const records = readRecords(join(dir, 'tmp', 'skill-units'), dir);
    expect(records.problems).toEqual([]);
    const failed = Object.fromEntries(records.units.map((u) => [u.id, u.status === 'failed' ? u.error : u.status]));
    expect(Object.keys(failed).sort()).toEqual(['first', 'red']);
    expect(failed.first).toMatch(/^RuntimeError: unit\(\) is called once per test; first is already declared here/);
    expect(failed.red).toMatch(/^AssertionError: the timeout is not 10 seconds/);
  });
});

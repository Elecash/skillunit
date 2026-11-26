import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ProofConfig } from '../config.js';
import type { Problem } from '../problems.js';
import { runProof } from '../proof/layer.js';

// Region markers and fences built from parts: this file holds none of its own.
const OPEN = (id: string) => `#${'region'} skill:${id}`;
const CLOSE = `#${'endregion'}`;
const F = '`'.repeat(3);

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'skillunit-records-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const json = (o: object) => `${JSON.stringify({ skillunit: 2, status: 'passed', ...o })}\n`;
const file = (id: string, testFile: string, line: number, spec: object) => json({ kind: 'file', id, file: testFile, line, test: `file ${id}`, ...spec });
const unit = (id: string, testFile: string, line: number, more: object) => json({ id, file: testFile, line, test: `unit ${id}`, examples: [], ...more });

const INDEX_TEST = `// ${OPEN('tinyfetch')}\nimport { tf } from 'tinyfetch';\n// ${CLOSE}\n`;
const RETRIES_TEST = `// ${OPEN('retries')}\nimport { tf } from 'tinyfetch';\n// ${CLOSE}\ntest('x', () => {\n  // ${OPEN('retry-idempotent-only')}\n  await tf.get(url, { retry: 3 });\n  // ${CLOSE}\n});\n`;

const RECORDS = {
  'tmp/skill-units/a.json': file('tinyfetch', 'tests/index.test.ts', 5, { skillFile: 'SKILL.md', title: 'tinyfetch', description: 'A small HTTP client for JSON APIs.', frontmatter: { name: 'tinyfetch', description: 'Make HTTP requests with tinyfetch.' } }),
  'tmp/skill-units/b.json': unit('await-every-request', 'tests/index.test.ts', 8, { setup: 'tinyfetch', order: 0, kind: 'rule', when: 'calling a method.', do: 'await it.' }),
  'tmp/skill-units/c.json': file('retries', 'tests/retries.test.ts', 4, { skillFile: 'features/retries.md', title: 'tinyfetch — retries', when: 'Retry a request that failed', description: 'tinyfetch can repeat a request that failed.' }),
  'tmp/skill-units/d.json': unit('retry-idempotent-only', 'tests/retries.test.ts', 20, { setup: 'retries', order: 1, kind: 'rule', body: false, when: 'a request may be retried.', do: 'retry GET only.' }),
  'tmp/skill-units/e.json': unit('retry-defaults', 'tests/retries.test.ts', 9, { setup: 'retries', order: 0, kind: 'fact', when: 'no retry is set.', value: 'none.' }),
  'tmp/skill-units/f.json': file('clients', 'tests/clients.test.ts', 2, { skillFile: 'features/clients.md', title: 'tinyfetch — clients', when: 'Make many requests to one API', description: 'A client holds a base URL.' }),
};
const GOOD = { 'tests/index.test.ts': INDEX_TEST, 'tests/retries.test.ts': RETRIES_TEST, 'tests/clients.test.ts': '', ...RECORDS };

const config = (root: string): ProofConfig => ({ units: join(root, 'tmp/skill-units'), cwd: root });
const run = (root: string, write = false) => runProof({ skill: join(root, 'skill'), config: config(root), write });
const show = (p: Problem) => `${p.file}:${p.line} ${p.unit ?? '-'}: ${p.message}`;

describe('a skill built from the records alone', () => {
  it('writes each file from its setup() and its units: the frontmatter, the title, the line, the code, the index by path, the rules in order', () => {
    const root = project(GOOD);
    const { result } = run(root, true);
    expect(result.problems.map(show)).toEqual([]);
    expect(readFileSync(join(root, 'skill/SKILL.md'), 'utf8')).toBe(
      [
        '---',
        'name: tinyfetch',
        'description: Make HTTP requests with tinyfetch.',
        '---',
        '',
        '# tinyfetch',
        '',
        'A small HTTP client for JSON APIs.',
        '',
        `${F}ts`,
        "import { tf } from 'tinyfetch';",
        F,
        '',
        '## Where to look',
        '',
        '| Task | File |',
        '| --- | --- |',
        '| Make many requests to one API | [features/clients.md](features/clients.md) |',
        '| Retry a request that failed | [features/retries.md](features/retries.md) |',
        '',
        '## Rules',
        '',
        '### rule: await-every-request',
        '',
        'When: calling a method.',
        '',
        'Do: await it.',
        '',
      ].join('\n'),
    );
    const retries = readFileSync(join(root, 'skill/features/retries.md'), 'utf8');
    expect(retries.indexOf('### fact: retry-defaults')).toBeLessThan(retries.indexOf('### rule: retry-idempotent-only'));
    expect(retries).toContain(`Right:\n\n${F}ts\nawait tf.get(url, { retry: 3 });\n${F}\n`);
    // A file with no unit has no rules.
    expect(readFileSync(join(root, 'skill/features/clients.md'), 'utf8')).toBe('# tinyfetch — clients\n\nA client holds a base URL.\n');
    expect(result.units.map((u) => `${u.id} ${u.from} ${u.file} ${u.setup.file}:${u.setup.line}`)).toEqual([
      'retry-defaults test features/retries.md ../tests/retries.test.ts:4',
      'retry-idempotent-only declared features/retries.md ../tests/retries.test.ts:4',
      'await-every-request test SKILL.md ../tests/index.test.ts:5',
    ]);
  });

  it('every line of a built file comes from a test: its setup(), a region, or a unit', () => {
    const root = project(GOOD);
    const { origin } = run(root, true);
    expect(origin('SKILL.md', 2)).toEqual({ kind: 'test', file: '../tests/index.test.ts', line: 5 });
    expect(origin('SKILL.md', 11)).toEqual({ kind: 'test', file: '../tests/index.test.ts', line: 1 });
    expect(origin('SKILL.md', 18)).toEqual({ kind: 'test', file: '../tests/clients.test.ts', line: 2 });
    expect(origin('SKILL.md', 23)).toEqual({ kind: 'test', file: '../tests/index.test.ts', line: 8, unit: 'await-every-request' });
  });

  it('a unit with no setup() before it, one whose setup() left nothing, and a file no setup() declares', () => {
    const root = project({
      ...GOOD,
      'tmp/skill-units/g.json': unit('orphan', 'tests/other.test.ts', 3, { kind: 'rule', when: 'x.', do: 'y.' }),
      'tmp/skill-units/h.json': unit('lost', 'tests/other.test.ts', 9, { setup: 'gone', order: 0, kind: 'rule', when: 'x.', do: 'y.' }),
    });
    run(root, true);
    writeFileSync(join(root, 'skill/notes.md'), '# Notes\n');
    expect(run(root).result.problems.map(show)).toEqual([
      '../tests/other.test.ts:3 orphan: the unit `orphan` belongs to no file of the skill: declare its file with `setup()` before it in this test file',
      '../tests/other.test.ts:9 lost: the unit `lost` belongs to `setup(\'gone\')`, which left no record: its test was skipped or deleted, or did not run',
      'notes.md:1 -: no `setup()` declares `notes.md`: declare it in a test, or remove it from the skill folder',
    ]);
  });

  it('a unit the skill has and no test declares: named on its heading, not blamed on the unit next to it', () => {
    const root = project(GOOD);
    run(root, true);
    const { 'tmp/skill-units/e.json': _gone, ...rest } = GOOD;
    const again = project(rest);
    mkdirSync(join(again, 'skill/features'), { recursive: true });
    for (const f of ['SKILL.md', 'features/retries.md', 'features/clients.md']) writeFileSync(join(again, 'skill', f), readFileSync(join(root, 'skill', f)));
    const found = run(again).result.problems;
    expect(found.map(show)).toEqual([
      'features/retries.md:11 retry-defaults: the skill has the unit `retry-defaults`, and no test declares it: its test was skipped or deleted, or did not run. Run `skillunit proof --write` to take it out of the skill',
    ]);
    expect(found[0]!.origin).toBeUndefined();
  });

  it('two setup() with one id or one file, and no SKILL.md', () => {
    const sameId = project({ ...GOOD, 'tmp/skill-units/g.json': file('retries', 'tests/zz.test.ts', 1, { skillFile: 'features/other.md', title: 'T', when: 'W', description: 'D.' }) });
    expect(run(sameId, true).result.problems.map(show)).toEqual(['../tests/zz.test.ts:1 -: the file `retries` is also declared at tests/retries.test.ts:4; two `setup()` cannot have the same id']);
    const samePath = project({ ...GOOD, 'tmp/skill-units/g.json': file('more-retries', 'tests/zz.test.ts', 1, { skillFile: 'features/retries.md', title: 'T', when: 'W', description: 'D.' }) });
    expect(run(samePath, true).result.problems.map(show)).toEqual([
      "../tests/zz.test.ts:1 -: `features/retries.md` is also declared by `setup('retries')` at tests/retries.test.ts:4; a file of the skill has one `setup()`",
    ]);
    const { 'tmp/skill-units/a.json': _a, 'tmp/skill-units/b.json': _b, ...rest } = GOOD;
    expect(run(project(rest), true).result.problems.map(show)).toEqual([
      '../tests/clients.test.ts:2 -: no `setup()` declares `SKILL.md`, the file an agent reads first: declare it, with `frontmatter`',
    ]);
  });

  it('a setup() that failed: its file is not built, and the finding says why', () => {
    const root = project({ ...GOOD, 'tmp/skill-units/c.json': `${JSON.stringify({ skillunit: 2, status: 'failed', kind: 'file', id: 'retries', file: 'tests/retries.test.ts', line: 4, test: 'file retries', error: 'setup `retries`: `when` is one line' })}\n` });
    const { result } = run(root, true);
    expect(result.problems.map(show)).toEqual(['../tests/retries.test.ts:4 -: the `setup()` of `retries` failed, so its file is not built: setup `retries`: `when` is one line']);
    expect(result.files.map((f) => f.file)).not.toContain('features/retries.md');
  });

  it('a record of a file is held to the checks of setup()', () => {
    const root = project({ ...GOOD, 'tmp/skill-units/f.json': file('clients', 'tests/clients.test.ts', 2, { skillFile: 'features/clients.md', title: 'Clients, 2 kinds', when: 'W', description: 'D.' }) });
    expect(run(root, true).result.problems.map((p) => p.message)).toContainEqual(expect.stringMatching(/^f\.json: setup `clients`: the number 2 in `title`/));
  });
});

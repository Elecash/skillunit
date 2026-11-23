import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ProofConfig } from '../config.js';
import { loadConfig } from '../config.js';
import { F } from '../lint/testing.js';
import type { Problem } from '../lint/types.js';
import { examplesFolder, skillExample } from './helper.js';
import { proof, type ProofOptions } from './layer.js';

// Region markers built from parts: this file holds no region of its own.
const OPEN = (id: string) => `#${'region'} skill:${id}`;
const CLOSE = `#${'endregion'}`;

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A project: the settings' folder holds `skill/`, `reports/`, `tests/` and `tmp/skill-proof/`. */
function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'skillunit-proof-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

type Status = 'passed' | 'failed' | 'skipped';
/** A JUnit report with one case per `[name, status]`, started now. */
function junit(...cases: [string, Status][]): string {
  const body = cases.map(([name, status]) => {
    const inner = status === 'failed' ? '<failure message="expected 500 to be 1000"/>' : status === 'skipped' ? '<skipped/>' : '';
    return `    <testcase classname="tests/a.test.ts" name="${name}">${inner}</testcase>`;
  });
  return `<testsuites>\n  <testsuite name="a" timestamp="${new Date().toISOString()}">\n${body.join('\n')}\n  </testsuite>\n</testsuites>\n`;
}

const config = (root: string, more: Partial<ProofConfig> = {}): ProofConfig => ({
  reports: ['reports/*.xml'],
  examples: join(root, 'tmp/skill-proof'),
  sources: ['tests/*.test.ts'],
  require: true,
  cwd: root,
  ...more,
});

const run = (root: string, more: Partial<ProofConfig> = {}, options: Partial<ProofOptions> = {}) =>
  proof({ skill: join(root, 'skill'), config: config(root, more), configFile: join(root, 'skillunit.yaml'), ...options });

const show = (p: Problem) => `${p.file}:${p.line} ${p.unit ?? '-'} ${p.severity}: ${p.message}`;
const errors = (r: ReturnType<typeof proof>) => r.problems.filter((p) => p.severity === 'error').map(show);
const warnings = (r: ReturnType<typeof proof>) => r.problems.filter((p) => p.severity === 'warning').map(show);

/** A skill: a rule with a proved block, a fact proved by a tag alone, and advice with `Proof: none`. */
const SKILL = `# Demo

## Rules

### rule: check-status

When: a request failed.

Do: test the error with \`isHttpError\` first.

Right:

${F}ts proof=check-status
if (isHttpError(error)) return null;
${F}

Applies: errors

### fact: retry-delay

When: no \`retryDelay\` is set.

Value: 1000 ms.

Applies: retries

### rule: one-client

When: calling one API many times.

Do: reuse one client.

Applies: clients

Proof: none, a recommendation
`;

const TEST = `test('[skill:check-status]', () => {
  // ${OPEN('check-status')}
  if (isHttpError(error)) return null;
  // ${CLOSE}
});
`;

const GOOD = {
  'skillunit.yaml': 'proof:\n  reports: reports/*.xml\n',
  'skill/SKILL.md': SKILL,
  'tests/a.test.ts': TEST,
  'reports/junit.xml': junit(['checks the status [skill:check-status]', 'passed'], ['reads the delay [skill:retry-delay]', 'passed'], ['no tag', 'passed']),
};

describe('a skill whose tests prove it', () => {
  it('counts proved, Proof: none and pending, and the blocks from tests', () => {
    const r = run(project(GOOD));
    expect(r.problems.map(show)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.summary).toEqual({ units: 3, proved: 2, none: 1, pending: 0, failed: 0, tagged: 2, fences: 1, differ: 0, written: 0 });
    expect(r.units.map((u) => `${u.id} ${u.state}`)).toEqual(['check-status proved', 'retry-delay proved', 'one-client none']);
    expect(r.reports).toEqual(['../reports/junit.xml']);
  });
});

describe('what fails the layer', () => {
  it('no report matches proof.reports', () => {
    const { 'reports/junit.xml': _, ...rest } = GOOD;
    expect(errors(run(project(rest)))[0]).toBe(
      '../skillunit.yaml:2 - error: no report matches `proof.reports` (`reports/*.xml`); run the tests with a JUnit reporter first, such as `vitest run --reporter=junit --outputFile=reports/junit.xml`',
    );
  });

  it('a report that cannot be read', () => {
    expect(errors(run(project({ ...GOOD, 'reports/junit.xml': '<testsuites>\n<testcase name="a">\n' })))).toEqual([
      '../reports/junit.xml:3 - error: this report cannot be read: the report ends inside `<testcase>`; was it cut short?',
      expect.stringContaining('check-status error: no test is tagged'),
      expect.stringContaining('retry-delay error: no test proves this unit'),
    ]);
  });

  it('a tagged test failed: always, whether the unit has a block or not and whatever require says', () => {
    const root = project({ ...GOOD, 'reports/junit.xml': junit(['checks the status [skill:check-status]', 'passed'], ['reads the delay [skill:retry-delay]', 'failed']) });
    const expected = [
      'SKILL.md:19 retry-delay error: the test "tests/a.test.ts › reads the delay [skill:retry-delay]" (reports/junit.xml:4) failed: expected 500 to be 1000. It proves this unit, so the unit may no longer say what the code does',
    ];
    expect(errors(run(root))).toEqual(expected);
    expect(errors(run(root, { require: false }))).toEqual(expected);
    expect(run(root).units[1]!.state).toBe('failed');
  });

  it('every tagged test was skipped, and the unit has a block or require is on', () => {
    const root = project({ ...GOOD, 'reports/junit.xml': junit(['checks the status [skill:check-status]', 'skipped'], ['reads the delay [skill:retry-delay]', 'skipped']) });
    expect(errors(run(root))).toEqual([
      'SKILL.md:5 check-status error: every test tagged `[skill:check-status]` was skipped ("tests/a.test.ts › checks the status [skill:check-status]"), so nothing proves this unit',
      'SKILL.md:19 retry-delay error: every test tagged `[skill:retry-delay]` was skipped ("tests/a.test.ts › reads the delay [skill:retry-delay]"), so nothing proves this unit',
    ]);
    // With require off, only the unit with a block fails; the fact is pending.
    expect(errors(run(root, { require: false })).map((e) => e.split(' ')[1])).toEqual(['check-status']);
    expect(run(root, { require: false }).summary.pending).toBe(2);
  });

  it('a block whose unit no test is tagged for, whatever require says', () => {
    const root = project({ ...GOOD, 'reports/junit.xml': junit(['reads the delay [skill:retry-delay]', 'passed']) });
    const message = 'SKILL.md:13 check-status error: no test is tagged `[skill:check-status]`, but the block at line 13 says a test produced it; tag the test that proves this unit';
    expect(errors(run(root))).toEqual([message]);
    expect(errors(run(root, { require: false }))).toEqual([message]);
  });

  it('a tag that names no unit, or none at all', () => {
    const root = project({ ...GOOD, 'reports/junit.xml': junit(['checks the status [skill:check-status]', 'passed'], ['reads the delay [skill:retry-delay] [skill:retry-dleay]', 'passed'], ['empty [skill:]', 'passed']) });
    expect(errors(run(root))).toEqual([
      '../reports/junit.xml:4 - error: `[skill:retry-dleay]` names no unit of the skill, in the test "tests/a.test.ts › reads the delay [skill:retry-delay] [skill:retry-dleay]"',
      '../reports/junit.xml:5 - error: `[skill:]` has no unit id, in the test "tests/a.test.ts › empty [skill:]"',
    ]);
  });

  it('a block that names another unit: reported by `skillunit proof`, left to lint in `check`', () => {
    const root = project({ ...GOOD, 'skill/SKILL.md': SKILL.replace('ts proof=check-status', 'ts proof=retry-delay') });
    expect(errors(run(root, {}, { marks: true }))).toEqual([
      "SKILL.md:13 check-status error: `proof=retry-delay` does not name this block's unit; a fence of `check-status` takes `proof=check-status`, or `proof=check-status.<name>` with a kebab-case name",
    ]);
    expect(errors(run(root, {}, { marks: false }))).toEqual([]);
  });

  it('a block with no file and no region, or with both', () => {
    const none = project({ ...GOOD, 'tests/a.test.ts': "test('[skill:check-status]', () => {});\n" });
    expect(errors(run(none))).toEqual([
      'SKILL.md:13 check-status error: nothing gives `proof=check-status`: no test wrote `tmp/skill-proof/check-status.<extension>`, and no file of `proof.sources` has the region `skill:check-status`',
    ]);
    expect(errors(run(none, { sources: [] }))[0]).toContain(', and `proof.sources` is not set');
    const both = project({ ...GOOD, 'tmp/skill-proof/check-status.txt': 'x' });
    expect(errors(run(both))).toEqual([
      'SKILL.md:13 check-status error: both `tmp/skill-proof/check-status.txt` and the region at tests/a.test.ts:2 give `proof=check-status`; a block comes from one of them',
    ]);
  });

  it('Proof: none on a unit a test is tagged for', () => {
    const root = project({ ...GOOD, 'reports/junit.xml': junit(['checks the status [skill:check-status]', 'passed'], ['reads the delay [skill:retry-delay]', 'passed'], ['one client [skill:one-client]', 'passed']) });
    expect(errors(run(root))).toEqual([
      'SKILL.md:27 one-client error: this unit says `Proof: none`, and a test is tagged `[skill:one-client]` ("tests/a.test.ts › one client [skill:one-client]"); keep one: the test, or `Proof: none`',
    ]);
  });

  it('a block that differs from its region: the first line that differs, and what to run', () => {
    const root = project({ ...GOOD, 'tests/a.test.ts': TEST.replace('return null;', 'return undefined;') });
    expect(errors(run(root))).toEqual([
      'SKILL.md:14 check-status error: this block is not what `tests/a.test.ts:2` gives, from line 1 of the block: the test gives `if (isHttpError(error)) return undefined;`, the skill has `if (isHttpError(error)) return null;`. Run `skillunit proof --write`',
    ]);
    expect(run(root).summary.differ).toBe(1);
  });

  it('require on, and a unit no test proves and with no Proof: none', () => {
    const root = project({ ...GOOD, 'reports/junit.xml': junit(['checks the status [skill:check-status]', 'passed']) });
    expect(errors(run(root))).toEqual([
      'SKILL.md:19 retry-delay error: no test proves this unit: tag a test that asserts what it says with `[skill:retry-delay]`, or write `Proof: none, <why>` when no test can',
    ]);
    const off = run(root, { require: false });
    expect(off.problems).toEqual([]);
    expect(off.summary).toMatchObject({ proved: 1, none: 1, pending: 1 });
  });

  it('a region whose text would close the block', () => {
    const root = project({ ...GOOD, 'tests/a.test.ts': `// ${OPEN('check-status')}\nconst md = \`\n${F}\n\`;\n// ${CLOSE}\n` });
    expect(errors(run(root))).toEqual([
      'SKILL.md:13 check-status error: the example has a line ````` that would close this block; open the block with a longer fence, such as `````` ',
    ].map((m) => m.trimEnd()));
  });
});

describe('warnings', () => {
  it('an example file no block uses, and a region no block uses', () => {
    const root = project({ ...GOOD, 'tmp/skill-proof/gone.json': '1\n', 'tests/b.test.ts': `// ${OPEN('gone-too')}\nx();\n// ${CLOSE}\n` });
    expect(warnings(run(root))).toEqual([
      '../tests/b.test.ts:1 - warning: no block has `proof=gone-too`, so nothing uses this region',
      '../tmp/skill-proof/gone.json:1 - warning: no block has `proof=gone`, so nothing uses `gone.json`',
    ]);
  });

  it('an example file older than the run in the report', () => {
    const skill = SKILL.replace('ts proof=check-status', 'json proof=check-status');
    const root = project({ ...GOOD, 'skill/SKILL.md': skill.replace('if (isHttpError(error)) return null;', '{ "status": 404 }'), 'tests/a.test.ts': '', 'tmp/skill-proof/check-status.json': '{ "status": 404 }\n' });
    expect(warnings(run(root))).toEqual([]);
    const old = new Date(Date.now() - 60 * 60 * 1000);
    utimesSync(join(root, 'tmp/skill-proof/check-status.json'), old, old);
    expect(warnings(run(root))).toEqual([
      'SKILL.md:13 check-status warning: `tmp/skill-proof/check-status.json` is older than the test run in the reports: a test did not write it this time. Empty `proof.examples` before the tests run',
    ]);
  });
});

describe('--write', () => {
  const NESTED = `# Demo

## Rules

### decision: pick

When: a choice.

Decide:

- **shared** — one base URL.

  ~~~~json title="client.json" proof=pick.shared
  {}
  ~~~~

Applies: picks
`;

  it('rewrites each flagged block at its indentation, keeps its info string, and touches nothing else', () => {
    const root = project({
      'skill/SKILL.md': NESTED,
      'tmp/skill-proof/pick.shared.json': '{\n  "baseUrl": "https://api.example.com"\n}\n',
      'reports/junit.xml': junit(['picks [skill:pick]', 'passed']),
    });
    const before = run(root);
    expect(errors(before)[0]).toContain('this block is not what `tmp/skill-proof/pick.shared.json` gives');
    const written = run(root, {}, { write: true });
    expect(written.problems).toEqual([]);
    expect(written.summary).toMatchObject({ written: 1, differ: 1 });
    expect(readFileSync(join(root, 'skill/SKILL.md'), 'utf8')).toBe(NESTED.replace('  {}\n', '  {\n    "baseUrl": "https://api.example.com"\n  }\n'));
    expect(run(root).problems).toEqual([]);
  });

  it('keeps CRLF line ends', () => {
    const root = project({ 'skill/SKILL.md': NESTED.replace(/\n/g, '\r\n'), 'tmp/skill-proof/pick.shared.json': 'a\nb\n', 'reports/junit.xml': junit(['picks [skill:pick]', 'passed']) });
    run(root, {}, { write: true });
    expect(readFileSync(join(root, 'skill/SKILL.md'), 'utf8')).toContain('  ~~~~json title="client.json" proof=pick.shared\r\n  a\r\n  b\r\n  ~~~~\r\n');
  });
});

describe('format', () => {
  // A formatter that writes `a = 1` for `a=1`, as Prettier would put spaces around `=`.
  const FORMATTER = `import { readFileSync, writeFileSync } from 'node:fs';
const file = process.argv[2];
writeFileSync(file, readFileSync(file, 'utf8').replace(/(\\w)=(\\d)/g, '$1 = $2'));
`;
  const files = (block: string) => ({
    'fmt.mjs': FORMATTER,
    'skill/SKILL.md': SKILL.replace('if (isHttpError(error)) return null;', block),
    'tests/a.test.ts': `// ${OPEN('check-status')}\nconst a=1;\n// ${CLOSE}\n`,
    'reports/junit.xml': GOOD['reports/junit.xml'],
  });

  it('compares the blocks as the formatter leaves them', () => {
    const root = project(files('const a = 1;'));
    expect(errors(run(root))[0]).toContain('the test gives `const a=1;`, the skill has `const a = 1;`');
    expect(run(root, { format: 'node fmt.mjs {file}' }).problems).toEqual([]);
  });

  it('runs the formatter on each file --write changes, and leaves no copy behind', () => {
    const root = project(files('old();'));
    const r = run(root, { format: 'node fmt.mjs {file}' }, { write: true });
    expect(r.problems).toEqual([]);
    expect(readFileSync(join(root, 'skill/SKILL.md'), 'utf8')).toContain(`${F}ts proof=check-status\nconst a = 1;\n${F}`);
    expect(run(root, { format: 'node fmt.mjs {file}' }).problems).toEqual([]);
    expect(readdirSync(join(root, 'skill'))).toEqual(['SKILL.md']);
  });

  it('reports a formatter that fails', () => {
    const root = project({ ...files('old();'), 'skillunit.yaml': 'proof:\n  reports: reports/*.xml\n  format: node nope.mjs {file}\n' });
    expect(errors(run(root, { format: 'node nope.mjs {file}' }))[0]).toMatch(/^\.\.\/skillunit\.yaml:3 - error: `proof\.format` failed on a copy of SKILL\.md:\n/);
  });
});

describe('the settings', () => {
  const load = (yaml: string) => {
    const root = project({ 'skillunit.yaml': yaml });
    return { root, config: () => loadConfig(join(root, 'skillunit.yaml')) };
  };

  it('reads proof with its defaults: require on, examples in ./tmp/skill-proof', () => {
    const { root, config } = load('proof:\n  reports: ./reports/junit.xml\n');
    expect(config().proof).toEqual({ reports: ['./reports/junit.xml'], examples: join(root, 'tmp/skill-proof'), sources: [], require: true, cwd: root });
  });

  it('reads every key, a list of reports included', () => {
    const { root, config } = load("proof:\n  reports: [a.xml, 'b/*.xml']\n  examples: out\n  sources: src/**/*.test.ts\n  format: npx prettier --write {file}\n  require: false\n");
    expect(config().proof).toEqual({ reports: ['a.xml', 'b/*.xml'], examples: join(root, 'out'), sources: ['src/**/*.test.ts'], format: 'npx prettier --write {file}', require: false, cwd: root });
  });

  it('rejects a wrong proof key', () => {
    expect(() => load('proof: yes\n').config()).toThrow(/`proof` must be a mapping/);
    expect(() => load('proof:\n  examples: out\n').config()).toThrow(/`proof.reports` is missing/);
    expect(() => load('proof:\n  reports: a.xml\n  report: b.xml\n').config()).toThrow(/unknown key `proof.report` \(allowed: reports, examples, sources, format, require\)/);
    expect(() => load('proof:\n  reports: [a.xml, 3]\n').config()).toThrow(/`proof.reports` must be a glob or a list of globs/);
    expect(() => load('proof:\n  reports: a.xml\n  format: prettier --write\n').config()).toThrow(/`proof.format` must be a command with `\{file\}`/);
    expect(() => load('proof:\n  reports: a.xml\n  require: "no"\n').config()).toThrow(/`proof.require` must be true or false/);
  });
});

describe('skillExample', () => {
  it('writes a value as JSON and a string as text, to the folder of the nearest skillunit.yaml', () => {
    const root = project({ 'skillunit.yaml': 'proof:\n  reports: r.xml\n  examples: out/examples\n', 'pkg/src/.keep': '' });
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(join(root, 'pkg/src'));
    try {
      expect(skillExample('retry-defaults', { retry: 0 })).toBe(join(root, 'out/examples/retry-defaults.json'));
      expect(readFileSync(join(root, 'out/examples/retry-defaults.json'), 'utf8')).toBe('{\n  "retry": 0\n}\n');
      skillExample('retry-defaults.cli', 'npx tinyfetch --retry 0');
      expect(readFileSync(join(root, 'out/examples/retry-defaults.cli.txt'), 'utf8')).toBe('npx tinyfetch --retry 0');
      // A string now: the JSON file of the same id goes, so the block has one source.
      skillExample('retry-defaults', 'text');
      expect(() => readFileSync(join(root, 'out/examples/retry-defaults.json'))).toThrow();
      expect(() => skillExample('../escape', 1)).toThrow(/is not a unit id/);
      expect(() => skillExample('a', undefined)).toThrow(/cannot be written as JSON/);
    } finally {
      cwd.mockRestore();
    }
  });

  it('uses ./tmp/skill-proof without a proof key, and says when there is no skillunit.yaml', () => {
    const root = project({ 'skillunit.yaml': 'skill: .\n' });
    expect(examplesFolder(root)).toBe(join(root, 'tmp/skill-proof'));
    const bare = mkdtempSync(join(tmpdir(), 'skillunit-bare-'));
    roots.push(bare);
    expect(() => examplesFolder(bare)).toThrow(/no skillunit\.yaml in .* or a folder above it/);
  });
});

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { ProofConfig } from '../config.js';
import { loadConfig } from '../config.js';
import { F } from '../lint/testing.js';
import type { Problem } from '../lint/types.js';
import { proof, runProof, traceSkill, type ProofOptions } from './layer.js';

// Region markers built from parts: this file holds no region of its own.
const OPEN = (id: string) => `#${'region'} skill:${id}`;
const CLOSE = `#${'endregion'}`;

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A project: the settings' folder holds `skill-src/`, `skill/`, `tests/` and `tmp/skill-units/`. */
function project(files: Record<string, string | null>): string {
  const root = mkdtempSync(join(tmpdir(), 'skillunit-build-'));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    if (text === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** A record as `unit()` leaves it, declared at `tests/a.test.ts:<line>`. */
const record = (id: string, line: number, more: Record<string, unknown>) =>
  `${JSON.stringify({ skillunit: 1, status: 'passed', id, file: 'tests/a.test.ts', line, test: `t ${id}`, examples: [], ...more }, null, 2)}\n`;
const failed = (id: string, line: number, error: string) => `${JSON.stringify({ skillunit: 1, status: 'failed', id, file: 'tests/a.test.ts', line, test: `t ${id}`, error })}\n`;

const config = (root: string, more: Partial<ProofConfig> = {}): ProofConfig => ({ units: join(root, 'tmp/skill-units'), sources: ['tests/*.test.ts'], cwd: root, ...more });
const run = (root: string, more: Partial<ProofConfig> = {}, options: Partial<ProofOptions> = {}) =>
  proof({ skill: join(root, 'skill'), source: join(root, 'skill-src'), config: config(root, more), configFile: join(root, 'skillunit.yaml'), ...options });

const show = (p: Problem) => `${p.file}:${p.line} ${p.unit ?? '-'} ${p.severity}: ${p.message}${p.origin ? ` [${p.origin.kind} ${p.origin.file}:${p.origin.line}]` : ''}`;
const errors = (r: ReturnType<typeof proof>) => r.problems.filter((p) => p.severity === 'error').map(show);
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');

const SOURCE = `# Demo

A request waits {{value:default-timeout.seconds}} seconds.

| Option | Default |
| --- | --- |
| \`timeout\` | {{ value:default-timeout.ms }} |

${F}ts
tf.get(url, { timeout: {{value:default-timeout.ms}} });
${F}

${F}md
{{unit:not-a-slot-in-a-fence}}
${F}

## Rules

{{unit:default-timeout}}

{{unit:check-status}}

{{unit:one-client-per-api}}

{{unit:by-hand}}
`;

const TEST = `test('x', () => {
  // ${OPEN('check-status')}
  if (isHttpError(error)) return null;
  // ${CLOSE}
  // ${OPEN('one-client-per-api.shared')}
  const api = create({ baseUrl });
  // ${CLOSE}
});
`;

const RECORDS = {
  'tmp/skill-units/default-timeout.0001.json': record('default-timeout', 10, {
    kind: 'fact',
    when: 'the user asks how long a request waits by default.',
    value: '10 seconds (`timeout: 10000`),\n  for every method.',
    unknown: 'say there is no connect timeout.',
    values: { seconds: 10, ms: 10000 },
    examples: [{ lang: 'text', text: 'GET   10 s\nPOST  10 s\n' }],
  }),
  'tmp/skill-units/by-hand.0004.json': record('by-hand', 40, { kind: 'rule', body: false, when: 'calling one API many times.', do: 'reuse one client.' }),
  'tmp/skill-units/check-status.0002.json': record('check-status', 20, { kind: 'rule', when: 'a request failed.', do: 'test the error with `isHttpError` first.', check: 'forbid `/\\.status\\b/` in ts' }),
  'tmp/skill-units/one-client-per-api.0003.json': record('one-client-per-api', 30, {
    kind: 'decision',
    when: 'the code makes several requests to the same API.',
    decide: 'whether to create a client.',
    paths: [
      { path: 'shared', when: 'the requests share a base URL.' },
      { path: 'direct', when: 'one request.' },
    ],
    evenWhen: 'the requests sit in different files.',
  }),
};

const BUILT = `# Demo

A request waits 10 seconds.

| Option | Default |
| --- | --- |
| \`timeout\` | 10000 |

${F}ts
tf.get(url, { timeout: 10000 });
${F}

${F}md
{{unit:not-a-slot-in-a-fence}}
${F}

## Rules

### fact: default-timeout

When: the user asks how long a request waits by default.

Value: 10 seconds (\`timeout: 10000\`), for every method.

${F}text
GET   10 s
POST  10 s
${F}

Unknown: say there is no connect timeout.

### rule: check-status

When: a request failed.

Do: test the error with \`isHttpError\` first.

Right:

${F}ts
if (isHttpError(error)) return null;
${F}

Check: forbid \`/\\.status\\b/\` in ts

### decision: one-client-per-api

When: the code makes several requests to the same API.

Decide: whether to create a client.

- **shared** — the requests share a base URL.

  ${F}ts
  const api = create({ baseUrl });
  ${F}

- **direct** — one request.

Even when: the requests sit in different files.

### rule: by-hand

When: calling one API many times.

Do: reuse one client.
`;

const GOOD = { 'skillunit.yaml': 'skill: ./skill\nsource: ./skill-src\nproof:\n  units: ./tmp/skill-units\n', 'skill-src/SKILL.md': SOURCE, 'skill-src/logo.txt': 'logo\n', 'tests/a.test.ts': TEST, ...RECORDS };

describe('building the skill', () => {
  it('renders each kind, fills values in prose, tables and fenced blocks, and copies other files', () => {
    const root = project(GOOD);
    const r = run(root, {}, { write: true });
    expect(r.problems.map(show)).toEqual([]);
    expect(read(root, 'skill/SKILL.md')).toBe(BUILT);
    expect(read(root, 'skill/logo.txt')).toBe('logo\n');
    expect(r.files).toEqual([
      { file: 'logo.txt', state: 'written' },
      { file: 'SKILL.md', state: 'written' },
    ]);
    expect(r.summary).toEqual({ units: 4, proved: 3, declared: 1, failed: 0, missing: 0, values: 3, files: 2, differ: 0, written: 2, extra: 0 });
    expect(r.units.map((u) => `${u.id} ${u.from} ${u.state} ${u.file}:${u.line} ${u.test ? `${u.test.file}:${u.test.line}` : '-'} ${u.source.file}:${u.source.line}`)).toEqual([
      'default-timeout test passed SKILL.md:19 ../tests/a.test.ts:10 ../skill-src/SKILL.md:19',
      'check-status test passed SKILL.md:32 ../tests/a.test.ts:20 ../skill-src/SKILL.md:21',
      'one-client-per-api test passed SKILL.md:46 ../tests/a.test.ts:30 ../skill-src/SKILL.md:23',
      'by-hand declared passed SKILL.md:62 ../tests/a.test.ts:40 ../skill-src/SKILL.md:25',
    ]);
  });

  it('reads the regions from the test file each record names, with no `proof.sources`', () => {
    const root = project(GOOD);
    const r = run(root, { sources: [] }, { write: true });
    expect(r.problems.map(show)).toEqual([]);
    expect(read(root, 'skill/SKILL.md')).toBe(BUILT);
  });

  it('reads the regions of `proof.sources` too: a file that holds regions and declares no unit', () => {
    const shared = `// ${OPEN('check-status')}\nif (isHttpError(error)) return null;\n// ${CLOSE}\n`;
    const root = project({ ...GOOD, 'tests/a.test.ts': TEST.replace(`  // ${OPEN('check-status')}\n  if (isHttpError(error)) return null;\n  // ${CLOSE}\n`, ''), 'examples/shared.ts': shared });
    expect(read(root, 'tests/a.test.ts')).not.toContain(OPEN('check-status'));
    const r = run(root, { sources: ['examples/*.ts'] }, { write: true });
    expect(r.problems.map(show)).toEqual([]);
    expect(read(root, 'skill/SKILL.md')).toBe(BUILT);
  });

  it('compares the skill folder with the build: the same, after a write', () => {
    const root = project(GOOD);
    run(root, {}, { write: true });
    const r = run(root);
    expect(r.problems.map(show)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.files.map((f) => f.state)).toEqual(['same', 'same']);
    expect(r.run).toEqual({ skipped: 'not-set' });
  });

  it('a skill folder that lacks a file the source builds', () => {
    const root = project(GOOD);
    expect(errors(run(root))).toEqual([
      'logo.txt:1 - error: the skill folder has no `logo.txt`, which `source` builds. Run `skillunit proof --write`',
      'SKILL.md:1 - error: the skill folder has no `SKILL.md`, which `source` builds. Run `skillunit proof --write` [source ../skill-src/SKILL.md:1]',
    ]);
  });
});

describe('a skill folder edited by hand', () => {
  const written = () => {
    const root = project(GOOD);
    run(root, {}, { write: true });
    return root;
  };

  it('a line of a unit from a test: the finding names the test', () => {
    const root = written();
    writeFileSync(join(root, 'skill/SKILL.md'), BUILT.replace('Value: 10 seconds', 'Value: 30 seconds'));
    expect(errors(run(root))).toEqual([
      "SKILL.md:23 default-timeout error: this line is not what the build gives: the build has `Value: 10 seconds ('timeout: 10000'), for every method.`, the skill has `Value: 30 seconds ('timeout: 10000'), for every method.`. Run `skillunit proof --write` to update the skill. To change this text, change where it comes from: the skill folder is built. [test ../tests/a.test.ts:10]",
    ]);
  });

  it('each block that differs gets a finding of its own, with its origin', () => {
    const root = written();
    writeFileSync(join(root, 'skill/SKILL.md'), BUILT.replace('A request waits 10 seconds.', 'A request waits 30 seconds.').replace('Value: 10 seconds', 'Value: 30 seconds'));
    expect(errors(run(root)).map((e) => e.replace(/ error: .* \[/, ' ['))).toEqual(['SKILL.md:3 - [source ../skill-src/SKILL.md:3]', 'SKILL.md:23 default-timeout [test ../tests/a.test.ts:10]']);
  });

  it('a long line that differs past its first 100 characters: each side is shown around the difference, and the JSON keeps both whole', () => {
    const value = 'a failed request is sent again after a wait of 300 ms before the first new attempt, which grows before each next one: doubled.';
    const root = project({ ...GOOD, 'tmp/skill-units/default-timeout.0001.json': record('default-timeout', 10, { kind: 'fact', when: 'x.', value, values: { seconds: 10, ms: 10000 } }) });
    run(root, {}, { write: true });
    const built = read(root, 'skill/SKILL.md');
    writeFileSync(join(root, 'skill/SKILL.md'), built.replace('one: doubled.', 'one: tripled.'));
    const [finding] = run(root).problems;
    const [, build, skill] = /the build has `(.*)`, the skill has `(.*)`\. Run/.exec(finding!.message)!;
    expect(build).not.toBe(skill);
    expect(build).toMatch(/^….*next one: doubled\.$/);
    expect(skill).toMatch(/^….*next one: tripled\.$/);
    expect(finding!.lines).toEqual({ build: `Value: ${value}`, skill: `Value: ${value.replace('doubled', 'tripled')}` });
  });

  it('lines the skill lacks at the end of a unit: blamed on that unit, not the next one', () => {
    const root = written();
    writeFileSync(join(root, 'skill/SKILL.md'), BUILT.replace('Check: forbid `/\\.status\\b/` in ts\n\n', ''));
    const found = run(root).problems;
    expect(found.map(show)).toEqual([
      expect.stringMatching(/^SKILL\.md:\d+ check-status error: .* the build has `Check: forbid '\/\\\.status\\b\/' in ts`, the skill has nothing here\. .* \[test \.\.\/tests\/a\.test\.ts:20\]$/),
    ]);
    expect(found[0]!.lines).toEqual({ build: 'Check: forbid `/\\.status\\b/` in ts', skill: null });
  });

  it('lines the skill lacks at the end of the file: the line reported is in the file, and so is its origin', () => {
    const root = project({ ...GOOD, 'skill-src/SKILL.md': '# Demo\n\nA.\n\nLast line.\n' });
    run(root, {}, { write: true });
    writeFileSync(join(root, 'skill/SKILL.md'), '# Demo\n\nA.\n');
    const [finding] = run(root).problems.filter((p) => p.file === 'SKILL.md');
    expect(finding!.line).toBeLessThanOrEqual(3);
    expect(finding!.origin).toEqual({ kind: 'source', file: '../skill-src/SKILL.md', line: 5 });
  });

  it('an empty line the skill has at its end: the line reported and its origin are lines of their files', () => {
    const root = project({ ...GOOD, 'skill-src/SKILL.md': '# Demo\n\nLast line.\n' });
    run(root, {}, { write: true });
    // Four lines, where the build and the source have three.
    writeFileSync(join(root, 'skill/SKILL.md'), '# Demo\n\nLast line.\n\n');
    const [finding] = run(root).problems.filter((p) => p.file === 'SKILL.md');
    expect(finding!.line).toBeLessThanOrEqual(4);
    expect(finding!.origin).toEqual({ kind: 'source', file: '../skill-src/SKILL.md', line: 3 });
  });

  it('a line of prose: the finding names the source', () => {
    const root = written();
    writeFileSync(join(root, 'skill/SKILL.md'), BUILT.replace('A request waits', 'Every request waits'));
    expect(errors(run(root))).toEqual([
      'SKILL.md:3 - error: this line is not what the build gives: the build has `A request waits 10 seconds.`, the skill has `Every request waits 10 seconds.`. Run `skillunit proof --write` to update the skill. To change this text, change where it comes from: the skill folder is built. [source ../skill-src/SKILL.md:3]',
    ]);
  });

  it('a line added inside a block of a region: the finding names the test', () => {
    const root = written();
    writeFileSync(join(root, 'skill/SKILL.md'), BUILT.replace('if (isHttpError(error)) return null;\n', 'if (isHttpError(error)) return null;\nconsole.log(error);\n'));
    expect(errors(run(root))[0]).toMatch(/^SKILL\.md:42 check-status error: .* the skill has `console\.log\(error\);`\. Run `skillunit proof --write` to update the skill\. .* \[test \.\.\/tests\/a\.test\.ts:2\]$/);
  });

  it('a file that is not Markdown', () => {
    const root = written();
    writeFileSync(join(root, 'skill/logo.txt'), 'other\n');
    expect(errors(run(root))).toEqual(['logo.txt:1 - error: this file is not the one in `source`, which it is copied from: edit skill-src/logo.txt, then run `skillunit proof --write` [source ../skill-src/logo.txt:1]']);
  });

  it('a Markdown file whose name starts with a dot: reported as any file the source does not build; other dot-files are left alone', () => {
    const root = written();
    writeFileSync(join(root, 'skill/.notes.md'), 'tinyfetch retries forever.\n');
    writeFileSync(join(root, 'skill/.DS_Store'), 'x');
    expect(errors(run(root))).toEqual(['.notes.md:1 - error: no file of `source` builds `.notes.md`, and none can: the build leaves out a name that starts with a dot. Remove it from the skill folder']);
  });

  it('a file the source does not build: reported, and left in place by --write', () => {
    const root = written();
    writeFileSync(join(root, 'skill/extra.md'), '# Extra\n');
    expect(errors(run(root))).toEqual(['extra.md:1 - error: no file of `source` builds `extra.md`: move it to skill-src/extra.md, or remove it from the skill folder']);
    const r = run(root, {}, { write: true });
    expect(errors(r)).toEqual(['extra.md:1 - error: no file of `source` builds `extra.md`: move it to skill-src/extra.md, or remove it from the skill folder. `--write` leaves it there']);
    expect(existsSync(join(root, 'skill/extra.md'))).toBe(true);
    expect(r.summary.extra).toBe(1);
  });
});

describe('what the build cannot fill', () => {
  it('a slot with no unit, and why: who ran the tests', () => {
    const { 'tmp/skill-units/check-status.0002.json': _, ...rest } = GOOD;
    const root = project(rest);
    const message = (more: Partial<ProofConfig>, options: Partial<ProofOptions> = {}) => errors(run(root, more, options)).find((e) => e.includes('check-status'));
    expect(message({})).toBe(
      '../skill-src/SKILL.md:21 check-status error: no test left the unit `check-status`: `proof.run` is not set, so the units are those already in `tmp/skill-units`: run the tests first, or set `proof.run`',
    );
    expect(message({ run: 'true' }, { noRun: true })).toBe(
      '../skill-src/SKILL.md:21 check-status error: no test left the unit `check-status`: `--no-run` used the units already in `tmp/skill-units`, and none is this one: run the tests first, or leave out `--no-run`',
    );
    // The run empties the folder and leaves nothing: every slot is missing, and the run did not fail.
    const ran = run(root, { run: 'true' });
    expect(errors(ran)).toContain('../skill-src/SKILL.md:19 default-timeout error: no test left the unit `default-timeout`: its test was skipped or deleted, or did not run');
    expect(ran.run).toMatchObject({ command: 'true', status: 0 });
    expect(ran.summary.missing).toBe(4);
  });

  it('a slot whose test failed: the finding carries the error', () => {
    const root = project({ ...GOOD, 'tmp/skill-units/check-status.0002.json': failed('check-status', 20, 'expected 500 to be 404') });
    const r = run(root);
    expect(errors(r)).toContain('../skill-src/SKILL.md:21 check-status error: the test of `check-status` (tests/a.test.ts:20) failed, so it left no unit: expected 500 to be 404');
    expect(r.units.find((u) => u.id === 'check-status')).toMatchObject({ state: 'failed', error: 'expected 500 to be 404', test: { file: '../tests/a.test.ts', line: 20 } });
    expect(r.files.find((f) => f.file === 'SKILL.md')!.state).toBe('broken');
  });

  it('a value with no value: no unit, or no such name', () => {
    const src = `# Demo\n\n{{value:default-timeout.minutes}} and {{value:gone.seconds}} and {{value:bad}}\n\n## Rules\n\n{{unit:default-timeout}}\n`;
    const root = project({ ...GOOD, 'skill-src/SKILL.md': src, 'tmp/skill-units/check-status.0002.json': null, 'tmp/skill-units/one-client-per-api.0003.json': null });
    expect(errors(run(root)).filter((e) => e.startsWith('../skill-src'))).toEqual([
      `../skill-src/SKILL.md:3 default-timeout error: \`{{value:default-timeout.minutes}}\` has no value: the unit \`default-timeout\` (tests/a.test.ts:10) has no value \`minutes\` (its values: seconds, ms)`,
      '../skill-src/SKILL.md:3 gone error: `{{value:gone.seconds}}` has no value: no test left the unit `gone`; `proof.run` is not set, so the units are those already in `tmp/skill-units`: run the tests first, or set `proof.run`',
      '../skill-src/SKILL.md:3 - error: `{{value:bad}}` needs a unit id, a dot and the name of a value: `{{value:default-timeout.seconds}}`',
    ]);
  });

  it('leaves a placeholder in a sentence about slots as it is', () => {
    const src = `# Demo\n\nPut \`{{unit:<id>}}\` where a unit goes, and \`{{value:<id>.<name>}}\` for a value: {{value:default-timeout.seconds}}.\n\n## Rules\n\n{{unit:default-timeout}}\n`;
    const root = project({ ...GOOD, 'skill-src/SKILL.md': src, 'tmp/skill-units/check-status.0002.json': null, 'tmp/skill-units/one-client-per-api.0003.json': null, 'tmp/skill-units/by-hand.0004.json': null, 'tests/a.test.ts': '' });
    const r = run(root, {}, { write: true });
    expect(errors(r)).toEqual([]);
    expect(read(root, 'skill/SKILL.md')).toContain('Put `{{unit:<id>}}` where a unit goes, and `{{value:<id>.<name>}}` for a value: 10.');
    expect(r.summary.values).toBe(1);
  });

  it('a slot that is not alone on its line, or names no id', () => {
    const src = `# Demo\n\n## Rules\n\nSee {{unit:default-timeout}}.\n\n{{unit:Default}}\n`;
    const root = project({ ...GOOD, 'skill-src/SKILL.md': src });
    expect(errors(run(root)).filter((e) => e.startsWith('../skill-src'))).toEqual([
      '../skill-src/SKILL.md:5 - error: `{{unit:default-timeout}}` goes alone on its line, where the unit goes',
      '../skill-src/SKILL.md:7 - error: `{{unit:Default}}` needs the id of a unit, in kebab-case: `{{unit:default-timeout}}`',
    ]);
  });
});

describe('a unit in two places, or in none', () => {
  it('a test declares a unit and no file of the source has its slot', () => {
    const root = project({ ...GOOD, 'skill-src/SKILL.md': SOURCE.replace('{{unit:check-status}}\n', '') });
    expect(errors(run(root, {}, { write: true }))).toEqual(['../tests/a.test.ts:20 check-status error: this test declares the unit `check-status`, and no file of `source` has `{{unit:check-status}}` where it goes']);
  });

  it('two tests declare the same id', () => {
    const root = project({ ...GOOD, 'tmp/skill-units/check-status.0009.json': record('check-status', 90, { kind: 'rule', when: 'x.', do: 'y.' }) });
    expect(errors(run(root, {}, { write: true }))).toEqual([`../tests/a.test.ts:90 check-status error: the unit \`check-status\` is also declared at tests/a.test.ts:20; two tests cannot declare the same id`]);
  });

  it('a unit heading in the source: an error on its line, and the file is not built', () => {
    const root = project({ ...GOOD, 'skill-src/features.md': '# More\n\n## Rules\n\n### rule: written-here\n\nWhen: calling an API.\n\nDo: reuse one client.\n' });
    const r = run(root, {}, { write: true });
    expect(errors(r)).toEqual(['../skill-src/features.md:5 written-here error: units are declared with `unit()`; put `{{unit:written-here}}` here']);
    expect(r.files.find((f) => f.file === 'features.md')).toEqual({ file: 'features.md', state: 'broken' });
  });

  it('a slot twice', () => {
    const root = project({ ...GOOD, 'skill-src/features.md': '# More\n\n## Rules\n\n{{unit:check-status}}\n' });
    const r = run(root, {}, { write: true });
    expect(errors(r)).toEqual([`../skill-src/features.md:5 check-status error: the slot of \`check-status\` is also at skill-src/SKILL.md:21; a unit goes in one place`]);
    // Neither file is built: which slot is the right one is not known.
    expect(r.files.filter((f) => f.state === 'broken').map((f) => f.file)).toEqual(['features.md', 'SKILL.md']);
  });

  it('a region of a unit no test declares, and a region that names no path of its decision', () => {
    const test = `${TEST}// ${OPEN('nobody')}\nx;\n// ${CLOSE}\n// ${OPEN('one-client-per-api.cache')}\ny;\n// ${CLOSE}\n`;
    const root = project({ ...GOOD, 'tests/a.test.ts': test });
    expect(errors(run(root, {}, { write: true }))).toEqual([
      '../tests/a.test.ts:9 - error: the region `skill:nobody` belongs to no unit a test declares; an example comes from the body of the test of its unit',
      '../tests/a.test.ts:12 one-client-per-api error: the region `skill:one-client-per-api.cache` names no path of the decision `one-client-per-api`; the example of a path is in the region `skill:<id>.<path>` (`skill:one-client-per-api.shared`, `skill:one-client-per-api.direct`)',
    ]);
  });

  it('a record that is not one', () => {
    const root = project({ ...GOOD, 'tmp/skill-units/broken.json': '{ "skillunit": 1,', 'tmp/skill-units/old.json': '{ "skillunit": 2 }' });
    expect(errors(run(root, {}, { write: true }))).toEqual([
      expect.stringMatching(/^\.\.\/tmp\/skill-units\/broken\.json:1 - error: broken\.json: not valid JSON \(/),
      '../tmp/skill-units/old.json:1 - error: old.json: `skillunit` must be 1, the version of the contract this SkillUnit reads; got 2',
    ]);
  });
});

describe('questions in a record', () => {
  const rule = (ask: unknown) => record('check-status', 20, { kind: 'rule', when: 'a request failed.', do: 'test the error with `isHttpError` first.', check: 'forbid `/\\.status\\b/` in ts', ask });
  const question = { scenario: 'A request failed.', question: 'What does the agent test first?', options: { helper: 'isHttpError', status: 'the status' }, expect: 'helper' };

  it('leave the built skill as it is', () => {
    const root = project({ ...GOOD, 'tmp/skill-units/check-status.0002.json': rule([{ id: 'check-status', ...question }, question]) });
    const r = run(root, {}, { write: true });
    expect(errors(r)).toEqual([]);
    expect(read(root, 'skill/SKILL.md')).toBe(BUILT);
  });

  it('a unit with no body builds as any unit, with its example from a region of its file', () => {
    const root = project({ ...GOOD, 'tmp/skill-units/check-status.0002.json': record('check-status', 20, { kind: 'rule', body: false, when: 'a request failed.', do: 'test the error with `isHttpError` first.', check: 'forbid `/\\.status\\b/` in ts' }) });
    const r = run(root, {}, { write: true });
    expect(errors(r)).toEqual([]);
    expect(r.units.find((u) => u.id === 'check-status')).toMatchObject({ from: 'declared', state: 'passed' });
    expect(r.summary).toMatchObject({ proved: 2, declared: 2 });
    expect(read(root, 'skill/SKILL.md')).toBe(BUILT);
  });

  it('the record of `ask()` is no unit: the build does not change', () => {
    const asked = `${JSON.stringify({ skillunit: 1, status: 'passed', kind: 'question', id: 'which-file', file: 'tests/a.test.ts', line: 40, test: 'question which-file: Which?', skillFile: 'SKILL.md', ask: [{ id: 'which-file', ...question }] })}\n`;
    const root = project({ ...GOOD, 'tmp/skill-units/which-file.0009.json': asked });
    const r = run(root, {}, { write: true });
    expect(errors(r)).toEqual([]);
    expect(read(root, 'skill/SKILL.md')).toBe(BUILT);
  });

  it('a record of `ask()` with a mistake is one that is not valid', () => {
    const asked = (more: object) => `${JSON.stringify({ skillunit: 1, status: 'passed', kind: 'question', id: 'which-file', file: 'tests/a.test.ts', line: 40, test: 't', skillFile: 'SKILL.md', ask: [{ id: 'which-file', ...question }], ...more })}\n`;
    const root = project({
      ...GOOD,
      'tmp/skill-units/a.json': asked({ skillFile: '' }),
      'tmp/skill-units/b.json': asked({ ask: [{ id: 'other', ...question }] }),
      'tmp/skill-units/c.json': asked({ when: 'x.' }),
    });
    expect(errors(run(root, {}, { write: true }))).toEqual([
      '../tmp/skill-units/a.json:1 - error: a.json: `skillFile` must be the built file the question is about, such as `SKILL.md` [test ../tests/a.test.ts:40]',
      '../tmp/skill-units/b.json:1 - error: b.json: the question in `ask` has the id `other`, and the record `which-file` [test ../tests/a.test.ts:40]',
      '../tmp/skill-units/c.json:1 - error: c.json: a question has no `when` [test ../tests/a.test.ts:40]',
    ]);
  });

  it('a question with a mistake makes the record one that is not valid, and the finding names the test the record says it comes from', () => {
    const root = project({ ...GOOD, 'tmp/skill-units/check-status.0002.json': rule({ ...question, expect: 'status-code' }) });
    const r = run(root, {}, { write: true });
    expect(errors(r)).toContainEqual(
      '../tmp/skill-units/check-status.0002.json:1 check-status error: check-status.0002.json: unit `check-status`: the question `check-status`: `expect` is "status-code", which is not an option (use one of: helper, status, none) [test ../tests/a.test.ts:20]',
    );
    expect(r.problems.find((p) => p.file.endsWith('.json'))!.origin).toEqual({ kind: 'test', file: '../tests/a.test.ts', line: 20, unit: 'check-status' });
  });
});

describe('proof.run', () => {
  /** A script that writes the records of GOOD, as the tests would, then exits with `code`. */
  const script = (code: number) => `import { mkdirSync, writeFileSync } from 'node:fs';
const records = ${JSON.stringify(RECORDS)};
mkdirSync('tmp/skill-units', { recursive: true });
for (const [path, text] of Object.entries(records)) writeFileSync(path, text);
console.log('ran the tests');
process.exit(${code});
`;

  it('empties the records of an earlier run, runs the command from the settings folder, and builds from what it left', () => {
    const root = project({ ...GOOD, 'run.mjs': script(0), 'tmp/skill-units/stale.0000.json': record('stale', 1, { kind: 'rule', when: 'x.', do: 'y.' }), 'tmp/skill-units/keep.txt': 'not a record' });
    const r = run(root, { run: 'node run.mjs' }, { write: true });
    expect(r.problems.map(show)).toEqual([]);
    expect(r.run).toMatchObject({ command: 'node run.mjs', status: 0, ms: expect.any(Number) });
    expect(readdirSync(join(root, 'tmp/skill-units')).sort()).toEqual(['by-hand.0004.json', 'check-status.0002.json', 'default-timeout.0001.json', 'keep.txt', 'one-client-per-api.0003.json']);
    expect(read(root, 'skill/SKILL.md')).toBe(BUILT);
  });

  it('a run that exits with 1 and left every unit: one error, on `proof.run`, with the end of its output', () => {
    const root = project({ ...GOOD, 'run.mjs': script(1) });
    const r = run(root, { run: 'node run.mjs' }, { write: true });
    expect(errors(r)).toEqual(['../skillunit.yaml:3 - error: `proof.run` (`node run.mjs`) exited with 1: a test failed, or the run did. The end of its output:\nran the tests']);
    expect(r.ok).toBe(false);
    // The build goes on: every unit is there, from its test.
    expect(r.units.filter((u) => u.from === 'test').map((u) => u.state)).toEqual(['passed', 'passed', 'passed']);
    expect(read(root, 'skill/SKILL.md')).toBe(BUILT);
  });

  it('a run that exits with 1 and left a failed unit: the unit and the run are both reported', () => {
    const failing = `${script(1).replace("process.exit(1);", '')}writeFileSync('tmp/skill-units/check-status.0002.json', ${JSON.stringify(failed('check-status', 20, 'expected 500 to be 404'))});\nprocess.exit(1);\n`;
    const root = project({ ...GOOD, 'run.mjs': failing });
    const r = run(root, { run: 'node run.mjs' }, { write: true });
    expect(errors(r).map((e) => e.replace(/: .*/s, ''))).toEqual(['../skill-src/SKILL.md:21 check-status error', '../skillunit.yaml:3 - error']);
    expect(errors(r)[0]).toContain('expected 500 to be 404');
    expect(errors(r)[1]).toContain('`proof.run` (`node run.mjs`) exited with 1: a test failed, or the run did');
  });

  it('a run that exits with 0 adds nothing', () => {
    const root = project({ ...GOOD, 'run.mjs': script(0) });
    expect(run(root, { run: 'node run.mjs' }, { write: true }).problems.map(show)).toEqual([]);
  });

  it('a command that left no unit and failed: one error, with the end of its output', () => {
    const root = project({ ...GOOD, 'skillunit.yaml': 'skill: ./skill\nsource: ./skill-src\nproof:\n  run: "no-such-command-here --run"\n' });
    const r = run(root, { run: 'no-such-command-here --run' });
    const findings = r.problems.filter((p) => p.file === '../skillunit.yaml');
    expect(findings).toHaveLength(1);
    expect(findings[0]!.line).toBe(4);
    expect(findings[0]!.message).toMatch(/^`proof\.run` \(`no-such-command-here --run`\) exited with 127 and left no unit in `tmp\/skill-units`\. The end of its output:\n.*no-such-command-here.*not found/s);
    expect(errors(r)).toContain('../skill-src/SKILL.md:19 default-timeout error: no test left the unit `default-timeout`: the tests did not run; see `proof.run`');
  });

  it('a run that does not finish says so', () => {
    const root = project({ ...GOOD, 'run.mjs': `${script(0).replace('process.exit(0);', "process.kill(process.pid, 'SIGTERM');")}` });
    const message = errors(run(root, { run: 'node run.mjs' }))[0]!;
    expect(message).toMatch(/`proof\.run` \(`node run\.mjs`\) (did not finish \(SIGTERM\)|exited with 143): a test failed, or the run did/);
  });

  it('--no-run uses the units that are there, and a run that does not happen cannot fail', () => {
    const root = project({ ...GOOD });
    const r = run(root, { run: 'exit 3' }, { noRun: true, write: true });
    expect(r.problems.map(show)).toEqual([]);
    expect(r.run).toEqual({ skipped: 'no-run' });
    expect(run(root, {}, { write: true }).run).toEqual({ skipped: 'not-set' });
    expect(run(root, {}, { write: true }).ok).toBe(true);
  });
});

describe('format', () => {
  // A formatter that inserts a line after the heading and drops the blank line before `Right:`.
  const FMT = `import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const files = process.argv.slice(2);
appendFileSync('runs.txt', files.length + '\\n');
// A file that says BAD fails the run, as a formatter fails on what it cannot parse.
const bad = files.find((f) => readFileSync(f, 'utf8').includes('BAD'));
if (bad) { console.error(bad + ': cannot format'); process.exit(2); }
for (const f of files) writeFileSync(f, readFileSync(f, 'utf8').replace('# Demo\\n', '# Demo\\n\\n<!-- built -->\\n').replace('\\n\\nRight:', '\\nRight:'));
`;

  it('runs on each built Markdown file, and the skill is compared as it leaves them', () => {
    const root = project({ ...GOOD, 'fmt.mjs': FMT });
    const r = run(root, { format: 'node fmt.mjs {file}' }, { write: true });
    expect(r.problems.map(show)).toEqual([]);
    const text = read(root, 'skill/SKILL.md');
    expect(text).toContain('<!-- built -->');
    expect(run(root, { format: 'node fmt.mjs {file}' }).ok).toBe(true);
    // No copy left next to the file.
    expect(readdirSync(join(root, 'skill')).sort()).toEqual(['SKILL.md', 'logo.txt']);
  });

  it('runs once, with every built Markdown file in place of {file}', () => {
    const root = project({ ...GOOD, 'fmt.mjs': FMT, 'skill-src/features/other.md': '# Demo\n\nOther.\n', 'skill-src/third.md': '# Demo\n\nThird.\n' });
    const r = run(root, { format: 'node fmt.mjs {file}' }, { write: true });
    expect(r.problems.map(show)).toEqual([]);
    expect(read(root, 'runs.txt')).toBe('3\n');
    for (const f of ['skill/SKILL.md', 'skill/features/other.md', 'skill/third.md']) expect(read(root, f)).toContain('<!-- built -->');
  });

  it('when the one run fails, runs once per file, so the error names the file it failed on and the others are formatted', () => {
    const root = project({ ...GOOD, 'fmt.mjs': FMT, 'skill-src/features/other.md': '# Demo\n\nBAD.\n', 'skill-src/third.md': '# Demo\n\nThird.\n' });
    const r = run(root, { format: 'node fmt.mjs {file}' }, { write: true });
    expect(errors(r)).toEqual([expect.stringMatching(/^\.\.\/skillunit\.yaml:\d+ - error: `proof\.format` failed on the build of features\/other\.md:\n.*features\/other\.md: cannot format$/)]);
    expect(read(root, 'runs.txt')).toBe('3\n1\n1\n1\n');
    expect(read(root, 'skill/third.md')).toContain('<!-- built -->');
  });

  it('traces a line through the formatter: the lines it moved still have their origin', () => {
    const root = project({ ...GOOD, 'fmt.mjs': FMT });
    run(root, { format: 'node fmt.mjs {file}' }, { write: true });
    writeFileSync(join(root, 'skill/SKILL.md'), read(root, 'skill/SKILL.md').replace('Do: test the error', 'Do: check the error'));
    expect(errors(run(root, { format: 'node fmt.mjs {file}' }))[0]).toMatch(/^SKILL\.md:38 check-status error: .* \[test \.\.\/tests\/a\.test\.ts:20\]$/);
  });

  it('a formatter that fails is reported, and the build is compared unformatted', () => {
    const root = project({ ...GOOD });
    const r = run(root, { format: 'exit 2 # {file}' });
    expect(errors(r)[0]).toBe('../skillunit.yaml:3 - error: `proof.format` failed on the build of SKILL.md:\nexit 2');
  });
});

describe('where a line comes from, for lint and the model tests', () => {
  it('traces the skill folder as it is, from the units already left, without running anything', () => {
    const root = project({ ...GOOD, 'skillunit.yaml': 'skill: ./skill\nsource: ./skill-src\nproof:\n  run: "exit 9"\n' });
    run(root, {}, { write: true });
    const origin = traceSkill({ skill: join(root, 'skill'), source: join(root, 'skill-src'), config: config(root, { run: 'exit 9' }) });
    expect(origin('SKILL.md', 3)).toEqual({ kind: 'source', file: '../skill-src/SKILL.md', line: 3 });
    expect(origin('SKILL.md', 23)).toEqual({ kind: 'test', file: '../tests/a.test.ts', line: 10, unit: 'default-timeout' });
    expect(origin('SKILL.md', 41)).toEqual({ kind: 'test', file: '../tests/a.test.ts', line: 2, unit: 'check-status' });
    expect(origin('logo.txt', 1)).toBeUndefined();
    expect(origin('nothing.md', 1)).toBeUndefined();
  });

  it('runProof gives the same lookup with the result', () => {
    const root = project(GOOD);
    const { result, origin } = runProof({ skill: join(root, 'skill'), source: join(root, 'skill-src'), config: config(root), write: true });
    expect(result.ok).toBe(true);
    expect(origin('SKILL.md', 3)).toEqual({ kind: 'source', file: '../skill-src/SKILL.md', line: 3 });
    expect(origin('SKILL.md', 66)).toEqual({ kind: 'test', file: '../tests/a.test.ts', line: 40, unit: 'by-hand' });
  });
});

describe('the settings', () => {
  const load = (yaml: string) => {
    const root = project({ 'skillunit.yaml': yaml });
    return { root, config: () => loadConfig(join(root, 'skillunit.yaml')) };
  };

  it('a source gives a proof layer with its defaults: units in ./tmp/skill-units', () => {
    const { root, config } = load('skill: ./skill\nsource: ./skill-src\n');
    expect(config().source).toBe(join(root, 'skill-src'));
    expect(config().proof).toEqual({ units: join(root, 'tmp/skill-units'), sources: [], cwd: root });
  });

  it('reads every key', () => {
    const { root, config } = load("skill: ./skill\nsource: ./src\nproof:\n  run: npx vitest run\n  units: out\n  sources: ['a/*.ts', b.ts]\n  format: npx prettier --write {file}\n");
    expect(config().proof).toEqual({ run: 'npx vitest run', units: join(root, 'out'), sources: ['a/*.ts', 'b.ts'], format: 'npx prettier --write {file}', cwd: root });
  });

  it('no source, no proof layer', () => {
    expect(load('skill: ./skill\n').config().proof).toBeUndefined();
  });

  it('rejects a wrong key', () => {
    const fails = (yaml: string) => () => load(yaml).config();
    expect(fails('proof:\n  run: x\n')).toThrow(/`proof` says how the skill is built from `source`; set `source` too/);
    expect(fails('skill: ./skill\nsource: ./src\nproof:\n  runs: x\n')).toThrow(/unknown key `proof.runs` \(allowed: run, units, sources, format\)/);
    expect(fails('skill: ./skill\nsource: ./src\nproof:\n  run: ""\n')).toThrow(/`proof.run` must be a command/);
    expect(fails('skill: ./skill\nsource: ./src\nproof:\n  units: ""\n')).toThrow(/`proof.units` must be a folder/);
    expect(fails('skill: ./skill\nsource: ./src\nproof:\n  format: prettier --write\n')).toThrow(/`proof.format` must be a command with `\{file\}`/);
    expect(fails('skill: ./skill\nsource: ./skill\n')).toThrow(/`source` and `skill` are two folders, neither inside the other/);
    expect(fails('skill: ./skill\nsource: ./skill/src\n')).toThrow(/neither inside the other/);
    expect(fails('source: 3\n')).toThrow(/`source` must be a path/);
  });
});

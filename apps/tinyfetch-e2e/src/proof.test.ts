/**
 * The proof on a copy of tinyfetch, message by message: what someone reads when the skill no
 * longer matches its tests, and the build that fixes it. The scenarios check which units are
 * reported; these check what is said about them.
 */
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { App, CLI, type Run } from './app.js';

afterAll(() => App.removeAll());

const REQUESTS = 'src/skill/requests.test.ts';
const RETRIES = 'src/skill/retries.test.ts';
const TIMEOUTS = 'src/skill/timeouts.test.ts';
const errors = (run: Run) => (run.report.proof.problems as any[]).filter((p) => p.severity === 'error');
const lineOf = (text: string, needle: string) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;

describe('the proof of tinyfetch', () => {
  it('the agents\' case: a changed default fails check on the unit, with both texts and the test, until a build', () => {
    const app = App.copy('default');
    app.edit('src/timeout.ts', 'export const DEFAULT_TIMEOUT = 10_000;', 'export const DEFAULT_TIMEOUT = 5_000;');
    const check = app.run('check', '--dry-run');
    expect(check.code).toBe(1);
    const unit = errors(check).find((p) => p.unit === 'default-timeout');
    expect(unit.message).toMatch(/^this line is not what the build gives: the build has `Value: the request waits 5 seconds \('timeout: 5_000'\), .*`, the skill has `Value: the request waits 10 seconds \('timeout: 10_000'\), .*`\. Run `skillunit proof --write` to update the skill\./);
    expect(unit.lines.skill).toBe(unit.lines.build.replace('5 seconds', '10 seconds').replace('5_000', '10_000'));
    expect(unit.origin).toEqual({ kind: 'test', file: `../${TIMEOUTS}`, line: lineOf(app.read(TIMEOUTS), "'default-timeout',") - 1, unit: 'default-timeout' });
    expect(errors(check)).toHaveLength(1);

    const write = app.run('proof', '--write');
    expect(write.code).toBe(0);
    expect(write.report.proof.files.filter((f: any) => f.state === 'written').map((f: any) => f.file)).toEqual(['features/timeouts.md']);
    expect(app.read('skill/features/timeouts.md')).toContain('Value: the request waits 5 seconds (`timeout: 5_000`), whatever its method');
    expect(app.run('check', '--dry-run').code).toBe(0);
  });

  it('the last lines of a unit gone from skill/: the finding is on that unit, not on the next one', () => {
    const app = App.copy('lacks-end');
    const lines = app.read('skill/features/requests.md').split('\n');
    const unit = lines.indexOf('### rule: send-a-body');
    const right = lines.indexOf('Right:', unit);
    const next = lines.indexOf('### fact: content-type');
    // `Right:` and its block, up to the heading of the next unit.
    app.write('skill/features/requests.md', [...lines.slice(0, right), ...lines.slice(next)].join('\n'));
    const found = errors(app.run('proof'));
    expect(found.map((p) => p.unit)).toEqual(['send-a-body']);
    expect(found[0].origin).toEqual({ kind: 'test', file: `../${REQUESTS}`, line: lineOf(app.read(REQUESTS), "'send-a-body',") - 1, unit: 'send-a-body' });
    expect(found[0].message).toMatch(/^this line is not what the build gives: the build has `Right:`, the skill has nothing here\./);
    expect(found[0].lines).toEqual({ build: 'Right:', skill: null });
  });

  it('a long line that differs at its end: the message shows both ends, and the JSON both lines', () => {
    const app = App.copy('long-line');
    app.edit('skill/features/retries.md', 'before each next one 2x the wait before it.', 'before each next one 3x the wait before it.');
    const [finding] = errors(app.run('proof'));
    expect(finding.unit).toBe('retry-delay');
    expect(finding.message).toMatch(/the build has `….*before each next one 2x the wait before it\.`, the skill has `….*before each next one 3x the wait before it\.`\./);
    expect(finding.lines.skill).toBe(finding.lines.build.replace('2x', '3x'));
  });

  it('the build takes every region example from the test files the records name, and writes nothing', () => {
    const app = App.copy('regions');
    const write = app.run('proof', '--write');
    expect(write.code).toBe(0);
    expect(write.report.proof.files.filter((f: any) => f.state !== 'same')).toEqual([]);
    expect(app.read('skill/features/errors.md')).toContain('if (isHttpError(error) && error.status === 404)');
    expect(app.run('check', '--dry-run').code).toBe(0);
  });

  it('a unit edited in skill/ by hand: the finding names the test to edit', () => {
    const app = App.copy('by-hand');
    app.edit('skill/features/timeouts.md', 'waits 10 seconds', 'waits 30 seconds');
    const proof = app.run('proof');
    const [finding] = errors(proof);
    expect(finding).toMatchObject({ unit: 'default-timeout', origin: { kind: 'test', file: `../${TIMEOUTS}` } });
  });

  it('a body that fails: the finding is on the test, carries the assertion, and the run fails too', () => {
    const app = App.copy('failing-body');
    app.edit(REQUESTS, "expect(calls[0]!.init.body).toBe(JSON.stringify({ name: 'Ada' }));", "expect(calls[0]!.init.body).toBe(JSON.stringify({ name: 'Bob' }));");
    const found = errors(app.run('proof'));
    expect(found.map((p) => p.file).sort()).toEqual(['../skillunit.yaml', `../${REQUESTS}`]);
    const finding = found.find((p) => p.unit === 'send-a-body');
    expect(finding.line).toBe(lineOf(app.read(REQUESTS), "'send-a-body',") - 1);
    expect(finding.message).toMatch(/^the test of `send-a-body` \(src\/skill\/requests\.test\.ts:\d+\) failed, so it left no unit: expected '\{"name":"Ada"\}' to be '\{"name":"Bob"\}'/);
  });

  it('a skipped test: its unit leaves the build, and the proof names the unit the skill still has', () => {
    const app = App.copy('gone');
    app.edit(REQUESTS, "  unit(\n    'response-value',", "  unit.skip(\n    'response-value',");
    const [finding, ...rest] = errors(app.run('proof'));
    expect(rest).toEqual([]);
    expect(finding).toMatchObject({
      file: 'features/requests.md',
      line: lineOf(app.read('skill/features/requests.md'), '### fact: response-value'),
      unit: 'response-value',
      message: 'the skill has the unit `response-value`, and no test declares it: its test was skipped or deleted, or did not run. Run `skillunit proof --write` to take it out of the skill',
    });
  });

  it('proof.run with a command that does not exist: the end of its output, and every file of the skill without its setup()', () => {
    const app = App.copy('no-command');
    app.edit('skillunit.yaml', 'run: "npx vitest run"', 'run: "no-such-test-runner run"');
    const proof = app.run('proof');
    expect(proof.code).toBe(1);
    expect(proof.report.proof.run).toMatchObject({ command: 'no-such-test-runner run', status: 127 });
    const settings = errors(proof).find((p) => p.file === '../skillunit.yaml');
    expect(settings.message).toMatch(/^`proof\.run` \(`no-such-test-runner run`\) exited with 127 and left no unit in `tmp\/skill-units`\. The end of its output:\n.*no-such-test-runner/s);
    // One error for the run, not two.
    expect(errors(proof).filter((p) => p.file === '../skillunit.yaml')).toHaveLength(1);
    expect(errors(proof).filter((p) => p.message.startsWith('no `setup()` declares')).map((p) => p.file).sort()).toEqual([
      'SKILL.md',
      'features/clients.md',
      'features/errors.md',
      'features/requests.md',
      'features/retries.md',
      'features/timeouts.md',
    ]);
  });

  it('an ordinary test that fails: check fails on proof.run, names the test, and every unit still comes from its test', () => {
    const app = App.copy('red-run');
    app.edit(TIMEOUTS, "  unit(\n    'cancel-with-signal',", "  it('fails on purpose', () => {\n    expect(1).toBe(2);\n  });\n\n  unit(\n    'cancel-with-signal',");
    app.edit(TIMEOUTS, "import { afterEach, describe, expect, vi } from 'vitest';", "import { afterEach, describe, expect, it, vi } from 'vitest';");
    const check = app.run('check', '--dry-run');
    expect(check.code).toBe(1);
    const found = errors(check);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: '../skillunit.yaml', line: lineOf(app.read('skillunit.yaml'), 'run:') });
    expect(found[0].message).toMatch(/^`proof\.run` \(`npx vitest run`\) exited with 1: a test failed, or the run did\. The end of its output:\n.*fails on purpose/s);
    expect(check.report.proof.units.filter((u: any) => u.from === 'test').every((u: any) => u.state === 'passed')).toBe(true);
  });

  it('a question whose `expect` names no option: the test of its unit fails and says why', () => {
    const app = App.copy('bad-expect');
    app.edit(RETRIES, "once: 'Once: tinyfetch does not retry a 429',", "single: 'Once: tinyfetch does not retry a 429',");
    const finding = errors(app.run('proof')).find((p) => p.unit === 'what-is-retried' && p.message.startsWith('the test of'));
    expect(finding.message).toMatch(
      /^the test of `what-is-retried` \(src\/skill\/retries\.test\.ts:\d+\) failed, so it left no unit: unit `what-is-retried`: the question `retry-on-429`: `expect` is "once", which is not an option \(use one of: single, four, until, none\)$/,
    );
  });

  it('a unit with no body reads as declared with no test, and never as proved', () => {
    const app = App.copy('declared');
    const proof = app.run('proof');
    const declared = (proof.report.proof.units as any[]).filter((u) => u.from === 'declared').map((u) => u.id);
    expect(declared).toEqual(['retry-idempotent-only', 'never-disable-timeout']);
    expect(proof.report.proof.summary).toMatchObject({ units: 24, proved: 22, declared: 2 });
    const table = spawnSync(process.execPath, [CLI, 'proof'], { cwd: app.root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } }).stdout;
    expect(table).toContain(`never-disable-timeout  rule\n      proof  – declared, no test, ${TIMEOUTS}:`);
    expect(table).not.toContain(`proved by a test, ${TIMEOUTS}:${lineOf(app.read(TIMEOUTS), "unit('never-disable-timeout'")}`);
    expect(table).toContain('24 units · 22 proved by a test · 2 declared without one');
  });

  it('check --dry-run with no key: every question is ready, and nothing is sent', () => {
    const app = App.copy('no-key');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.endsWith('_API_KEY')));
    const run = spawnSync(process.execPath, [CLI, 'check', '--dry-run', '--json'], { cwd: app.root, encoding: 'utf8', env });
    expect(run.status).toBe(0);
    const test = JSON.parse(run.stdout).test;
    expect(test.summary).toMatchObject({ tests: 9, passed: 9, usage: { input_tokens: 0, output_tokens: 0 } });
    expect(test.requests.flatMap((r: any) => r.verdicts).every((v: any) => v.answer === '(dry run)' && v.declared)).toBe(true);
    expect(test.problems).toEqual([]);
  });

  it('--no-run uses the units an earlier run left', () => {
    const app = App.copy('no-run');
    expect(app.run('proof').code).toBe(0);
    app.edit('skillunit.yaml', 'run: "npx vitest run"', 'run: "exit 1"');
    const proof = app.run('proof', '--no-run');
    expect(proof.code).toBe(0);
    expect(proof.report.proof.run).toEqual({ skipped: 'no-run' });
  });
});

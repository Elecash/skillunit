/**
 * The proof on a copy of tinyfetch, message by message: what someone reads when the skill no
 * longer matches its tests, and the build that fixes it. The scenarios check which units are
 * reported; these check what is said about them.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { App, type Run } from './app.js';

afterAll(() => App.removeAll());

const TEST = 'src/tinyfetch.test.ts';
const errors = (run: Run) => (run.report.proof.problems as any[]).filter((p) => p.severity === 'error');
const lineOf = (text: string, needle: string) => text.split('\n').findIndex((l) => l.includes(needle)) + 1;

describe('the proof of tinyfetch', () => {
  it('the agents\' case: a changed default fails check on the unit, with both texts and the test, until a build', () => {
    const app = App.copy('default');
    app.edit('src/timeout.ts', 'export const DEFAULT_TIMEOUT = 10_000;', 'export const DEFAULT_TIMEOUT = 5_000;');
    const check = app.run('check', '--dry-run');
    expect(check.code).toBe(1);
    const unit = errors(check).find((p) => p.unit === 'default-timeout');
    expect(unit.message).toBe(
      "this line is not what the build gives: the build has `Value: 5 seconds ('timeout: 5_000'), for every method.`, the skill has `Value: 10 seconds ('timeout: 10_000'), for every method.`. The skill is built: edit the file this line comes from, then run `skillunit proof --write`",
    );
    expect(unit.origin).toEqual({ kind: 'test', file: `../${TEST}`, line: lineOf(app.read(TEST), "'default-timeout',") - 1, unit: 'default-timeout' });
    const table = errors(check).find((p) => !p.unit);
    expect(table).toMatchObject({ file: 'features/timeouts.md', origin: { kind: 'source', file: '../skill-src/features/timeouts.md' } });

    const write = app.run('proof', '--write');
    expect(write.code).toBe(0);
    expect(write.report.proof.files.filter((f: any) => f.state === 'written').map((f: any) => f.file)).toEqual(['features/timeouts.md']);
    expect(app.read('skill/features/timeouts.md')).toContain('Value: 5 seconds (`timeout: 5_000`), for every method.');
    expect(app.run('check', '--dry-run').code).toBe(0);
  });

  it('a unit edited in skill/ by hand: the finding names the test to edit', () => {
    const app = App.copy('by-hand');
    app.edit('skill/features/timeouts.md', 'Value: 10 seconds', 'Value: 30 seconds');
    const proof = app.run('proof');
    const [finding] = errors(proof);
    expect(finding).toMatchObject({ unit: 'default-timeout', origin: { kind: 'test', file: `../${TEST}` } });
  });

  it('a body that fails: the slot has no unit, and the finding carries the assertion', () => {
    const app = App.copy('failing-body');
    app.edit(TEST, `body: '{"name":"Ada"}'`, `body: '{"name":"Bob"}'`);
    const [finding] = errors(app.run('proof'));
    expect(finding.file).toBe('../skill-src/features/requests.md');
    expect(finding.message).toMatch(/^the test of `body-as-object` \(src\/tinyfetch\.test\.ts:\d+\) failed, so it left no unit: expected \{ method: 'POST', .* to match object /);
  });

  it('a deleted test and a skipped one: no test left the unit', () => {
    const app = App.copy('gone');
    app.edit(TEST, "  unit(\n    'response-body',", "  unit.skip(\n    'response-body',");
    const [finding] = errors(app.run('proof'));
    expect(finding).toMatchObject({ unit: 'response-body', message: 'no test left the unit `response-body`: its test was skipped or deleted, or did not run' });
  });

  it('proof.run with a command that does not exist: the end of its output, and every slot without its unit', () => {
    const app = App.copy('no-command');
    app.edit('skillunit.yaml', 'run: "npx vitest run"', 'run: "no-such-test-runner run"');
    const proof = app.run('proof');
    expect(proof.code).toBe(1);
    expect(proof.report.proof.run).toMatchObject({ command: 'no-such-test-runner run', status: 127 });
    const settings = errors(proof).find((p) => p.file === '../skillunit.yaml');
    expect(settings.message).toMatch(/^`proof\.run` exited with 127 and left no unit in `tmp\/skill-units`\. The end of its output:\n.*no-such-test-runner/s);
    expect(errors(proof).filter((p) => p.message.startsWith('no test left the unit')).map((p) => p.unit).sort()).toEqual([
      'await-every-request',
      'body-as-object',
      'check-with-is-http-error',
      'default-timeout',
      'query-in-options',
      'response-body',
      'retry-defaults',
      'what-a-failed-request-throws',
      'what-is-retried',
    ]);
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

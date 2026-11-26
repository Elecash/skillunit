/**
 * The proof on a copy of tinyfetch, message by message: what someone reads when the skill no
 * longer matches its tests, and the build that fixes it. The scenarios check which units are
 * reported; these check what is said about them.
 */
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { App, CLI, type Run } from './app.js';

afterAll(() => App.removeAll());

const TEST = 'src/tinyfetch.test.ts';
const DECLARED = 'src/tinyfetch.skill.test.ts';
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
      "this line is not what the build gives: the build has `Value: 5 seconds ('timeout: 5_000'), for every method.`, the skill has `Value: 10 seconds ('timeout: 10_000'), for every method.`. Run `skillunit proof --write` to update the skill. To change this text, change where it comes from: the skill folder is built.",
    );
    expect(unit.origin).toEqual({ kind: 'test', file: `../${TEST}`, line: lineOf(app.read(TEST), "'default-timeout',") - 1, unit: 'default-timeout' });
    // The table's columns are padded again; the row with the value is the one reported.
    const table = errors(check).find((p) => !p.unit);
    expect(table).toMatchObject({ file: 'features/timeouts.md', line: lineOf(app.read('skill/features/timeouts.md'), '| `timeout`'), origin: { kind: 'source', file: '../skill-src/features/timeouts.md' } });
    expect(table.message).toMatch(/^this line is not what the build gives: the build has `\| 'timeout' +\| number \(ms\) \| '5_000' /);

    const write = app.run('proof', '--write');
    expect(write.code).toBe(0);
    expect(write.report.proof.files.filter((f: any) => f.state === 'written').map((f: any) => f.file)).toEqual(['features/timeouts.md']);
    expect(app.read('skill/features/timeouts.md')).toContain('Value: 5 seconds (`timeout: 5_000`), for every method.');
    expect(app.run('check', '--dry-run').code).toBe(0);
  });

  it('the last lines of a unit gone from skill/: the finding is on that unit, not on the next one', () => {
    const app = App.copy('lacks-end');
    const lines = app.read('skill/features/requests.md').split('\n');
    const unit = lines.indexOf('### rule: query-in-options');
    const right = lines.indexOf('Right:', unit);
    const next = lines.indexOf('### rule: body-as-object');
    // `Right:`, its block and the `Check:`, up to the heading of the next unit.
    app.write('skill/features/requests.md', [...lines.slice(0, right), ...lines.slice(next)].join('\n'));
    const found = errors(app.run('proof'));
    expect(found.map((p) => p.unit)).toEqual(['query-in-options']);
    expect(found[0].origin).toEqual({ kind: 'test', file: `../${TEST}`, line: lineOf(app.read(TEST), "'query-in-options',") - 1, unit: 'query-in-options' });
    expect(found[0].message).toMatch(/^this line is not what the build gives: the build has `Right:`, the skill has nothing here\./);
    expect(found[0].lines).toEqual({ build: 'Right:', skill: null });
  });

  it('a long line that differs at its end: the message shows both ends, and the JSON both lines', () => {
    const app = App.copy('long-line');
    app.edit('skill/features/retries.md', 'each next wait is 2x the one before.', 'each next wait is 3x the one before.');
    const [finding] = errors(app.run('proof'));
    expect(finding.unit).toBe('retry-defaults');
    expect(finding.message).toMatch(/the build has `….*each next wait is 2x the one before\.`, the skill has `….*each next wait is 3x the one before\.`\./);
    expect(finding.lines.skill).toBe(finding.lines.build.replace('2x', '3x'));
  });

  it('settings with no `proof.sources`: the build keeps every region example, and writes nothing', () => {
    const app = App.copy('no-sources');
    expect(app.read('skillunit.yaml')).not.toMatch(/sources/);
    const write = app.run('proof', '--write');
    expect(write.code).toBe(0);
    expect(write.report.proof.files.filter((f: any) => f.state !== 'same')).toEqual([]);
    expect(app.read('skill/features/errors.md')).toContain('if (isHttpError(error) && error.status === 404)');
    expect(app.run('check', '--dry-run').code).toBe(0);
  });

  it('a unit edited in skill/ by hand: the finding names the test to edit', () => {
    const app = App.copy('by-hand');
    app.edit('skill/features/timeouts.md', 'Value: 10 seconds', 'Value: 30 seconds');
    const proof = app.run('proof');
    const [finding] = errors(proof);
    expect(finding).toMatchObject({ unit: 'default-timeout', origin: { kind: 'test', file: `../${TEST}` } });
  });

  it('a body that fails: the slot has no unit, the finding carries the assertion, and the run fails too', () => {
    const app = App.copy('failing-body');
    app.edit(TEST, `body: '{"name":"Ada"}'`, `body: '{"name":"Bob"}'`);
    const found = errors(app.run('proof'));
    expect(found.map((p) => p.file).sort()).toEqual(['../skill-src/features/requests.md', '../skillunit.yaml']);
    const finding = found.find((p) => p.unit === 'body-as-object');
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
    expect(settings.message).toMatch(/^`proof\.run` \(`no-such-test-runner run`\) exited with 127 and left no unit in `tmp\/skill-units`\. The end of its output:\n.*no-such-test-runner/s);
    // One error for the run, not two.
    expect(errors(proof).filter((p) => p.file === '../skillunit.yaml')).toHaveLength(1);
    expect(errors(proof).filter((p) => p.message.startsWith('no test left the unit')).map((p) => p.unit).sort()).toEqual([
      'await-every-request',
      'body-as-object',
      'cancel-with-signal',
      'check-with-is-http-error',
      'client-options',
      'default-timeout',
      'method-results',
      'never-disable-timeout',
      'one-client-per-api',
      'query-in-options',
      'response-body',
      'retry-defaults',
      'retry-idempotent-only',
      'timeout-off',
      'what-a-failed-request-throws',
      'what-is-retried',
    ]);
  });

  it('an ordinary test that fails: check fails on proof.run, names the test, and every unit still comes from its test', () => {
    const app = App.copy('red-run');
    app.edit(TEST, "  unit(\n    'cancel-with-signal',", "  it('fails on purpose', () => {\n    expect(1).toBe(2);\n  });\n\n  unit(\n    'cancel-with-signal',");
    app.edit(TEST, "import { afterEach, describe, expect, vi } from 'vitest';", "import { afterEach, describe, expect, it, vi } from 'vitest';");
    const check = app.run('check', '--dry-run');
    expect(check.code).toBe(1);
    const found = errors(check);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ file: '../skillunit.yaml', line: lineOf(app.read('skillunit.yaml'), 'run:') });
    expect(found[0].message).toMatch(/^`proof\.run` \(`npx vitest run`\) exited with 1: a test failed, or the run did\. The end of its output:\n.*fails on purpose/s);
    expect(check.report.proof.units.filter((u: any) => u.from === 'test').every((u: any) => u.state === 'passed')).toBe(true);
  });

  it('a unit heading in the source: the error names the file and the line, and says where units go', () => {
    const app = App.copy('heading');
    app.write('skill-src/features/errors.md', `${app.read('skill-src/features/errors.md')}\n### rule: log-failed-requests\n\nWhen: code logs a failed request.\n\nDo: log the method and the URL.\n`);
    const [finding] = errors(app.run('proof'));
    expect(finding).toEqual(
      expect.objectContaining({
        file: '../skill-src/features/errors.md',
        line: lineOf(app.read('skill-src/features/errors.md'), '### rule: log-failed-requests'),
        unit: 'log-failed-requests',
        message: 'units are declared with `unit()`; put `{{unit:log-failed-requests}}` here',
      }),
    );
  });

  it('a question whose `expect` names no option: the test of its unit fails and says why', () => {
    const app = App.copy('bad-expect');
    app.edit(TEST, 'right: `${DEFAULT_RETRY_DELAY} ms`,', 'default: `${DEFAULT_RETRY_DELAY} ms`,');
    const finding = errors(app.run('proof')).find((p) => p.unit === 'retry-defaults' && p.message.startsWith('the test of'));
    expect(finding.message).toMatch(
      /^the test of `retry-defaults` \(src\/tinyfetch\.test\.ts:\d+\) failed, so it left no unit: unit `retry-defaults`: the question `retry-delay-default`: `expect` is "right", which is not an option \(use one of: default, ms1000, none-wait, none\)$/,
    );
  });

  it('a unit with no body reads as declared with no test, and never as proved', () => {
    const app = App.copy('declared');
    const proof = app.run('proof');
    const declared = (proof.report.proof.units as any[]).filter((u) => u.from === 'declared').map((u) => u.id);
    expect(declared).toEqual(['one-client-per-api', 'retry-idempotent-only', 'never-disable-timeout']);
    expect(proof.report.proof.summary).toMatchObject({ units: 16, proved: 13, declared: 3 });
    const table = spawnSync(process.execPath, [CLI, 'proof'], { cwd: app.root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } }).stdout;
    expect(table).toContain(`never-disable-timeout  rule\n      proof  – declared, no test, ${DECLARED}:`);
    expect(table).not.toContain(`proved by a test, ${DECLARED}`);
    expect(table).toContain('16 units · 13 proved by a test · 3 declared without one');
  });

  it('check --dry-run with no key: every question is ready, and nothing is sent', () => {
    const app = App.copy('no-key');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.endsWith('_API_KEY')));
    const run = spawnSync(process.execPath, [CLI, 'check', '--dry-run', '--json'], { cwd: app.root, encoding: 'utf8', env });
    expect(run.status).toBe(0);
    const test = JSON.parse(run.stdout).test;
    expect(test.summary).toMatchObject({ tests: 16, passed: 16, usage: { input_tokens: 0, output_tokens: 0 } });
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

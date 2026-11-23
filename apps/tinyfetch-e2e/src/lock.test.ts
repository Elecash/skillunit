/**
 * `skillunit.lock` on a copy of tinyfetch: what `proof` reports when the tests and the lock
 * disagree, and what `--write` and `--forget` do to the lock. Each flow runs the app's tests,
 * then `skillunit proof`, as a developer does.
 */
import { spawnSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { App, CLI, type Run } from './app.js';

afterAll(() => App.removeAll());

const TEST = 'src/tinyfetch.test.ts';
const lockOf = (app: App): string[] => JSON.parse(app.read('skillunit.lock')).proved;
const errors = (run: Run) => (run.report.proof.problems as any[]).filter((p) => p.severity === 'error').map((p) => `${p.unit ?? p.file}: ${p.message}`);

/** Deletes the test that proves `body-as-object`, region and all. */
function deleteBodyTest(app: App) {
  const text = app.read(TEST);
  const start = text.indexOf("  it('sends the body as JSON [skill:body-as-object]'");
  app.write(TEST, text.slice(0, start) + text.slice(text.indexOf('  it(', start + 1)));
}

describe('skillunit.lock', () => {
  it('a tagged test for a unit the lock does not list: the error says --write, which adds it once', () => {
    const app = App.copy('lock-add');
    app.edit(TEST, "it('times out with a TimeoutError, and never with timeout 0'", "it('times out with a TimeoutError, and never with timeout 0 [skill:never-disable-timeout]'");
    app.test();
    const check = app.run('proof');
    expect(check.code).toBe(1);
    expect(errors(check)).toEqual(['never-disable-timeout: a test proves this unit and `skillunit.lock` does not list it. Run `skillunit proof --write`']);

    const write = app.run('proof', '--write');
    expect(write.code).toBe(0);
    expect(write.report.proof.lock).toMatchObject({ added: ['never-disable-timeout'], dropped: [], written: true });
    expect(lockOf(app)).toContain('never-disable-timeout');
    const again = app.run('proof', '--write');
    expect(again.code).toBe(0);
    expect(again.report.proof.lock.written).toBe(false);
  });

  it('a deleted test: --write keeps the id and the check fails; --forget then lets it pass, the unit unproved', () => {
    const app = App.copy('lock-forget');
    deleteBodyTest(app);
    // The block the test produced loses its flag in the same change.
    app.edit('skill/features/requests.md', '```ts proof=body-as-object', '```ts');
    app.test();
    const write = app.run('proof', '--write');
    expect(write.code).toBe(1);
    expect(write.report.proof.lock).toMatchObject({ added: [], dropped: [], written: false });
    expect(lockOf(app)).toContain('body-as-object');
    expect(errors(write)).toEqual([
      'body-as-object: `skillunit.lock` lists this unit as proved, and no test in the reports is tagged `[skill:body-as-object]`. Bring the test back, or run `skillunit proof --forget body-as-object` if the unit is no longer meant to be proved',
    ]);

    const forget = app.run('proof', '--forget', 'body-as-object');
    expect(forget.code).toBe(0);
    expect(forget.report.proof.lock).toMatchObject({ forgot: ['body-as-object'], written: true });
    expect(lockOf(app)).not.toContain('body-as-object');
    expect(forget.report.proof.units.find((u: any) => u.id === 'body-as-object').state).toBe('unproved');
  });

  it('--forget with an id the lock does not list forgets nothing', () => {
    const app = App.copy('lock-forget-none');
    app.test();
    const before = app.read('skillunit.lock');
    const run = app.run('proof', '--forget', 'body-as-object,no-such-unit');
    expect(run.code).toBe(1);
    expect(errors(run)).toEqual(['../skillunit.lock: `skillunit.lock` does not list `no-such-unit`, so nothing was forgotten: `--forget` takes only ids the lock lists']);
    expect(app.read('skillunit.lock')).toBe(before);
  });

  it('--forget on a unit a test still proves: the lock loses the id and the check fails', () => {
    const app = App.copy('lock-forget-proved');
    app.test();
    const run = app.run('proof', '--forget', 'retry-defaults', '--forget', 'default-timeout');
    expect(run.code).toBe(1);
    expect(lockOf(app)).not.toContain('retry-defaults');
    expect(errors(run)).toEqual([
      'retry-defaults: a test proves this unit and `skillunit.lock` does not list it. Run `skillunit proof --write`',
      'default-timeout: a test proves this unit and `skillunit.lock` does not list it. Run `skillunit proof --write`',
    ]);
  });

  it('--forget with --write is a usage error', () => {
    const app = App.copy('lock-usage');
    const result = spawnSync(process.execPath, [CLI, 'proof', '--write', '--forget', 'body-as-object'], { cwd: app.root, encoding: 'utf8' });
    expect(result.status).toBe(2);
    expect(result.stderr).toBe('skillunit: --forget and --write go in separate runs: --write would add back a unit a test still proves\n');
  });

  it('a unit deleted with its test: --write drops its id', () => {
    const app = App.copy('lock-drop');
    deleteBodyTest(app);
    const skill = app.read('skill/features/requests.md');
    const start = skill.indexOf('### rule: body-as-object');
    const end = skill.indexOf('\n### ', start + 1);
    app.write('skill/features/requests.md', skill.slice(0, start) + (end < 0 ? '' : skill.slice(end + 1)));
    app.test();
    expect(errors(app.run('proof'))).toEqual(['../skillunit.lock: `skillunit.lock` lists `body-as-object`, and no unit of the skill has that id; `skillunit proof --write` drops it']);
    const write = app.run('proof', '--write');
    expect(write.code).toBe(0);
    expect(write.report.proof.lock).toMatchObject({ added: [], dropped: ['body-as-object'] });
    expect(lockOf(app)).not.toContain('body-as-object');
  });

  it('a merge conflict: one error, and --write keeps the units of both sides', () => {
    const app = App.copy('lock-conflict');
    const ids = lockOf(app);
    const side = (list: string[]) => list.map((id, i) => `    ${JSON.stringify(id)}${i < list.length - 1 ? ',' : ''}`);
    app.write('skillunit.lock', ['{', '  "version": 2,', '  "proved": [', '<<<<<<< HEAD', ...side(ids.slice(0, 5)), '=======', ...side(ids.slice(5)), '>>>>>>> topic', '  ]', '}', ''].join('\n'));
    app.test();
    expect(errors(app.run('proof'))).toEqual([
      '../skillunit.lock: `skillunit.lock` cannot be read: it has merge conflict markers. Run `skillunit proof --write`, which keeps the units of both sides',
    ]);
    const write = app.run('proof', '--write');
    expect(write.code).toBe(0);
    expect(lockOf(app)).toEqual(ids);
  });
});

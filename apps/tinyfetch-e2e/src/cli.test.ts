/** The built command, called the way a script calls it. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CLI } from './app.js';

const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

describe('exit 2 with a JSON reporter', () => {
  it('prints the error as JSON on stdout as well as on stderr', () => {
    for (const args of [['lint', '--reporter', 'json', '--bogus'], ['check', '--json', '--config', 'missing.yaml']]) {
      const result = run(...args);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/^skillunit: /);
      const out = JSON.parse(result.stdout);
      expect(out).toMatchObject({ schema: 4, command: args[0], ok: false, error: { exit: 2 } });
      expect(result.stderr).toContain(out.error.message);
    }
  });

  it('prints nothing on stdout with the table reporter', () => {
    const result = run('lint', '--bogus');
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });
});

describe('a report through a pipe', () => {
  // A skill whose report is far above the 64 KB a pipe holds: 3,000 links that do not resolve.
  const skill = mkdtempSync(join(tmpdir(), 'skillunit-pipe-'));
  const links = Array.from({ length: 3000 }, (_, i) => `- [file ${i}](references/missing-file-number-${i}.md)`);
  writeFileSync(join(skill, 'SKILL.md'), `---\nname: big\ndescription: A skill with a long report.\n---\n\n# Big\n\n${links.join('\n')}\n`);
  afterAll(() => rmSync(skill, { recursive: true, force: true }));

  // spawnSync reads stdout through a pipe, as `| jq` and a CI log do.
  const lint = (...args: string[]) =>
    spawnSync(process.execPath, [CLI, 'lint', skill, ...args], { cwd: skill, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });

  it('arrives whole with the JSON reporter', () => {
    const result = lint('--reporter', 'json');
    expect(result.status).toBe(1);
    expect(result.stdout.length).toBeGreaterThan(256 * 1024);
    const report = JSON.parse(result.stdout);
    expect(report.lint.problems.filter((p: { message: string }) => p.message.includes('does not resolve'))).toHaveLength(3000);
  });

  it.each(['table', 'github'])('ends with the status line with the %s reporter', (reporter) => {
    const result = lint('--reporter', reporter);
    expect(result.status).toBe(1);
    expect(result.stdout.length).toBeGreaterThan(64 * 1024);
    // Nx sets FORCE_COLOR, which wins over NO_COLOR.
    const last = result.stdout.replace(/\x1b\[[0-9;]*m/g, '').trimEnd().split('\n').at(-1);
    expect(last).toMatch(/^FAILED {2}lint 3,?000 errors/);
  });
});

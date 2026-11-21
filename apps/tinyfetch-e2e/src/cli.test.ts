/** The built command, called the way a script calls it. */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CLI } from './app.js';

const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

describe('exit 2 with a JSON reporter', () => {
  it('prints the error as JSON on stdout as well as on stderr', () => {
    for (const args of [['lint', '--reporter', 'json', '--bogus'], ['check', '--json', '--config', 'missing.yaml']]) {
      const result = run(...args);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/^skillunit: /);
      const out = JSON.parse(result.stdout);
      expect(out).toMatchObject({ schema: 3, command: args[0], ok: false, error: { exit: 2 } });
      expect(result.stderr).toContain(out.error.message);
    }
  });

  it('prints nothing on stdout with the table reporter', () => {
    const result = run('lint', '--bogus');
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });
});

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { runCommands } from './lint/commands.js';
import { runTsc } from './lint/tsc.js';
import { removeTemp } from './temp.js';
import { parseSkill } from './units/index.js';

// A folder whose entries cannot be deleted: its own write permission is gone. Root ignores
// permissions, and Windows has no `chmod`, so there the folder would be removed anyway.
const canLock = process.platform !== 'win32' && process.getuid?.() !== 0;

const roots: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'skillunit-temp-test-'));
  roots.push(dir);
  return dir;
}

/** Gives write permission back to every folder under `dir`, so the test can delete it. */
function unlock(dir: string) {
  if (!existsSync(dir)) return;
  chmodSync(dir, 0o755);
  for (const entry of readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) unlock(join(dir, entry.name));
}

afterAll(() => {
  for (const dir of roots) {
    unlock(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

/** The warnings written to stderr while `run` runs. */
function stderrOf<T>(run: () => T): { result: T; stderr: string } {
  let stderr = '';
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  });
  try {
    return { result: run(), stderr };
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => vi.restoreAllMocks());

describe('removeTemp', () => {
  it('removes a folder and what is in it', () => {
    const dir = join(scratch(), 'run');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'a.ts'), '');
    const warnings: string[] = [];
    removeTemp(dir, (m) => warnings.push(m));
    expect(existsSync(dir)).toBe(false);
    expect(warnings).toEqual([]);
  });

  it.skipIf(!canLock)('warns once, with the path, when the folder cannot be removed', () => {
    const dir = join(scratch(), 'run');
    mkdirSync(dir);
    writeFileSync(join(dir, 'a.ts'), '');
    chmodSync(dir, 0o555);
    const warnings: string[] = [];
    expect(() => removeTemp(dir, (m) => warnings.push(m))).not.toThrow();
    // The code depends on the system: ENOTEMPTY on macOS; another system may give another.
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/^could not remove the temporary folder .+ \(E[A-Z]+\); delete it yourself$/);
    expect(warnings[0]).toContain(dir);
    expect(existsSync(join(dir, 'a.ts'))).toBe(true);
  });
});

describe('a run whose temporary folder cannot be removed', () => {
  it.skipIf(!canLock)('the command check keeps its result and warns', () => {
    const root = scratch();
    mkdirSync(join(root, 'skill'));
    writeFileSync(join(root, 'skill', 'SKILL.md'), '# Tool\n\n```sh\necho hi\n```\n');
    // The command makes the folder of its own example read-only, so removing it fails.
    const { result, stderr } = stderrOf(() => runCommands(parseSkill(join(root, 'skill')), { commands: { sh: 'chmod 555 "$(dirname {file})"' }, cwd: root }));
    expect(result).toEqual({ problems: [], checked: 1, noCheck: 0 });
    const left = /could not remove the temporary folder (\S+) \(E[A-Z]+\); delete it yourself\n$/.exec(stderr)?.[1];
    // The folder is outside `root`: clean it up too, even when an assertion below fails.
    if (left) roots.push(left);
    expect(stderr.startsWith('skillunit: warning: ')).toBe(true);
    expect(left && existsSync(left)).toBe(true);
  });

  it.skipIf(!canLock)('the type-check keeps its result and warns', () => {
    const root = scratch();
    // A stand-in `typescript` whose `tsc` finds nothing wrong in the examples and makes its run folder read-only.
    const ts = join(root, 'node_modules', 'typescript');
    mkdirSync(join(ts, 'bin'), { recursive: true });
    writeFileSync(join(ts, 'package.json'), JSON.stringify({ name: 'typescript', version: '0.0.0-test', bin: { tsc: 'bin/tsc' } }));
    // It prints the error of SkillUnit's sentinel file, as a real `tsc` that reached the type-check does.
    writeFileSync(
      join(ts, 'bin', 'tsc'),
      "require('node:fs').chmodSync(process.cwd(), 0o555);\nconsole.log('skillunit-sentinel.ts(1,7): error TS2322: Type \\'string\\' is not assignable to type \\'number\\'.');\nprocess.exitCode = 2;\n",
    );
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    const { result, stderr } = stderrOf(() => runTsc(join(root, 'tsconfig.json'), [{ lang: 'ts', code: 'const a = 1;', line: 3 }]));
    expect(result).toEqual({ version: '0.0.0-test', diagnostics: [[]] });
    const left = /could not remove the temporary folder (\S+) \(E[A-Z]+\); delete it yourself\n$/.exec(stderr)?.[1];
    expect(left?.startsWith(join(root, 'node_modules', '.cache', 'skillunit', 'run-'))).toBe(true);
    expect(existsSync(left!)).toBe(true);
  });
});

/**
 * Lint item 6, examples in other languages: each fence is written, after its file's `Setup` of
 * the same language, to a temp file, and the configured command must exit 0.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExamplesConfig } from '../config.js';
import { removeTemp } from '../temp.js';
import type { ParsedSkill } from '../units/index.js';
import { isExample, isNoCheck, ownerUnit, snippet } from './examples.js';
import type { Problem } from './types.js';

export interface CommandResult {
  problems: Problem[];
  checked: number;
  noCheck: number;
}

export function runCommands(skill: ParsedSkill, examples: ExamplesConfig): CommandResult {
  const result: CommandResult = { problems: [], checked: 0, noCheck: 0 };
  if (Object.keys(examples.commands).length === 0) return result;
  const dir = mkdtempSync(join(tmpdir(), 'skillunit-examples-'));
  try {
    let n = 0;
    for (const file of skill.files) {
      for (const fence of file.fences) {
        const command = examples.commands[fence.lang];
        if (!command || !(isExample(fence) || fence.owner.kind === 'setup')) continue;
        if (isNoCheck(fence)) {
          result.noCheck++;
          continue;
        }
        const setup = fence.owner.kind === 'setup' ? undefined : file.setup[fence.lang];
        const path = join(dir, `example${n++}.${fence.lang}`);
        writeFileSync(path, setup ? `${setup.code}\n${fence.code}\n` : `${fence.code}\n`);
        result.checked++;
        const run = spawnSync(command.replaceAll('{file}', quote(path)), { shell: true, cwd: examples.cwd, encoding: 'utf8' });
        if (run.status === 0) continue;
        const said = `${run.stderr ?? ''}${run.stdout ?? ''}`.trim().split('\n').find((l) => l.trim()) ?? run.error?.message ?? '';
        const p: Problem = {
          file: file.file,
          line: fence.line,
          severity: 'error',
          rule: 'command',
          message: `this \`${fence.lang}\` example fails \`${command}\` (exit ${run.status ?? 'none'})${said ? `: ${snippet(said, 160)}` : ''}`,
        };
        const unit = ownerUnit(fence.owner);
        if (unit) p.unit = unit;
        result.problems.push(p);
      }
    }
  } finally {
    removeTemp(dir);
  }
  return result;
}

/** Quotes a path for `sh` and `cmd`. */
function quote(path: string): string {
  return process.platform === 'win32' ? `"${path}"` : `'${path.replaceAll("'", "'\\''")}'`;
}

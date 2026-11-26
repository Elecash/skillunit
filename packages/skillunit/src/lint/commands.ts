/**
 * Lint item 6, examples in other languages: each fence is written, after its file's `Setup` of
 * the same language, to a temp file, and the configured command must exit 0.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { ExamplesConfig } from '../config.js';
import { removeTemp } from '../temp.js';
import type { ParsedSkill } from '../units/index.js';
import { isExample, isNoCheck, ownerUnit, setupFor } from './examples.js';
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
  // The command may print the folder's real path (on macOS, /private/var/… for /var/…).
  const realDir = realpathSync(dir);
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
        const source = fence.owner.kind === 'setup' ? undefined : setupFor(skill, file, fence.lang);
        const setup = source?.fence;
        const path = join(dir, `example${n++}.${fence.lang}`);
        writeFileSync(path, setup ? `${setup.code}\n${fence.code}\n` : `${fence.code}\n`);
        result.checked++;
        const run = spawnSync(command.replaceAll('{file}', quote(path)), { shell: true, cwd: examples.cwd, encoding: 'utf8' });
        if (run.status === 0) continue;
        const setupLines = setup ? setup.code.split('\n').length : 0;
        const codeLines = fence.code.split('\n').length;
        // Line `n` of the temp file: in the `Setup` written above the example, or in the example.
        const lineAt = (n: number) => {
          if (source && n <= setupLines) return `${source.file.file}:${source.fence.line + Math.max(n, 1)} (Setup)`;
          return `${file.file}:${fence.line + Math.min(Math.max(n - setupLines, 1), codeLines)}`;
        };
        const said = output(`${run.stderr ?? ''}${run.stdout ?? ''}`, [path, join(realDir, basename(path)), dir, realDir], `${file.file}:${fence.line}`, lineAt) || (run.error?.message ?? '');
        const p: Problem = {
          file: file.file,
          line: fence.line,
          example: fence.line,
          severity: 'error',
          rule: 'command',
          message: `this \`${fence.lang}\` example fails \`${command}\` (exit ${run.status ?? 'none'})${said ? `:\n${said}` : ''}`,
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
export function quote(path: string): string {
  return process.platform === 'win32' ? `"${path}"` : `'${path.replaceAll("'", "'\\''")}'`;
}

/** Lines of a command's output kept in a finding, and characters per line. */
const OUTPUT_LINES = 12;
const LINE_CHARS = 200;

/**
 * What a command printed, for a finding: its non-empty lines, at most `OUTPUT_LINES`, with the
 * temp file it was given named by the example's place in the skill, since that file is gone.
 * With `lineAt`, `<temp file>:<n>` is named by the line of the skill that line `n` is.
 */
export function output(text: string, temp: string[], place: string, lineAt?: (n: number) => string): string {
  let out = text;
  for (const path of temp) {
    if (lineAt) out = out.replace(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+)`, 'g'), (_, n: string) => lineAt(Number(n)));
    out = out.split(path).join(place);
  }
  const lines = out
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  const kept = lines.slice(0, OUTPUT_LINES).map((l) => (l.length > LINE_CHARS ? `${l.slice(0, LINE_CHARS - 1)}…` : l));
  if (lines.length > OUTPUT_LINES) kept.push(`(${lines.length - OUTPUT_LINES} more lines)`);
  return kept.join('\n');
}

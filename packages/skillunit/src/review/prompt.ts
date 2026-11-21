/**
 * The review at a terminal: for each group, what changed, then each unit with a question. One
 * answer per line, read with Node's `readline`:
 *
 * - `a` accept: the unit is still right, or I have edited it
 * - `e` open the unit in `$VISUAL` or `$EDITOR` at its line, then ask again
 * - `s` skip it for now
 * - `A` accept it and the rest of this file
 * - `q` quit, keeping what was accepted so far (the end of the input does the same)
 */
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import type { ReportOptions } from '../report/types.js';
import { parseSkill } from '../units/index.js';
import type { LockEdit } from './accept.js';
import { groupHead, header, summary, unitLines } from './render.js';
import type { Review } from './review.js';

export interface PromptIO {
  input: Readable;
  output: Writable;
  /** Opens a skill file at a line and returns when the editor closes. */
  edit(file: string, line: number): void;
}

const QUESTION = '  a accept · e edit · s skip · A accept the rest of this file · q quit > ';

/** Asks about every unit of the review and records the answers in `edit`. Returns the ids left. */
export async function prompt(review: Review, edit: LockEdit, io: PromptIO, options: ReportOptions): Promise<string[]> {
  const say = (lines: string[]) => io.output.write(`${lines.join('\n')}\n`);
  const lines = lineReader(io.input);
  const left: string[] = [];
  let quit = false;
  say(header(review, options));

  try {
    for (const group of review.groups) {
      if (quit) {
        left.push(...group.units.map((u) => u.id));
        continue;
      }
      say(groupHead(group, options));
      let rest = false;
      for (const unit of group.units) {
        if (quit) {
          left.push(unit.id);
          continue;
        }
        if (rest) {
          const error = edit.accept(unit.id);
          say([error ? `  ${unit.id}: ${error}` : `  ${unit.id}: accepted`]);
          if (error) left.push(unit.id);
          continue;
        }
        say(unitLines(unit, review, options));
        for (;;) {
          io.output.write(`\n${QUESTION}`);
          const answer = (await lines.next())?.trim() ?? 'q';
          const key = answer[0];
          if (key === 'a' || key === 'A') {
            const error = edit.accept(unit.id);
            if (error) {
              say([`  ${error}. Edit the unit or its code, or skip it.`]);
              continue;
            }
            say(['  accepted']);
            rest = key === 'A';
          } else if (key === 'e') {
            io.edit(join(review.skill, unit.file), unit.line);
            const now = parseSkill(review.skill).units.find((u) => u.id === unit.id);
            if (!now) {
              say([`  there is no unit \`${unit.id}\` any more; skipping it`]);
              left.push(unit.id);
              break;
            }
            Object.assign(unit, { file: now.file, line: now.line, text: now.text });
            say(unitLines(unit, review, options));
            continue;
          } else if (key === 's') {
            left.push(unit.id);
          } else if (key === 'q') {
            quit = true;
            left.push(unit.id);
          } else {
            say(['  type a, e, s, A or q, then Enter']);
            continue;
          }
          break;
        }
      }
    }
  } finally {
    lines.close();
  }
  // Every unit not left was accepted, so it is in sync now.
  const accepted = review.summary.toReview - left.length;
  const groups = review.groups.filter((g) => g.units.some((u) => left.includes(u.id)));
  say(summary({ ...review, groups, summary: { ...review.summary, toReview: left.length, inSync: review.summary.inSync + accepted } }, options));
  return left;
}

/** Lines of the input one at a time; null once it has ended. */
function lineReader(input: Readable) {
  const rl = createInterface({ input, terminal: false });
  const queue: string[] = [];
  const waiting: Array<(line: string | null) => void> = [];
  let ended = false;
  rl.on('line', (line) => (waiting.length ? waiting.shift()!(line) : queue.push(line)));
  rl.on('close', () => {
    ended = true;
    while (waiting.length) waiting.shift()!(null);
  });
  return {
    next: (): Promise<string | null> => (queue.length ? Promise.resolve(queue.shift()!) : ended ? Promise.resolve(null) : new Promise((r) => waiting.push(r))),
    close: () => rl.close(),
  };
}

/**
 * JetBrains launchers, as each IDE's "Open files from the command line" page names them:
 * `<ide>`, `<ide>.sh` and `<ide>64.exe` (RustRover: `rustrover.exe`), plus IntelliJ IDEA's
 * `idea.bat` and snap `intellij-idea`. They take `--line <n> <file>`.
 */
const JETBRAINS = ['idea', 'intellij-idea', 'webstorm', 'pycharm', 'phpstorm', 'goland', 'rider', 'clion', 'rubymine', 'rustrover', 'datagrip'];

/**
 * The arguments that open `file` at `line` in an editor, by the name of its command:
 *
 * - VS Code and its forks: `--goto file:line`
 * - Sublime Text (`subl`) and Zed (`zed`, `zeditor` on some Linux distributions): `file:line`
 * - JetBrains IDEs: `--line <n> file`
 * - anything else (vi, vim, nano, emacs, …): `+<n> file`
 */
export function editorArgs(command: string, file: string, line: number): string[] {
  const name = command
    .split(/[\\/]/)
    .pop()!
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|sh)$/, '')
    .replace(/64$/, '');
  if (['code', 'code-insiders', 'codium', 'cursor'].includes(name)) return ['--goto', `${file}:${line}`];
  if (['subl', 'zed', 'zeditor'].includes(name)) return [`${file}:${line}`];
  if (JETBRAINS.includes(name)) return ['--line', String(line), file];
  return [`+${line}`, file];
}

/**
 * Opens `file` at `line` in `$VISUAL`, `$EDITOR` or `vi`. The editor command should wait until
 * the file is closed: `code --wait`, `zed --wait`, `idea --wait`.
 */
export function openEditor(file: string, line: number, output: Writable): void {
  const [command, ...args] = (process.env.VISUAL || process.env.EDITOR || 'vi').trim().split(/\s+/);
  const result = spawnSync(command!, [...args, ...editorArgs(command!, file, line)], { stdio: 'inherit' });
  if (result.error) output.write(`  could not open ${command}: ${result.error.message}. Set $EDITOR to your editor.\n`);
}

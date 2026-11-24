/**
 * The words after a fence's language. SkillUnit knows `no-check`; any other bare word is ignored,
 * which hides a typo such as `nocheck`, so it gets a warning. `key=value` flags and `{...}` are
 * left alone: other tools give them a meaning (`title="app.ts"`, `{1,3}`).
 */
import type { ParsedSkill } from '../units/index.js';
import type { Problem } from './types.js';

export const FENCE_FLAGS = ['no-check'];

export function fenceFlags(skill: ParsedSkill): Problem[] {
  const out: Problem[] = [];
  for (const file of skill.files) {
    for (const fence of file.fences) {
      if (!fence.lang) continue;
      for (const flag of bareWords(fence.flags)) {
        if (FENCE_FLAGS.includes(flag)) continue;
        const close = FENCE_FLAGS.find((known) => near(flag, known));
        out.push({
          file: file.file,
          line: fence.line,
          severity: 'warning',
          rule: 'fence',
          message: close
            ? `\`${flag}\` after \`${fence.lang}\` is not a flag SkillUnit knows; did you mean \`${close}\`? The block is checked as it is`
            : `\`${flag}\` after \`${fence.lang}\` is not a flag SkillUnit knows, so it does nothing (flags: ${FENCE_FLAGS.map((f) => `\`${f}\``).join(', ')})`,
        });
      }
    }
  }
  return out;
}

/**
 * The flags that are bare words. `key=value` (its value quoted or not, spaces and all, as in
 * `title="Going from 0 to 1"`), a `{...}` group and a quoted string are taken out first.
 */
function bareWords(flags: string[]): string[] {
  return flags
    .join(' ')
    .replace(/[\w:.-]+=(?:"[^"]*"?|'[^']*'?|\S+)/g, ' ')
    .replace(/\{[^}]*\}?/g, ' ')
    .replace(/"[^"]*"?|'[^']*'?/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** The same word give or take case, separators or two edits: `nocheck`, `no_check`, `no-chek`. */
function near(word: string, known: string): boolean {
  const flat = (s: string) => s.toLowerCase().replace(/[-_\s]/g, '');
  return flat(word) === flat(known) || distance(word.toLowerCase(), known) <= 2;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const here = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = here;
    }
  }
  return row[b.length]!;
}

/**
 * Lint item 3, `Setup`: at most one per file and language, outside `## Rules`, and before the
 * first example of the file that uses it. A `Setup` inherited from `SKILL.md` is placed there.
 */
import type { ParsedSkill } from '../units/index.js';
import { ownSetup } from './examples.js';
import type { Problem } from './types.js';

export function setups(skill: ParsedSkill): Problem[] {
  const out: Problem[] = [];
  for (const file of skill.files) {
    const at = (line: number, message: string): Problem => ({ file: file.file, line, severity: 'error', rule: 'setup', message });
    const rules = file.headings.find((h) => h.level === 2 && h.text === 'Rules');
    const seen = new Set<string>();

    for (const fence of file.fences) {
      if (fence.owner.kind !== 'setup') continue;
      if (seen.has(fence.lang)) {
        out.push(at(fence.line, `a second \`${fence.lang}\` Setup; a file has at most one per language`));
        continue;
      }
      seen.add(fence.lang);
      if (rules && fence.line > rules.line) out.push(at(fence.line, '`Setup` goes in the prose part of the file, above `## Rules`'));
    }

    const late = new Set<number>();
    for (const fence of file.fences) {
      if (fence.owner.kind === 'setup' || fence.owner.kind === 'misplaced' || fence.owner.kind === 'skipped') continue;
      const setup = ownSetup(file, fence.lang);
      if (!setup || setup.line < fence.line || late.has(setup.line)) continue;
      late.add(setup.line);
      out.push(at(setup.line, `this \`${setup.lang}\` Setup comes after a \`${fence.lang}\` example at line ${fence.line}; move it above the first example`));
    }
  }
  return out;
}

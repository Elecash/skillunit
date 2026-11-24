/**
 * The `proof=` flag of 0.2, which said that a test produced a block. Units declared in tests
 * replaced it: a block from a test is built into the skill, so the flag no longer means anything.
 */
import { FROM_02_DOCS } from '../config.js';
import type { ParsedSkill } from '../units/index.js';
import type { Problem } from './types.js';

export function removedProofFlags(skill: ParsedSkill): Problem[] {
  const out: Problem[] = [];
  for (const file of skill.files) {
    for (const fence of file.fences) {
      const flag = fence.flags.find((f) => /^proof=/.test(f));
      if (flag === undefined) continue;
      const p: Problem = {
        file: file.file,
        line: fence.line,
        severity: 'error',
        rule: 'proof',
        message: `\`${flag}\` is a flag of SkillUnit 0.2 and was removed: a block that a test produces now comes from the test's \`unit()\`, built into the skill. Remove the flag: ${FROM_02_DOCS}`,
      };
      if ('unit' in fence.owner) p.unit = fence.owner.unit;
      out.push(p);
    }
  }
  return out;
}

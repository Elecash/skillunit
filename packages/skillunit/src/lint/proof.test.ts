import { describe, expect, it } from 'vitest';
import { lintSkill } from './lint.js';
import { removedProofFlags } from './proof.js';
import { F, skillOf } from './testing.js';
import type { Problem } from './types.js';

const show = (p: Problem) => `${p.file}:${p.line} ${p.unit ?? '-'} ${p.rule} ${p.severity}: ${p.message}`;

describe('the proof= flag of 0.2', () => {
  const SKILL = `# T\n\n${F}ts proof=outside\nx;\n${F}\n\n## Rules\n\n### rule: r\n\nWhen: a.\n\nDo: b.\n\nRight:\n\n${F}ts title="a.ts" proof='r'\nx;\n${F}\n`;

  it('is reported as removed, in a unit or outside one', () => {
    expect(removedProofFlags(skillOf({ 'SKILL.md': SKILL })).map(show)).toEqual([
      'SKILL.md:3 - proof error: `proof=outside` is a flag of SkillUnit 0.2 and was removed: a block that a test produces now comes from the test\'s `unit()`, built into the skill. Remove the flag: https://github.com/Elecash/skillunit/blob/main/docs/index.md#coming-from-02',
      "SKILL.md:17 r proof error: `proof='r'` is a flag of SkillUnit 0.2 and was removed: a block that a test produces now comes from the test's `unit()`, built into the skill. Remove the flag: https://github.com/Elecash/skillunit/blob/main/docs/index.md#coming-from-02",
    ]);
  });

  it('is part of lint, under the rule `proof`, which `lint.off` can turn off', () => {
    const skill = skillOf({ 'SKILL.md': SKILL });
    expect(lintSkill(skill).problems.filter((p) => p.rule === 'proof')).toHaveLength(2);
    expect(lintSkill(skill, { off: ['proof'] }).problems.filter((p) => p.rule === 'proof')).toEqual([]);
  });
});

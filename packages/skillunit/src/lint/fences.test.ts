import { describe, expect, it } from 'vitest';
import { fenceFlags } from './fences.js';
import { F, skillOf } from './testing.js';

const flagsOf = (info: string) => fenceFlags(skillOf({ 'SKILL.md': `# T\n\n${F}${info}\nconst a = 1;\n${F}\n` })).map((p) => `${p.line} ${p.rule} ${p.severity}: ${p.message}`);

describe('fence flags', () => {
  it('says nothing about no-check, key=value or a {...} group', () => {
    expect(flagsOf('ts no-check')).toEqual([]);
    expect(flagsOf('ts title="app.ts"')).toEqual([]);
    expect(flagsOf('ts title="Going from 0 to 1 over 0.3 seconds"')).toEqual([]);
    expect(flagsOf("tsx title='Two words' {1-3} showLineNumbers=true")).toEqual([]);
    expect(flagsOf('ts {1, 3}')).toEqual([]);
    expect(flagsOf('ts')).toEqual([]);
  });

  it('warns about a typo of no-check, and suggests it', () => {
    expect(flagsOf('ts title="A title" nocheck')).toHaveLength(1);
    expect(flagsOf('typescript nocheck')).toEqual(['3 fence warning: `nocheck` after `ts` is not a flag SkillUnit knows; did you mean `no-check`? The block is checked as it is']);
    expect(flagsOf('ts no_check')).toHaveLength(1);
    expect(flagsOf('ts no-chek')[0]).toContain('did you mean `no-check`');
  });

  it('warns about any other bare word', () => {
    expect(flagsOf('ts twoslash')).toEqual(['3 fence warning: `twoslash` after `ts` is not a flag SkillUnit knows, so it does nothing (flags: `no-check`)']);
  });
});

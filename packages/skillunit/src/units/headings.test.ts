import { describe, expect, it } from 'vitest';
import { unitHeadings } from './headings.js';

const F = '```';

describe('the units of a file, by their headings', () => {
  it('finds each kind, with its line, and leaves out fenced blocks and the frontmatter', () => {
    const text = `---\nname: x\n### rule: in-frontmatter\n---\n\n# T\n\n## Rules\n\n### rule: retry-only-get\n\nWhen: x.\n\n${F}md\n### fact: in-a-fence\n${F}\n\n### decision: one-client\n\n### fact: default-timeout\n`;
    expect(unitHeadings(text, 'features/a.md')).toEqual([
      { kind: 'rule', id: 'retry-only-get', file: 'features/a.md', line: 10 },
      { kind: 'decision', id: 'one-client', file: 'features/a.md', line: 18 },
      { kind: 'fact', id: 'default-timeout', file: 'features/a.md', line: 20 },
    ]);
  });

  it('a heading that is not a unit is not one', () => {
    expect(unitHeadings('# Rules\n\n## Retries\n\n### Note: x\n', 'SKILL.md')).toEqual([]);
  });
});

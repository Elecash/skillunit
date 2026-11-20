import { describe, expect, it } from 'vitest';
import { sliceSection } from './skill-text.js';

const SOURCE = `# Skill

Intro.

## Setup

Install it.

\`\`\`sh
# not a heading
npm install
\`\`\`

### Options

Some options.

## Usage

Use it.
`;

describe('sliceSection', () => {
  it('returns the heading and everything under it, up to the next heading of the same level', () => {
    const text = sliceSection(SOURCE, 'Setup', 'SKILL.md');
    expect(text.startsWith('## Setup')).toBe(true);
    expect(text).toContain('### Options');
    expect(text).not.toContain('## Usage');
  });

  it('ignores case and skips lines inside fenced code', () => {
    expect(sliceSection(SOURCE, 'usage', 'SKILL.md')).toBe('## Usage\n\nUse it.');
    expect(() => sliceSection(SOURCE, 'not a heading', 'SKILL.md')).toThrow(/no heading "not a heading"/);
  });

  it('lists the headings of the file when the one asked for is missing', () => {
    expect(() => sliceSection(SOURCE, 'Missing', 'SKILL.md')).toThrow(/## Setup\n {2}### Options/);
  });
});

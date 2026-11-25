import { describe, expect, it } from 'vitest';
import { collectRegions, dedent, findRegions } from './regions.js';

// The markers are built from parts, so this file holds no region of its own when a project
// scans its tests for them.
const OPEN = (id: string) => `#${'region'} skill:${id}`;
const CLOSE = `#${'endregion'}`;

const lines = (...l: string[]) => l.join('\n');
const regionsOf = (text: string) => findRegions(text, 'a.test.ts');
const show = (p: { file: string; line: number; message: string }) => `${p.file}:${p.line} ${p.message}`;

describe('regions', () => {
  it('reads the lines between the markers, in any comment syntax', () => {
    const text = lines(
      `test('[skill:a]', () => {`,
      `  // ${OPEN('a')}`,
      `  const x = 1;`,
      `  // ${CLOSE}`,
      `});`,
      `# ${OPEN('b.custom')}`,
      `x = 1`,
      `# ${CLOSE}`,
      `<!-- ${OPEN('c')} -->`,
      `<p>c</p>`,
      `<!-- ${CLOSE} -->`,
    );
    const { regions, problems } = regionsOf(text);
    expect(problems).toEqual([]);
    expect(regions.map((r) => [r.id, r.line, r.endLine, r.code])).toEqual([
      ['a', 2, 4, 'const x = 1;'],
      ['b.custom', 6, 8, 'x = 1'],
      ['c', 9, 11, '<p>c</p>'],
    ]);
  });

  it('leaves other #region blocks alone, and their #endregion', () => {
    const text = lines(`// #${'region'} helpers`, 'const h = 1;', `// ${CLOSE}`, `// ${OPEN('a')}`, 'a();', `// ${CLOSE}`, `// ${CLOSE}`);
    const { regions, problems } = regionsOf(text);
    expect(problems).toEqual([]);
    expect(regions.map((r) => r.code)).toEqual(['a();']);
  });

  it('reports a region never closed, a nested one, an empty one and one with no id, with file and line', () => {
    expect(regionsOf(lines(`// ${OPEN('a')}`, 'a();')).problems.map(show)).toEqual(['a.test.ts:1 the region `skill:a` is never closed; end it with a line containing `#endregion`']);
    expect(regionsOf(lines(`// ${OPEN('a')}`, `// ${OPEN('b')}`, 'b();', `// ${CLOSE}`, `// ${CLOSE}`)).problems.map(show)).toEqual([
      'a.test.ts:2 a `#region` inside the region `skill:a` opened at line 1; regions do not nest, so close it with `#endregion` first',
    ]);
    expect(regionsOf(lines(`// ${OPEN('a')}`, '', `// ${CLOSE}`)).problems.map(show)).toEqual(['a.test.ts:1 the region `skill:a` is empty']);
    expect(regionsOf(lines(`// ${OPEN('')}`, 'a();', `// ${CLOSE}`)).problems.map(show)).toEqual([`a.test.ts:1 \`${OPEN('')}\` needs the id of the example: \`${OPEN('<unit id>')}\``]);
  });

  it('reads a placeholder such as skill:<id> as prose, and an id against the end of an HTML comment as an id', () => {
    const text = lines(`// A test writes its example between ${OPEN('<id>')} and ${CLOSE}.`, `<!-- ${OPEN('a')}-->`, 'a();', `<!-- ${CLOSE} -->`);
    const { regions, problems } = regionsOf(text);
    expect(problems).toEqual([]);
    expect(regions.map((r) => [r.id, r.code])).toEqual([['a', 'a();']]);
  });

  it('reports an id used twice, in one file or in two', () => {
    const one = lines(`// ${OPEN('a')}`, 'a();', `// ${CLOSE}`);
    expect(regionsOf(lines(one, one)).problems.map(show)).toEqual(['a.test.ts:4 the region `skill:a` is also at line 1; each example comes from one region']);
    const both = collectRegions([
      { file: 'a.test.ts', text: one },
      { file: 'b.test.ts', text: lines('', one) },
    ]);
    expect(both.problems.map(show)).toEqual(['b.test.ts:2 the region `skill:a` is also at a.test.ts:1; each example comes from one region']);
    expect([...both.regions.values()].map((r) => r.file)).toEqual(['a.test.ts']);
  });

  it('reads CRLF files', () => {
    expect(regionsOf(`// ${OPEN('a')}\r\n  a();\r\n  b();\r\n// ${CLOSE}\r\n`).regions[0]!.code).toBe('a();\nb();');
  });
});

describe('dedent', () => {
  it('removes the indentation every line shares, keeping the deeper one', () => {
    expect(dedent(['    if (a) {', '      b();', '    }'])).toBe('if (a) {\n  b();\n}');
  });

  it('removes shared tabs', () => {
    expect(dedent(['\t\tif (a) {', '\t\t\tb();', '\t\t}'])).toBe('if (a) {\n\tb();\n}');
  });

  it('removes only what the lines share when tabs and spaces are mixed', () => {
    expect(dedent(['\t  a();', '\t    b();'])).toBe('a();\n  b();');
    // A tab and two spaces share nothing: both lines stay as they are.
    expect(dedent(['\ta();', '  b();'])).toBe('\ta();\n  b();');
  });

  it('leaves code at column zero as it is', () => {
    expect(dedent(['a();', '  b();'])).toBe('a();\n  b();');
  });

  it('drops blank lines at the ends, empties lines of only spaces, and keeps trailing spaces of code', () => {
    expect(dedent(['', '   ', '    a(); ', '  ', '    b();', '', ''])).toBe('a(); \n\nb();');
  });
});

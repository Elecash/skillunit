import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readExamples } from './examples.js';
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

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe('the examples folder', () => {
  it('reads <id>.<extension> as the text of <id>, the id keeping its own dots', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skillunit-examples-'));
    roots.push(dir);
    writeFileSync(join(dir, 'retry-defaults.json'), '{\n  "retry": 0\n}\n');
    writeFileSync(join(dir, 'retry-defaults.custom-delay.txt'), 'delay: 500');
    writeFileSync(join(dir, '.gitkeep'), '');
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'nested', 'x.json'), '1');
    const { missing, examples, problems } = readExamples(dir);
    expect(missing).toBe(false);
    expect(problems).toEqual([]);
    expect([...examples.values()].map((e) => [e.id, e.name, e.text])).toEqual([
      ['retry-defaults.custom-delay', 'retry-defaults.custom-delay.txt', 'delay: 500'],
      ['retry-defaults', 'retry-defaults.json', '{\n  "retry": 0\n}\n'],
    ]);
    expect(examples.get('retry-defaults')!.mtimeMs).toBeGreaterThan(0);
  });

  it('reports a file with no extension and two files for one id', () => {
    const dir = mkdtempSync(join(tmpdir(), 'skillunit-examples-'));
    roots.push(dir);
    writeFileSync(join(dir, 'a.json'), '1');
    writeFileSync(join(dir, 'a.txt'), '1');
    writeFileSync(join(dir, 'README'), '');
    expect(readExamples(dir).problems.map((p) => `${p.name}: ${p.message}`)).toEqual([
      'README: `README` has no extension; an example file is `<id>.<extension>`, such as `README.json`',
      'a.txt: `a.txt` and `a.json` are both examples of `a`; keep one',
    ]);
  });

  it('says when the folder does not exist', () => {
    expect(readExamples(join(tmpdir(), 'skillunit-no-such-folder'))).toMatchObject({ missing: true, problems: [] });
  });
});

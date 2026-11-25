import { describe, expect, it } from 'vitest';
import { alignLines, differences, layoutOnly } from './align.js';

const lines = (s: string) => s.split('');

describe('aligning the lines of two texts', () => {
  it('maps equal texts line to line', () => {
    expect(alignLines(lines('abc'), lines('abc'))).toEqual([0, 1, 2]);
  });

  it('maps a changed line to the line it replaced', () => {
    expect(alignLines(lines('abcde'), lines('abXde'))).toEqual([0, 1, 2, 3, 4]);
  });

  it('maps lines a formatter inserted to the line before them, and skips lines it removed', () => {
    expect(alignLines(lines('abcd'), lines('aXYbcd'))).toEqual([0, 0, 0, 1, 2, 3]);
    expect(alignLines(lines('abcd'), lines('ad'))).toEqual([0, 3]);
  });

  it('maps a line inserted at the start to the first line', () => {
    expect(alignLines(lines('abc'), lines('Xabc'))).toEqual([0, 0, 1, 2]);
  });

  it('keeps every index inside the first text', () => {
    expect(alignLines(lines('ab'), lines('abXYZ'))).toEqual([0, 1, 1, 1, 1]);
    expect(alignLines([], lines('ab'))).toEqual([0, 0]);
  });
});

describe('the blocks where two texts differ', () => {
  it('gives the first line of each block, counted in the second text', () => {
    expect(differences(lines('abcdefg'), lines('aXcdeYg'))).toEqual([
      { line: 2, expected: 'b', actual: 'X' },
      { line: 6, expected: 'f', actual: 'Y' },
    ]);
  });

  it('a block one text lacks, and none when they are equal', () => {
    expect(differences(lines('abc'), lines('ac'))).toEqual([{ line: 2, expected: 'b', actual: undefined }]);
    expect(differences(lines('ac'), lines('abc'))).toEqual([{ line: 2, expected: undefined, actual: 'b' }]);
    expect(differences(lines('abc'), lines('abc'))).toEqual([]);
  });
});

describe('a block that differs only in layout on some lines', () => {
  it('a table whose value changes width: reported on the row with the value, not the header', () => {
    const before = ['# T', '', '| Option    | Default  |', '| --------- | -------- |', '| `timeout` | `10_000` |', '| `signal`  | none     |', ''];
    const after = ['# T', '', '| Option    | Default |', '| --------- | ------- |', '| `timeout` | `5_000` |', '| `signal`  | none    |', ''];
    expect(differences(after, before)).toEqual([{ line: 5, expected: '| `timeout` | `5_000` |', actual: '| `timeout` | `10_000` |' }]);
  });

  it('a table whose padding alone changed: reported on its first line', () => {
    const before = ['| A | B |', '|---|---|', '| 1 | 2 |'];
    const after = ['| A   | B   |', '| --- | --- |', '|  1  |  2  |'];
    expect(differences(after, before)).toEqual([{ line: 1, expected: '| A   | B   |', actual: '| A | B |' }]);
  });

  it('separator rows with another number of columns differ in more than layout', () => {
    expect(layoutOnly('| --- | --- |', '|:---|---:|')).toBe(true);
    expect(layoutOnly('| --- | --- |', '| --- | --- | --- |')).toBe(false);
    expect(layoutOnly('a  b', ' a b')).toBe(true);
    expect(layoutOnly('a b', 'a c')).toBe(false);
    expect(layoutOnly('a', undefined)).toBe(false);
  });
});

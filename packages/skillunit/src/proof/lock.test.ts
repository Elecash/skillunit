import { describe, expect, it } from 'vitest';
import { formatLock, parseLock } from './lock.js';

const ids = (text: string | null) => {
  const lock = parseLock(text);
  return lock.kind === 'ok' || lock.kind === 'conflict' ? lock.ids.map((i) => `${i.line} ${i.id}`) : lock;
};

describe('reading the lock', () => {
  it('reads no file as missing', () => {
    expect(parseLock(null)).toEqual({ kind: 'missing' });
  });

  it('reads the ids with their lines, in file order, an id twice kept twice', () => {
    expect(ids('{\n  "version": 2,\n  "proved": [\n    "b",\n    "a",\n    "b"\n  ]\n}\n')).toEqual(['4 b', '5 a', '6 b']);
    expect(ids('{ "version": 2, "proved": [] }')).toEqual([]);
  });

  it('reads version 1 as the lock of sync', () => {
    expect(parseLock('{ "version": 1, "units": { "a": { "src/a.ts": "0123456789abcdef" } } }')).toEqual({ kind: 'sync' });
  });

  it('says why it cannot read a lock', () => {
    const broken = (text: string) => {
      const lock = parseLock(text);
      return lock.kind === 'broken' ? `${lock.line} ${lock.message}` : lock.kind;
    };
    expect(broken('{\n  "version": 3,\n  "proved": []\n}')).toBe('2 it has version 3, and this SkillUnit reads version 2; upgrade skillunit to read it');
    expect(broken('{ "version": 2, "proved": [')).toMatch(/^1 it is not valid JSON \(/);
    expect(broken('[]')).toBe('1 it must be an object with `version` and `proved`');
    expect(broken('{ "version": "2", "proved": [] }')).toBe('1 `version` must be a whole number');
    expect(broken('{\n  "version": 2,\n  "proved": "a"\n}')).toBe('3 `proved` must be a list of unit ids');
    expect(broken('{ "version": 2, "proved": ["a", 1] }')).toBe('1 `proved` holds 1, which is not a unit id');
    expect(broken('{ "version": 2, "proved": [""] }')).toBe('1 `proved` holds "", which is not a unit id');
    expect(broken('{\n  "version": 2,\n  "units": {},\n  "proved": []\n}')).toBe('3 unknown key `units` (allowed: version, proved)');
  });

  it('reads the ids of both sides of a merge conflict', () => {
    const text = ['{', '  "version": 2,', '  "proved": [', '    "a",', '<<<<<<< HEAD', '    "c"', '=======', '    "b",', '    "d"', '>>>>>>> topic', '  ]', '}', ''].join('\n');
    expect(parseLock(text)).toMatchObject({ kind: 'conflict', line: 5 });
    expect(ids(text)).toEqual(['4 a', '6 c', '8 b', '9 d']);
  });

  it('does not resolve a conflict with the lock of sync', () => {
    const text = ['<<<<<<< HEAD', '{ "version": 1, "units": {} }', '=======', '{ "version": 2, "proved": ["a"] }', '>>>>>>> topic'].join('\n');
    expect(parseLock(text)).toMatchObject({ kind: 'broken', line: 1 });
  });
});

describe('writing the lock', () => {
  it('sorts the ids, keeps each once, one to a line', () => {
    expect(formatLock(['b', 'a', 'b'])).toBe('{\n  "version": 2,\n  "proved": [\n    "a",\n    "b"\n  ]\n}\n');
    expect(formatLock([])).toBe('{\n  "version": 2,\n  "proved": []\n}\n');
  });

  it('reads back what it writes', () => {
    expect(ids(formatLock(['x.y', 'a-b']))).toEqual(['4 a-b', '5 x.y']);
  });
});

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const dir = mkdtempSync(join(tmpdir(), 'skillunit-config-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const load = (yaml: string) => {
  const path = join(dir, 'skillunit.yaml');
  writeFileSync(path, yaml);
  return loadConfig(path);
};

describe('examples', () => {
  it('reads a tsconfig for ts and a command per other language, with paths from the file', () => {
    const config = load('examples:\n  ts: { tsconfig: ./tsconfig.json }\n  py: { command: "python3 -m py_compile {file}" }\n');
    expect(config.examples).toEqual({
      ts: { tsconfig: join(dir, 'tsconfig.json') },
      commands: { py: 'python3 -m py_compile {file}' },
      cwd: dir,
    });
  });

  it('has no examples when the key is absent', () => {
    expect(load('skill: .\n').examples).toBeUndefined();
  });

  it('rejects settings it cannot use', () => {
    expect(() => load('examples: [ts]\n')).toThrow(/`examples` must be a mapping/);
    expect(() => load('examples:\n  ts: ./tsconfig.json\n')).toThrow(/`examples.ts` takes one key, `tsconfig`/);
    expect(() => load('examples:\n  tsx: { tsconfig: ./t.json }\n')).toThrow(/are all type-checked through `examples.ts`/);
    expect(() => load('examples:\n  py: { command: "python3 x.py" }\n')).toThrow(/must contain `\{file\}`/);
    expect(() => load('examples:\n  py: { run: "x {file}" }\n')).toThrow(/takes one key, `command`/);
  });
});

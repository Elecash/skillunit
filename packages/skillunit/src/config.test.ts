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

describe('model', () => {
  it('defaults to typesafe, and reads a provider with a name or a module path', () => {
    expect(load('skill: .\n').model).toEqual({ provider: 'typesafe' });
    expect(load('model: { provider: typesafe, name: jev-latest }\n').model).toEqual({ provider: 'typesafe', name: 'jev-latest' });
    expect(load('model: ./models/mine.mjs\n').model).toEqual({ provider: 'module', module: join(dir, 'models', 'mine.mjs') });
  });

  it('rejects a bare name, an unknown provider and unknown keys', () => {
    expect(() => load('model: jev-latest\n')).toThrow(/`model` is `\{ provider: typesafe, name: <model name> \}`, or the path of a module/);
    expect(() => load('model: { provider: openai }\n')).toThrow(/unknown model provider `openai`/);
    expect(() => load('model: { provider: typesafe, temperature: 0 }\n')).toThrow(/unknown key `model.temperature`/);
  });
});

describe('sourceRoot', () => {
  it('is the folder of the config file by default, and relative to it when set', () => {
    expect(load('skill: .\n').sourceRoot).toBe(dir);
    expect(load('sourceRoot: ../code\n').sourceRoot).toBe(join(dir, '..', 'code'));
    expect(() => load('sourceRoot: 3\n')).toThrow(/`sourceRoot` must be a folder/);
  });
});

describe('lint', () => {
  it('reads the rules to turn off', () => {
    expect(load('lint:\n  off: [length, index]\n').lint).toEqual({ off: ['length', 'index'] });
    expect(load('lint: { off: length }\n').lint).toEqual({ off: ['length'] });
  });

  it('rejects a rule it does not know, and names the ones it does', () => {
    expect(() => load('lint: { off: [lenght] }\n')).toThrow(/unknown rule `lenght` \(rules: parse, structure, setup, check, types, wrong-code, command, index, length, source, fence\)/);
    expect(() => load('lint: { on: [index] }\n')).toThrow(/unknown key `lint.on`/);
  });
});

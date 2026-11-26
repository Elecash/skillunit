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

describe('model', () => {
  it('defaults to typesafe, and reads a provider with a name or a module path', () => {
    expect(load('skill: .\n').model).toEqual({ provider: 'typesafe' });
    expect(load('model: { provider: typesafe, name: jev-latest }\n').model).toEqual({ provider: 'typesafe', name: 'jev-latest' });
    expect(load('model: { provider: openai }\n').model).toEqual({ provider: 'openai' });
    expect(load('model: ./models/mine.mjs\n').model).toEqual({ provider: 'module', module: join(dir, 'models', 'mine.mjs') });
  });

  it('rejects a bare name, an unknown provider and unknown keys', () => {
    expect(() => load('model: jev-latest\n')).toThrow(/`model` is `\{ provider: typesafe \| openai, name: <model name> \}`, or the path of a module/);
    expect(() => load('model: { provider: mistral }\n')).toThrow(/unknown model provider `mistral`; SkillUnit ships `typesafe` and `openai`, and any other goes in a module/);
    expect(() => load('model: { provider: typesafe, temperature: 0 }\n')).toThrow(/unknown key `model.temperature`/);
  });
});

describe('keys', () => {
  it('rejects a key it does not know, and names the ones it does', () => {
    expect(() => load('skills: ./skill\n')).toThrow(/unknown key `skills` \(allowed: skill, context, model, thresholds, proof\)/);
    expect(() => load('examples:\n  ts: { tsconfig: ./tsconfig.json }\n')).toThrow(/unknown key `examples`/);
  });
});


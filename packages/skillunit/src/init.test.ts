import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { init } from './init.js';
import { ConfigError } from './lint/types.js';

const roots: string[] = [];
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'skillunit-init-'));
  roots.push(root);
  mkdirSync(join(root, 'skills', 'my-skill'), { recursive: true });
  writeFileSync(join(root, 'skills', 'my-skill', 'SKILL.md'), '# My skill\n');
  return root;
}
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe('init', () => {
  it('writes the settings at the project root, pointing at the skill folder', () => {
    const root = project();
    expect(init('skills/my-skill', root)).toEqual([
      'created skillunit.yaml and specs/example.yaml',
      'next: run `skillunit lint`, then `skillunit test --dry-run`',
    ]);
    expect(existsSync(join(root, 'specs', 'example.yaml'))).toBe(true);
    expect(existsSync(join(root, 'skills', 'my-skill', 'skillunit.yaml'))).toBe(false);
    const config = loadConfig(join(root, 'skillunit.yaml'));
    expect(config.skill).toBe(join(root, 'skills', 'my-skill'));
    expect(config.specs).toEqual([join(root, 'specs')]);
    expect(config.configDir).toBe(root);
    expect(config.examples?.ts).toBeUndefined();
  });

  it('turns on the type-check when the project has a tsconfig.json', () => {
    const root = project();
    writeFileSync(join(root, 'tsconfig.json'), '{}');
    init('skills/my-skill', root);
    expect(loadConfig(join(root, 'skillunit.yaml')).examples?.ts?.tsconfig).toBe(join(root, 'tsconfig.json'));
  });

  it('with no folder, the skill is the current folder', () => {
    const root = project();
    init('.', root);
    expect(readFileSync(join(root, 'skillunit.yaml'), 'utf8')).toMatch(/^skill: \. +# folder with SKILL\.md$/m);
  });

  it('says so when the folder has no SKILL.md', () => {
    const root = project();
    expect(init('skills/other', root)[1]).toBe('there is no SKILL.md in ./skills/other: set `skill` in skillunit.yaml to the folder that has it');
  });

  it('refuses to overwrite skillunit.yaml', () => {
    const root = project();
    init('skills/my-skill', root);
    expect(() => init('skills/my-skill', root)).toThrow(ConfigError);
  });
});

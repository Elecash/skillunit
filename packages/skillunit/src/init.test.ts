import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { CONTRACT, init } from './init.js';
import { ConfigError } from './problems.js';

const roots: string[] = [];
function project(): string {
  const root = mkdtempSync(join(tmpdir(), 'skillunit-init-'));
  roots.push(root);
  writeFileSync(join(root, 'package.json'), '{}\n');
  mkdirSync(join(root, 'skills', 'my-skill'), { recursive: true });
  writeFileSync(join(root, 'skills', 'my-skill', 'SKILL.md'), '# My skill\n');
  return root;
}
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

describe('init', () => {
  it('writes the settings at the project root, pointing at the skill folder', () => {
    const root = project();
    expect(init('skills/my-skill', root)).toEqual([
      'created skillunit.yaml',
      'next: in a test, declare each file of the skill with `setup()` and each unit with `unit()`, from `skillunit/vitest`, and set `proof.run` in skillunit.yaml to the command that runs those tests',
      'then: run `skillunit proof --write` to build ./skills/my-skill, and `skillunit check` to check it',
    ]);
    expect(existsSync(join(root, 'specs'))).toBe(false);
    expect(existsSync(join(root, 'skills', 'my-skill', 'skillunit.yaml'))).toBe(false);
    const config = loadConfig(join(root, 'skillunit.yaml'));
    expect(config.skill).toBe(join(root, 'skills', 'my-skill'));
    expect(config.configDir).toBe(root);
    // Building the skill from the tests is there to turn on, commented out.
    expect(config.proof).toBeUndefined();
    const text = readFileSync(join(root, 'skillunit.yaml'), 'utf8');
    expect(text).toContain('\n# proof: { run: "npx vitest run skill.test" }   # the test files that declare them: *.skill.test.ts\n');
    expect(text).not.toContain('source');
    expect(text).not.toContain('specs');
  });

  it('with a tsconfig.json, the proof.run it suggests type-checks before the tests', () => {
    const root = project();
    writeFileSync(join(root, 'tsconfig.json'), '{}\n');
    init('skills/my-skill', root);
    expect(readFileSync(join(root, 'skillunit.yaml'), 'utf8')).toContain('\n# proof: { run: "npx tsc --noEmit && npx vitest run skill.test" }   # the type-check, then the test files that declare them: *.skill.test.ts\n');
  });

  it('with no folder, the skill is the current folder', () => {
    const root = project();
    init('.', root);
    expect(readFileSync(join(root, 'skillunit.yaml'), 'utf8')).toMatch(/^skill: \. +# folder with SKILL\.md$/m);
  });

  it('with no SKILL.md, says so, and gives the same steps, which build it', () => {
    const root = project();
    const out = init('skills/other', root);
    expect(out).toEqual([
      'created skillunit.yaml',
      'there is no SKILL.md in ./skills/other yet: the steps below build it from your tests',
      'next: in a test, declare each file of the skill with `setup()` and each unit with `unit()`, from `skillunit/vitest`, and set `proof.run` in skillunit.yaml to the command that runs those tests',
      'then: run `skillunit proof --write` to build ./skills/other, and `skillunit check` to check it',
    ]);
  });

  it('with no package.json, points at the JSON contract for a test in another runner or language', () => {
    const root = project();
    rmSync(join(root, 'package.json'));
    expect(init('skills/my-skill', root).at(-1)).toBe(`no package.json here: a test in another runner or language writes the records itself, as the JSON contract says: ${CONTRACT}`);
  });

  it('refuses to overwrite skillunit.yaml', () => {
    const root = project();
    init('skills/my-skill', root);
    expect(() => init('skills/my-skill', root)).toThrow(ConfigError);
  });
});

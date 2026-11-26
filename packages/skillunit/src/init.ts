/**
 * `skillunit init [skill folder]`: writes `skillunit.yaml` in the current folder, the project
 * root, so every other command runs from there with no `--config`.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { CONFIG_FILE } from './config.js';
import { ConfigError } from './problems.js';

function config(skill: string): string {
  return `${[
    '# SkillUnit settings. Reference: https://github.com/Elecash/skillunit#readme',
    `skill: ${skill}`.padEnd(32) + '# folder with SKILL.md',
    '# context: "One sentence about what the skill is for."',
    '# To build the skill from the files and units your tests declare:',
    '# proof: { run: "npx vitest run skill.test" }   # the test files that declare them: *.skill.test.ts',
  ].join('\n')}\n`;
}

/** Writes the files in `cwd` for the skill in `dir`. Returns what to print. */
export function init(dir: string, cwd = process.cwd()): string[] {
  const configPath = join(cwd, CONFIG_FILE);
  if (existsSync(configPath)) throw new ConfigError(`${CONFIG_FILE} already exists in ${cwd}`);

  const skillDir = resolve(cwd, dir);
  const path = relative(cwd, skillDir).split(sep).join('/');
  const skill = path === '' ? '.' : path.startsWith('..') ? path : `./${path}`;
  writeFileSync(configPath, config(skill));

  const out = [`created ${CONFIG_FILE}`];
  if (!existsSync(join(skillDir, 'SKILL.md'))) out.push(`there is no SKILL.md in ${skill} yet: the steps below build it from your tests`);
  out.push(
    `next: in a test, declare each file of the skill with \`setup()\` and each unit with \`unit()\`, from \`skillunit/vitest\`, and set \`proof.run\` in ${CONFIG_FILE} to the command that runs those tests`,
    `then: run \`skillunit proof --write\` to build ${skill}, and \`skillunit check\` to check it`,
  );
  return out;
}

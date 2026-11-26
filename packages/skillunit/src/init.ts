/**
 * `skillunit init [skill folder]`: writes `skillunit.yaml` in the current folder, the project
 * root, so every other command runs from there with no `--config`.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { CONFIG_FILE } from './config.js';
import { ConfigError } from './problems.js';

function config(skill: string): string {
  const lines = [
    '# SkillUnit settings. Reference: https://github.com/Elecash/skillunit#readme',
    `skill: ${skill}`.padEnd(32) + '# folder with SKILL.md',
    '# context: "One sentence about what the skill is for."',
  ];
  lines.push(
    '# To build the skill from the folder people write and the units and questions your tests declare:',
    '# source: ./skill-src',
    '# proof: { run: "npx vitest run skill.test" }   # the test files that declare units: *.skill.test.ts',
  );
  return `${lines.join('\n')}\n`;
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
  if (!existsSync(join(skillDir, 'SKILL.md'))) {
    // No skill yet: the steps that build one come first.
    out.push(
      `there is no SKILL.md in ${skill}: set \`skill\` in ${CONFIG_FILE} to the folder that has it, or build one there from your tests:`,
      `next: set \`source\` and \`proof.run\` in ${CONFIG_FILE}, write the source with \`{{unit:<id>}}\` where each unit goes, and declare each unit and its questions in a test with \`unit()\` and \`ask()\` from \`skillunit/vitest\``,
      `then: run \`skillunit proof --write\` to build ${skill}, and \`skillunit check\` to check it`,
    );
    return out;
  }
  out.push('next: a unit and its questions go in a test: `unit()` and `ask()` from `skillunit/vitest`; set `source` and `proof.run` to build the skill from them');
  return out;
}

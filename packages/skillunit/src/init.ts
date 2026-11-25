/**
 * `skillunit init [skill folder]`: writes `skillunit.yaml` in the current folder, the project
 * root, so every other command runs from there with no `--config`.
 */
import { existsSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { CONFIG_FILE } from './config.js';
import { ConfigError } from './lint/types.js';

function config(skill: string, tsconfig: boolean): string {
  const lines = [
    '# SkillUnit settings. Reference: https://github.com/Elecash/skillunit#readme',
    `skill: ${skill}`.padEnd(32) + '# folder with SKILL.md',
    '# context: "One sentence about what the skill is for."',
  ];
  if (tsconfig) lines.push('examples:                       # type-check TypeScript and JavaScript examples', '  ts: { tsconfig: ./tsconfig.json }');
  else lines.push('# examples: { ts: { tsconfig: ./tsconfig.json } }   # type-check TypeScript and JavaScript examples');
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
  writeFileSync(configPath, config(skill, existsSync(join(cwd, 'tsconfig.json'))));

  const out = [`created ${CONFIG_FILE}`];
  if (!existsSync(join(skillDir, 'SKILL.md'))) out.push(`there is no SKILL.md in ${skill}: set \`skill\` in ${CONFIG_FILE} to the folder that has it`);
  out.push('next: run `skillunit lint`');
  out.push('a unit and its questions go in a test: `unit()` and `ask()` from `skillunit/vitest`; set `source` and `proof.run` to build the skill from them');
  return out;
}

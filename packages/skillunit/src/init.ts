/**
 * `skillunit init [skill folder]`: writes `skillunit.yaml` and a first spec in the current
 * folder, the project root, so every other command runs from there with no `--config`.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { CONFIG_FILE, DEFAULT_SPECS } from './config.js';
import { ConfigError } from './lint/types.js';

function config(skill: string, tsconfig: boolean): string {
  const lines = [
    '# SkillUnit settings. Reference: https://github.com/Elecash/skillunit#readme',
    `skill: ${skill}`.padEnd(32) + '# folder with SKILL.md',
    `specs: ./${DEFAULT_SPECS}`.padEnd(32) + '# folder with the spec files',
    '# context: "One sentence about what the skill is for."',
  ];
  if (tsconfig) lines.push('examples:                       # type-check TypeScript and JavaScript examples', '  ts: { tsconfig: ./tsconfig.json }');
  else lines.push('# examples: { ts: { tsconfig: ./tsconfig.json } }   # type-check TypeScript and JavaScript examples');
  lines.push(
    '# To build the skill from the folder people write and the units your tests declare with unit():',
    '# source: ./skill-src',
    '# proof: { run: "npx vitest run" }',
  );
  return `${lines.join('\n')}\n`;
}

const SPEC = `# A spec lists the decisions an agent must reach after reading part of the skill.
# Each test is a situation and a question with a fixed set of answers.
file: SKILL.md
# section: A heading      # test only that heading; leave out to test the whole file

tests:
  - id: example-choice
    # unit: some-unit-id    # the unit this test is about: the report shows the test under it
    scenario: Describe the situation the agent is in.
    question: What should the agent do?
    options:
      a: What the skill tells the agent to do
      b: A plausible thing the skill rules out
    expect: a
    # SkillUnit adds a "none" option to every choice test: the reader picks it when the
    # skill says something else or does not settle the question. "expect: none" is valid.

  - id: example-yes-no
    scenario: Another situation.
    question: Does the skill allow this?
    expect: no
`;

/** Writes the files in `cwd` for the skill in `dir`. Returns what to print. */
export function init(dir: string, cwd = process.cwd()): string[] {
  const configPath = join(cwd, CONFIG_FILE);
  const specPath = join(cwd, DEFAULT_SPECS, 'example.yaml');
  if (existsSync(configPath)) throw new ConfigError(`${CONFIG_FILE} already exists in ${cwd}`);

  const skillDir = resolve(cwd, dir);
  const path = relative(cwd, skillDir).split(sep).join('/');
  const skill = path === '' ? '.' : path.startsWith('..') ? path : `./${path}`;
  mkdirSync(join(cwd, DEFAULT_SPECS), { recursive: true });
  writeFileSync(configPath, config(skill, existsSync(join(cwd, 'tsconfig.json'))));
  const wroteSpec = !existsSync(specPath);
  if (wroteSpec) writeFileSync(specPath, SPEC);

  const out = [`created ${CONFIG_FILE}${wroteSpec ? ` and ${DEFAULT_SPECS}/example.yaml` : ''}`];
  if (!existsSync(join(skillDir, 'SKILL.md'))) out.push(`there is no SKILL.md in ${skill}: set \`skill\` in ${CONFIG_FILE} to the folder that has it`);
  out.push('next: run `skillunit lint`, then `skillunit test --dry-run`');
  return out;
}

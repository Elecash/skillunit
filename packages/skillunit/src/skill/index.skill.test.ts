// The file `SKILL.md` of SkillUnit's own skill: its `setup()`, then its units in the order the file shows them.
// The region `skill:skillunit` is the code under its description.
// #region skill:skillunit
import { ask, setup, unit } from 'skillunit/vitest';
// #endregion
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect } from 'vitest';
import { INIT, OPTIONS } from '../commands.js';
import { CONFIG_FILE } from '../config.js';
import { SKILL_INDEX } from '../unit/contract.js';
import { and, BIN, cleanUp, cli, command, option, project, report, scratch, type Command } from './helpers.js';

afterEach(cleanUp);

setup('skillunit', {
  file: SKILL_INDEX,
  title: 'SkillUnit',
  description: 'SkillUnit builds an agent skill from the tests of the code it describes, and checks that the skill still says what the code does.',
  frontmatter: {
    name: 'skillunit',
    description: `Write and maintain an agent skill that SkillUnit builds from tests. Use when a project has ${CONFIG_FILE}, when its tests call ${setup.name}(), ${unit.name}() or ${ask.name}() from skillunit, or when the user asks to add SkillUnit to a project.`,
  },
});

const write = option('proof', '--write');

/** A project whose skill has one file and one unit, built. */
async function built() {
  const p = await project((r) => {
    r.setup('demo', { file: 'SKILL.md', title: 'Demo', description: 'A skill to try SkillUnit on.', frontmatter: { name: 'demo', description: 'Use it to try SkillUnit.' } });
    r.unit('wait-before-retry', { when: 'a request is sent again.', do: 'wait before each new attempt.' });
  });
  p.proof({ write: true });
  return p;
}

describe('SKILL.md', () => {
  unit(
    'skill-folder-is-built',
    {
      when: 'a line of the skill folder is wrong, or a unit has to change.',
      do: `change the test that declares the line, then run \`${BIN} ${command('proof')} ${write}\`; never edit a file of the skill folder by hand.`,
      evenWhen: `the change is one word: the next \`${command('proof')}\` reports the edit, and \`${write}\` puts the built line back.`,
    },
    async () => {
      const p = await built();
      const file = join('skill', 'SKILL.md');
      const builtText = p.read(file);
      p.write(file, builtText.replace('wait before each new attempt.', 'wait a little before each new attempt.'));
      const found = p.proof();
      expect(found.ok).toBe(false);
      expect(found.problems).toHaveLength(1);
      expect(found.problems[0]).toMatchObject({ unit: 'wait-before-retry', lines: { build: 'Do: wait before each new attempt.', skill: 'Do: wait a little before each new attempt.' } });
      expect(found.problems[0]!.origin?.file).toMatch(/skill\.test\.ts$/);
      expect(p.proof({ write: true }).files).toEqual([{ file: 'SKILL.md', state: 'written' }]);
      expect(p.read(file)).toBe(builtText);
      expect(p.proof().ok).toBe(true);
    },
  );

  unit('commands', { when: `an agent runs \`${BIN}\`.` }, async (u) => {
    const does: Record<Command, string> = {
      init: `writes \`${CONFIG_FILE}\``,
      proof: 'runs the tests that declare the skill, builds the skill from what they declare and compares it with the skill folder',
      test: 'runs those tests and asks the decision model their questions about the skill folder',
      check: `runs \`${command('proof')}\`, then \`${command('test')}\``,
    };
    expect(Object.keys(does).sort()).toEqual([INIT, ...Object.keys(OPTIONS)].sort());
    const empty = scratch('init');
    expect((await cli(empty, [INIT, 'skill'])).status).toBe(0);
    expect(existsSync(join(empty, CONFIG_FILE))).toBe(true);
    const p = await built();
    const layers = async (...args: string[]) => {
      const ran = report(await cli(p.root, [...args, '--json']));
      return [ran.proof && 'proof', ran.test && 'test'].filter(Boolean);
    };
    expect(await layers(command('proof'))).toEqual(['proof']);
    expect(await layers(command('test'), '--dry-run')).toEqual(['test']);
    expect(await layers(command('check'), '--dry-run')).toEqual(['proof', 'test']);
    u.value(Object.entries(does).map(([name, what]) => `\`${BIN} ${name}\` ${what}.`).join(' '));
  });
});

// The file `setup.md` of SkillUnit's own skill: its `setup()`, then its units in the order the file shows them.
import { existsSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { key, setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect } from 'vitest';
import { INIT, OPTIONS } from '../commands.js';
import { CONFIG_FILE, DEFAULT_PROOF_UNITS, DEFAULT_THRESHOLDS, FORMAT_FILE, loadConfig, PROOF_KEYS, SETTINGS_KEYS, type ModelConfig, type Thresholds } from '../config.js';
import { loadEnv } from '../env.js';
import { init } from '../init.js';
import { loadModel, ModelError, PROVIDER_NAMES, PROVIDERS, type DecisionModel, type ProviderName } from '../models/index.js';
import { runTests } from '../proof/layer.js';
import { SKILL_INDEX } from '../unit/contract.js';
import { and, BIN, cleanUp, cli, code, command, envLayout, option, project, report, scratch } from './helpers.js';

afterEach(cleanUp);

setup('setup', {
  file: 'setup.md',
  title: 'SkillUnit — setting up a project',
  when: 'Add SkillUnit to a project, or change its settings',
  description: 'The settings file, the decision model, and its key.',
});

type Setting = (typeof SETTINGS_KEYS)[number];
const setting = key<Record<Setting, unknown>>;
const proofKey = (name: (typeof PROOF_KEYS)[number]) => `${setting('proof')}.${name}`;
const modelKey = key<Extract<ModelConfig, { provider: ProviderName }>>;
const checkOption = (flag: (typeof OPTIONS)['check'][number]) => option('check', flag);
const HALF = 0.5;

/** A project whose skill has one file and one unit with a question, built. */
async function withQuestion(settings = 'skill: ./skill\nproof: {}\n') {
  const p = await project(
    (r) => {
      r.setup('demo', { file: 'SKILL.md', title: 'Demo', description: 'A skill to try SkillUnit on.', frontmatter: { name: 'demo', description: 'Use it to try SkillUnit.' } });
      r.unit('wait-before-retry', {
        when: 'a request is sent again.',
        do: 'wait before each new attempt.',
        ask: { scenario: 'A request failed.', question: 'What does the agent do?', options: { wait: 'Wait, then send it again', now: 'Send it again at once' }, expect: 'wait' },
      });
    },
    { settings },
  );
  p.proof({ write: true });
  return p;
}

describe('setup.md', () => {
  unit(
    'init',
    {
      when: `the project has no \`${CONFIG_FILE}\` yet.`,
      value: `\`${BIN} ${INIT} <skill folder>\` writes \`${CONFIG_FILE}\` in the current folder, with \`${setting('skill')}\` set to that folder. It refuses when the file is there already, and it writes no \`${SKILL_INDEX}\`: the first \`${command('proof')} ${option('proof', '--write')}\` builds it.`,
    },
    () => {
      const dir = scratch('init');
      init('skills/my-skill', dir);
      expect(loadConfig(join(dir, CONFIG_FILE)).skill).toBe(join(dir, 'skills', 'my-skill'));
      expect(existsSync(join(dir, 'skills', 'my-skill', SKILL_INDEX))).toBe(false);
      expect(() => init('skills/my-skill', dir)).toThrow(`${CONFIG_FILE} already exists`);
    },
  );

  unit('settings-keys', { when: `the code writes or reads \`${CONFIG_FILE}\`.` }, (u) => {
    const valid: Record<Setting, string> = {
      skill: 'skill: ./skills/my-skill',
      context: 'context: "A client for JSON APIs."',
      model: 'model: { provider: typesafe }',
      thresholds: 'thresholds: { yes: 0.8 }',
      proof: 'proof: { units: ./out/units }',
    };
    expect(Object.keys(valid).sort()).toEqual([...SETTINGS_KEYS].sort());
    const dir = scratch('settings');
    const file = join(dir, CONFIG_FILE);
    writeFileSync(file, `${Object.values(valid).join('\n')}\n`);
    const config = loadConfig(file);
    expect(config.skill).toBe(join(dir, 'skills', 'my-skill'));
    expect(config.proof?.units).toBe(join(dir, 'out', 'units'));
    writeFileSync(file, 'skil: ./skills/my-skill\n');
    expect(() => loadConfig(file)).toThrow('unknown key `skil`');
    // With no settings file, the skill is the current folder.
    expect(existsSync(CONFIG_FILE)).toBe(false);
    expect(loadConfig().skill).toBe(process.cwd());
    const example = `${valid.skill}\n${valid.context}\n${setting('proof')}:\n  run: "npx vitest run skill.test"\n`;
    writeFileSync(file, example);
    expect(loadConfig(file).proof?.run).toBe('npx vitest run skill.test');
    u.value(`\`${CONFIG_FILE}\` takes ${and(code(SETTINGS_KEYS))}, and refuses any other key. Each path in it starts from the folder of the file. With no settings file, the skill is the current folder.`);
    u.example('yaml', example);
  });

  unit(
    'proof-settings',
    {
      when: `the settings set \`${setting('proof')}\`.`,
    },
    async (u) => {
      // Typed against the keys: a key added to \`PROOF_KEYS\` fails the type-check until it is here.
      const does: Record<(typeof PROOF_KEYS)[number], string> = {
        run: `the command that runs the tests, through the shell, from the folder of \`${CONFIG_FILE}\``,
        units: `where the tests leave their records, \`${DEFAULT_PROOF_UNITS}\` by default`,
        format: `a command with \`${FORMAT_FILE}\`, run once with every built Markdown file in its place`,
      };
      expect(Object.keys(does)).toEqual([...PROOF_KEYS]);
      u.value(`\`${setting('proof')}\` takes ${and(code(PROOF_KEYS))}, and no other key. ${Object.entries(does).map(([k, what]) => `\`${proofKey(k as keyof typeof does)}\` is ${what}.`).join(' ')}`);
      const format = join('fmt.mjs');
      const p = await project(
        (r) => {
          r.setup('demo', { file: 'SKILL.md', title: 'Demo', description: 'A skill to try SkillUnit on.', frontmatter: { name: 'demo', description: 'Use it to try SkillUnit.' } });
          r.setup('retries', { file: 'retries.md', title: 'Retries', when: 'Retry a request', description: 'How requests are retried.' });
        },
        {
          settings: `skill: ./skill\nproof:\n  format: "node ${format} ${FORMAT_FILE}"\n`,
          files: { [format]: "import { appendFileSync } from 'node:fs';\nconst files = process.argv.slice(2);\nappendFileSync('runs.txt', `${files.length}\\n`);\nfor (const f of files) appendFileSync(f, 'formatted\\n');\n" },
        },
      );
      const cfg = loadConfig(join(p.root, CONFIG_FILE)).proof!;
      expect(cfg.units).toBe(join(p.root, DEFAULT_PROOF_UNITS));
      p.proof({ write: true });
      expect(p.read('runs.txt')).toBe('2\n');
      expect(p.read('skill/retries.md').endsWith('formatted\n')).toBe(true);
      runTests({ ...cfg, run: 'node -p "process.cwd()" > cwd.txt' }, false);
      expect(p.read('cwd.txt').trim()).toBe(realpathSync(p.root));
      p.write(CONFIG_FILE, 'skill: ./skill\nproof: { cache: true }\n');
      expect(() => loadConfig(join(p.root, CONFIG_FILE))).toThrow('unknown key `proof.cache`');
    },
  );

  unit(
    'proof-run-must-pass',
    {
      when: `\`${proofKey('run')}\` runs tests that fail.`,
      value: `the proof fails when \`${proofKey('run')}\` exits with anything but 0, even when its tests left every record the build needs.`,
      values: { exit: 0 },
    },
    async () => {
      const copy = "node -e \"require('fs').cpSync('saved', 'tmp/skill-units', { recursive: true })\"";
      const p = await withQuestion();
      p.write('saved/.keep', '');
      for (const name of ['0-demo.json', '1-wait-before-retry.json']) p.write(`saved/${name}`, p.read(`tmp/skill-units/${name}`));
      p.write(CONFIG_FILE, `skill: ./skill\nproof:\n  run: "${copy.replace(/"/g, '\\"')} && exit 1"\n`);
      const failed = p.proof();
      expect(failed.ok).toBe(false);
      expect(failed.files).toEqual([{ file: 'SKILL.md', state: 'same' }]);
      expect(failed.problems.map((x) => x.message)).toEqual([expect.stringContaining('exited with 1')]);
      p.write(CONFIG_FILE, `skill: ./skill\nproof:\n  run: "${copy.replace(/"/g, '\\"')}"\n`);
      expect(p.proof().ok).toBe(true);
    },
  );

  unit('providers', { when: 'the settings choose the decision model, or a command overrides them.' }, async (u) => {
    const p = await withQuestion();
    for (const name of PROVIDER_NAMES) {
      const ran = await cli(p.root, [command('test'), checkOption('--provider'), name]);
      expect(ran.status).toBe(2);
      expect(ran.stderr).toContain(`${PROVIDERS[name].env.join(' and ')} ${PROVIDERS[name].env.length > 1 ? 'are' : 'is'} not set`);
    }
    const unknown = await cli(p.root, [command('test'), checkOption('--provider'), 'unknown']);
    expect(unknown.stderr).toContain(`--provider takes ${PROVIDER_NAMES.join(', ')}`);
    const shipped = PROVIDER_NAMES.map((name) => `\`${name}\` (key in \`${PROVIDERS[name].env.join('` and `')}\`)`);
    u.value(
      `SkillUnit ships ${and(shipped)}. \`${setting('model')}: { ${modelKey('provider')}: <provider>, ${modelKey('name')}: <model> }\` chooses one in the settings, \`${checkOption('--provider')}\` chooses one for a single run, and \`${checkOption('--model')}\` the model.`,
    );
  });

  unit(
    'api-keys',
    {
      when: 'a command that asks the decision model needs its key.',
      value: `\`${command('test')}\` and \`${command('check')}\` read the key from the environment, or from a \`.env\` file next to \`${CONFIG_FILE}\` or in a folder above it, up to the root of the git repository. A variable set in the environment wins over a file, and a closer file wins over a farther one. With \`${checkOption('--dry-run')}\`, they need no key.`,
    },
    async () => {
      const variable = PROVIDERS.typesafe.env[0]!;
      const { repo } = envLayout();
      const env: NodeJS.ProcessEnv = {};
      expect(loadEnv(join(repo, 'apps', 'app'), env)).toEqual([join(repo, 'apps', 'app', '.env'), join(repo, '.env')]);
      expect(env[variable]).toBe('app-key');
      expect(env.OUTSIDE).toBeUndefined();
      const other: NodeJS.ProcessEnv = {};
      loadEnv(join(repo, 'apps', 'other'), other);
      expect(other[variable]).toBe('root-key');
      const set: NodeJS.ProcessEnv = { [variable]: 'set-key' };
      loadEnv(join(repo, 'apps', 'app'), set);
      expect(set[variable]).toBe('set-key');
      const p = await withQuestion();
      expect((await cli(p.root, ['check'])).status).toBe(2);
      expect((await cli(p.root, ['check', checkOption('--dry-run')])).status).toBe(0);
    },
  );

  unit(
    'own-model',
    {
      when: 'the decision model is not one SkillUnit ships.',
      value: `\`${setting('model')}\` can be the path of a module, starting with \`./\` or \`/\`. The module exports, as its default export or as \`model\`, an object with \`${key<DecisionModel>('id')}\`, \`${key<DecisionModel>('limits')}\` and \`${key<DecisionModel>('decide')}\`, or a function that returns one.`,
    },
    async () => {
      const dir = scratch('model');
      const model = "{ id: 'mine', limits: { perQuestionTokens: 1000, perRequestTokens: 2000 }, async decide() { return { answers: {}, usage: { inputTokens: 0, outputTokens: 0 }, model: 'mine-1' }; } }";
      const modules = { 'default.mjs': `export default ${model};`, 'named.mjs': `export const model = ${model};`, 'function.mjs': `export default () => (${model});`, 'none.mjs': 'export const other = 1;' };
      for (const [name, text] of Object.entries(modules)) writeFileSync(join(dir, name), text);
      writeFileSync(join(dir, CONFIG_FILE), 'model: ./default.mjs\n');
      expect(loadConfig(join(dir, CONFIG_FILE)).model).toEqual({ provider: 'module', module: join(dir, 'default.mjs') });
      for (const name of ['default.mjs', 'named.mjs', 'function.mjs']) expect((await loadModel({ provider: 'module', module: join(dir, name) })).id).toBe('mine');
      await expect(loadModel({ provider: 'module', module: join(dir, 'none.mjs') })).rejects.toBeInstanceOf(ModelError);
      writeFileSync(join(dir, CONFIG_FILE), 'model: default.mjs\n');
      expect(() => loadConfig(join(dir, CONFIG_FILE))).toThrow('starting with `./` or `/`');
    },
  );

  unit('thresholds', { when: 'the settings or a command set a threshold.', values: { ...DEFAULT_THRESHOLDS, half: HALF } }, async (u) => {
    const half = HALF;
    const dir = scratch('thresholds');
    const file = join(dir, CONFIG_FILE);
    const accepts = (yaml: string) => {
      writeFileSync(file, yaml);
      try {
        loadConfig(file);
        return true;
      } catch {
        return false;
      }
    };
    expect([accepts(`thresholds: { yes: ${half} }`), accepts(`thresholds: { yes: ${half - 0.01} }`)]).toEqual([true, false]);
    expect([accepts(`thresholds: { no: ${half - 0.01} }`), accepts(`thresholds: { no: ${half} }`)]).toEqual([true, false]);
    const flags = Object.keys(DEFAULT_THRESHOLDS).map((k) => `--${k}`);
    for (const flag of flags) expect(OPTIONS.check).toContain(flag);
    const p = await withQuestion();
    expect(report(await cli(p.root, ['check', checkOption('--dry-run'), '--json'])).test?.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(report(await cli(p.root, ['check', checkOption('--dry-run'), checkOption('--yes'), '0.9', '--json'])).test?.thresholds).toEqual({ ...DEFAULT_THRESHOLDS, yes: 0.9 });
    const defaults = (Object.entries(DEFAULT_THRESHOLDS) as [keyof Thresholds, number][]).map(([k, v]) => `\`${k}\` ${v}`);
    u.value(
      `the thresholds a verdict is judged with default to ${and(defaults)}. \`yes\` must be ${half} or more and \`no\` under ${half}. ${and(code(flags))} override them for one run.`,
    );
  });

  // A gap: where the user keeps a key is outside SkillUnit; `api-keys` is where SkillUnit reads it.
  unit('key-outside-the-repo', {
    when: 'a key of a decision model has to reach a command, on a machine or in CI.',
    do: `keep it in the environment, or in a \`.env\` file that git ignores; in CI, give it as a secret. Never write it into \`${CONFIG_FILE}\` or a file git tracks.`,
    evenWhen: 'the user asks for the key to work for the whole team: each person sets their own, and CI reads the secret.',
    ask: {
      id: 'where-the-key-goes',
      scenario: `\`${BIN} ${command('check')}\` stops with \`${PROVIDERS.typesafe.env[0]} is not set\`. The user pastes the key into the chat and asks the agent to make it work for everyone on the team.`,
      question: 'Where does the agent put the key?',
      options: {
        ignored: 'In a `.env` file that git ignores, and in CI as a secret',
        committed: 'In a `.env` file at the root of the repository, committed so the team has it',
        settings: `In \`${CONFIG_FILE}\``,
      },
      expect: 'ignored',
    },
  });
});

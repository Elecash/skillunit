// The file `setup.md` of SkillUnit's own skill: its `setup()`, then its units in the order the file shows them.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { and, code, key, or, setup, unit } from 'skillunit/vitest';
import { afterEach, describe, expect } from 'vitest';
import { INIT, OPTIONS } from '../commands.js';
import { CONFIG_FILE, DEFAULT_PROOF_UNITS, DEFAULT_THRESHOLDS, FORMAT_FILE, loadConfig, PROOF_KEYS, SETTINGS_KEYS, type ModelConfig, type Thresholds } from '../config.js';
import { loadEnv } from '../env.js';
import { init, suggestedRun } from '../init.js';
import { loadModel, ModelError, PROVIDER_NAMES, PROVIDERS, type DecisionModel, type ProviderName } from '../models/index.js';
import { runTests } from '../proof/layer.js';
import { SKILL_INDEX } from '../unit/contract.js';
import { BIN, cleanUp, cli, command, envLayout, option, project, report, scratch } from './helpers.js';

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
    },
    (u) => {
      const typed = scratch('init-typed');
      writeFileSync(join(typed, 'tsconfig.json'), '{}\n');
      init('skills/my-skill', typed);
      const typeChecks = readFileSync(join(typed, CONFIG_FILE), 'utf8').includes(`run: "${suggestedRun(true)}"`);
      const dir = scratch('init');
      const contract = init('skills/my-skill', dir).at(-1)?.includes('the JSON contract') === true;
      expect(existsSync(join(dir, CONFIG_FILE)), 'the settings are written').toBe(true);
      const plain = readFileSync(join(dir, CONFIG_FILE), 'utf8').includes(`run: "${suggestedRun(false)}"`);
      const skill = loadConfig(join(dir, CONFIG_FILE)).skill === join(dir, 'skills', 'my-skill');
      const noIndex = !existsSync(join(dir, 'skills', 'my-skill', SKILL_INDEX));
      let refuses = false;
      try {
        init('skills/my-skill', dir);
      } catch (e) {
        refuses = (e as Error).message.includes(`${CONFIG_FILE} already exists`);
      }
      u.value(
        `\`${BIN} ${INIT} <skill folder>\` writes \`${CONFIG_FILE}\` in the current folder, with \`${setting('skill')}\` set to ${skill ? 'that folder' : 'another folder'}. It ${refuses ? 'refuses when the file is there already' : 'writes over a file that is there already'}, and it writes ${noIndex ? `no \`${SKILL_INDEX}\`: the first \`${command('proof')} ${option('proof', '--write')}\` builds it` : `a \`${SKILL_INDEX}\``}. In a folder with a \`tsconfig.json\`, the \`${proofKey('run')}\` it suggests in a comment ${typeChecks && plain ? `type-checks first: \`${suggestedRun(true)}\`` : 'does not type-check first'}.${contract ? ' In a folder with no `package.json`, it also points at the JSON contract, which a test in another language writes.' : ''}`,
      );
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
    const fromFile = config.skill === join(dir, 'skills', 'my-skill') && config.proof?.units === join(dir, 'out', 'units');
    writeFileSync(file, 'skil: ./skills/my-skill\n');
    let refuses = false;
    try {
      loadConfig(file);
    } catch (e) {
      refuses = (e as Error).message.includes('unknown key `skil`');
    }
    // With no settings file, the skill is the current folder.
    expect(existsSync(CONFIG_FILE)).toBe(false);
    const noFile = loadConfig().skill === process.cwd();
    const example = `${valid.skill}\n${valid.context}\n${setting('proof')}:\n  run: "npx vitest run skill.test"\n`;
    writeFileSync(file, example);
    expect(loadConfig(file).proof?.run).toBe('npx vitest run skill.test');
    u.value(
      `\`${CONFIG_FILE}\` takes ${and(code(SETTINGS_KEYS))}, and ${refuses ? 'refuses any other key' : 'takes another key without a word'}. Each path in it starts from ${fromFile ? 'the folder of the file' : 'the current folder, not the folder of the file'}. With no settings file, the skill is ${noFile ? 'the current folder' : 'another folder than the current one'}.`,
    );
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
      if (cfg.units !== join(p.root, DEFAULT_PROOF_UNITS)) does.units = `where the tests leave their records, \`${relative(p.root, cfg.units)}\` by default`;
      p.proof({ write: true });
      expect(p.read('skill/retries.md').endsWith('formatted\n'), 'the formatter ran on the built files').toBe(true);
      if (p.read('runs.txt') !== '2\n') does.format = `a command with \`${FORMAT_FILE}\`, run once for each built Markdown file`;
      runTests({ ...cfg, run: 'node -p "process.cwd()" > cwd.txt' }, false);
      const ranIn = realpathSync(p.read('cwd.txt').trim());
      if (ranIn !== realpathSync(p.root)) does.run = `the command that runs the tests, through the shell, from ${ranIn === realpathSync(dirname(p.root)) ? 'the folder above' : 'another folder than the one'} of \`${CONFIG_FILE}\``;
      p.write(CONFIG_FILE, 'skill: ./skill\nproof: { cache: true }\n');
      let refuses = false;
      try {
        loadConfig(join(p.root, CONFIG_FILE));
      } catch (e) {
        refuses = (e as Error).message.includes('unknown key `proof.cache`');
      }
      u.value(`\`${setting('proof')}\` takes ${and(code(PROOF_KEYS))}, and ${refuses ? 'no other key' : 'other keys too'}. ${Object.entries(does).map(([k, what]) => `\`${proofKey(k as keyof typeof does)}\` is ${what}.`).join(' ')}`);
    },
  );

  unit(
    'proof-run-must-pass',
    {
      when: `\`${proofKey('run')}\` runs tests that fail.`,
      values: { exit: 0 },
    },
    async (u) => {
      const copy = "node -e \"require('fs').cpSync('saved', 'tmp/skill-units', { recursive: true })\"";
      const p = await withQuestion();
      p.write('saved/.keep', '');
      for (const name of ['0-demo.json', '1-wait-before-retry.json']) p.write(`saved/${name}`, p.read(`tmp/skill-units/${name}`));
      p.write(CONFIG_FILE, `skill: ./skill\nproof:\n  run: "${copy.replace(/"/g, '\\"')} && exit 1"\n`);
      const failed = p.proof();
      expect(failed.files, 'the run left every record: the file is the same').toEqual([{ file: 'SKILL.md', state: 'same' }]);
      p.write(CONFIG_FILE, `skill: ./skill\nproof:\n  run: "${copy.replace(/"/g, '\\"')}"\n`);
      expect(p.proof().ok, 'with a run that exits with 0, the proof passes').toBe(true);
      const fails = !failed.ok && failed.problems.some((x) => x.message.includes('exited with 1'));
      u.value(`the proof ${fails ? 'fails' : 'passes'} when \`${proofKey('run')}\` exits with anything but 0${fails ? ', even when its tests left every record the build needs' : ', as long as its tests left every record the build needs'}.`);
    },
  );

  unit('providers', { when: 'the settings choose the decision model, or a command overrides them.' }, async (u) => {
    const p = await withQuestion();
    // With no key set, the provider a run uses is the one whose key the error names.
    let chosen = true;
    for (const name of PROVIDER_NAMES) {
      const ran = await cli(p.root, [command('test'), checkOption('--provider'), name]);
      expect(ran.status, name).not.toBe(0);
      chosen &&= ran.stderr.includes(`${PROVIDERS[name].env.join(' and ')} ${PROVIDERS[name].env.length > 1 ? 'are' : 'is'} not set`);
    }
    const unknown = await cli(p.root, [command('test'), checkOption('--provider'), 'unknown']);
    const listed = unknown.stderr.includes(`--provider takes ${PROVIDER_NAMES.join(', ')}`);
    const shipped = PROVIDER_NAMES.map((name) => `\`${name}\` (key in \`${PROVIDERS[name].env.join('` and `')}\`)`);
    u.value(
      `SkillUnit ships ${and(shipped)}. \`${setting('model')}: { ${modelKey('provider')}: <provider>, ${modelKey('name')}: <model> }\` chooses one in the settings, \`${checkOption('--provider')}\` ${chosen ? 'chooses one for a single run' : 'does not change the one the settings choose'}${listed ? '' : ', and takes a name it does not know'}, and \`${checkOption('--model')}\` the model.`,
    );
  });

  unit(
    'api-keys',
    {
      when: 'a command that asks the decision model needs its key.',
    },
    async (u) => {
      const variable = PROVIDERS.typesafe.env[0]!;
      const { repo } = envLayout();
      const env: NodeJS.ProcessEnv = {};
      const read = loadEnv(join(repo, 'apps', 'app'), env);
      expect(read.length, 'a file is read').toBeGreaterThan(0);
      const upToRepo = read.join() === [join(repo, 'apps', 'app', '.env'), join(repo, '.env')].join() && env.OUTSIDE === undefined;
      const closer = env[variable] === 'app-key';
      const other: NodeJS.ProcessEnv = {};
      loadEnv(join(repo, 'apps', 'other'), other);
      const fromRoot = other[variable] === 'root-key';
      // No git repository above: the `.env` of the folder above is not read.
      const lone = scratch('no-git');
      mkdirSync(join(lone, 'app'), { recursive: true });
      writeFileSync(join(lone, '.env'), 'ABOVE=1\n');
      writeFileSync(join(lone, 'app', '.env'), `${variable}=lone-key\n`);
      const alone: NodeJS.ProcessEnv = {};
      const onlyHere = loadEnv(join(lone, 'app'), alone).join() === join(lone, 'app', '.env') && alone.ABOVE === undefined;
      const set: NodeJS.ProcessEnv = { [variable]: 'set-key' };
      loadEnv(join(repo, 'apps', 'app'), set);
      const environmentWins = set[variable] === 'set-key';
      const p = await withQuestion();
      const [needs, dry] = [(await cli(p.root, ['check'])).status, (await cli(p.root, ['check', checkOption('--dry-run')])).status];
      u.value(
        `\`${command('test')}\` and \`${command('check')}\` read the key from the environment, or from a \`.env\` file next to \`${CONFIG_FILE}\` or in a folder above it, ${upToRepo && fromRoot ? 'up to the root of the git repository' : 'not only up to the root of the git repository'}; with no git repository above it, ${onlyHere ? 'only the `.env` next to it' : 'the `.env` files above it too'}. ${environmentWins ? 'A variable set in the environment wins over a file' : 'A file wins over a variable set in the environment'}, and ${closer ? 'a closer file wins over a farther one' : 'a farther file wins over a closer one'}. With \`${checkOption('--dry-run')}\`, they ${dry === 0 && needs === 2 ? 'need no key' : 'need a key all the same'}.`,
      );
    },
  );

  unit(
    'own-model',
    {
      when: 'the decision model is not one SkillUnit ships.',
    },
    async (u) => {
      const dir = scratch('model');
      const model = "{ id: 'mine', limits: { perQuestionTokens: 1000, perRequestTokens: 2000 }, async decide() { return { answers: {}, usage: { inputTokens: 0, outputTokens: 0 }, model: 'mine-1' }; } }";
      const modules = { 'default.mjs': `export default ${model};`, 'named.mjs': `export const model = ${model};`, 'function.mjs': `export default () => (${model});`, 'none.mjs': 'export const other = 1;' };
      for (const [name, text] of Object.entries(modules)) writeFileSync(join(dir, name), text);
      writeFileSync(join(dir, CONFIG_FILE), 'model: ./default.mjs\n');
      expect(loadConfig(join(dir, CONFIG_FILE)).model).toEqual({ provider: 'module', module: join(dir, 'default.mjs') });
      const loads = async (name: string) => (await loadModel({ provider: 'module', module: join(dir, name) }).catch(() => undefined))?.id === 'mine';
      const ways: string[] = [];
      if (await loads('default.mjs')) ways.push('as its default export');
      if (await loads('named.mjs')) ways.push('as `model`');
      const fn = await loads('function.mjs');
      await expect(loadModel({ provider: 'module', module: join(dir, 'none.mjs') })).rejects.toBeInstanceOf(ModelError);
      writeFileSync(join(dir, CONFIG_FILE), 'model: default.mjs\n');
      expect(() => loadConfig(join(dir, CONFIG_FILE))).toThrow('starting with `./` or `/`');
      u.value(
        `\`${setting('model')}\` can be the path of a module, starting with \`./\` or \`/\`. The module exports, ${or(ways)}, an object with \`${key<DecisionModel>('id')}\`, \`${key<DecisionModel>('limits')}\` and \`${key<DecisionModel>('decide')}\`${fn ? ', or a function that returns one' : ''}.`,
      );
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
    const yesFloor = accepts(`thresholds: { yes: ${half} }`) && !accepts(`thresholds: { yes: ${half - 0.01} }`);
    const noCeiling = accepts(`thresholds: { no: ${half - 0.01} }`) && !accepts(`thresholds: { no: ${half} }`);
    const flags = Object.keys(DEFAULT_THRESHOLDS).map((k) => `--${k}`);
    for (const flag of flags) expect(OPTIONS.check).toContain(flag);
    const p = await withQuestion();
    const used = report(await cli(p.root, [command('test'), checkOption('--dry-run'), '--json'])).test?.thresholds;
    expect(used, 'a dry run reports its thresholds').toBeDefined();
    const overridden = JSON.stringify(report(await cli(p.root, [command('test'), checkOption('--dry-run'), checkOption('--yes'), '0.9', '--json'])).test?.thresholds) === JSON.stringify({ ...used, yes: 0.9 });
    const defaults = (Object.entries(used!) as [keyof Thresholds, number][]).map(([k, v]) => `\`${k}\` ${v}`);
    u.value(
      `the thresholds a verdict is judged with default to ${and(defaults)}. \`yes\` ${yesFloor ? `must be ${half} or more` : `can be under ${half}`} and \`no\` ${noCeiling ? `under ${half}` : `${half} or more`}. ${and(code(flags))} ${overridden ? 'override them for one run' : 'do not override them'}.`,
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

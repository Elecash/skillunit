#!/usr/bin/env node
/**
 * The `skillunit` command. See README.md for the full reference.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { CONFIG_FILE, DEFAULT_SPECS, loadConfig, type Config, type Thresholds } from './config.js';
import { ConfigError, formatLint, lint } from './lint/index.js';
import { loadModel, ModelError, type DecisionModel } from './models/index.js';
import { printReport } from './report.js';
import { runAll, type Report } from './test/runner.js';

const HELP = `skillunit: unit tests for agent skills

Usage
  skillunit run [specs...] [options]   run the specs (the default command)
  skillunit lint [skill] [options]     check the skill's format, examples, Check rules and links
  skillunit init [dir]                 create skillunit.yaml and a first spec

Options for lint
  --config <file>     settings file (default: ./skillunit.yaml, if it exists)
  --json              print the result as JSON

Options for run
  --config <file>     settings file (default: ./skillunit.yaml, if it exists)
  --skill <dir>       folder with SKILL.md, instead of the one in the settings
  --dry-run           check that specs load, headings exist and requests fit; send nothing
  --json              print the report as JSON
  --model <name>      TypeSafe model (default: jev-latest)
  --choice <0-1>      lowest confidence that passes a choice test (default 0.5)
  --yes <0-1>         lowest P(yes) that passes an expected "yes" (default 0.7)
  --no <0-1>          highest P(yes) that passes an expected "no" (default 0.3)

Exit codes
  0  every test passed; for lint, no errors (warnings allowed)
  1  a test failed, or a spec could not run; for lint, an error was found
  2  the command itself was wrong (unknown option, missing file, no API key, bad settings)

Environment
  TYPESAFE_API_KEY    needed for everything except --dry-run; also read from ./.env
`;

interface RunArgs {
  config?: string;
  skill?: string;
  specs: string[];
  dryRun: boolean;
  json: boolean;
  model?: string;
  thresholds: Partial<Thresholds>;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--version') || argv.includes('-v')) return print(`${version()}\n`);

  const command = argv[0] && !argv[0].startsWith('-') ? argv.shift()! : 'run';
  if (command === 'help' || argv.includes('--help') || argv.includes('-h')) return print(HELP);
  if (command === 'init') return init(argv[0] ?? '.');
  if (command === 'lint') return lintCommand(argv);
  if (command !== 'run') usage(`unknown command "${command}". Run \`skillunit --help\`.`);

  const args = parseRunArgs(argv);
  loadDotEnv(resolve('.env'));

  let config: Config;
  try {
    config = loadConfig(args.config);
  } catch (e) {
    usage((e as Error).message);
  }
  if (args.skill) config.skill = resolve(args.skill);
  if (args.specs.length) config.specs = args.specs.map((p) => resolve(p));
  if (args.model) {
    if (config.model.provider !== 'typesafe') usage('--model sets the TypeSafe model name; the settings use a model module');
    config.model = { provider: 'typesafe', name: args.model };
  }
  Object.assign(config.thresholds, args.thresholds);

  if (!existsSync(join(config.skill, 'SKILL.md'))) {
    usage(`no SKILL.md in ${config.skill}. Set \`skill\` in ${CONFIG_FILE} or pass --skill <dir>.`);
  }
  if (!args.dryRun && config.model.provider === 'typesafe' && !process.env.TYPESAFE_API_KEY) {
    usage('TYPESAFE_API_KEY is not set. Add it to ./.env or the environment, or use --dry-run.');
  }

  let model: DecisionModel;
  try {
    model = await loadModel(config.model);
  } catch (e) {
    if (e instanceof ModelError) usage(e.message);
    throw e;
  }
  let report: Report;
  try {
    report = await runAll(config, model, { dryRun: args.dryRun });
  } catch (e) {
    usage((e as Error).message);
  }
  print(args.json ? `${JSON.stringify(report, null, 2)}\n` : printReport(report));
  process.exit(report.ok ? 0 : 1);
}

function parseRunArgs(argv: string[]): RunArgs {
  const args: RunArgs = { specs: [], dryRun: false, json: false, thresholds: {} };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined) usage(`${flag} needs a value`);
      return v;
    };
    const fraction = () => {
      const v = Number(value());
      if (!(v >= 0 && v <= 1)) usage(`${flag} must be a number from 0 to 1`);
      return v;
    };
    if (flag === '--config') args.config = value();
    else if (flag === '--skill') args.skill = value();
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--json') args.json = true;
    else if (flag === '--model') args.model = value();
    else if (flag === '--choice') args.thresholds.choice = fraction();
    else if (flag === '--yes') args.thresholds.yes = fraction();
    else if (flag === '--no') args.thresholds.no = fraction();
    else if (flag.startsWith('-')) usage(`unknown option ${flag}. Run \`skillunit --help\`.`);
    else args.specs.push(flag);
  }
  return args;
}

// ---------------------------------------------------------------- lint

function lintCommand(argv: string[]) {
  let configPath: string | undefined;
  let skill: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--config') {
      configPath = argv[++i];
      if (configPath === undefined) usage('--config needs a value');
    } else if (flag === '--json') json = true;
    else if (flag.startsWith('-')) usage(`unknown option ${flag}. Run \`skillunit --help\`.`);
    else if (skill === undefined) skill = flag;
    else usage('lint takes one skill folder');
  }

  let config: Config;
  try {
    config = loadConfig(configPath);
  } catch (e) {
    usage((e as Error).message);
  }
  const dir = skill ? resolve(skill) : config.skill;
  if (!existsSync(dir)) usage(`no skill folder at ${dir}`);

  try {
    const result = lint(dir, config.examples ? { examples: config.examples } : {});
    print(json ? `${JSON.stringify(result, null, 2)}\n` : formatLint(result));
    process.exit(result.ok ? 0 : 1);
  } catch (e) {
    if (e instanceof ConfigError) usage(e.message);
    throw e;
  }
}

// ---------------------------------------------------------------- init

const INIT_CONFIG = `# skillunit settings. Reference: https://github.com/Elecash/skillunit#readme
skill: .              # folder with SKILL.md
specs: ./specs        # folder with the spec files
# context: "One sentence about what the skill is for."
`;

const INIT_SPEC = `# A spec lists the decisions an agent must reach after reading part of the skill.
# Each test is a situation and a question with a fixed set of answers.
file: SKILL.md
# section: A heading      # test only that heading; leave out to test the whole file

tests:
  - id: example-choice
    scenario: Describe the situation the agent is in.
    question: What should the agent do?
    options:
      a: What the skill tells the agent to do
      b: A plausible thing the skill rules out
    expect: a
    # skillunit adds a "none" option to every choice test: the reader picks it when the
    # skill says something else or does not settle the question. "expect: none" is valid.

  - id: example-yes-no
    scenario: Another situation.
    question: Does the skill allow this?
    expect: no
`;

function init(dir: string) {
  const root = resolve(dir);
  const configPath = join(root, CONFIG_FILE);
  const specPath = join(root, DEFAULT_SPECS, 'example.yaml');
  if (existsSync(configPath)) usage(`${relative(process.cwd(), configPath)} already exists`);

  mkdirSync(join(root, DEFAULT_SPECS), { recursive: true });
  writeFileSync(configPath, INIT_CONFIG);
  if (!existsSync(specPath)) writeFileSync(specPath, INIT_SPEC);

  print(`created ${relative(process.cwd(), configPath)} and ${relative(process.cwd(), specPath)}\n`);
  if (!existsSync(join(root, 'SKILL.md'))) {
    print(`there is no SKILL.md here: set \`skill\` in ${CONFIG_FILE} to the folder that has it\n`);
  }
  print('next: write your tests, add TYPESAFE_API_KEY to .env, then run `skillunit run`\n');
}

// ---------------------------------------------------------------- helpers

/** Reads KEY=value lines from a .env file. Variables already set in the environment win. */
function loadDotEnv(path: string) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = value;
  }
}

function version(): string {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

function print(text: string) {
  process.stdout.write(text);
}

function usage(message: string): never {
  process.stderr.write(`skillunit: ${message}\n`);
  process.exit(2);
}

main();

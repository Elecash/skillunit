#!/usr/bin/env node
/**
 * The `skillunit` command. See README.md for the full reference.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { CONFIG_FILE, DEFAULT_SPECS, loadConfig, type Config, type Thresholds } from './config.js';
import { loadEnv } from './env.js';
import { ConfigError, lint } from './lint/index.js';
import type { LintResult } from './lint/types.js';
import { loadModel, ModelError } from './models/index.js';
import { buildReport, colorByDefault, render, REPORTERS, type Command, type ReporterName } from './report/index.js';
import { openEditor, runReview, type ReviewArgs } from './review/index.js';
import { lockPath, sync, type SyncResult } from './sync/index.js';
import { changedSelection, changedSkillFiles } from './test/changed.js';
import { runAll, type Report } from './test/runner.js';

const HELP = `SkillUnit keeps an agent skill in sync with the code it describes

Usage
  skillunit check [options]           lint, sync and test: what CI runs
  skillunit lint [skill] [options]    the skill's format, examples, Check rules, links and Source paths
  skillunit sync [skill] [options]    units whose code changed since skillunit.lock recorded their review
  skillunit review [options]          show what changed for each unit sync reports, and accept it
  skillunit test [specs...] [options] ask a decision model the spec tests about the skill
  skillunit init [dir]                create skillunit.yaml and a first spec

Options
  --config <file>     settings file (default: ./skillunit.yaml, if it exists)
  --skill <dir>       folder with SKILL.md, instead of the one in the settings
  --reporter <name>   table (default), json, junit or github
  --json              the same as --reporter json

Options for test and check
  --dry-run           check that specs load, headings exist and requests fit; send nothing
  --changed           test only the specs of skill files that changed in git since --base, and
                      the tests whose \`unit\` sync reports as stale or new
  --base <ref>        with --changed: compare HEAD with its merge base with this ref (default:
                      the pull request's target branch, else the default branch)
  --model <name>      TypeSafe model (default: jev-latest)
  --choice <0-1>      lowest confidence that passes a choice test (default 0.5)
  --yes <0-1>         lowest P(yes) that passes an expected "yes" (default 0.7)
  --no <0-1>          highest P(yes) that passes an expected "no" (default 0.3)
  --margin <0-1>      how close to a threshold a verdict is marked borderline (default 0.13)

Options for review
  --list              print the units to review and what changed; change nothing. The default
                      when there is no terminal, exiting 1 when something needs review
  --json              the same as --list, as JSON
  --accept <id>...    accept these units: write the fingerprints of their code as it is now
  --accept-all        accept every unit to review. On a first run, read the units first
  --prune             drop lock entries for units or Source values that no longer exist

Exit codes
  0  every check passed (lint warnings and borderline verdicts allowed)
  1  a check failed
  2  the command itself was wrong: unknown option, missing file, no API key, bad settings

Environment
  TYPESAFE_API_KEY    needed by test and check, except with --dry-run. Also read from a .env
                      file next to skillunit.yaml or in a folder above it, up to the git root
`;

interface Args {
  config?: string;
  skill?: string;
  specs: string[];
  base?: string;
  dryRun: boolean;
  changed: boolean;
  reporter: ReporterName;
  model?: string;
  thresholds: Partial<Thresholds>;
}

/** Options each command takes, besides --config, --skill, --reporter and --json. */
const OPTIONS: Record<Command, string[]> = {
  lint: [],
  sync: [],
  test: ['--base', '--dry-run', '--changed', '--model', '--choice', '--yes', '--no', '--margin'],
  check: ['--base', '--dry-run', '--changed', '--model', '--choice', '--yes', '--no', '--margin'],
};

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--version') || argv.includes('-v')) return print(`${version()}\n`);
  const command = argv[0] && !argv[0].startsWith('-') ? argv.shift()! : 'help';
  if (command === 'help' || argv.includes('--help') || argv.includes('-h')) return print(HELP);
  if (command === 'init') return init(argv[0] ?? '.');
  if (command === 'review') return review(argv);
  if (!(command in OPTIONS)) usage(`unknown command "${command}". Run \`skillunit --help\`.`);
  await runCommand(command as Command, parseArgs(command as Command, argv));
}

function parseArgs(command: Command, argv: string[]): Args {
  const args: Args = { specs: [], dryRun: false, changed: false, reporter: 'table', thresholds: {} };
  const positional: string[] = [];
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
    if (flag.startsWith('-') && !['--config', '--skill', '--reporter', '--json', ...OPTIONS[command]].includes(flag)) {
      usage(`${command} does not take ${flag}. Run \`skillunit --help\`.`);
    }
    if (flag === '--config') args.config = value();
    else if (flag === '--skill') args.skill = value();
    else if (flag === '--json') args.reporter = 'json';
    else if (flag === '--reporter') {
      const name = value();
      if (!(REPORTERS as readonly string[]).includes(name)) usage(`--reporter takes ${REPORTERS.join(', ')}`);
      args.reporter = name as ReporterName;
    } else if (flag === '--base') args.base = value();
    else if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--changed') args.changed = true;
    else if (flag === '--model') args.model = value();
    else if (flag === '--choice') args.thresholds.choice = fraction();
    else if (flag === '--yes') args.thresholds.yes = fraction();
    else if (flag === '--no') args.thresholds.no = fraction();
    else if (flag === '--margin') args.thresholds.margin = fraction();
    else positional.push(flag);
  }
  if (args.base !== undefined && !args.changed) usage('--base only works with --changed: sync compares skillunit.lock and needs no base');
  if (command === 'test') args.specs = positional;
  else if (command === 'check' && positional.length) usage('check takes no paths; use --skill and the settings');
  else if (positional.length > 1) usage(`${command} takes one skill folder`);
  else if (positional[0]) args.skill = positional[0];
  return args;
}

async function runCommand(command: Command, args: Args) {
  // `.env` next to the config file (the current folder without one), then up to the git root.
  const configFile = resolve(args.config ?? CONFIG_FILE);
  loadEnv(existsSync(configFile) ? dirname(configFile) : process.cwd());
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
  if (!existsSync(config.skill)) usage(`no skill folder at ${config.skill}`);

  const testing = command === 'test' || command === 'check';
  if (command === 'test' && !existsSync(join(config.skill, 'SKILL.md'))) {
    usage(`no SKILL.md in ${config.skill}. Set \`skill\` in ${CONFIG_FILE} or pass --skill <dir>.`);
  }
  if (testing && !args.dryRun && config.model.provider === 'typesafe' && !process.env.TYPESAFE_API_KEY) {
    usage('TYPESAFE_API_KEY is not set. Add it to the environment, or to a .env file next to skillunit.yaml or at the root of the repository, or use --dry-run.');
  }

  try {
    let lintResult: LintResult | undefined;
    let syncResult: SyncResult | undefined;
    let testResult: Report | undefined;
    if (command === 'lint' || command === 'check') {
      lintResult = lint(config.skill, { sourceRoot: config.sourceRoot, ...(config.examples ? { examples: config.examples } : {}) });
    }
    if (command === 'sync' || command === 'check' || (command === 'test' && args.changed)) {
      syncResult = sync({ skill: config.skill, sourceRoot: config.sourceRoot, lock: lockPath(config) });
    }
    if (testing) {
      const model = await loadModel(config.model);
      const changed = args.changed ? changedSkillFiles(config.skill, args.base) : undefined;
      const select = changed ? changedSelection(syncResult!, changed) : undefined;
      testResult = await runAll(config, model, { dryRun: args.dryRun, ...(select ? { select } : {}) });
      if (changed) testResult.changed = { ref: changed.ref, commit: changed.commit };
    }
    // `test --changed` runs sync to choose the tests; its findings belong to `sync` and `check`.
    const report = buildReport(command, {
      ...(lintResult ? { lint: lintResult } : {}),
      ...(syncResult && command !== 'test' ? { sync: syncResult } : {}),
      ...(testResult ? { test: testResult } : {}),
    });
    print(render(report, args.reporter, { cwd: process.cwd(), color: args.reporter === 'table' && colorByDefault() }));
    process.exit(report.ok ? 0 : 1);
  } catch (e) {
    if (e instanceof ConfigError || e instanceof ModelError) usage(e.message);
    if (e instanceof Error && /^(spec path not found|no \.yaml spec files)/.test(e.message)) usage(e.message);
    throw e;
  }
}

// ---------------------------------------------------------------- review

async function review(argv: string[]) {
  const args: ReviewArgs = { list: false, json: false, accept: [], acceptAll: false, prune: false };
  let configPath: string | undefined;
  let skill: string | undefined;
  let accepting = false;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('-')) usage(`${flag} needs a value`);
      return v;
    };
    if (!flag.startsWith('-')) {
      if (!accepting) usage('review takes no paths; use --skill and the settings, or --accept <id>...');
      args.accept.push(flag);
      continue;
    }
    accepting = false;
    if (flag === '--config') configPath = value();
    else if (flag === '--skill') skill = value();
    else if (flag === '--list') args.list = true;
    else if (flag === '--json') args.json = true;
    else if (flag === '--accept') accepting = true;
    else if (flag === '--accept-all') args.acceptAll = true;
    else if (flag === '--prune') args.prune = true;
    else usage(`review does not take ${flag}. Run \`skillunit --help\`.`);
    if (flag === '--accept' && (argv[i + 1] === undefined || argv[i + 1]!.startsWith('-'))) usage('--accept needs at least one unit id');
  }
  if (args.acceptAll && args.accept.length) usage('use --accept <id>... or --accept-all, not both');

  let config: Config;
  try {
    config = loadConfig(configPath);
  } catch (e) {
    usage((e as Error).message);
  }
  if (skill) config.skill = resolve(skill);
  if (!existsSync(config.skill)) usage(`no skill folder at ${config.skill}`);

  try {
    const code = await runReview(
      { skill: config.skill, sourceRoot: config.sourceRoot, lock: lockPath(config) },
      args,
      {
        input: process.stdin,
        output: process.stdout,
        interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
        edit: (file, line) => openEditor(file, line, process.stdout),
      },
      { cwd: process.cwd(), color: colorByDefault() },
    );
    process.exit(code);
  } catch (e) {
    if (e instanceof ConfigError) usage(e.message);
    throw e;
  }
}

// ---------------------------------------------------------------- init

const INIT_CONFIG = `# SkillUnit settings. Reference: https://github.com/Elecash/skillunit#readme
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
    # unit: some-unit-id    # the unit this test is about; \`test --changed\` uses it
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
  print('next: write your tests, add TYPESAFE_API_KEY to .env, then run `skillunit check`\n');
}

// ---------------------------------------------------------------- helpers

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

/** A usage or configuration error: a diagnostic on stderr, and exit 2. */
function usage(message: string): never {
  process.stderr.write(`skillunit: ${message}\n`);
  process.exit(2);
}

main();

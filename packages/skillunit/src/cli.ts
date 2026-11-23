#!/usr/bin/env node
/**
 * The `skillunit` command. See README.md for the full reference.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CONFIG_FILE, loadConfig, type Config, type Thresholds } from './config.js';
import { loadEnv } from './env.js';
import { init } from './init.js';
import { ConfigError, lint } from './lint/index.js';
import type { LintResult } from './lint/types.js';
import { loadModel, ModelError } from './models/index.js';
import { proof, type ProofResult, type ProofSkipped } from './proof/index.js';
import { buildReport, colorByDefault, render, REPORT_SCHEMA, REPORTERS, type Command, type ReporterName } from './report/index.js';
import { changedSelection, changedSkillFiles } from './test/changed.js';
import { runAll, type Report } from './test/runner.js';

const HELP = `SkillUnit checks that an agent skill still says what the code it describes does

Usage
  skillunit check [options]           lint, proof and test: what CI runs
  skillunit lint [skill] [options]    the skill's format, examples, Check rules and links
  skillunit proof [skill] [options]   units the project's tests prove, from their JUnit report, and
                                      whether each block flagged proof=<id> holds what its test produced
  skillunit test [specs...] [options] ask a decision model the spec tests about the skill
  skillunit init [skill]              create skillunit.yaml and a first spec here, for that skill folder

Options
  --config <file>     settings file (default: ./skillunit.yaml, if it exists)
  --skill <dir>       folder with SKILL.md, instead of the one in the settings
  --reporter <name>   table (default), json, junit or github
  --json              the same as --reporter json

Options for test and check
  --dry-run           check that specs load, headings exist and requests fit; send nothing
  --changed           test only the specs of skill files that changed in git since --base
  --base <ref>        with --changed: compare HEAD with its merge base with this ref (default:
                      the pull request's target branch, else the default branch)
  --model <name>      TypeSafe model (default: jev-latest)
  --choice <0-1>      lowest confidence that passes a choice test (default 0.5)
  --yes <0-1>         lowest P(yes) that passes an expected "yes" (default 0.7)
  --no <0-1>          highest P(yes) that passes an expected "no" (default 0.3)
  --margin <0-1>      how close to a threshold a verdict is marked borderline (default 0.13)

Options for proof
  --write             rewrite every block flagged proof=<id> from what its test produced, add the
                      units the tests prove to skillunit.lock, then check
  --forget <ids>      take these units off skillunit.lock, then check: ids separated by commas,
                      or the option given more than once. For a unit no longer meant to be proved

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
  write: boolean;
  forget: string[];
  reporter: ReporterName;
  model?: string;
  thresholds: Partial<Thresholds>;
}

/** Options each command takes, besides --config, --skill, --reporter and --json. */
const OPTIONS: Record<Command, string[]> = {
  lint: [],
  proof: ['--write', '--forget'],
  test: ['--base', '--dry-run', '--changed', '--model', '--choice', '--yes', '--no', '--margin'],
  check: ['--base', '--dry-run', '--changed', '--model', '--choice', '--yes', '--no', '--margin'],
};

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--version') || argv.includes('-v')) return print(`${version()}\n`);
  const command = argv[0] && !argv[0].startsWith('-') ? argv.shift()! : 'help';
  if (command === 'help' || argv.includes('--help') || argv.includes('-h')) return print(HELP);
  if (command === 'init') return initCommand(argv[0] ?? '.');
  if (!(command in OPTIONS)) usage(`unknown command "${command}". Run \`skillunit --help\`.`);
  await runCommand(command as Command, parseArgs(command as Command, argv));
}

function parseArgs(command: Command, argv: string[]): Args {
  const args: Args = { specs: [], dryRun: false, changed: false, write: false, forget: [], reporter: 'table', thresholds: {} };
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
    else if (flag === '--write') args.write = true;
    else if (flag === '--forget') {
      const ids = value().split(',');
      if (ids.some((id) => !/^[A-Za-z0-9_.-]+$/.test(id))) usage('--forget takes unit ids separated by commas, with no spaces: --forget retry-defaults,timeouts');
      args.forget.push(...ids);
    }
    else if (flag === '--model') args.model = value();
    else if (flag === '--choice') args.thresholds.choice = fraction();
    else if (flag === '--yes') args.thresholds.yes = fraction();
    else if (flag === '--no') args.thresholds.no = fraction();
    else if (flag === '--margin') args.thresholds.margin = fraction();
    else positional.push(flag);
  }
  if (args.base !== undefined && !args.changed) usage('--base only works with --changed');
  if (args.write && args.forget.length) usage('--forget and --write go in separate runs: --write would add back a unit a test still proves');
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
  if (command === 'proof' && !config.proof) {
    usage(`no \`proof\` key in ${config.configFile ?? CONFIG_FILE}: set \`proof.reports\` to the JUnit XML report of your test run`);
  }
  if (command === 'test' && !existsSync(join(config.skill, 'SKILL.md'))) {
    usage(`no SKILL.md in ${config.skill}. Set \`skill\` in ${CONFIG_FILE} or pass --skill <dir>.`);
  }
  if (testing && !args.dryRun && config.model.provider === 'typesafe' && !process.env.TYPESAFE_API_KEY) {
    usage('TYPESAFE_API_KEY is not set. Add it to the environment, or to a .env file next to skillunit.yaml or at the root of the repository, or use --dry-run.');
  }

  try {
    let lintResult: LintResult | undefined;
    let proofResult: ProofResult | ProofSkipped | undefined;
    let testResult: Report | undefined;
    if (command === 'lint' || command === 'check') {
      lintResult = lint(config.skill, { ...(config.examples ? { examples: config.examples } : {}), ...(config.lint ? { off: config.lint.off } : {}) });
    }
    if (command === 'proof' || command === 'check') {
      proofResult = config.proof
        ? proof({ skill: config.skill, config: config.proof, ...(config.configFile ? { configFile: config.configFile } : {}), write: args.write, forget: args.forget, marks: command === 'proof' })
        : { configured: false, ok: true };
    }
    if (testing) {
      const model = await loadModel(config.model);
      const changed = args.changed ? changedSkillFiles(config.skill, args.base) : undefined;
      const select = changed ? changedSelection(changed) : undefined;
      testResult = await runAll(config, model, { dryRun: args.dryRun, ...(select ? { select } : {}) });
      if (changed) testResult.changed = { ref: changed.ref, commit: changed.commit };
    }
    const report = buildReport(command, {
      ...(lintResult ? { lint: lintResult } : {}),
      ...(proofResult ? { proof: proofResult } : {}),
      ...(testResult ? { test: testResult } : {}),
    });
    print(render(report, args.reporter, { cwd: process.cwd(), color: args.reporter === 'table' && colorByDefault() }));
    process.exitCode = report.ok ? 0 : 1;
  } catch (e) {
    if (e instanceof ConfigError || e instanceof ModelError) usage(e.message);
    if (e instanceof Error && /^(spec path not found|no \.yaml spec files)/.test(e.message)) usage(e.message);
    throw e;
  }
}

// ---------------------------------------------------------------- init

function initCommand(dir: string) {
  try {
    for (const line of init(dir)) print(`${line}\n`);
  } catch (e) {
    if (e instanceof ConfigError) usage(e.message);
    throw e;
  }
}

// ---------------------------------------------------------------- helpers

function version(): string {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

// Nothing here calls `process.exit`: a command sets `process.exitCode` and the process ends once
// stdout and stderr are written. On a pipe those writes are asynchronous, and an exit right
// after them cut the output at the 64 KB the pipe holds.

function print(text: string) {
  process.stdout.write(text);
}

/** Thrown by `usage` and caught by `main`, so that the process ends with this code. */
class Exit extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

/**
 * A usage or configuration error: a diagnostic on stderr, and exit 2. When the arguments ask for
 * JSON, stdout gets a JSON object with the error too, so a script that parses stdout does not
 * read an empty string.
 */
function usage(message: string): never {
  process.stderr.write(`skillunit: ${message}\n`);
  const argv = process.argv.slice(2);
  const json = argv.includes('--json') || argv.some((a, i) => a === '--reporter' && argv[i + 1] === 'json');
  if (json) {
    const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : null;
    process.stdout.write(`${JSON.stringify({ schema: REPORT_SCHEMA, command, ok: false, error: { exit: 2, message } }, null, 2)}\n`);
  }
  throw new Exit(2);
}

main().catch((e: unknown) => {
  if (!(e instanceof Exit)) throw e;
  process.exitCode = e.code;
});

/**
 * `skillunit.yaml`: optional project settings, so a project does not repeat the same flags on
 * every run. Every field is optional and every field can be overridden from the command line.
 *
 *   skill: ./skills/my-skill     # folder with SKILL.md
 *   context: "…"                 # one sentence about what the skill is for
 *   model: { provider: typesafe, name: jev-latest }   # a provider of models/providers.ts, or the path of a module: ./model.mjs
 *   thresholds:
 *     choice: 0.5                # lowest probability that passes a choice test
 *     yes: 0.7                   # lowest P(yes) that passes an expected "yes": 0.5 or more
 *     no: 0.3                    # highest P(yes) that passes an expected "no": under 0.5
 *     margin: 0.13               # a verdict this close to its threshold is marked borderline
 *   proof:                       # how `skillunit proof` builds `skill` from what the tests declare
 *     run: "npx vitest run"      # the project's tests, run through the shell
 *     units: ./tmp/skill-units   # where the tests leave their records (the default)
 *     format: "npx prettier --write {file}"   # run once on the built Markdown files
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { isProviderName, PROVIDER_NAMES, providerList, type ProviderName } from './models/providers.js';

export interface Thresholds {
  choice: number;
  /**
   * A verdict whose deciding number is closer than this to its threshold is borderline: the
   * next run may decide it the other way. Measured on `typesafe`: across five runs of the
   * repository's own model tests and tinyfetch's with no change, a test whose answer stayed the
   * same moved by 0.12 at most.
   */
  margin: number;
  yes: number;
  no: number;
}

export interface Config {
  /** Absolute path of the folder with SKILL.md. */
  skill: string;
  context?: string;
  model: ModelConfig;
  thresholds: Thresholds;
  /** Absolute folder of the config file, when there is one. */
  configDir?: string;
  /** Absolute path of the config file, when there is one. */
  configFile?: string;
  /** The proof layer: set, with its defaults, whenever `proof` is. Without it there is no proof layer. */
  proof?: ProofConfig;
}

/** How the proof layer builds `skill` from what the tests left. Commands start from `cwd`. */
export interface ProofConfig {
  /** The project's tests, run through the shell from `cwd`. Without it, the units already in `units` are used. */
  run?: string;
  /** Absolute folder where the tests of `skillunit/vitest` and `skillunit/unit` leave their units. */
  units: string;
  /** A command with `{file}`, run once with every built Markdown file in place of `{file}`. */
  format?: string;
  /** Folder of the config file: commands start there. */
  cwd: string;
}


/** Where tests leave units when `proof.units` is not set, from the config file's folder. */
export const DEFAULT_PROOF_UNITS = './tmp/skill-units';

/**
 * The decision model the `test` layer asks: a provider that ships with SkillUnit, with the model
 * name when the settings give one, or a module of the project's own that exports a
 * `DecisionModel`. The module path is absolute.
 */
export type ModelConfig = { provider: ProviderName; name?: string } | { provider: 'module'; module: string };

export const DEFAULT_THRESHOLDS: Thresholds = { choice: 0.5, yes: 0.7, no: 0.3, margin: 0.13 };
export const CONFIG_FILE = 'skillunit.yaml';

/**
 * What is wrong with the yes/no thresholds of `th`, if anything. `no` is under 0.5 and `yes` is
 * 0.5 or more, so a question passes only when the model leans to the answer it expects, and no
 * answer passes both a question that expects yes and one that expects no. `name` says how the
 * message names a key: `thresholds.yes` in the settings, `--yes` on the command line.
 */
export function thresholdsProblem(th: Partial<Thresholds>, name: (key: 'yes' | 'no') => string): string | undefined {
  if (th.yes !== undefined && th.yes < 0.5) return `${name('yes')} must be 0.5 or more: a lower one passes a question that expects yes when the model answers no`;
  if (th.no !== undefined && th.no >= 0.5) return `${name('no')} must be under 0.5: from 0.5 up, it passes a question that expects no when the model answers yes`;
  return undefined;
}

const KEYS = new Set(['skill', 'context', 'model', 'thresholds', 'proof']);

/**
 * Loads the config file at `path`, or `./skillunit.yaml` if it exists. With no file, the skill
 * is the current folder. Paths in the file are relative to the file itself.
 */
export function loadConfig(path?: string): Config {
  const file = resolve(path ?? CONFIG_FILE);
  const config: Config = { skill: resolve('.'), model: { provider: 'typesafe' }, thresholds: { ...DEFAULT_THRESHOLDS } };
  if (!existsSync(file)) {
    if (path) throw new Error(`config file not found: ${file}`);
    return config;
  }

  const raw = parse(readFileSync(file, 'utf8')) ?? {};
  const fail = (msg: string) => new Error(`${file}: ${msg}`);
  if (typeof raw !== 'object' || Array.isArray(raw)) throw fail('expected a mapping at the top level');
  for (const key of Object.keys(raw)) {
    if (!KEYS.has(key)) throw fail(`unknown key \`${key}\` (allowed: ${[...KEYS].join(', ')})`);
  }

  const root = dirname(file);
  config.configDir = root;
  config.configFile = file;
  config.skill = root;

  if (raw.skill !== undefined) {
    if (typeof raw.skill !== 'string') throw fail('`skill` must be a path');
    config.skill = resolve(root, raw.skill);
  }
  if (raw.context !== undefined) {
    if (typeof raw.context !== 'string') throw fail('`context` must be text');
    config.context = raw.context.trim() || undefined;
  }
  if (raw.model !== undefined) {
    config.model = readModel(raw.model, root, fail);
  }
  if (raw.thresholds !== undefined) {
    if (!raw.thresholds || typeof raw.thresholds !== 'object') throw fail('`thresholds` must be a mapping');
    for (const [key, value] of Object.entries(raw.thresholds as Record<string, unknown>)) {
      if (!(key in DEFAULT_THRESHOLDS)) throw fail(`unknown threshold \`${key}\` (allowed: choice, yes, no, margin)`);
      if (typeof value !== 'number' || value < 0 || value > 1) throw fail(`thresholds.${key} must be a number from 0 to 1`);
      config.thresholds[key as keyof Thresholds] = value;
    }
    const problem = thresholdsProblem(config.thresholds, (key) => `thresholds.${key}`);
    if (problem) throw fail(problem);
  }
  if (raw.proof !== undefined) config.proof = readProof(raw.proof, root, fail);
  return config;
}

const PROOF_KEYS = ['run', 'units', 'format'];

function readProof(value: unknown, root: string, fail: (msg: string) => Error): ProofConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('`proof` must be a mapping, such as `proof: { run: "npx vitest run" }`');
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!PROOF_KEYS.includes(key)) throw fail(`unknown key \`proof.${key}\` (allowed: ${PROOF_KEYS.join(', ')})`);
  }
  const out: ProofConfig = { units: resolve(root, DEFAULT_PROOF_UNITS), cwd: root };
  if (raw.run !== undefined) {
    if (typeof raw.run !== 'string' || !raw.run.trim()) throw fail('`proof.run` must be a command, such as `npx vitest run`');
    out.run = raw.run;
  }
  if (raw.units !== undefined) {
    if (typeof raw.units !== 'string' || !raw.units.trim()) throw fail('`proof.units` must be a folder');
    out.units = resolve(root, raw.units);
  }
  if (raw.format !== undefined) {
    if (typeof raw.format !== 'string' || !raw.format.includes('{file}')) throw fail('`proof.format` must be a command with `{file}` where the skill file goes');
    out.format = raw.format;
  }
  return out;
}

const MODEL_FORMAT = `\`model\` is \`{ provider: ${PROVIDER_NAMES.join(' | ')}, name: <model name> }\`, or the path of a module that exports a DecisionModel, starting with \`./\` or \`/\``;

function readModel(value: unknown, root: string, fail: (msg: string) => Error): ModelConfig {
  if (typeof value === 'string') {
    if (!/^\.{0,2}\//.test(value)) throw fail(MODEL_FORMAT);
    return { provider: 'module', module: resolve(root, value) };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(MODEL_FORMAT);
  const { provider, name, ...rest } = value as Record<string, unknown>;
  if (!isProviderName(provider)) throw fail(`unknown model provider \`${String(provider)}\`; SkillUnit ships ${providerList()}, and any other goes in a module`);
  if (Object.keys(rest).length) throw fail(`unknown key \`model.${Object.keys(rest)[0]}\` (allowed: provider, name)`);
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) throw fail('`model.name` must be a model name');
  return name ? { provider, name: name as string } : { provider };
}

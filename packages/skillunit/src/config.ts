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
 *   examples:                    # how lint checks the code examples of the skill
 *     ts: { tsconfig: ./tsconfig.json }        # ts, tsx, js and jsx fences, with `tsc`
 *     py: { command: "python3 -m py_compile {file}" }   # any other language
 *   lint:
 *     off: [length]              # lint rules not to report, by the name they are reported under
 *   source: ./skill-src          # the skill as people write it; `skill` is built from it
 *   proof:                       # how `skillunit proof` builds `skill` from `source` and the tests
 *     run: "npx vitest run"      # the project's tests, run through the shell
 *     units: ./tmp/skill-units   # where the tests leave their units (the default)
 *     sources: ['src/**\/*.test.ts'] # test files with `#region skill:<id>` examples
 *     format: "npx prettier --write {file}"   # run once on the built Markdown files
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { LINT_RULES, type LintRule } from './lint/types.js';
import { isProviderName, PROVIDER_NAMES, providerList, type ProviderName } from './models/providers.js';
import { canonicalLang } from './units/parse.js';

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
  examples?: ExamplesConfig;
  /** Lint rules turned off. */
  lint?: { off: LintRule[] };
  /** Absolute folder of the config file, when there is one. */
  configDir?: string;
  /** Absolute path of the config file, when there is one. */
  configFile?: string;
  /** Absolute path of the folder people write, which `skill` is built from. Without it there is no proof layer. */
  source?: string;
  /** The proof layer: set, with its defaults, whenever `source` is. */
  proof?: ProofConfig;
}

/** How the proof layer builds `skill` from `source` and what the tests left. Globs start from `cwd`. */
export interface ProofConfig {
  /** The project's tests, run through the shell from `cwd`. Without it, the units already in `units` are used. */
  run?: string;
  /** Absolute folder where the tests of `skillunit/vitest` and `skillunit/unit` leave their units. */
  units: string;
  /**
   * Globs of files that hold `#region skill:<id>` examples and declare no unit. The test files the
   * records name are always read.
   */
  sources: string[];
  /** A command with `{file}`, run once with every built Markdown file in place of `{file}`. */
  format?: string;
  /** Folder of the config file: globs and commands start there. */
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

/** How lint checks code examples. Paths are absolute. */
export interface ExamplesConfig {
  /** `ts`, `tsx`, `js` and `jsx` fences are type-checked with `tsc` against this tsconfig. */
  ts?: { tsconfig: string };
  /** Other languages: a command per fence language, with `{file}` for the example's path. */
  commands: Record<string, string>;
  /** Folder the commands run in: the folder of the config file. */
  cwd: string;
  /** The settings file, and the line of each language's key in it, for findings about a key. */
  place?: { file: string; lines: Record<string, number> };
}

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

const KEYS = new Set(['skill', 'source', 'context', 'model', 'thresholds', 'examples', 'lint', 'proof']);

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
  if (raw.examples !== undefined) config.examples = readExamples(raw.examples, root, fail, file);
  if (raw.lint !== undefined) config.lint = readLint(raw.lint, fail);
  if (raw.source !== undefined) {
    if (typeof raw.source !== 'string' || !raw.source.trim()) throw fail('`source` must be a path: the folder the skill is built from');
    config.source = resolve(root, raw.source);
    const inside = (a: string, b: string) => a === b || a.startsWith(`${b}/`) || a.startsWith(`${b}\\`);
    if (inside(config.source, config.skill) || inside(config.skill, config.source)) {
      throw fail('`source` and `skill` are two folders, neither inside the other: `skill` is built from `source`');
    }
  }
  if (raw.proof !== undefined && config.source === undefined) throw fail('`proof` says how the skill is built from `source`; set `source` too');
  if (config.source !== undefined) config.proof = readProof(raw.proof ?? {}, root, fail);
  return config;
}

const PROOF_KEYS = ['run', 'units', 'sources', 'format'];

function readProof(value: unknown, root: string, fail: (msg: string) => Error): ProofConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('`proof` must be a mapping, such as `proof: { run: "npx vitest run" }`');
  const raw = value as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!PROOF_KEYS.includes(key)) throw fail(`unknown key \`proof.${key}\` (allowed: ${PROOF_KEYS.join(', ')})`);
  }
  const globs = (key: string): string[] => {
    const v = raw[key];
    if (v === undefined || v === null) return [];
    const list = Array.isArray(v) ? v : [v];
    if (!list.length || list.some((s) => typeof s !== 'string' || !s.trim())) throw fail(`\`proof.${key}\` must be a glob or a list of globs`);
    return list as string[];
  };
  const out: ProofConfig = { units: resolve(root, DEFAULT_PROOF_UNITS), sources: globs('sources'), cwd: root };
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

function readLint(value: unknown, fail: (msg: string) => Error): { off: LintRule[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('`lint` must be a mapping, such as `lint: { off: [length] }`');
  const { off, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length) throw fail(`unknown key \`lint.${Object.keys(rest)[0]}\` (allowed: off)`);
  const list = off === undefined ? [] : Array.isArray(off) ? off : [off];
  for (const rule of list) {
    if (typeof rule !== 'string' || !(LINT_RULES as readonly string[]).includes(rule)) {
      throw fail(`\`lint.off\`: unknown rule \`${String(rule)}\` (rules: ${LINT_RULES.join(', ')})`);
    }
  }
  return { off: list as LintRule[] };
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

/** Fence languages the `ts` entry covers. */
export const TS_LANGS = ['ts', 'tsx', 'js', 'jsx'];

function readExamples(value: unknown, root: string, fail: (msg: string) => Error, file: string): ExamplesConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail('`examples` must be a mapping of fence language to settings');
  }
  const text = readFileSync(file, 'utf8').split(/\r?\n/);
  const out: ExamplesConfig = { commands: {}, cwd: root, place: { file, lines: {} } };
  const seen = new Map<string, string>();
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    // `python` and `py` are one language: the key and the fence are read by the short name.
    const lang = canonicalLang(key);
    const first = seen.get(lang);
    if (first !== undefined) throw fail(`\`examples.${first}\` and \`examples.${key}\` are one language; keep one`);
    seen.set(lang, key);
    out.place!.lines[lang] = text.findIndex((l) => new RegExp(`^\\s+["']?${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s*:`).test(l)) + 1 || 1;
    const settings = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;
    if (lang === 'ts') {
      if (!settings || typeof settings.tsconfig !== 'string' || Object.keys(settings).length !== 1) {
        throw fail('`examples.ts` takes one key, `tsconfig`, with the path of a tsconfig.json');
      }
      out.ts = { tsconfig: resolve(root, settings.tsconfig) };
    } else if (TS_LANGS.includes(lang)) {
      throw fail(`\`examples.${key}\`: ${TS_LANGS.join(', ')} fences are all type-checked through \`examples.ts\``);
    } else {
      if (!settings || typeof settings.command !== 'string' || Object.keys(settings).length !== 1) {
        throw fail(`\`examples.${key}\` takes one key, \`command\`, with \`{file}\` where the example's path goes`);
      }
      if (!settings.command.includes('{file}')) throw fail(`\`examples.${key}.command\` must contain \`{file}\``);
      out.commands[lang] = settings.command;
    }
  }
  return out;
}

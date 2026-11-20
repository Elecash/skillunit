/**
 * `skillunit.yaml`: optional project settings, so a project does not repeat the same flags on
 * every run. Every field is optional and every field can be overridden from the command line.
 *
 *   skill: ./skills/my-skill     # folder with SKILL.md
 *   specs: ./specs               # a spec file, a folder of them, or a list of either
 *   context: "…"                 # one sentence about what the skill is for
 *   model: { provider: typesafe, name: jev-latest }   # or the path of a module: ./model.mjs
 *   thresholds:
 *     choice: 0.5                # lowest confidence that passes a choice test
 *     yes: 0.7                   # lowest P(yes) that passes an expected "yes"
 *     no: 0.3                    # highest P(yes) that passes an expected "no"
 *   examples:                    # how lint checks the code examples of the skill
 *     ts: { tsconfig: ./tsconfig.json }        # ts, tsx, js and jsx fences, with `tsc`
 *     py: { command: "python3 -m py_compile {file}" }   # any other language
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';

export interface Thresholds {
  choice: number;
  yes: number;
  no: number;
}

export interface Config {
  /** Absolute path of the folder with SKILL.md. */
  skill: string;
  /** Absolute paths of spec files or folders. */
  specs: string[];
  context?: string;
  model: ModelConfig;
  thresholds: Thresholds;
  examples?: ExamplesConfig;
}

/**
 * The decision model the `test` layer asks: the `typesafe` adapter, or a module of the project's
 * own that exports a `DecisionModel`. The module path is absolute.
 */
export type ModelConfig = { provider: 'typesafe'; name?: string } | { provider: 'module'; module: string };

/** How lint checks code examples. Paths are absolute. */
export interface ExamplesConfig {
  /** `ts`, `tsx`, `js` and `jsx` fences are type-checked with `tsc` against this tsconfig. */
  ts?: { tsconfig: string };
  /** Other languages: a command per fence language, with `{file}` for the example's path. */
  commands: Record<string, string>;
  /** Folder the commands run in: the folder of the config file. */
  cwd: string;
}

export const DEFAULT_THRESHOLDS: Thresholds = { choice: 0.5, yes: 0.7, no: 0.3 };
/** Folder with the spec files when the settings do not say. */
export const DEFAULT_SPECS = 'specs';
export const CONFIG_FILE = 'skillunit.yaml';

const KEYS = new Set(['skill', 'specs', 'context', 'model', 'thresholds', 'examples']);

/**
 * Loads the config file at `path`, or `./skillunit.yaml` if it exists. With no file, the skill
 * is the current folder and the specs are in `./specs`. Paths in the file are relative to
 * the file itself.
 */
export function loadConfig(path?: string): Config {
  const file = resolve(path ?? CONFIG_FILE);
  const config: Config = { skill: resolve('.'), specs: [resolve(DEFAULT_SPECS)], model: { provider: 'typesafe' }, thresholds: { ...DEFAULT_THRESHOLDS } };
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
  config.skill = root;
  config.specs = [resolve(root, DEFAULT_SPECS)];

  if (raw.skill !== undefined) {
    if (typeof raw.skill !== 'string') throw fail('`skill` must be a path');
    config.skill = resolve(root, raw.skill);
  }
  if (raw.specs !== undefined) {
    const list = Array.isArray(raw.specs) ? raw.specs : [raw.specs];
    if (list.some((s: unknown) => typeof s !== 'string')) throw fail('`specs` must be a path or a list of paths');
    config.specs = list.map((s: string) => resolve(root, s));
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
      if (!(key in DEFAULT_THRESHOLDS)) throw fail(`unknown threshold \`${key}\` (allowed: choice, yes, no)`);
      if (typeof value !== 'number' || value < 0 || value > 1) throw fail(`thresholds.${key} must be a number from 0 to 1`);
      config.thresholds[key as keyof Thresholds] = value;
    }
  }
  if (raw.examples !== undefined) config.examples = readExamples(raw.examples, root, fail);
  return config;
}

const MODEL_FORMAT = '`model` is `{ provider: typesafe, name: <model name> }`, or the path of a module that exports a DecisionModel, starting with `./` or `/`';

function readModel(value: unknown, root: string, fail: (msg: string) => Error): ModelConfig {
  if (typeof value === 'string') {
    if (!/^\.{0,2}\//.test(value)) throw fail(MODEL_FORMAT);
    return { provider: 'module', module: resolve(root, value) };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(MODEL_FORMAT);
  const { provider, name, ...rest } = value as Record<string, unknown>;
  if (provider !== 'typesafe') throw fail(`unknown model provider \`${String(provider)}\`; skillunit ships \`typesafe\`, and any other goes in a module`);
  if (Object.keys(rest).length) throw fail(`unknown key \`model.${Object.keys(rest)[0]}\` (allowed: provider, name)`);
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) throw fail('`model.name` must be a model name');
  return name ? { provider: 'typesafe', name: name as string } : { provider: 'typesafe' };
}

/** Fence languages the `ts` entry covers. */
export const TS_LANGS = ['ts', 'tsx', 'js', 'jsx'];

function readExamples(value: unknown, root: string, fail: (msg: string) => Error): ExamplesConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fail('`examples` must be a mapping of fence language to settings');
  }
  const out: ExamplesConfig = { commands: {}, cwd: root };
  for (const [lang, entry] of Object.entries(value as Record<string, unknown>)) {
    const settings = entry && typeof entry === 'object' && !Array.isArray(entry) ? (entry as Record<string, unknown>) : null;
    if (lang === 'ts') {
      if (!settings || typeof settings.tsconfig !== 'string' || Object.keys(settings).length !== 1) {
        throw fail('`examples.ts` takes one key, `tsconfig`, with the path of a tsconfig.json');
      }
      out.ts = { tsconfig: resolve(root, settings.tsconfig) };
    } else if (TS_LANGS.includes(lang)) {
      throw fail(`\`examples.${lang}\`: ${TS_LANGS.join(', ')} fences are all type-checked through \`examples.ts\``);
    } else {
      if (!settings || typeof settings.command !== 'string' || Object.keys(settings).length !== 1) {
        throw fail(`\`examples.${lang}\` takes one key, \`command\`, with \`{file}\` where the example's path goes`);
      }
      if (!settings.command.includes('{file}')) throw fail(`\`examples.${lang}.command\` must contain \`{file}\``);
      out.commands[lang.toLowerCase()] = settings.command;
    }
  }
  return out;
}

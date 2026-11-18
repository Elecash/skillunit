/**
 * `alchemist.yaml`: optional project settings, so a project does not repeat the same flags on
 * every run. Every field is optional and every field can be overridden from the command line.
 *
 *   skill: ./skills/my-skill     # folder with SKILL.md
 *   specs: ./alchemist           # a spec file, a folder of them, or a list of either
 *   context: "…"                 # one sentence about what the skill is for
 *   model: jev-latest            # TypeSafe model
 *   thresholds:
 *     choice: 0.5                # lowest confidence that passes a choice test
 *     yes: 0.7                   # lowest P(yes) that passes an expected "yes"
 *     no: 0.3                    # highest P(yes) that passes an expected "no"
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
  model?: string;
  thresholds: Thresholds;
}

export const DEFAULT_THRESHOLDS: Thresholds = { choice: 0.5, yes: 0.7, no: 0.3 };
export const CONFIG_FILE = 'alchemist.yaml';

const KEYS = new Set(['skill', 'specs', 'context', 'model', 'thresholds']);

/**
 * Loads the config file at `path`, or `./alchemist.yaml` if it exists. With no file, the skill
 * is the current folder and the specs are in `./alchemist`. Paths in the file are relative to
 * the file itself.
 */
export function loadConfig(path?: string): Config {
  const file = resolve(path ?? CONFIG_FILE);
  const config: Config = { skill: resolve('.'), specs: [resolve('alchemist')], thresholds: { ...DEFAULT_THRESHOLDS } };
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
  config.specs = [resolve(root, 'alchemist')];

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
    if (typeof raw.model !== 'string') throw fail('`model` must be a model name');
    config.model = raw.model;
  }
  if (raw.thresholds !== undefined) {
    if (!raw.thresholds || typeof raw.thresholds !== 'object') throw fail('`thresholds` must be a mapping');
    for (const [key, value] of Object.entries(raw.thresholds as Record<string, unknown>)) {
      if (!(key in DEFAULT_THRESHOLDS)) throw fail(`unknown threshold \`${key}\` (allowed: choice, yes, no)`);
      if (typeof value !== 'number' || value < 0 || value > 1) throw fail(`thresholds.${key} must be a number from 0 to 1`);
      config.thresholds[key as keyof Thresholds] = value;
    }
  }
  return config;
}

/**
 * The decision model providers that ship with SkillUnit. The settings, the CLI and the check for
 * an API key read this list, so a new provider is one entry here and its adapter. Any other
 * provider goes in a model module of the project's own.
 */
import type { DecisionModel } from './types.js';

export interface Provider {
  /** The model used when the settings and `--model` name none. */
  defaultModel: string;
  /** Environment variables `test` and `check` need, except with `--dry-run`. */
  env: readonly string[];
  /** Builds the model. The adapter is loaded here, so the settings can be read without it. */
  create(options: { name?: string }): Promise<DecisionModel>;
}

export const PROVIDERS = {
  typesafe: {
    defaultModel: 'jev-latest',
    env: ['TYPESAFE_API_KEY'],
    async create(options) {
      const { typesafe } = await import('./typesafe.js');
      return typesafe(options.name ? { name: options.name } : {});
    },
  },
  openai: {
    defaultModel: 'gpt-6-luna',
    env: ['OPENAI_API_KEY'],
    async create(options) {
      const { openai } = await import('./openai.js');
      return openai(options.name ? { name: options.name } : {});
    },
  },
} satisfies Record<string, Provider>;

export type ProviderName = keyof typeof PROVIDERS;

export const PROVIDER_NAMES = Object.keys(PROVIDERS) as ProviderName[];

export function isProviderName(name: unknown): name is ProviderName {
  return typeof name === 'string' && Object.hasOwn(PROVIDERS, name);
}

/** The provider names as a sentence, for messages: `typesafe`, or `openai` and `typesafe`. */
export function providerList(): string {
  const names = PROVIDER_NAMES.map((n) => `\`${n}\``);
  return names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

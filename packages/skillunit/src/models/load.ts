/**
 * Builds the decision model the settings name: a provider that ships with SkillUnit, or a module
 * of the project's own that exports a `DecisionModel` (as its default export, or as `model`), or
 * a function that returns one.
 */
import { pathToFileURL } from 'node:url';
import type { ModelConfig } from '../config.js';
import { PROVIDERS } from './providers.js';
import type { DecisionModel } from './types.js';

export class ModelError extends Error {}

export async function loadModel(config: ModelConfig): Promise<DecisionModel> {
  if (config.provider !== 'module') return PROVIDERS[config.provider].create(config.name ? { name: config.name } : {});

  let mod: Record<string, unknown>;
  try {
    mod = (await import(pathToFileURL(config.module).href)) as Record<string, unknown>;
  } catch (e) {
    throw new ModelError(`could not load the model module ${config.module}: ${(e as Error).message}`);
  }
  let exported = mod.default ?? mod.model;
  if (typeof exported === 'function') exported = await (exported as () => unknown)();
  if (!isDecisionModel(exported)) {
    throw new ModelError(
      `${config.module} must export a DecisionModel (default export or \`model\`): an object with \`id\`, \`limits\` and \`decide\`, or a function that returns one`,
    );
  }
  return exported;
}

function isDecisionModel(value: unknown): value is DecisionModel {
  if (!value || typeof value !== 'object') return false;
  const m = value as Partial<DecisionModel>;
  return (
    typeof m.id === 'string' &&
    typeof m.decide === 'function' &&
    typeof m.limits?.perQuestionTokens === 'number' &&
    typeof m.limits?.perRequestTokens === 'number' &&
    optionalCount(m.limits.questionsPerRequest) &&
    optionalCount(m.limits.optionsPerQuestion)
  );
}

function optionalCount(value: unknown): boolean {
  return value === undefined || (Number.isInteger(value) && (value as number) > 0);
}

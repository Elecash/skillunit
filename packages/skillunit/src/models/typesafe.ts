/**
 * The `typesafe` adapter: TypeSafe's System One API (docs.typesafe.ai). One `decide` call is one
 * request. Each question carries its framing and its own text; a choice question becomes a
 * `choice` with the options as criteria, a yes/no question a `noul`.
 */
import { TypeSafeClient, type EntryType, type Questions, type SystemOneRequest } from '@typesafe-ai/sdk';
import type { DecisionAnswer, DecisionModel, DecisionRequest, DecisionResult } from './types.js';

export interface TypeSafeOptions {
  /** Model name, such as `jev-latest`. Left out, the SDK's default. */
  name?: string;
  /** For tests: a client to use instead of one built from `TYPESAFE_API_KEY`. */
  client?: Pick<TypeSafeClient, 'systemOne'>;
}

/**
 * TypeSafe's token limits for a request (docs.typesafe.ai/models): the state plus the longest
 * question, and the state plus every question.
 */
export const TYPESAFE_LIMITS = { perQuestionTokens: 32_000, perRequestTokens: 64_000 };

export function typesafe(options: TypeSafeOptions = {}): DecisionModel {
  let client = options.client;
  return {
    id: 'typesafe',
    limits: TYPESAFE_LIMITS,
    async decide(request) {
      // Built on first use, so a dry run needs no API key.
      client ??= new TypeSafeClient({ timeout: 60_000 });
      const result = await client.systemOne(toTypeSafe(request, options.name));
      const answers: Record<string, DecisionAnswer> = {};
      for (const [id, answer] of Object.entries(result.answers)) {
        if (answer.type === 'choice') {
          answers[id] = { probabilities: { ...answer.probabilities } };
        } else if (answer.type === 'noul') {
          answers[id] = { probabilities: { yes: answer.noul, no: 1 - answer.noul } };
        }
      }
      return {
        answers,
        usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens },
        model: result.model,
      } satisfies DecisionResult;
    },
  };
}

export function toTypeSafe(request: DecisionRequest, model?: string): SystemOneRequest<Questions> {
  const questions: Questions = {};
  for (const q of request.questions) {
    const instructions = { framing: q.instructions ?? request.instructions, question: q.text };
    questions[q.id] = q.options
      ? { type: 'choice', instructions, criteria: Object.fromEntries(q.options.map((o) => [o.id, o.description ?? null])) }
      : { type: 'noul', instructions };
  }
  return { state: request.state as EntryType, questions, ...(model ? { model } : {}) };
}

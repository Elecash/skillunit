/**
 * A decision model answers closed questions about a state: a yes/no question, or a choice among
 * named options. SkillUnit's `test` layer asks it whether a skill's text settles the decisions it
 * must. Any provider can be plugged in through this interface; `typesafe` ships with SkillUnit.
 */

export interface DecisionOption {
  id: string;
  /** What the option means. Left out, the model sees only the label. */
  description?: string;
}

export interface DecisionQuestion {
  /** Key of the answer in `DecisionResult.answers`. */
  id: string;
  text: string;
  /** Absent for a yes/no question. */
  options?: DecisionOption[];
}

export interface DecisionRequest {
  /** How to read the state and answer; the same for every question. */
  instructions: string;
  state: Record<string, unknown>;
  questions: DecisionQuestion[];
}

export interface DecisionAnswer {
  /** Probability of each option id; `{ yes, no }` for a yes/no question. */
  probabilities: Record<string, number>;
  /**
   * The model's own confidence in its top option, when it reports one. Without it, SkillUnit
   * uses the top probability.
   */
  confidence?: number;
}

export interface DecisionResult {
  /** By question id. A question with no answer here fails its test. */
  answers: Record<string, DecisionAnswer>;
  usage: { inputTokens: number; outputTokens: number };
  /** The model that answered, as the provider names it. */
  model: string;
}

export interface DecisionModel {
  /** Provider name, for reports and messages. */
  readonly id: string;
  readonly limits: {
    /** Tokens of the state plus one question, the instructions included. */
    perQuestionTokens: number;
    /** Tokens of the whole request. */
    perRequestTokens: number;
  };
  /** Rejects on a failed request; SkillUnit reports it as a spec that could not run. */
  decide(request: DecisionRequest): Promise<DecisionResult>;
}

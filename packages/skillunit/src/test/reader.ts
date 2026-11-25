/**
 * The reader: asks a decision model every question about one file of the skill in one
 * request. The skill text is the state and each phrasing of a scenario is one question about
 * it. The model answers the questions apart from each other, so each answer depends on the
 * skill text alone. Questions with `with` also put the other files the agent reads in the
 * state, under `references`.
 *
 * The framing, the automatic `none` option, the thresholds and the token checks live here, not
 * in the adapters, so every model is asked and judged the same way.
 */
import type { Thresholds } from '../config.js';
import type { DecisionAnswer, DecisionModel, DecisionQuestion, DecisionRequest } from '../models/index.js';
import { NONE } from '../unit/contract.js';
import type { TestCase } from './questions.js';

export interface Verdict {
  id: string;
  expect: string;
  /** The option the reader picked, or "yes" / "no" for a yes/no test. */
  answer: string;
  /**
   * The number that decided the verdict: for a choice test, the probability of the option the
   * reader picked; for a yes/no test, P(yes).
   */
  confidence: number;
  /** Probability the reader gave to the expected answer, from 0 to 1. */
  expectedProb: number;
  /** For a choice test, the probability of every option, `none` included. */
  probabilities?: Record<string, number>;
  pass: boolean;
  /** The reader picked the expected answer, with a probability under the threshold. Counts as a fail. */
  weak: boolean;
  /**
   * For a choice test, when two options or more share the top probability: those options, in the
   * order the question lists them. A tie never passes, since which of them comes first is only the
   * provider's order. `answer` is the expected option when it is one of them.
   */
  tied?: string[];
  /** The model declined to answer. Counts as a fail; `answer` is `(refused)`. */
  refused?: true;
  /**
   * The deciding number is within `thresholds.margin` of what would flip the verdict, so the next
   * run may decide it the other way. A borderline pass still passes.
   */
  borderline: boolean;
  /**
   * The phrasing of the scenario this verdict comes from. With several, the phrasings are ranked,
   * failing ones first and then by `expectedProb`, and this is the median one.
   */
  scenario: string;
  question: string;
  /** The unit the question is about, if any. */
  unit?: string;
  /** Where the question is declared: the absolute path of the test file, and the line. */
  declared?: { file: string; line: number };
  /** For a test with several phrasings: `expectedProb` of each, in the order they were declared. */
  variants?: number[];
  /** For a test with several phrasings: whether each passed, in the same order as `variants`. */
  variantsPass?: boolean[];
}

export interface ReaderResult {
  verdicts: Verdict[];
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

/** Description of the option SkillUnit adds to every choice test. */
export const NONE_DESCRIPTION =
  'None of the options above: the skill says something different, or it does not settle this';

const FRAMING =
  'The `skill` in the state is a document that an AI coding agent must follow. Answer only from ' +
  'what the skill says, never from what seems sensible in general. If the skill does not settle ' +
  'the question, or says something that none of the other options matches, answer `none`. When ' +
  'an option quotes an exact value such as a command, a name or a path, compare it with the ' +
  'skill literally: a value that differs in any character is a different value.';

/**
 * The framing of a yes/no question. It has no `none` to fall back on, so it says what to do when
 * the skill does not settle the question: give yes and no the same probability, which fails the
 * test whichever answer it expects. With the choice framing instead, a model may read "answer
 * `none`" as a reason to doubt and lean the wrong way: on OpenAI's Decisions API, "should the agent
 * pass `retry` to a POST?" got P(yes) 0.97 with it and 0.03 with this one (2026-11-23).
 */
const YES_NO_FRAMING =
  'The `skill` in the state is a document that an AI coding agent must follow. Answer only from ' +
  'what the skill says, never from what seems sensible in general. Answer yes only when the ' +
  'skill says yes, and no only when the skill says no. If the skill does not settle the question, ' +
  'give yes and no the same probability. When the question quotes an exact value such as a ' +
  'command, a name or a path, compare it with the skill literally: a value that differs in any ' +
  'character is a different value.';

/** Added when the state carries `references`, so the reader treats all the files as one skill. */
const WITH_REFERENCES =
  'The `references` in the state are other files of the same skill, which the agent reads too: ' +
  'read the skill and its references together, and answer from what any of them says.';

/** The framing of a choice question, or of a yes/no question with `yesNo`. */
export function framing(context?: string, withReferences = false, yesNo = false): string {
  const first = yesNo ? YES_NO_FRAMING : FRAMING;
  const base = withReferences ? `${first} ${WITH_REFERENCES}` : first;
  return context ? `${base} What the skill is about: ${context}` : base;
}

/** Question id for phrasing `i` of a test. A test with one phrasing uses its id. */
function questionKey(test: TestCase, i: number): string {
  return test.scenarios.length === 1 ? test.id : `${test.id}#${i + 1}`;
}

export function buildRequest(
  skillText: string,
  tests: TestCase[],
  context?: string,
  references: Record<string, string> = {},
): DecisionRequest {
  const withReferences = Object.keys(references).length > 0;
  const questions: DecisionQuestion[] = [];
  for (const test of tests) {
    test.scenarios.forEach((scenario, i) => {
      const question: DecisionQuestion = { id: questionKey(test, i), text: `Situation: ${scenario}\nQuestion: ${test.question}` };
      if (test.options) {
        question.options = [
          ...Object.entries(test.options).map(([id, description]) => (description === null ? { id } : { id, description })),
          { id: NONE, description: NONE_DESCRIPTION },
        ];
      } else {
        question.instructions = framing(context, withReferences, true);
      }
      questions.push(question);
    });
  }
  const state: Record<string, unknown> = { skill: skillText };
  if (withReferences) state.references = references;
  return { instructions: framing(context, withReferences), state, questions };
}

/**
 * Characters per token used to estimate a request before it is sent, since there is no
 * tokenizer for every model. Measured with TypeSafe on a real skill: adding 65,000 characters of
 * its markdown to a state added about 18,300 input tokens (3.57 characters per token). Rounded
 * down so the estimate errs high by about 8%.
 */
const CHARS_PER_TOKEN = 3.3;

export interface TokenEstimate {
  /** The state plus the longest question, instructions included: what `perQuestionTokens` limits. */
  stateAndLongestQuestion: number;
  /** The whole request. */
  request: number;
}

/** Each question is counted with the instructions, as an adapter may send them with every question. */
export function estimateTokens(request: DecisionRequest): TokenEstimate {
  const tokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / CHARS_PER_TOKEN);
  const state = tokens(request.state);
  const questions = request.questions.map((q) => tokens({ instructions: request.instructions, ...q }));
  return {
    stateAndLongestQuestion: state + Math.max(0, ...questions),
    request: state + questions.reduce((a, b) => a + b, 0),
  };
}

export async function read(model: DecisionModel, request: DecisionRequest, tests: TestCase[], thresholds: Thresholds): Promise<ReaderResult> {
  const result = await model.decide(request);
  const verdicts = tests.map((test) => {
    const perPhrasing = test.scenarios.map((_, i) => judge(test, result.answers[questionKey(test, i)], thresholds, i));
    if (perPhrasing.length === 1) return perPhrasing[0]!;
    // Failing phrasings rank below passing ones, then by how strongly the reader backed the
    // expected answer, and the median one decides. So the test passes when most phrasings pass,
    // whatever the thresholds: a single odd phrasing cannot decide it.
    const ranked = [...perPhrasing].sort((a, b) => Number(a.pass) - Number(b.pass) || a.expectedProb - b.expectedProb);
    const median = ranked[Math.floor((ranked.length - 1) / 2)]!;
    return { ...median, variants: perPhrasing.map((v) => v.expectedProb), variantsPass: perPhrasing.map((v) => v.pass) };
  });
  return {
    verdicts,
    usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
    model: result.model,
  };
}

export function judge(test: TestCase, answer: DecisionAnswer | undefined, th: Thresholds, phrasing = 0): Verdict {
  const base = {
    id: test.id,
    expect: test.expect,
    scenario: test.scenarios[phrasing]!,
    question: test.question,
    ...(test.unit ? { unit: test.unit } : {}),
    ...(test.declared ? { declared: test.declared } : {}),
  };
  const near = (value: number, threshold: number) => Math.abs(value - threshold) < th.margin;
  const missing = (why: string): Verdict => ({ ...base, answer: why, confidence: 0, expectedProb: 0, pass: false, weak: false, borderline: false });
  if (answer && 'refused' in answer) return { ...missing('(refused)'), refused: true };
  const probabilities = answer?.probabilities;
  if (!probabilities || Object.keys(probabilities).length === 0) return missing('(no answer)');

  if (test.options) {
    const confidence = Math.max(...Object.values(probabilities));
    const expectedProb = probabilities[test.expect] ?? 0;
    // The options at the top, in the order the question lists them: a verdict must not depend on
    // the order the provider lists them in. Two or more are a tie, which never passes.
    const order = [...Object.keys(test.options), NONE];
    const rank = (o: string) => (order.includes(o) ? order.indexOf(o) : order.length);
    const top = Object.keys(probabilities)
      .filter((o) => probabilities[o] === confidence)
      .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    const tied = top.length > 1;
    const choice = tied && top.includes(test.expect) ? test.expect : top[0]!;
    const right = choice === test.expect;
    const sure = !tied && confidence >= th.choice;
    return {
      ...base,
      answer: choice,
      confidence,
      expectedProb,
      probabilities: { ...probabilities },
      pass: right && sure,
      weak: right && !tied && !sure,
      ...(tied ? { tied: top } : {}),
      // Right: its probability is near the threshold, or tied. Wrong: the expected option is close behind.
      borderline: right ? tied || near(confidence, th.choice) : near(expectedProb, confidence),
    };
  }

  const pYes = probabilities.yes;
  if (typeof pYes !== 'number') return missing('(no yes/no answer)');
  const leaning = pYes >= 0.5 ? 'yes' : 'no';
  const pass = test.expect === 'yes' ? pYes >= th.yes : pYes <= th.no;
  const threshold = test.expect === 'yes' ? th.yes : th.no;
  return {
    ...base,
    answer: leaning,
    confidence: pYes,
    expectedProb: test.expect === 'yes' ? pYes : 1 - pYes,
    pass,
    weak: !pass && leaning === test.expect,
    borderline: near(pYes, threshold),
  };
}

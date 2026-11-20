/**
 * The reader: asks TypeSafe every test of a spec in one request. The skill text is the state
 * and each scenario phrasing is one question about it. TypeSafe answers the questions in
 * parallel and none of them sees the others, so each answer depends on the skill text alone.
 * A spec with `with` also puts the other files the agent reads in the state, under `references`.
 */
import { TypeSafeClient, type Questions, type SystemOneResult } from '@typesafe-ai/sdk';
import type { Thresholds } from './config.js';
import { NONE, type TestCase } from './spec.js';

export interface Verdict {
  id: string;
  expect: string;
  /** The option the reader picked, or "yes" / "no" for a yes/no test. */
  answer: string;
  /** For a choice test, TypeSafe's confidence. For a yes/no test, P(yes). */
  confidence: number;
  /** Probability the reader gave to the expected answer, from 0 to 1. */
  expectedProb: number;
  /** For a choice test, the probability of every option, `none` included. */
  probabilities?: Record<string, number>;
  pass: boolean;
  /** The reader picked the expected answer but without enough confidence. Counts as a fail. */
  weak: boolean;
  /** For a test with several phrasings: `expectedProb` of each, in the order of the spec. */
  variants?: number[];
}

export interface ReaderResult {
  verdicts: Verdict[];
  usage: { input_tokens: number; output_tokens: number };
  model: string;
}

/** Description of the option skillunit adds to every choice test. */
export const NONE_DESCRIPTION =
  'None of the options above: the skill says something different, or it does not settle this';

const FRAMING =
  'The `skill` in the state is a document that an AI coding agent must follow. Answer only from ' +
  'what the skill says, never from what seems sensible in general. If the skill does not settle ' +
  'the question, or says something that none of the other options matches, answer `none`. When ' +
  'an option quotes an exact value such as a command, a name or a path, compare it with the ' +
  'skill literally: a value that differs in any character is a different value.';

/** Added when the state carries `references`, so the reader treats all the files as one skill. */
const WITH_REFERENCES =
  'The `references` in the state are other files of the same skill, which the agent reads too: ' +
  'read the skill and its references together, and answer from what any of them says.';

export function framing(context?: string, withReferences = false): string {
  const base = withReferences ? `${FRAMING} ${WITH_REFERENCES}` : FRAMING;
  return context ? `${base} What the skill is about: ${context}` : base;
}

/** Question name for phrasing `i` of a test. A test with one phrasing uses its id. */
function questionKey(test: TestCase, i: number): string {
  return test.scenarios.length === 1 ? test.id : `${test.id}#${i + 1}`;
}

export function buildRequest(
  skillText: string,
  tests: TestCase[],
  context?: string,
  model?: string,
  references: Record<string, string> = {},
) {
  const withReferences = Object.keys(references).length > 0;
  const questions: Questions = {};
  const frame = framing(context, withReferences);
  for (const test of tests) {
    test.scenarios.forEach((scenario, i) => {
      const instructions = { framing: frame, situation: scenario, question: test.question };
      questions[questionKey(test, i)] = test.options
        ? { type: 'choice', instructions, criteria: { ...test.options, [NONE]: NONE_DESCRIPTION } }
        : { type: 'noul', instructions };
    });
  }
  const state: Record<string, string | Record<string, string>> = { skill: skillText };
  if (withReferences) state.references = references;
  return { state, questions, ...(model ? { model } : {}) };
}

/**
 * TypeSafe's token limits for a request (docs.typesafe.ai/models): the state plus the longest
 * question, and the state plus every question.
 */
export const TOKEN_LIMITS = { stateAndLongestQuestion: 32_000, request: 64_000 };

/**
 * Characters per token used to estimate a request before it is sent, since the SDK has no
 * tokenizer. Measured on a real skill: adding 65,000 characters of its markdown to a state added
 * about 18,300 input tokens (3.57 characters per token). Rounded down so the estimate errs high
 * by about 8%.
 */
const CHARS_PER_TOKEN = 3.3;

export interface TokenEstimate {
  /** The state plus the longest question: what the 32k limit applies to. */
  stateAndLongestQuestion: number;
  /** The whole request. */
  request: number;
}

export function estimateTokens(request: ReturnType<typeof buildRequest>): TokenEstimate {
  const tokens = (value: unknown) => Math.ceil(JSON.stringify(value).length / CHARS_PER_TOKEN);
  const state = tokens(request.state);
  const questions = Object.values(request.questions).map(tokens);
  return {
    stateAndLongestQuestion: state + Math.max(0, ...questions),
    request: state + questions.reduce((a, b) => a + b, 0),
  };
}

export function createClient(): TypeSafeClient {
  return new TypeSafeClient({ timeout: 60_000 });
}

export async function read(
  client: TypeSafeClient,
  skillText: string,
  tests: TestCase[],
  thresholds: Thresholds,
  context?: string,
  model?: string,
  references: Record<string, string> = {},
): Promise<ReaderResult> {
  const result = await client.systemOne(buildRequest(skillText, tests, context, model, references));
  const verdicts = tests.map((test) => {
    const perPhrasing = test.scenarios.map((_, i) => judge(test, result.answers[questionKey(test, i)], thresholds));
    if (perPhrasing.length === 1) return perPhrasing[0]!;
    // Rank the phrasings by how strongly the reader backed the expected answer and keep the
    // median one: a single odd phrasing cannot decide the test, half of them can.
    const ranked = [...perPhrasing].sort((a, b) => a.expectedProb - b.expectedProb);
    const median = ranked[Math.floor((ranked.length - 1) / 2)]!;
    return { ...median, variants: perPhrasing.map((v) => v.expectedProb) };
  });
  return { verdicts, usage: { ...result.usage }, model: result.model };
}

type Answer = SystemOneResult<Questions>['answers'][string] | undefined;

function judge(test: TestCase, answer: Answer, th: Thresholds): Verdict {
  const base = { id: test.id, expect: test.expect };
  if (!answer) {
    return { ...base, answer: '(no answer)', confidence: 0, expectedProb: 0, pass: false, weak: false };
  }
  if (answer.type === 'choice') {
    const right = answer.choice === test.expect;
    const sure = answer.confidence >= th.choice;
    return {
      ...base,
      answer: answer.choice,
      confidence: answer.confidence,
      expectedProb: answer.probabilities[test.expect] ?? 0,
      probabilities: { ...answer.probabilities },
      pass: right && sure,
      weak: right && !sure,
    };
  }
  if (answer.type === 'noul') {
    const pYes = answer.noul;
    const leaning = pYes >= 0.5 ? 'yes' : 'no';
    const pass = test.expect === 'yes' ? pYes >= th.yes : pYes <= th.no;
    return {
      ...base,
      answer: leaning,
      confidence: pYes,
      expectedProb: test.expect === 'yes' ? pYes : 1 - pYes,
      pass,
      weak: !pass && leaning === test.expect,
    };
  }
  const type = (answer as { type: string }).type;
  return { ...base, answer: `(unexpected answer type ${type})`, confidence: 0, expectedProb: 0, pass: false, weak: false };
}

import { describe, expect, it } from 'vitest';
import { errorMessage, fromOpenAI, openai, OPENAI_LIMITS, retryable, toOpenAI, type OpenAIResponse } from './openai.js';
import { DEFAULT_THRESHOLDS } from '../config.js';
import { judge } from '../test/reader.js';
import type { DecisionRequest } from './types.js';

const NONE = { id: 'none', description: 'None of the options above: the skill says something different, or it does not settle this' };

/** Three questions of tinyfetch's retries spec, as SkillUnit builds them. */
const request: DecisionRequest = {
  instructions: 'The `skill` in the state is a document that an AI coding agent must follow.',
  state: { skill: '# tinyfetch — retries\n\nRetry only GET, HEAD, PUT and DELETE.' },
  questions: [
    {
      id: 'post-no-retry#1',
      text: 'Situation: An order is created with `tf.post`, and the network drops now and then.\nQuestion: Should the agent pass `retry` to that call?',
      options: [{ id: 'retry', description: 'Pass `retry`.' }, { id: 'no-retry', description: 'Leave `retry` out.' }, NONE],
    },
    { id: 'get-may-retry', text: 'Situation: A list of users is read with `tf.get`, and the API sometimes answers 503.\nQuestion: May the agent pass `retry` to that call?' },
    {
      id: 'retry-methods-bare',
      text: 'Situation: The agent adds `retry` to the calls of a client that uses every method tinyfetch has.\nQuestion: Which methods may get `retry`?',
      options: [{ id: 'get-head-put-delete' }, { id: 'all', description: 'Every method, POST and PATCH included.' }, NONE],
    },
  ],
};

/** Recorded from `POST /v1/decisions` on 2026-11-23 (phase 0 of the plan), answers to these three questions. */
const recorded: OpenAIResponse = {
  model: 'gpt-6-luna',
  answers: [
    { type: 'choice', name: 'post-no-retry#1', choice: 'no-retry', probabilities: [{ value: 'retry', probability: 0.01 }, { value: 'no-retry', probability: 0.9 }, { value: 'none', probability: 0.09 }], confidence: 0.85 },
    { type: 'predicate', name: 'get-may-retry', probability: 1 },
    { type: 'choice', name: 'retry-methods-bare', choice: 'get-head-put-delete', probabilities: [{ value: 'get-head-put-delete', probability: 0.88 }, { value: 'all', probability: 0.03 }, { value: 'none', probability: 0.09 }], confidence: 0.82 },
  ],
  usage: { input_tokens: 3292, output_tokens: 0 },
};

describe('toOpenAI', () => {
  it('sends the state as JSON, and each question with the instructions and its own text', () => {
    const body = toOpenAI(request);
    expect(body.model).toBe('gpt-6-luna');
    expect(body.input).toEqual([{ role: 'user', content: [{ type: 'input_json', data: request.state }] }]);
    expect(body.questions[0]).toEqual({
      type: 'choice',
      name: 'post-no-retry#1',
      instructions: `${request.instructions}\n\n${request.questions[0]!.text}`,
      choices: [{ value: 'retry', description: 'Pass `retry`.' }, { value: 'no-retry', description: 'Leave `retry` out.' }, { value: 'none', description: NONE.description }],
    });
    expect(body.questions[1]).toEqual({ type: 'predicate', name: 'get-may-retry', instructions: `${request.instructions}\n\n${request.questions[1]!.text}` });
    const own = { ...request, questions: [{ ...request.questions[1]!, instructions: 'Yes/no framing.' }] };
    expect(toOpenAI(own).questions[0]).toMatchObject({ instructions: `Yes/no framing.\n\n${request.questions[1]!.text}` });
  });

  it('leaves out the description of an option without one, and passes the model name as written', () => {
    const body = toOpenAI(request, 'gpt-6-luna-2026-12-01');
    expect(body.model).toBe('gpt-6-luna-2026-12-01');
    expect((body.questions[2] as { choices: unknown[] }).choices[0]).toEqual({ value: 'get-head-put-delete' });
  });
});

describe('fromOpenAI', () => {
  it("maps a recorded response: choices without OpenAI's confidence, a predicate as yes and no, and the usage", () => {
    expect(fromOpenAI(recorded, request)).toEqual({
      model: 'gpt-6-luna',
      usage: { inputTokens: 3292, outputTokens: 0 },
      answers: {
        'post-no-retry#1': { probabilities: { retry: 0.01, 'no-retry': 0.9, none: 0.09 } },
        'get-may-retry': { probabilities: { yes: 1, no: 0 } },
        'retry-methods-bare': { probabilities: { 'get-head-put-delete': 0.88, all: 0.03, none: 0.09 } },
      },
    });
  });

  it('leaves the choice to be judged on its top probability', () => {
    // Recorded on 2026-11-23 for `prefer-choice` of SkillUnit's own questions: right answer, confidence 0.25.
    const spread: OpenAIResponse = {
      model: 'gpt-6-luna',
      answers: [{ type: 'choice', name: 'pick', choice: 'choice', probabilities: [{ value: 'choice', probability: 0.5 }, { value: 'yes-no', probability: 0.16 }, { value: 'none', probability: 0.34 }], confidence: 0.25 }],
      usage: { input_tokens: 10, output_tokens: 0 },
    };
    const one: DecisionRequest = { instructions: 'i', state: {}, questions: [{ id: 'pick', text: 't', options: [{ id: 'choice' }, { id: 'yes-no' }, NONE] }] };
    const test = { id: 'pick', scenarios: ['s'], question: 'q', options: { choice: null, 'yes-no': null }, expect: 'choice' };
    expect(judge(test, fromOpenAI(spread, one).answers.pick, DEFAULT_THRESHOLDS)).toMatchObject({ answer: 'choice', confidence: 0.5, pass: true });
  });

  it('maps a refusal to a refused answer, and keeps the other answers', () => {
    // The shape of the reference; no probe produced a refusal.
    const answers = [recorded.answers[0]!, { type: 'refusal', name: 'get-may-retry' }, recorded.answers[2]!];
    const result = fromOpenAI({ ...recorded, answers }, request);
    expect(result.answers['get-may-retry']).toEqual({ refused: true });
    expect(result.answers['post-no-retry#1']).toMatchObject({ probabilities: { 'no-retry': 0.9 } });
  });

  it('refuses a response that does not line up with the questions', () => {
    expect(() => fromOpenAI({ ...recorded, answers: recorded.answers.slice(0, 2) }, request)).toThrow('OpenAI returned 2 answers for 3 questions');
    const swapped = [recorded.answers[1]!, recorded.answers[0]!, recorded.answers[2]!];
    expect(() => fromOpenAI({ ...recorded, answers: swapped }, request)).toThrow('OpenAI answer 1 is for "get-may-retry", not for question post-no-retry#1');
    const score = [recorded.answers[0]!, { type: 'score', name: 'get-may-retry' }, recorded.answers[2]!];
    expect(() => fromOpenAI({ ...recorded, answers: score }, request)).toThrow('OpenAI answered question get-may-retry with a score answer');
  });
});

describe('errors', () => {
  it('retries a 5xx and a 429 for the rate, not a 429 for money or a 4xx', () => {
    expect(retryable({ status: 503, code: 'server_is_overloaded' })).toBe(true);
    expect(retryable({ status: 500 })).toBe(true);
    expect(retryable({ status: 429, code: 'slow_down', type: 'rate_limit_error' })).toBe(true);
    expect(retryable({ status: 429, code: null, type: 'requests' })).toBe(true);
    for (const code of ['credit_balance_exhausted', 'organization_spend_limit_exceeded', 'project_spend_limit_exceeded', 'organization_usage_limit_exceeded']) {
      expect(retryable({ status: 429, code, type: 'insufficient_quota' })).toBe(false);
    }
    expect(retryable({ status: 429, code: null, type: 'insufficient_quota' })).toBe(false);
    expect(retryable({ status: 400 })).toBe(false);
    expect(retryable({ status: 404, code: 'model_not_found' })).toBe(false);
  });

  it("gives the status and OpenAI's text, and names the model the endpoint takes on model_not_found", () => {
    // Recorded on 2026-11-23 with `model: gpt-4.1-mini`.
    expect(errorMessage({ status: 404, code: 'model_not_found', type: 'invalid_request_error', message: 'The model `gpt-4.1-mini` does not exist or you do not have access to it.' })).toBe(
      'OpenAI 404 model_not_found: The model `gpt-4.1-mini` does not exist or you do not have access to it. The Decisions API takes `gpt-6-luna`.',
    );
    expect(errorMessage({ status: 400, code: null, message: 'input_json data exceeds the maximum serialized size of 262144 bytes' })).toBe(
      'OpenAI 400: input_json data exceeds the maximum serialized size of 262144 bytes',
    );
  });

  it('keeps no part of a key a 401 quotes', () => {
    const message = errorMessage({ status: 401, code: 'invalid_api_key', message: 'Incorrect API key provided: sk-proj-abc1********************xyz9. You can find your API key at https://platform.openai.com/account/api-keys.' });
    expect(message).toBe('OpenAI 401 invalid_api_key: Incorrect API key provided: sk-…. You can find your API key at https://platform.openai.com/account/api-keys.');
  });
});

describe('openai', () => {
  it('builds without a key, with the limits of the Decisions API', async () => {
    const model = openai();
    expect(model.id).toBe('openai');
    expect(model.limits).toEqual(OPENAI_LIMITS);
    expect(model.limits).toMatchObject({ questionsPerRequest: 400, optionsPerQuestion: 255 });
  });
});

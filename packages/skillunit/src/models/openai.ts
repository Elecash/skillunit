/**
 * The `openai` adapter: OpenAI's Decisions API (`POST /v1/decisions`, developers.openai.com/api/
 * docs/guides/decisions). One `decide` call is one request, with plain `fetch`. The state is an
 * `input_json` part. Each question carries its framing and its own text, as the `typesafe`
 * adapter sends them: a choice question becomes a `choice`, a yes/no question a `predicate`.
 * OpenAI's `confidence` field is left out: SkillUnit judges every choice on its probabilities.
 */
import type { DecisionAnswer, DecisionModel, DecisionRequest, DecisionResult } from './types.js';

export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/decisions';

/** The only model the Decisions API takes, as of November 2026. */
export const OPENAI_DEFAULT_MODEL = 'gpt-6-luna';

/**
 * Limits of a request: 922,000 input tokens for `gpt-6-luna` (its model page), 400 questions and
 * 255 choices per question (the reference of the endpoint). The endpoint has no limit per question
 * apart from the request's.
 */
export const OPENAI_LIMITS = { perQuestionTokens: 922_000, perRequestTokens: 922_000, questionsPerRequest: 400, optionsPerQuestion: 255 };

const TIMEOUT_MS = 60_000;
/** The longest `Retry-After` the one retry waits for; a longer one fails the request instead. */
const MAX_RETRY_WAIT_MS = 20_000;

export interface OpenAIOptions {
  /** Model name. Left out, `gpt-6-luna`. Passed as written. */
  name?: string;
}

// ---------------------------------------------------------------- the wire format

type Choice = { value: string; description?: string };
type Question =
  | { type: 'predicate'; name: string; instructions: string }
  | { type: 'choice'; name: string; instructions: string; choices: Choice[] };

export interface OpenAIRequest {
  model: string;
  input: { role: 'user'; content: { type: 'input_json'; data: Record<string, unknown> }[] }[];
  questions: Question[];
}

type Answer =
  | { type: 'predicate'; name: string | null; probability: number }
  | { type: 'choice'; name: string | null; choice: string | boolean; confidence: number; probabilities: { value: string | boolean; probability: number }[] }
  | { type: 'refusal'; name: string | null }
  | { type: string; name: string | null };

export interface OpenAIResponse {
  model: string;
  answers: Answer[];
  usage: { input_tokens: number; output_tokens: number };
}

// ---------------------------------------------------------------- the two mappings

export function toOpenAI(request: DecisionRequest, model: string = OPENAI_DEFAULT_MODEL): OpenAIRequest {
  return {
    model,
    input: [{ role: 'user', content: [{ type: 'input_json', data: request.state }] }],
    questions: request.questions.map((q): Question => {
      const instructions = `${q.instructions ?? request.instructions}\n\n${q.text}`;
      if (!q.options) return { type: 'predicate', name: q.id, instructions };
      const choices = q.options.map((o) => (o.description === undefined ? { value: o.id } : { value: o.id, description: o.description }));
      return { type: 'choice', name: q.id, instructions, choices };
    }),
  };
}

/**
 * Answers come back in the order the questions were sent. Each is matched by position, and its
 * `name` must be the question's id: a response that does not line up is an error, not a guess.
 */
export function fromOpenAI(body: OpenAIResponse, request: DecisionRequest): DecisionResult {
  if (!Array.isArray(body?.answers)) throw new Error('OpenAI returned no answers');
  if (body.answers.length !== request.questions.length) {
    throw new Error(`OpenAI returned ${body.answers.length} answers for ${request.questions.length} questions`);
  }
  const answers: Record<string, DecisionAnswer> = {};
  request.questions.forEach((q, i) => {
    const a = body.answers[i]!;
    if (a.name !== q.id) throw new Error(`OpenAI answer ${i + 1} is for ${JSON.stringify(a.name)}, not for question ${q.id}`);
    if (a.type === 'refusal') {
      answers[q.id] = { refused: true };
    } else if (a.type === 'predicate' && 'probability' in a) {
      answers[q.id] = { probabilities: { yes: a.probability, no: 1 - a.probability } };
    } else if (a.type === 'choice' && 'probabilities' in a) {
      answers[q.id] = { probabilities: Object.fromEntries(a.probabilities.map((p) => [String(p.value), p.probability])) };
    } else {
      throw new Error(`OpenAI answered question ${q.id} with a ${a.type} answer`);
    }
  });
  return { answers, usage: { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 }, model: body.model };
}

// ---------------------------------------------------------------- errors and the one retry

interface OpenAIError {
  status: number;
  code?: string | null;
  type?: string | null;
  message?: string;
}

/**
 * Whether a failed request is worth one more try: a 5xx, or a 429 for the rate of requests. A
 * 429 for credit, a spend limit or a usage limit stays failed until someone changes the account.
 */
export function retryable(error: OpenAIError): boolean {
  if (error.status >= 500) return true;
  if (error.status !== 429) return false;
  return error.type !== 'insufficient_quota' && !/credit|spend_limit|usage_limit|quota/.test(error.code ?? '');
}

/** The message a failed request becomes: the status and OpenAI's own text, never the key. */
export function errorMessage(error: OpenAIError): string {
  // A 401 quotes the start and end of the key it got; none of it goes in a report.
  const text = (error.message?.trim() || 'no message').replace(/\bsk-[A-Za-z0-9_*-]+/g, 'sk-…');
  const extra = error.code === 'model_not_found' ? ` The Decisions API takes \`${OPENAI_DEFAULT_MODEL}\`.` : '';
  return `OpenAI ${error.status}${error.code ? ` ${error.code}` : ''}: ${text}${extra}`;
}

async function parseError(res: Response): Promise<OpenAIError> {
  const text = await res.text().catch(() => '');
  try {
    const e = (JSON.parse(text) as { error?: { message?: string; code?: string | null; type?: string | null } }).error;
    if (e) return { status: res.status, code: e.code ?? null, type: e.type ?? null, message: e.message ?? '' };
  } catch {
    // not JSON: a proxy or a gateway answered
  }
  return { status: res.status, message: text.slice(0, 500) };
}

function retryAfterMs(res: Response): number {
  const seconds = Number(res.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
}

// ---------------------------------------------------------------- the adapter

export function openai(options: OpenAIOptions = {}): DecisionModel {
  const model = options.name ?? OPENAI_DEFAULT_MODEL;
  return {
    id: 'openai',
    limits: OPENAI_LIMITS,
    async decide(request) {
      // Read on first use, so a dry run needs no key.
      const key = process.env.OPENAI_API_KEY;
      if (!key) throw new Error('OPENAI_API_KEY is not set');
      const body = JSON.stringify(toOpenAI(request, model));
      const send = () =>
        fetch(OPENAI_ENDPOINT, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });

      let res = await send();
      if (!res.ok) {
        const error = await parseError(res);
        const wait = retryAfterMs(res);
        if (!retryable(error) || wait > MAX_RETRY_WAIT_MS) throw new Error(errorMessage(error));
        await new Promise((r) => setTimeout(r, wait));
        res = await send();
        if (!res.ok) throw new Error(errorMessage(await parseError(res)));
      }
      return fromOpenAI((await res.json()) as OpenAIResponse, request);
    },
  };
}

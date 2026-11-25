/**
 * Asks the decision model the questions the tests declared, about the skill folder as it is, and
 * builds the report. One request per file of the skill and set of `with` files, with every
 * question about them. The text output and `--json` both print this same report, so people and
 * CI read the same data.
 */
import type { Config, Thresholds } from '../config.js';
import type { DecisionModel, DecisionRequest } from '../models/index.js';
import type { RunReport } from '../proof/layer.js';
import { buildRequest, estimateTokens, read, type TokenEstimate, type Verdict } from './reader.js';
import type { Collected, Question, QuestionProblem, TestCase } from './questions.js';
import { readSkillText, readWithFiles } from './skill-text.js';

type Usage = { input_tokens: number; output_tokens: number };

/** One request: the questions about one file of the skill, read with the same `with` files. */
export interface RequestReport {
  /** The file the questions are about, from the skill folder. */
  file: string;
  sections: string[];
  /** Other files the reader got too (from `with`), in the order they were sent. */
  with: string[];
  /** Length of the text the questions read: the part of `file` plus every `with` file. */
  chars: number;
  /** Estimated tokens of the state plus the longest question: what the model's `perQuestionTokens` limits. */
  estimatedTokens: number;
  model?: string;
  verdicts: Verdict[];
  usage: Usage;
  /** Why the request could not run: a missing heading, a request too large, a failed call… */
  error?: string;
  /** The questions of the request that could not run, when it could not: where each is declared. */
  questions?: { id: string; unit?: string; declared: { file: string; line: number } }[];
}

export interface Report {
  ok: boolean;
  skill: string;
  /** The provider asked: the `id` of the decision model. */
  provider?: string;
  dryRun: boolean;
  /** What the verdicts were judged with. */
  thresholds: Thresholds;
  /** What ran the tests that declare the questions, when `test` ran them itself. */
  run?: RunReport;
  requests: RequestReport[];
  /** Questions that cannot be asked, and what kept the questions from being collected. */
  problems: QuestionProblem[];
  /** With `--changed`: the base the changed skill files were found against. */
  changed?: { ref: string; commit: string };
  summary: {
    tests: number;
    passed: number;
    /** Verdicts near their threshold, pass or fail. */
    borderline: number;
    /** Questions a selection (`--changed`) left out. */
    skipped: number;
    usage: Usage;
  };
}

/** Whether to ask a question (`--changed`). */
export type Selection = (question: Question) => boolean;

export interface RunOptions {
  /** Check that the questions can be asked, headings exist and requests fit the model's limits; send nothing. */
  dryRun?: boolean;
  select?: Selection;
  /** What ran the tests, when `test` ran them. */
  run?: RunReport;
  /** Problems found before the questions were asked, such as a run of the tests that failed. */
  problems?: QuestionProblem[];
}

export async function runAll(config: Config, model: DecisionModel, collected: Collected, options: RunOptions = {}): Promise<Report> {
  const dryRun = options.dryRun ?? false;
  const selected = options.select ? collected.questions.filter(options.select) : collected.questions;
  const skipped = collected.questions.length - selected.length;

  const requests: RequestReport[] = [];
  for (const group of groups(selected)) {
    for (const chunk of chunks(group.questions, model.limits.questionsPerRequest)) {
      requests.push(await runRequest({ ...group, questions: chunk }, config, model, dryRun));
    }
  }
  const problems = [...(options.problems ?? []), ...collected.problems];

  const summary = { tests: 0, passed: 0, borderline: 0, skipped, usage: { input_tokens: 0, output_tokens: 0 } };
  for (const r of requests) {
    summary.tests += r.verdicts.length;
    summary.passed += r.verdicts.filter((v) => v.pass).length;
    summary.borderline += r.verdicts.filter((v) => v.borderline).length;
    summary.usage.input_tokens += r.usage.input_tokens;
    summary.usage.output_tokens += r.usage.output_tokens;
  }
  const ok = !problems.length && requests.every((r) => !r.error && r.verdicts.every((v) => v.pass));
  return {
    ok,
    skill: config.skill,
    provider: model.id,
    dryRun,
    thresholds: { ...config.thresholds },
    ...(options.run ? { run: options.run } : {}),
    requests,
    problems,
    summary,
  };
}

interface Group {
  file: string;
  sections: string[];
  withFiles: string[] | 'all';
  questions: Question[];
}

/** The questions by file, sections and `with` files, in the order the first of each was declared. */
function groups(questions: Question[]): Group[] {
  const out = new Map<string, Group>();
  for (const q of questions) {
    const key = JSON.stringify([q.file, q.sections, q.withFiles]);
    const group = out.get(key) ?? { file: q.file, sections: q.sections, withFiles: q.withFiles, questions: [] };
    group.questions.push(q);
    out.set(key, group);
  }
  return [...out.values()];
}

/** The questions in runs that fit `limit` questions, every phrasing counted. */
function chunks(questions: Question[], limit: number | undefined): Question[][] {
  if (limit === undefined) return [questions];
  const out: Question[][] = [];
  let current: Question[] = [];
  let count = 0;
  for (const q of questions) {
    if (current.length && count + q.scenarios.length > limit) {
      out.push(current);
      current = [];
      count = 0;
    }
    current.push(q);
    count += q.scenarios.length;
  }
  if (current.length) out.push(current);
  return out;
}

async function runRequest(group: Group, config: Config, model: DecisionModel, dryRun: boolean): Promise<RequestReport> {
  const report: RequestReport = {
    file: group.file,
    sections: group.sections,
    with: [],
    chars: 0,
    estimatedTokens: 0,
    verdicts: [],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  const tests: TestCase[] = group.questions;
  try {
    const text = readSkillText(config.skill, group.file, group.sections);
    const references = readWithFiles(config.skill, group.file, group.withFiles);
    report.with = Object.keys(references);
    report.chars = text.length + Object.values(references).reduce((n, r) => n + r.length, 0);

    const request = buildRequest(text, tests, config.context, references);
    const estimate = estimateTokens(request);
    report.estimatedTokens = estimate.stateAndLongestQuestion;
    checkCounts(model, request);
    checkLimits(model, estimate, text, references);

    if (dryRun) {
      report.verdicts = tests.map((t) => ({
        id: t.id,
        expect: t.expect,
        answer: '(dry run)',
        confidence: 0,
        expectedProb: 0,
        pass: true,
        weak: false,
        borderline: false,
        scenario: t.scenarios[0]!,
        question: t.question,
        ...(t.unit ? { unit: t.unit } : {}),
        ...(t.declared ? { declared: t.declared } : {}),
      }));
      return report;
    }

    const result = await read(model, request, tests, config.thresholds);
    report.verdicts = result.verdicts;
    report.model = result.model;
    report.usage = result.usage;
    return report;
  } catch (e) {
    return {
      ...report,
      error: (e as Error).message,
      questions: group.questions.map((q) => ({ id: q.id, ...(q.unit ? { unit: q.unit } : {}), declared: q.declared })),
    };
  }
}

/** Refuses a request with more questions, or a question with more options, than the model takes. */
function checkCounts(model: DecisionModel, request: DecisionRequest) {
  const { questionsPerRequest, optionsPerQuestion } = model.limits;
  if (questionsPerRequest !== undefined && request.questions.length > questionsPerRequest) {
    throw new Error(
      `too many phrasings: the question ${request.questions[0]!.id.replace(/#\d+$/, '')} has ${request.questions.length}; ${model.id} takes ${questionsPerRequest} in one request`,
    );
  }
  if (optionsPerQuestion === undefined) return;
  const over = request.questions.find((q) => (q.options?.length ?? 0) > optionsPerQuestion);
  if (over) {
    throw new Error(
      `too many options: the question ${over.id.replace(/#\d+$/, '')} has ${over.options!.length}, \`none\` included; ${model.id} takes ${optionsPerQuestion} in one question`,
    );
  }
}

/** Refuses a request the model would reject, and says which files make it big. */
function checkLimits(model: DecisionModel, estimate: TokenEstimate, text: string, references: Record<string, string>) {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const { perQuestionTokens, perRequestTokens } = model.limits;
  const over =
    estimate.stateAndLongestQuestion > perQuestionTokens
      ? `the skill text plus the longest question is about ${fmt(estimate.stateAndLongestQuestion)} tokens; ${model.id} takes ${fmt(perQuestionTokens)}`
      : estimate.request > perRequestTokens
        ? `the request is about ${fmt(estimate.request)} tokens; ${model.id} takes ${fmt(perRequestTokens)}. Give some of the questions about this file a \`section\`, so they are asked apart`
        : '';
  if (!over) return;
  const sizes = [['the file under test', text.length] as const, ...Object.entries(references).map(([p, r]) => [p, r.length] as const)]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([p, n]) => `${p} ${fmt(n)} chars`)
    .join(', ');
  throw new Error(`too large: ${over}. Largest parts: ${sizes}. List fewer files in \`with\`.`);
}

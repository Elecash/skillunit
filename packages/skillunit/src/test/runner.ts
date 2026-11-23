/**
 * Runs spec files against a skill and builds the report. The text output and `--json` both
 * print this same report, so people and CI read the same data.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, Thresholds } from '../config.js';
import type { DecisionModel } from '../models/index.js';
import { buildRequest, estimateTokens, read, type TokenEstimate, type Verdict } from './reader.js';
import { readSkillText, readWithFiles } from './skill-text.js';
import { loadSpec, type SpecFile } from './spec.js';

type Usage = { input_tokens: number; output_tokens: number };

export interface SpecReport {
  spec: string;
  file: string;
  sections: string[];
  /** Other files the reader got too (from `with`), in the order they were sent. */
  with: string[];
  /** Length of the text the tests read: the part of `file` plus every `with` file. */
  chars: number;
  /** Estimated tokens of the state plus the longest question: what the model's `perQuestionTokens` limits. */
  estimatedTokens: number;
  model?: string;
  verdicts: Verdict[];
  usage: Usage;
  /** Why the spec could not run (invalid YAML, a missing heading, a failed request…). */
  error?: string;
}

export interface Report {
  ok: boolean;
  skill: string;
  dryRun: boolean;
  /** What the verdicts were judged with. */
  thresholds: Thresholds;
  specs: SpecReport[];
  /** With `--changed`: the base the changed skill files were found against. */
  changed?: { ref: string; commit: string };
  summary: {
    tests: number;
    passed: number;
    /** Verdicts near their threshold, pass or fail. */
    borderline: number;
    /** Specs a selection (`test --changed`) left out. */
    skipped: number;
    usage: Usage;
  };
}

/** Whether to run a spec (`test --changed`). A spec that does not load is always reported. */
export type Selection = (spec: SpecFile) => boolean;

export interface RunOptions {
  /** Check that specs load, headings exist and requests fit the model's limits; send nothing. */
  dryRun?: boolean;
  select?: Selection;
}

export async function runAll(config: Config, model: DecisionModel, options: RunOptions = {}): Promise<Report> {
  const dryRun = options.dryRun ?? false;
  const specs: SpecReport[] = [];
  let skipped = 0;
  for (const path of collectSpecs(config.specs)) {
    const report = await runSpec(path, config, model, dryRun, options.select);
    if (report) specs.push(report);
    else skipped++;
  }

  const summary = { tests: 0, passed: 0, borderline: 0, skipped, usage: { input_tokens: 0, output_tokens: 0 } };
  for (const s of specs) {
    summary.tests += s.verdicts.length;
    summary.passed += s.verdicts.filter((v) => v.pass).length;
    summary.borderline += s.verdicts.filter((v) => v.borderline).length;
    summary.usage.input_tokens += s.usage.input_tokens;
    summary.usage.output_tokens += s.usage.output_tokens;
  }
  const ok = specs.every((s) => !s.error && s.verdicts.every((v) => v.pass));
  return { ok, skill: config.skill, dryRun, thresholds: { ...config.thresholds }, specs, summary };
}

/** Expands folders into the `.yaml` / `.yml` files they contain, sorted by name. */
export function collectSpecs(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) throw new Error(`spec path not found: ${p}`);
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) if (/\.ya?ml$/.test(f)) out.push(join(p, f));
    } else {
      out.push(p);
    }
  }
  if (out.length === 0) throw new Error(`no .yaml spec files in: ${paths.join(', ')}`);
  return out;
}

async function runSpec(
  path: string,
  config: Config,
  model: DecisionModel,
  dryRun: boolean,
  select: Selection | undefined,
): Promise<SpecReport | null> {
  const report: SpecReport = {
    spec: path,
    file: 'SKILL.md',
    sections: [],
    with: [],
    chars: 0,
    estimatedTokens: 0,
    verdicts: [],
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  try {
    const spec = loadSpec(path);
    if (select && !select(spec)) return null;
    report.file = spec.file;
    report.sections = spec.sections;

    const text = readSkillText(config.skill, spec.file, spec.sections);
    const references = readWithFiles(config.skill, spec.file, spec.withFiles);
    report.with = Object.keys(references);
    report.chars = text.length + Object.values(references).reduce((n, r) => n + r.length, 0);

    const request = buildRequest(text, spec.tests, config.context, references);
    const estimate = estimateTokens(request);
    report.estimatedTokens = estimate.stateAndLongestQuestion;
    checkLimits(model, estimate, text, references);

    if (dryRun) {
      report.verdicts = spec.tests.map((t) => ({
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
        ...(t.line ? { line: t.line } : {}),
      }));
      return report;
    }

    const result = await read(model, request, spec.tests, config.thresholds);
    report.verdicts = result.verdicts;
    report.model = result.model;
    report.usage = result.usage;
    return report;
  } catch (e) {
    return { ...report, error: (e as Error).message };
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
        ? `the request is about ${fmt(estimate.request)} tokens; ${model.id} takes ${fmt(perRequestTokens)}. Split the tests into two specs`
        : '';
  if (!over) return;
  const sizes = [['the file under test', text.length] as const, ...Object.entries(references).map(([p, r]) => [p, r.length] as const)]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([p, n]) => `${p} ${fmt(n)} chars`)
    .join(', ');
  throw new Error(`too large: ${over}. Largest parts: ${sizes}. List fewer files in \`with\`.`);
}

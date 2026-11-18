/**
 * Runs spec files against a skill and builds the report. The text output and `--json` both
 * print this same report, so people and CI read the same data.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import type { Config } from './config.js';
import { buildRequest, estimateTokens, read, TOKEN_LIMITS, type Verdict } from './reader.js';
import { readSkillText, readWithFiles } from './skill-text.js';
import { loadSpec } from './spec.js';

/** Bumped only when a field of the JSON report changes meaning or disappears. */
export const REPORT_SCHEMA = 1;

type Usage = { input_tokens: number; output_tokens: number };

export interface SpecReport {
  spec: string;
  file: string;
  sections: string[];
  /** Other files the reader got too (from `with`), in the order they were sent. */
  with: string[];
  /** Length of the text the tests read: the part of `file` plus every `with` file. */
  chars: number;
  /** Estimated tokens of the state plus the longest question, the figure TypeSafe caps at 32k. */
  estimatedTokens: number;
  model?: string;
  verdicts: Verdict[];
  usage: Usage;
  /** Why the spec could not run (invalid YAML, a missing heading, a TypeSafe error…). */
  error?: string;
}

export interface Report {
  schema: typeof REPORT_SCHEMA;
  ok: boolean;
  skill: string;
  dryRun: boolean;
  specs: SpecReport[];
  summary: { tests: number; passed: number; usage: Usage };
}

/** `client` is undefined for a dry run: specs and headings are checked, nothing is sent. */
export async function runAll(config: Config, client: TypeSafeClient | undefined): Promise<Report> {
  const specs: SpecReport[] = [];
  for (const path of collectSpecs(config.specs)) specs.push(await runSpec(path, config, client));

  const summary = { tests: 0, passed: 0, usage: { input_tokens: 0, output_tokens: 0 } };
  for (const s of specs) {
    summary.tests += s.verdicts.length;
    summary.passed += s.verdicts.filter((v) => v.pass).length;
    summary.usage.input_tokens += s.usage.input_tokens;
    summary.usage.output_tokens += s.usage.output_tokens;
  }
  const ok = specs.every((s) => !s.error && s.verdicts.every((v) => v.pass));
  return { schema: REPORT_SCHEMA, ok, skill: config.skill, dryRun: !client, specs, summary };
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

async function runSpec(path: string, config: Config, client: TypeSafeClient | undefined): Promise<SpecReport> {
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
    report.file = spec.file;
    report.sections = spec.sections;

    const text = readSkillText(config.skill, spec.file, spec.sections);
    const references = readWithFiles(config.skill, spec.file, spec.withFiles);
    report.with = Object.keys(references);
    report.chars = text.length + Object.values(references).reduce((n, r) => n + r.length, 0);

    const request = buildRequest(text, spec.tests, config.context, config.model, references);
    const estimate = estimateTokens(request);
    report.estimatedTokens = estimate.stateAndLongestQuestion;
    checkLimits(estimate, text, references);

    if (!client) {
      report.verdicts = spec.tests.map((t) => ({
        id: t.id,
        expect: t.expect,
        answer: '(dry run)',
        confidence: 0,
        expectedProb: 0,
        pass: true,
        weak: false,
      }));
      return report;
    }

    const result = await read(client, text, spec.tests, config.thresholds, config.context, config.model, references);
    report.verdicts = result.verdicts;
    report.model = result.model;
    report.usage = result.usage;
    return report;
  } catch (e) {
    return { ...report, error: (e as Error).message };
  }
}

/** Refuses a request TypeSafe would reject, and says which files make it big. */
function checkLimits(
  estimate: ReturnType<typeof estimateTokens>,
  text: string,
  references: Record<string, string>,
) {
  const fmt = (n: number) => n.toLocaleString('en-US');
  const over =
    estimate.stateAndLongestQuestion > TOKEN_LIMITS.stateAndLongestQuestion
      ? `the skill text plus the longest question is about ${fmt(estimate.stateAndLongestQuestion)} tokens; TypeSafe takes ${fmt(TOKEN_LIMITS.stateAndLongestQuestion)}`
      : estimate.request > TOKEN_LIMITS.request
        ? `the request is about ${fmt(estimate.request)} tokens; TypeSafe takes ${fmt(TOKEN_LIMITS.request)}. Split the tests into two specs`
        : '';
  if (!over) return;
  const sizes = [['the file under test', text.length] as const, ...Object.entries(references).map(([p, r]) => [p, r.length] as const)]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([p, n]) => `${p} ${fmt(n)} chars`)
    .join(', ');
  throw new Error(`too large: ${over}. Largest parts: ${sizes}. List fewer files in \`with\`.`);
}

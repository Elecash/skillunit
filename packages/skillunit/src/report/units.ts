/**
 * The report by unit: the three layers joined on the unit id. Each file of the skill, then each
 * unit in it, then what each layer found about that unit: its lint findings, the tests tagged
 * for it, and the model tests that name it with `unit:`. The table reporter prints this; the
 * join is apart from the text so it can be tested without it.
 */
import type { Problem } from '../lint/types.js';
import { failedTestPrefix, type ProofTest, type UnitProof } from '../proof/layer.js';
import type { Verdict } from '../test/reader.js';
import type { SpecReport } from '../test/runner.js';
import type { UnitKind } from '../units/types.js';
import type { CheckReport, ReportUnit } from './types.js';

/** Findings shown for one example; the rest are counted. */
export const PER_EXAMPLE = 3;

/**
 * The state a line shows: passed, failed, a warning or borderline pass, no line of this layer
 * for the unit, or a test of a dry run, ready and not sent.
 */
export type Mark = 'pass' | 'fail' | 'warn' | 'none' | 'ready';

export type Line =
  /** `more`: findings of the same example left out after this one. */
  | { kind: 'lint'; mark: Mark; problem: Problem; more: number }
  /** A tagged test, and the finding its failure gave, if any. */
  | { kind: 'tagged'; mark: Mark; test: ProofTest; problem?: Problem }
  /** Any other proof finding. */
  | { kind: 'proof'; mark: Mark; problem: Problem }
  /** `unknownUnit`: the test's `unit:` names no unit of the skill. */
  | { kind: 'verdict'; mark: Mark; spec: SpecReport; verdict: Verdict; unknownUnit: boolean }
  /** A spec that could not run. */
  | { kind: 'spec'; mark: Mark; spec: SpecReport }
  /** The unit has no line of this layer. */
  | { kind: 'missing'; mark: Mark; layer: 'proof' | 'test' };

export type Layer = 'lint' | 'proof' | 'test';

export const layerOf = (line: Line): Layer =>
  line.kind === 'lint' ? 'lint' : line.kind === 'tagged' || line.kind === 'proof' ? 'proof' : line.kind === 'missing' ? line.layer : 'test';

/** Which layers cover a unit: tagged tests, model tests, both or neither. */
export type Coverage = 'both' | 'proof' | 'test' | 'none';

export interface UnitNode {
  id: string;
  kind: UnitKind;
  file: string;
  line: number;
  /** Lint findings, then proof lines, then test lines. */
  lines: Line[];
  /** Failed when a line failed; a warning when a line is one, or the unit is not covered. */
  mark: 'pass' | 'fail' | 'warn';
  /** Null when coverage is not computed: see `UnitTree.coverage`. */
  coverage: Coverage | null;
  /** What the proof layer says about the unit, when it ran. */
  proof?: UnitProof;
  /** Its model tests, when the test layer ran. */
  tests?: { passed: number; total: number };
}

export interface FileNode {
  /** From the skill folder. */
  file: string;
  /** Findings with no unit, and the tests of a spec about this file that name none. */
  lines: Line[];
  units: UnitNode[];
}

export interface UnitTree {
  /** Absolute path of the skill folder. */
  skill: string;
  /** The layers that ran. Proof counts only with a `proof` key. */
  layers: Record<Layer, boolean>;
  /** `--changed` or spec paths: only the units and files with a line are kept. */
  partial: boolean;
  files: FileNode[];
  /** Files lint read that have no node, or null when lint did not run or the run is partial. */
  otherFiles: number | null;
  /** What has no place in the skill: findings about the settings, the lock or a report, and specs that could not run. */
  elsewhere: Line[];
  /** Units by coverage, when both layers ran over the whole skill (`check` with a `proof` key, without `--changed`). */
  coverage: Record<Coverage, number> | null;
}

export function unitTree(report: CheckReport): UnitTree {
  const { lint, test } = report;
  const proof = report.proof?.configured ? report.proof : undefined;
  const skill = lint?.skill ?? proof?.skill ?? test?.skill ?? '';
  const partial = Boolean(test && (test.changed || test.paths?.length || test.summary.skipped));
  const units: ReportUnit[] = report.units ?? [];

  // ---------------------------------------------------------------- nodes
  const order = new Map<string, number>();
  for (const f of [...(lint?.files ?? []), ...units.map((u) => u.file)]) if (!order.has(f)) order.set(f, order.size);
  const files = new Map<string, FileNode>();
  const fileNode = (file: string) => {
    let node = files.get(file);
    if (!node) {
      node = { file, lines: [], units: [] };
      files.set(file, node);
      if (!order.has(file)) order.set(file, order.size);
    }
    return node;
  };
  const byId = new Map<string, UnitNode>();
  const all: UnitNode[] = [];
  for (const u of units) {
    const node: UnitNode = { ...u, lines: [], mark: 'pass', coverage: null };
    fileNode(u.file).units.push(node);
    all.push(node);
    if (!byId.has(u.id)) byId.set(u.id, node);
  }
  /** The unit a finding names, in the finding's file when two units share the id. */
  const unitOf = (id: string | undefined, file?: string) => (id === undefined ? undefined : (all.find((u) => u.id === id && u.file === file) ?? byId.get(id)));
  const elsewhere: Line[] = [];
  /** A finding about a file that is not Markdown of the skill: the settings, the lock, a report, a source file. */
  const outside = (p: Problem) => p.file.startsWith('../') || !p.file.endsWith('.md');
  const severity = (p: Problem): Mark => (p.severity === 'error' ? 'fail' : 'warn');

  // ---------------------------------------------------------------- lint
  if (lint) {
    const groups = new Map<Line[], Problem[]>();
    for (const p of lint.problems) {
      const target = outside(p) ? elsewhere : (unitOf(p.unit, p.file)?.lines ?? fileNode(p.file).lines);
      groups.set(target, [...(groups.get(target) ?? []), p]);
    }
    for (const [target, problems] of groups) target.push(...compact(problems).map(({ problem, more }): Line => ({ kind: 'lint', mark: severity(problem), problem, more })));
  }

  // ---------------------------------------------------------------- proof
  if (proof) {
    const used = new Set<Problem>();
    for (const u of proof.units) {
      const node = unitOf(u.id, u.file);
      if (!node) continue;
      node.proof = u;
      for (const t of u.tests) {
        const problem = t.status === 'failed' ? proof.problems.find((p) => !used.has(p) && p.unit === u.id && p.message.startsWith(failedTestPrefix(t.title))) : undefined;
        if (problem) used.add(problem);
        node.lines.push({ kind: 'tagged', mark: t.status === 'passed' ? 'pass' : t.status === 'failed' ? 'fail' : 'warn', test: t, ...(problem ? { problem } : {}) });
      }
    }
    for (const p of proof.problems) {
      if (used.has(p)) continue;
      const line: Line = { kind: 'proof', mark: severity(p), problem: p };
      if (outside(p)) elsewhere.push(line);
      else (unitOf(p.unit, p.file)?.lines ?? fileNode(p.file).lines).push(line);
    }
    for (const node of all) if (!node.lines.some((l) => layerOf(l) === 'proof')) node.lines.push({ kind: 'missing', mark: 'none', layer: 'proof' });
  }

  // ---------------------------------------------------------------- test
  if (test) {
    for (const spec of test.specs) {
      if (spec.error) elsewhere.push({ kind: 'spec', mark: 'fail', spec });
      for (const verdict of spec.verdicts) {
        const node = unitOf(verdict.unit);
        const mark: Mark = test.dryRun ? 'ready' : !verdict.pass ? 'fail' : verdict.borderline ? 'warn' : 'pass';
        const line: Line = { kind: 'verdict', mark, spec, verdict, unknownUnit: verdict.unit !== undefined && !node };
        (node?.lines ?? fileNode(spec.file).lines).push(line);
        if (node) {
          node.tests ??= { passed: 0, total: 0 };
          node.tests.total++;
          if (verdict.pass) node.tests.passed++;
        }
      }
    }
    if (!partial) for (const node of all) if (!node.tests) node.lines.push({ kind: 'missing', mark: 'none', layer: 'test' });
  }

  // ---------------------------------------------------------------- coverage and marks
  const covered = report.command === 'check' && proof !== undefined && test !== undefined && !partial;
  const coverage: Record<Coverage, number> | null = covered ? { both: 0, proof: 0, test: 0, none: 0 } : null;
  for (const node of all) {
    if (coverage) {
      const tagged = (node.proof?.tests.length ?? 0) > 0;
      const tested = (node.tests?.total ?? 0) > 0;
      node.coverage = tagged && tested ? 'both' : tagged ? 'proof' : tested ? 'test' : 'none';
      coverage[node.coverage]++;
    }
    const marks = node.lines.map((l) => l.mark);
    node.mark = marks.includes('fail') ? 'fail' : marks.includes('warn') || node.coverage === 'none' ? 'warn' : 'pass';
  }

  // ---------------------------------------------------------------- what is shown
  const real = (lines: Line[]) => lines.some((l) => l.kind !== 'missing');
  const shown = [...files.values()]
    .map((f) => ({ ...f, units: partial ? f.units.filter((u) => real(u.lines)) : f.units }))
    .filter((f) => f.lines.length || f.units.length)
    .sort((a, b) => order.get(a.file)! - order.get(b.file)!);
  const otherFiles = lint && !partial ? lint.files.filter((f) => !shown.some((n) => n.file === f)).length : null;

  return { skill, layers: { lint: lint !== undefined, proof: proof !== undefined, test: test !== undefined }, partial, files: shown, otherFiles, elsewhere, coverage };
}

/**
 * Lint findings as people read them: each line and message once, and at most `PER_EXAMPLE`
 * findings per example, with the rest counted on the last one shown.
 */
export function compact(problems: Problem[]): { problem: Problem; more: number }[] {
  const out: { problem: Problem; more: number }[] = [];
  const seen = new Set<string>();
  const last = new Map<string, { problem: Problem; more: number }>();
  const count = new Map<string, number>();
  for (const p of problems) {
    const key = `${p.file}\0${p.line}\0${p.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const example = p.example === undefined ? undefined : `${p.file}\0${p.example}`;
    if (example !== undefined) {
      const n = count.get(example) ?? 0;
      count.set(example, n + 1);
      if (n >= PER_EXAMPLE) {
        last.get(example)!.more++;
        continue;
      }
    }
    const entry = { problem: p, more: 0 };
    out.push(entry);
    if (example !== undefined) last.set(example, entry);
  }
  return out;
}

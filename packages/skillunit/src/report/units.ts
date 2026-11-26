/**
 * The report by unit: the two layers joined on the unit id. Each file of the skill, then each
 * unit in it, then what each layer found about that unit: what the proof found about it and
 * where it comes from, and the questions it declares. The table reporter prints this; the join
 * is apart from the text so it can be tested without it.
 */
import type { Problem } from '../problems.js';
import type { UnitProof } from '../proof/layer.js';
import type { QuestionProblem } from '../test/questions.js';
import type { Verdict } from '../test/reader.js';
import type { RequestReport } from '../test/runner.js';
import type { UnitKind } from '../unit/contract.js';
import type { CheckReport, ReportUnit } from './types.js';

/**
 * The state a line shows: passed, failed, a warning or borderline pass, no line of this layer
 * for the unit, or a test of a dry run, ready and not sent.
 */
export type Mark = 'pass' | 'fail' | 'warn' | 'none' | 'ready';

export type Line =
  /** Where a unit of a built skill comes from: a test that passed, or a declaration with no body. */
  | { kind: 'origin'; mark: Mark; unit: UnitProof }
  /** A proof finding. */
  | { kind: 'proof'; mark: Mark; problem: Problem }
  | { kind: 'verdict'; mark: Mark; request: RequestReport; verdict: Verdict }
  /** A request that could not run. */
  | { kind: 'request'; mark: Mark; request: RequestReport }
  /** A question that cannot be asked, or what kept the questions from being collected. */
  | { kind: 'question'; mark: Mark; problem: QuestionProblem }
  /** The unit has no line of this layer. */
  | { kind: 'missing'; mark: Mark; layer: 'proof' | 'test' };

export type Layer = 'proof' | 'test';

export const layerOf = (line: Line): Layer => (line.kind === 'origin' || line.kind === 'proof' ? 'proof' : line.kind === 'missing' ? line.layer : 'test');

/** Which layers cover a unit: a test that builds it, model tests, both or neither. */
export type Coverage = 'both' | 'proof' | 'test' | 'none';

export interface UnitNode {
  id: string;
  kind: UnitKind;
  file: string;
  line: number;
  /** Proof lines, then test lines. */
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
  /** Findings with no unit, and the questions of `ask()` about this file. */
  lines: Line[];
  units: UnitNode[];
}

export interface UnitTree {
  /** Absolute path of the skill folder. */
  skill: string;
  /** The layers that ran. Proof counts only with a `proof` key. */
  layers: Record<Layer, boolean>;
  /** `--changed`: only the units and files with a line are kept. */
  partial: boolean;
  files: FileNode[];
  /** What has no place in the skill: findings about the settings, the source or a test file, and requests that could not run. */
  elsewhere: Line[];
  /** Units by coverage, when both layers ran over the whole skill (`check` with a `source`, without `--changed`). */
  coverage: Record<Coverage, number> | null;
}

export function unitTree(report: CheckReport): UnitTree {
  const { test } = report;
  const proof = report.proof?.configured ? report.proof : undefined;
  const skill = proof?.skill ?? test?.skill ?? '';
  const partial = Boolean(test && (test.changed || test.summary.skipped));
  const units: ReportUnit[] = report.units ?? [];

  // ---------------------------------------------------------------- nodes
  const order = new Map<string, number>();
  for (const f of units.map((u) => u.file)) if (!order.has(f)) order.set(f, order.size);
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
  /** A finding about a file that is not Markdown of the skill: the settings, a record, a test file, a file of the source. */
  const outside = (p: Problem) => p.file.startsWith('../') || !p.file.endsWith('.md');
  const severity = (p: Problem): Mark => (p.severity === 'error' ? 'fail' : 'warn');

  // ---------------------------------------------------------------- proof
  if (proof) {
    for (const u of proof.units) {
      const node = unitOf(u.id, u.file);
      if (!node) continue;
      node.proof = u;
      // A unit declared with no body is never shown as proved.
      if (u.state === 'passed') node.lines.push({ kind: 'origin', mark: u.from === 'test' ? 'pass' : 'none', unit: u });
    }
    for (const p of proof.problems) {
      const line: Line = { kind: 'proof', mark: severity(p), problem: p };
      // A finding about a unit goes under it, even when it is in the source or a test file.
      const node = unitOf(p.unit, p.file);
      if (node) node.lines.push(line);
      else if (outside(p)) elsewhere.push(line);
      else fileNode(p.file).lines.push(line);
    }
    for (const node of all) if (!node.lines.some((l) => layerOf(l) === 'proof')) node.lines.push({ kind: 'missing', mark: 'none', layer: 'proof' });
  }

  // ---------------------------------------------------------------- test
  if (test) {
    for (const problem of test.problems) {
      const node = unitOf(problem.unit);
      (node?.lines ?? elsewhere).push({ kind: 'question', mark: 'fail', problem });
    }
    for (const request of test.requests) {
      if (request.error) elsewhere.push({ kind: 'request', mark: 'fail', request });
      for (const verdict of request.verdicts) {
        const node = unitOf(verdict.unit, request.file);
        const mark: Mark = test.dryRun ? 'ready' : !verdict.pass ? 'fail' : verdict.borderline ? 'warn' : 'pass';
        const line: Line = { kind: 'verdict', mark, request, verdict };
        (node?.lines ?? fileNode(request.file).lines).push(line);
        if (node) {
          node.tests ??= { passed: 0, total: 0 };
          node.tests.total++;
          if (verdict.pass) node.tests.passed++;
        }
      }
    }
    if (!partial) for (const node of all) if (!node.lines.some((l) => layerOf(l) === 'test')) node.lines.push({ kind: 'missing', mark: 'none', layer: 'test' });
  }

  // ---------------------------------------------------------------- coverage and marks
  const covered = report.command === 'check' && proof !== undefined && test !== undefined && !partial;
  const coverage: Record<Coverage, number> | null = covered ? { both: 0, proof: 0, test: 0, none: 0 } : null;
  for (const node of all) {
    if (coverage) {
      const built = node.proof?.from === 'test';
      const tested = (node.tests?.total ?? 0) > 0;
      node.coverage = built && tested ? 'both' : built ? 'proof' : tested ? 'test' : 'none';
      coverage[node.coverage]++;
    }
    const marks = node.lines.map((l) => l.mark);
    node.mark = marks.includes('fail') ? 'fail' : marks.includes('warn') || node.coverage === 'none' ? 'warn' : 'pass';
  }

  // ---------------------------------------------------------------- what is shown
  // `declared, no test` says nothing a partial run needs to show.
  const real = (lines: Line[]) => lines.some((l) => l.kind !== 'missing' && !(l.kind === 'origin' && l.unit.from === 'declared'));
  const shown = [...files.values()]
    .map((f) => ({ ...f, units: partial ? f.units.filter((u) => real(u.lines)) : f.units }))
    .filter((f) => f.lines.length || f.units.length)
    .sort((a, b) => order.get(a.file)! - order.get(b.file)!);
  return { skill, layers: { proof: proof !== undefined, test: test !== undefined }, partial, files: shown, elsewhere, coverage };
}

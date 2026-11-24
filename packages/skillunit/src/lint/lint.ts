/**
 * `skillunit lint`: parses the skill and runs every lint rule. The type-check of `ts`, `tsx`, `js`
 * and `jsx` examples happens in one `tsc` run, here.
 */
import { TS_LANGS, type ExamplesConfig } from '../config.js';
import { parseSkill, type Fence, type ParsedFile, type ParsedSkill } from '../units/index.js';
import { checks } from './check.js';
import { runCommands } from './commands.js';
import { isExample, isNoCheck, ownerUnit, setupFor } from './examples.js';
import { index } from './links.js';
import { fenceFlags } from './fences.js';
import { removedProofFlags } from './proof.js';
import { setups } from './setup.js';
import { structure } from './structure.js';
import { runTsc, type TsBlock, type TsDiagnostic } from './tsc.js';
import type { LintResult, LintRule, LintSummary, Problem } from './types.js';

export interface LintOptions {
  examples?: ExamplesConfig;
  /** Rules whose problems are not reported. */
  off?: LintRule[];
}

export function lint(dir: string, options: LintOptions = {}): LintResult {
  return lintSkill(parseSkill(dir), options);
}

export function lintSkill(skill: ParsedSkill, options: LintOptions = {}): LintResult {
  const summary: LintSummary = {
    files: skill.files.length,
    units: skill.units.length,
    typeChecked: 0,
    notParsed: 0,
    commandChecked: 0,
    unchecked: {},
    noCheck: 0,
    notConfigured: 0,
    off: [...(options.off ?? [])],
    undeclared: [],
  };
  const problems: Problem[] = [...structure(skill), ...setups(skill), ...checks(skill), ...index(skill), ...fenceFlags(skill), ...removedProofFlags(skill)];
  problems.push(...typeCheck(skill, options.examples, summary));
  if (options.examples) {
    const commands = runCommands(skill, options.examples);
    problems.push(...commands.problems);
    summary.commandChecked = commands.checked;
    summary.noCheck += commands.noCheck;
  }

  countUnchecked(skill, options.examples, summary);

  if (options.off?.length) {
    const off = new Set<string>(options.off);
    problems.splice(0, problems.length, ...problems.filter((p) => !off.has(p.rule)));
  }
  problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  summary.undeclared = undeclared(problems);
  return { skill: skill.root, files: skill.files.map((f) => f.file), ok: !problems.some((p) => p.severity === 'error'), problems, summary };
}

/** `setupFile` is the file whose `Setup` the block uses: its own, or its skill's `SKILL.md`. */
interface Job {
  file: ParsedFile;
  fence: Fence;
  isSetup: boolean;
  setupFile?: ParsedFile;
}

function typeCheck(skill: ParsedSkill, examples: ExamplesConfig | undefined, summary: LintSummary): Problem[] {
  const ts = examples?.ts;
  const jobs: Job[] = [];
  const blocks: TsBlock[] = [];
  const tsLang = (lang: string | null): lang is TsBlock['lang'] => lang !== null && TS_LANGS.includes(lang);
  const setupOf = (file: ParsedFile, lang: string) => {
    const s = setupFor(skill, file, lang);
    return s ? { block: { code: s.fence.code, line: s.fence.line + 1 }, file: s.file } : undefined;
  };

  for (const file of skill.files) {
    for (const fence of file.fences) {
      const isSetup = fence.owner.kind === 'setup';
      if (!tsLang(fence.lang) || !(isExample(fence) || isSetup)) continue;
      if (isNoCheck(fence)) {
        summary.noCheck++;
        continue;
      }
      if (!ts) {
        summary.notConfigured++;
        continue;
      }
      const setup = isSetup ? undefined : setupOf(file, fence.lang);
      jobs.push({ file, fence, isSetup, ...(setup ? { setupFile: setup.file } : {}) });
      blocks.push({ lang: fence.lang, code: fence.code, line: fence.line + 1, ...(setup ? { setup: setup.block } : {}) });
    }
  }

  const problems: Problem[] = [];
  if (!ts || blocks.length === 0) return problems;
  const run = runTsc(ts.tsconfig, blocks);
  summary.typescript = run.version;

  const reported = new Set<string>();
  const report = (p: Problem) => {
    const key = `${p.file}:${p.line}:${p.message}`;
    if (reported.has(key)) return;
    reported.add(key);
    problems.push(p);
  };
  const setupProblem = (file: ParsedFile, d: TsDiagnostic, example: number): Problem => ({
    file: file.file,
    line: d.line,
    severity: 'error',
    rule: 'types',
    message: `the Setup ${d.syntax ? 'does not parse' : 'does not type-check'}: ${d.code} ${d.message}`,
    code: d.code,
    example,
  });

  jobs.forEach((job, i) => {
    const diagnostics = withJsxHint(run.diagnostics[i]!, blocks[i]!);
    // A block whose code, or whose `Setup`, did not parse never reached the type-check.
    if (diagnostics.some((d) => d.syntax)) summary.notParsed++;
    else summary.typeChecked++;
    for (const d of diagnostics) {
      if (d.inSetup || job.isSetup) {
        // Once, at the `Setup` itself: an inherited one is in `SKILL.md`.
        const setup = d.inSetup ? blocks[i]!.setup!.line - 1 : job.fence.line;
        report(setupProblem(d.inSetup ? job.setupFile! : job.file, d, setup));
        continue;
      }
      const p: Problem = { file: job.file.file, line: d.line, severity: 'error', rule: 'types', message: `${d.syntax ? 'does not parse' : 'does not type-check'}: ${d.code} ${d.message}`, code: d.code, example: job.fence.line };
      const unit = ownerUnit(job.fence.owner);
      if (unit) p.unit = unit;
      report(p);
    }
  });
  return problems;
}

/** "Cannot find name", and "Cannot find name 'x'. Did you mean 'y'?". */
const NOT_FOUND = new Set(['TS2304', 'TS2552']);

/** The names of the problems `tsc` reports as not found, counted, the most frequent first. */
function undeclared(problems: Problem[]): LintSummary['undeclared'] {
  const counts = new Map<string, number>();
  for (const p of problems) {
    const name = p.code && NOT_FOUND.has(p.code) ? /Cannot find name '([^']+)'/.exec(p.message)?.[1] : undefined;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Example fences no checker ran on, per language: a language with no `examples` entry. Fences
 * with no language and `ts`/`js` fences without `examples.ts` are counted elsewhere.
 */
function countUnchecked(skill: ParsedSkill, examples: ExamplesConfig | undefined, summary: LintSummary) {
  for (const file of skill.files) {
    for (const fence of file.fences) {
      if (!fence.lang || TS_LANGS.includes(fence.lang) || isNoCheck(fence)) continue;
      if (!(isExample(fence) || fence.owner.kind === 'setup')) continue;
      if (examples?.commands[fence.lang]) continue;
      summary.unchecked[fence.lang] = (summary.unchecked[fence.lang] ?? 0) + 1;
    }
  }
}

/** A JSX tag: a closing tag, a self-closing one, or an opening tag with an attribute. `Array<string>` is not one. */
const JSX_TAG = /<\/[A-Za-z][\w.]*>|<[A-Za-z][\w.]*\s*\/>|<[A-Za-z][\w.]*\s+[\w-]+(?:=|\s*\/?>)/;

/**
 * JSX in a `ts` or `js` fence does not parse, and `tsc` says so with errors such as
 * "Unterminated regular expression literal" that do not name the cause. When a block that did
 * not parse looks like JSX, its first parse error says the fence should be `tsx` or `jsx`.
 */
function withJsxHint(diagnostics: TsDiagnostic[], block: TsBlock): TsDiagnostic[] {
  const first = diagnostics.findIndex((d) => d.syntax && !d.inSetup);
  if (first < 0 || (block.lang !== 'ts' && block.lang !== 'js') || !JSX_TAG.test(block.code)) return diagnostics;
  const fence = block.lang === 'ts' ? 'tsx' : 'jsx';
  return diagnostics.map((d, i) => (i === first ? { ...d, message: `${d.message} (this block looks like JSX, which parses only in a \`${fence}\` fence)` } : d));
}

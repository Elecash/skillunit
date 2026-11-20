/**
 * `skillunit lint`: parses the skill and runs every lint rule. The type-check of `ts`, `tsx`, `js`
 * and `jsx` examples and `Wrong` code happens in one `tsc` run, here.
 */
import { TS_LANGS, type ExamplesConfig } from '../config.js';
import { parseSkill, type Fence, type ParsedFile, type ParsedSkill } from '../units/index.js';
import { checks, guardedByCheck } from './check.js';
import { runCommands } from './commands.js';
import { collectWrongCode, isExample, isNoCheck, ownerUnit, setupFor, type WrongCode } from './examples.js';
import { index } from './links.js';
import { setups } from './setup.js';
import { sources } from './sources.js';
import { structure } from './structure.js';
import { runTsc, type TsBlock, type TsDiagnostic } from './tsc.js';
import type { LintResult, LintSummary, Problem } from './types.js';

export interface LintOptions {
  examples?: ExamplesConfig;
  /** Folder that `Source:` paths start from. Without it, `Source` paths are not checked. */
  sourceRoot?: string;
}

/** An undefined name in `Wrong` code would make the mistake look caught by the types. */
const UNDEFINED_NAME = 'TS2304';

export function lint(dir: string, options: LintOptions = {}): LintResult {
  return lintSkill(parseSkill(dir), options);
}

export function lintSkill(skill: ParsedSkill, options: LintOptions = {}): LintResult {
  const summary: LintSummary = {
    files: skill.files.length,
    units: skill.units.length,
    typeChecked: 0,
    commandChecked: 0,
    unchecked: {},
    noCheck: 0,
    notConfigured: 0,
    wrongCode: { checked: 0, unchecked: 0 },
  };
  const wrong = collectWrongCode(skill);
  const problems: Problem[] = [...structure(skill), ...setups(skill), ...checks(skill, wrong), ...index(skill)];
  if (options.sourceRoot) problems.push(...sources(skill, options.sourceRoot));

  problems.push(...typeCheck(skill, wrong, options.examples, summary));
  if (options.examples) {
    const commands = runCommands(skill, options.examples);
    problems.push(...commands.problems);
    summary.commandChecked = commands.checked;
    summary.noCheck += commands.noCheck;
  }

  countUnchecked(skill, options.examples, summary);

  problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { skill: skill.root, files: skill.files.map((f) => f.file), ok: !problems.some((p) => p.severity === 'error'), problems, summary };
}

type Job =
  | { kind: 'example'; file: ParsedFile; fence: Fence; isSetup: boolean }
  | { kind: 'wrong'; wrong: WrongCode };

function typeCheck(skill: ParsedSkill, wrong: WrongCode[], examples: ExamplesConfig | undefined, summary: LintSummary): Problem[] {
  const ts = examples?.ts;
  const jobs: Job[] = [];
  const blocks: TsBlock[] = [];
  const tsLang = (lang: string | null): lang is TsBlock['lang'] => lang !== null && TS_LANGS.includes(lang);
  const setupOf = (file: ParsedFile, lang: string) => {
    const s = setupFor(file, lang);
    return s ? { code: s.code, line: s.line + 1 } : undefined;
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
      jobs.push({ kind: 'example', file, fence, isSetup });
      blocks.push({ lang: fence.lang, code: fence.code, line: fence.line + 1, ...(isSetup ? {} : { setup: setupOf(file, fence.lang) }) });
    }
  }

  const problems: Problem[] = [];
  for (const w of wrong) {
    if (w.fence && isNoCheck(w.fence)) {
      summary.noCheck++;
      continue;
    }
    if (ts && tsLang(w.lang)) {
      jobs.push({ kind: 'wrong', wrong: w });
      blocks.push({ lang: w.lang, code: w.code, line: w.line, setup: setupOf(w.file, w.lang) });
      continue;
    }
    // Not type-checked: a Check that matches still guards it, but "compiles" cannot be told.
    if (w.lang !== null && guardedByCheck(w)) summary.wrongCode.checked++;
    else summary.wrongCode.unchecked++;
  }

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
  const setupProblem = (file: ParsedFile, d: TsDiagnostic): Problem => ({
    file: file.file,
    line: d.line,
    severity: 'error',
    rule: 'types',
    message: `the Setup ${d.syntax ? 'does not parse' : 'does not type-check'}: ${d.code} ${d.message}`,
  });

  jobs.forEach((job, i) => {
    const diagnostics = run.diagnostics[i]!;
    if (job.kind === 'example') {
      summary.typeChecked++;
      for (const d of diagnostics) {
        if (d.inSetup || job.isSetup) {
          report(setupProblem(job.file, d));
          continue;
        }
        const p: Problem = { file: job.file.file, line: d.line, severity: 'error', rule: 'types', message: `${d.syntax ? 'does not parse' : 'does not type-check'}: ${d.code} ${d.message}` };
        const unit = ownerUnit(job.fence.owner);
        if (unit) p.unit = unit;
        report(p);
      }
      return;
    }

    const w = job.wrong;
    summary.wrongCode.checked++;
    const own = diagnostics.filter((d) => !d.inSetup);
    for (const d of diagnostics.filter((d) => d.inSetup)) report(setupProblem(w.file, d));
    const syntax = own.find((d) => d.syntax);
    const undefinedName = own.find((d) => d.code === UNDEFINED_NAME);
    const base = { file: w.file.file, unit: w.unit.id, rule: 'wrong-code' as const };
    if (syntax) {
      report({
        ...base,
        line: syntax.line,
        severity: 'error',
        message: `this \`Wrong\` code does not parse (${syntax.code} ${syntax.message}); write it as complete code, or describe the mistake in prose`,
      });
    } else if (undefinedName) {
      report({
        ...base,
        line: undefinedName.line,
        severity: 'error',
        message: `this \`Wrong\` code uses a name that is not defined (${undefinedName.code} ${undefinedName.message}); define it in \`Setup\` or in the code, or the mistake looks caught by the types when it is not`,
      });
    } else if (own.length === 0 && !guardedByCheck(w)) {
      report({
        ...base,
        line: w.line,
        severity: 'warning',
        message: 'this `Wrong` code compiles and no `Check` of the unit matches it: nothing reports an example that makes this mistake',
      });
    }
  });
  return problems;
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

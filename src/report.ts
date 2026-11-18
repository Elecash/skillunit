/**
 * Prints a report as text for people. CI should read `--json` instead.
 *
 * Colour is on when stdout is a terminal, off with NO_COLOR or TERM=dumb, and forced on with
 * FORCE_COLOR. It uses plain ANSI codes, so there is no dependency.
 */
import { relative } from 'node:path';
import type { Verdict } from './reader.js';
import type { Report } from './runner.js';

// ---------------------------------------------------------------- colour

const useColor =
  process.env.FORCE_COLOR !== undefined
    ? process.env.FORCE_COLOR !== '0'
    : Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined && process.env.TERM !== 'dumb';

const paint = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');

/** Length as shown on screen, without the ANSI codes. */
const width = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '').length;
const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - width(s)));

const LEGEND =
  'confidence: how strongly the reader backs its answer, from 0 to 1. ' +
  'none: the skill says something else, or does not settle the question.';

// ---------------------------------------------------------------- report

export function printReport(report: Report): string {
  const out: string[] = [];
  for (const s of report.specs) {
    const base = s.sections.length ? `${s.file} › ${s.sections.join(' + ')}` : s.file;
    const also = s.with.length <= 3 ? s.with.join(', ') : `${s.with.length} more files`;
    const where = s.with.length ? `${base}  with ${also}` : base;
    const meta = [
      s.chars ? `${s.chars.toLocaleString('en-US')} chars` : '',
      // The estimate matters before sending, and when `with` makes the request large.
      (report.dryRun || s.with.length) && s.estimatedTokens ? `~${s.estimatedTokens.toLocaleString('en-US')} tokens` : '',
      s.model ?? '',
    ]
      .filter(Boolean)
      .join(' · ');
    out.push('', bold(relative(process.cwd(), s.spec)), `${where}  ${dim(meta)}`, '');
    if (s.error) {
      out.push(`  ${red('✗ could not run')}  ${s.error}`);
      continue;
    }
    out.push(...(report.dryRun ? dryRunLines(s.verdicts) : testLines(s.verdicts)));
  }

  const { tests, passed, usage } = report.summary;
  const failedSpecs = report.specs.filter((s) => s.error).length;
  out.push('');
  if (report.dryRun) {
    out.push(
      report.ok
        ? `${green('dry run ok')}  ${tests} tests; every spec loads, every heading exists and every request fits.`
        : red(`dry run failed  ${plural(failedSpecs, 'spec')} could not run`),
    );
  } else {
    const counts = `${passed}/${tests} tests passed`;
    const tokens = dim(`${usage.input_tokens.toLocaleString('en-US')} in / ${usage.output_tokens.toLocaleString('en-US')} out tokens`);
    out.push(`${report.ok ? green(counts) : red(counts)} · ${tokens}`);
    if (report.ok) {
      out.push(green('OK'));
    } else {
      const parts = [
        failedSpecs ? `${plural(failedSpecs, 'spec')} could not run` : '',
        tests > passed ? `${plural(tests - passed, 'test')} failed` : '',
      ].filter(Boolean);
      out.push(red(`FAILED  ${parts.join(', ')}`));
    }
    out.push('', dim(LEGEND));
  }
  out.push('');
  return out.join('\n');
}

function dryRunLines(verdicts: Verdict[]): string[] {
  const idw = Math.max(20, ...verdicts.map((v) => v.id.length)) + 2;
  return [
    dim(`  ${pad('TEST', idw + 2)}RESULT`),
    ...verdicts.map((v) => `  ${green('✓')} ${pad(v.id, idw)}${dim('ready to send')}`),
  ];
}

function testLines(verdicts: Verdict[]): string[] {
  const idw = Math.max(20, ...verdicts.map((v) => v.id.length)) + 2;
  const answers = verdicts.map((v) =>
    v.pass ? v.answer : v.weak ? `${v.answer} ${yellow('(weak)')}` : `${red(v.answer)} ${dim(`(expected ${v.expect})`)}`,
  );
  const aw = Math.max(12, ...answers.map(width)) + 3;

  const lines = [dim(`  ${pad('TEST', idw + 2)}${pad('ANSWER', aw)}${pad('CONFIDENCE', 12)}DISTRIBUTION`)];
  verdicts.forEach((v, i) => {
    const mark = v.pass ? green('✓') : v.weak ? yellow('~') : red('✗');
    const id = v.pass ? v.id : v.weak ? yellow(v.id) : red(v.id);
    lines.push(`  ${mark} ${pad(id, idw)}${pad(answers[i]!, aw)}${pad(confidenceOf(v).toFixed(2), 12)}${distribution(v)}`);
    if (v.variants) {
      const values = v.variants.map((p) => p.toFixed(2)).join('  ');
      lines.push(dim(`      phrasings  ${values}   (probability of "${v.expect}" for each; the median decides)`));
    }
  });
  return lines;
}

/**
 * One number for "how sure is the reader of what it answered". For a choice test that is
 * TypeSafe's confidence; for a yes/no test, the probability of the side it leaned to.
 */
function confidenceOf(v: Verdict): number {
  if (v.probabilities) return v.confidence;
  return v.answer === 'yes' ? v.confidence : 1 - v.confidence;
}

/** Options from most to least likely, e.g. "stop 96% · none 3% · local 1%". */
function distribution(v: Verdict): string {
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const entries = v.probabilities ? Object.entries(v.probabilities) : [['yes', v.confidence] as const, ['no', 1 - v.confidence] as const];
  return [...entries]
    .sort((a, b) => b[1] - a[1])
    .map(([label, p]) => `${label} ${pct(p)}`)
    .join(dim(' · '));
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

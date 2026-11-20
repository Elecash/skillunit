/** Plain text for `skillunit lint`, one problem per line. Phase 5 adds the other reporters. */
import type { LintResult, Problem } from './types.js';

/** `file:line  unit-id  what is wrong`, with `-` for a line that belongs to no unit. */
export function formatProblem(p: Problem): string {
  return `${p.file}:${p.line}  ${p.unit ?? '-'}  ${p.severity === 'warning' ? 'warning: ' : ''}${p.message}`;
}

export function formatLint(result: LintResult): string {
  const s = result.summary;
  const errors = result.problems.filter((p) => p.severity === 'error').length;
  const warnings = result.problems.length - errors;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

  const lines = result.problems.map(formatProblem);
  if (lines.length) lines.push('');
  const examples = [
    s.typeChecked ? `${plural(s.typeChecked, 'example')} type-checked with TypeScript ${s.typescript}` : '',
    s.commandChecked ? `${plural(s.commandChecked, 'example')} run through a command` : '',
    s.noCheck ? `${s.noCheck} marked no-check` : '',
    s.notConfigured ? `${s.notConfigured} ts/js not type-checked: set \`examples.ts\` in skillunit.yaml` : '',
    Object.keys(s.unchecked).length
      ? `not checked, no command set: ${Object.entries(s.unchecked)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([lang, n]) => `${n} ${lang}`)
          .join(', ')}`
      : '',
    s.wrongCode.unchecked ? `${s.wrongCode.unchecked} Wrong code not checked` : '',
  ].filter(Boolean);
  lines.push(`${plural(s.files, 'file')}, ${plural(s.units, 'unit')}${examples.length ? ` · ${examples.join(' · ')}` : ''}`);
  lines.push(errors || warnings ? `${plural(errors, 'error')}, ${plural(warnings, 'warning')}` : 'lint ok');
  return `${lines.join('\n')}\n`;
}

/** Plain text for `skillunit sync`. Phase 5 adds the other reporters. */
import { formatProblem } from '../lint/format.js';
import type { SyncResult } from './sync.js';

export function formatSync(result: SyncResult): string {
  const s = result.summary;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const lines = result.problems.map(formatProblem);
  if (lines.length) lines.push('');
  const since = `since ${result.base.ref} (${result.base.commit.slice(0, 7)})`;
  lines.push(`${plural(result.changed.length, 'file')} changed ${since} · ${plural(s.units, 'unit')}`);
  if (s.pointing === 0) {
    lines.push(result.problems.length ? plural(result.problems.length, 'error') : 'sync ok: no unit points at changed code');
  } else {
    const parts = [`${s.edited} edited`, `${s.marked} marked reviewed`, `${s.toReview} to review`];
    lines.push(`${plural(s.pointing, 'unit')} point${s.pointing === 1 ? 's' : ''} at changed code: ${parts.join(', ')}`);
    lines.push(result.ok ? 'sync ok' : plural(result.problems.length, 'error'));
  }
  return `${lines.join('\n')}\n`;
}

/** How a review reads at a terminal, in `review --list`, and as JSON with `--json`. */
import { basename, join } from 'node:path';
import { painter, plural, shown } from '../report/text.js';
import type { ReportOptions } from '../report/types.js';
import type { Change } from './changes.js';
import type { Review, ReviewGroup, ReviewUnit } from './review.js';

/** Bumped when a field of `review --json` changes meaning or disappears. */
export const REVIEW_SCHEMA = 1;

export function header(review: Review, options: ReportOptions): string[] {
  const c = painter(options.color);
  const lock = review.lock.found ? shown(review.lock.path, options) : `no ${shown(review.lock.path, options)} yet`;
  const base = review.base ? `changes since ${review.base.ref} (${review.base.commit.slice(0, 7)})` : 'no git base: paths only';
  return ['', `${c.bold('Review')}  ${c.dim(`${lock} · ${base}`)}`];
}

/** A group's source file, then what changed in each of its `Source` values. */
export function groupHead(group: ReviewGroup, options: ReportOptions): string[] {
  const c = painter(options.color);
  const out = ['', c.bold(shown(group.absolute, options))];
  for (const change of group.changes) out.push(...changeLines(change, options));
  return out;
}

/**
 * A `Source` as the unit writes it, the path that opens it from the folder the command runs in
 * (`path:line`, which an editor's terminal turns into a link), and its diff when it is stale.
 * A new `Source` has no diff: the reader opens the code there.
 */
function changeLines(change: Change, options: ReportOptions): string[] {
  const c = painter(options.color);
  const { line, lastLine } = change.at;
  const range = line !== undefined && lastLine !== undefined && lastLine > line ? `, lines ${line} to ${lastLine}` : '';
  const what = change.state === 'new' ? `new${range}` : `changed since the last review${range}`;
  const out = ['', `  ${c.bold(change.source)}  ${location(change, options)}  ${c.dim(what)}`];
  if (change.note) out.push(`  ${c.dim(change.note)}`);
  if (change.diff) {
    for (const text of change.diff.replace(/\n$/, '').split('\n')) {
      const paint = text.startsWith('+') && !text.startsWith('+++') ? c.green : text.startsWith('-') && !text.startsWith('---') ? c.red : text.startsWith('@@') ? c.dim : (s: string) => s;
      out.push(`    ${paint(text)}`);
    }
  }
  return out;
}

/** `path:line` from the folder the command runs in; a folder's path ends in `/`. */
export function location(change: Change, options: ReportOptions): string {
  const path = shown(change.at.path, options);
  if (change.at.line !== undefined) return `${path}:${change.at.line}`;
  return change.at.kind === 'folder' ? `${path}/` : path;
}

/** One unit: id, state and the edit hint, `file:line`, and its text. */
export function unitLines(unit: ReviewUnit, review: Review, options: ReportOptions): string[] {
  const c = painter(options.color);
  const hint = unit.change === 'edited' ? ', edited in this change' : unit.change === 'added' ? ', added in this change' : '';
  const state = unit.state === 'stale' ? c.red(`stale${hint}`) : c.yellow(`new${hint}`);
  return [
    '',
    `  ${c.bold(unit.id)}  ${state}`,
    `  ${c.dim(`${shown(join(review.skill, unit.file), options)}:${unit.line}`)}`,
    ...unit.text.split('\n').map((l) => `  ${c.dim('│')} ${l}`.trimEnd()),
  ];
}

/** The line that ends a listing: what is left, and the orphans. */
export function summary(review: Review, options: ReportOptions): string[] {
  const c = painter(options.color);
  const s = review.summary;
  const lock = basename(review.lock.path);
  const out: string[] = [''];
  if (!review.lock.found && s.toReview) {
    out.push(`There is no ${lock} yet, so every unit is new. Read them, then run \`skillunit review --accept-all\` to write it.`);
  }
  if (s.orphans) {
    const which = review.orphans.map((o) => (o.source ? `${o.unit} ${o.source}` : o.unit)).join(', ');
    out.push(c.yellow(`${lock} has ${s.orphans === 1 ? 'an entry' : `${s.orphans} entries`} with nothing left to describe (${which}); \`skillunit review --prune\` drops ${s.orphans === 1 ? 'it' : 'them'}.`));
  }
  const files = review.groups.length;
  out.push(s.toReview ? `${plural(s.toReview, 'unit')} to review in ${plural(files, 'file')} · ${s.inSync} in sync` : `Nothing to review: ${plural(s.inSync, 'unit')} in sync.`);
  return out;
}

/** `review --list`: everything, changing nothing. */
export function listing(review: Review, options: ReportOptions): string {
  const out = header(review, options);
  for (const group of review.groups) {
    out.push(...groupHead(group, options));
    for (const unit of group.units) out.push(...unitLines(unit, review, options));
  }
  out.push(...summary(review, options), '');
  return out.join('\n');
}

export function listingJson(review: Review): string {
  return `${JSON.stringify({ schema: REVIEW_SCHEMA, ...review }, null, 2)}\n`;
}

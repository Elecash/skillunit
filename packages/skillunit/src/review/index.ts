/**
 * `skillunit review`. At a terminal it asks about each unit to review. For agents and scripts:
 * `--list` prints the same content and changes nothing (`--json` for a machine), `--accept <id>…`
 * and `--accept-all` accept units, `--prune` drops orphan entries. With no flag and no terminal
 * it lists, and exits 1 when something needs review. It never commits.
 */
import type { ReportOptions } from '../report/types.js';
import { LockEdit } from './accept.js';
import { prompt, type PromptIO } from './prompt.js';
import { listing, listingJson, REVIEW_SCHEMA } from './render.js';
import { buildReview, type ReviewOptions } from './review.js';

export { buildReview, type Review, type ReviewGroup, type ReviewOptions, type ReviewUnit } from './review.js';
export { editorArgs, openEditor } from './prompt.js';

export interface ReviewArgs {
  list: boolean;
  json: boolean;
  accept: string[];
  acceptAll: boolean;
  prune: boolean;
}

export interface ReviewIO extends PromptIO {
  /** Both stdin and stdout are a terminal. */
  interactive: boolean;
}

/** Runs a review and returns the exit code: 0 done, 1 something still needs review or failed, 2 a wrong id. */
export async function runReview(options: ReviewOptions, args: ReviewArgs, io: ReviewIO, report: ReportOptions): Promise<number> {
  const review = buildReview(options);
  const print = (text: string) => io.output.write(text.endsWith('\n') ? text : `${text}\n`);

  if (args.accept.length || args.acceptAll || args.prune) {
    const edit = new LockEdit(options.lock, review.skill, options.sourceRoot);
    const ids = args.acceptAll ? review.groups.flatMap((g) => g.units.map((u) => u.id)) : args.accept;
    const errors: string[] = [];
    let unknown = false;
    for (const id of ids) {
      const error = edit.accept(id);
      if (error) errors.push(error);
      if (error?.startsWith('there is no unit')) unknown = true;
    }
    if (args.prune) edit.prune(review.orphans);
    const message = edit.write();
    if (args.json) {
      print(JSON.stringify({ schema: REVIEW_SCHEMA, lock: options.lock, written: edit.changed, accepted: edit.accepted, pruned: edit.pruned, errors }, null, 2));
    } else {
      for (const error of errors) print(`skillunit: ${error}`);
      print(message);
    }
    return unknown ? 2 : errors.length ? 1 : 0;
  }

  if (args.list || args.json || !io.interactive) {
    print(args.json ? listingJson(review) : listing(review, report));
    return review.summary.toReview ? 1 : 0;
  }

  if (!review.summary.toReview) {
    print(listing(review, report));
    return 0;
  }
  const edit = new LockEdit(options.lock, review.skill, options.sourceRoot);
  const left = await prompt(review, edit, io, report);
  print(`\n${edit.write()}`);
  return left.length ? 1 : 0;
}

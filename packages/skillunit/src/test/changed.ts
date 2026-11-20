/**
 * `test --changed`: from sync's result, run every spec whose skill file (or a `with` file)
 * changed, and the tests that name, with `unit:`, a unit sync reports for review.
 */
import { posix } from 'node:path';
import type { SyncResult } from '../sync/sync.js';
import type { Selection } from './runner.js';

export function changedSelection(sync: SyncResult): Selection {
  const files = new Set(sync.skillFiles);
  const toReview = new Set(sync.units.filter((u) => u.status === 'to-review').map((u) => u.id));
  const norm = (p: string) => posix.normalize(p.split('\\').join('/'));
  const anyMarkdown = sync.skillFiles.some((f) => f.endsWith('.md'));

  return (spec) => {
    const withChanged = spec.withFiles === 'all' ? anyMarkdown : spec.withFiles.some((f) => files.has(norm(f)));
    if (files.has(norm(spec.file)) || withChanged) return 'all';
    const ids = new Set(spec.tests.filter((t) => t.unit && toReview.has(t.unit)).map((t) => t.id));
    return ids.size ? ids : null;
  };
}

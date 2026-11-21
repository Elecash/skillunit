/**
 * Changes to `skillunit.lock` from a review: accept a unit (write the fingerprints of its code as
 * it is now), or drop orphan entries. Only this writes the lock.
 */
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { entryFor, formatLock, LOCK_VERSION, readLock, type Lock } from '../sync/lock.js';
import type { SyncOrphan } from '../sync/sync.js';
import { parseSkill } from '../units/index.js';

export class LockEdit {
  readonly lock: Lock;
  readonly existed: boolean;
  readonly accepted: string[] = [];
  readonly pruned: SyncOrphan[] = [];

  constructor(
    readonly path: string,
    private readonly skill: string,
    private readonly sourceRoot: string,
  ) {
    const current = readLock(path);
    this.existed = current !== null;
    this.lock = current ?? { version: LOCK_VERSION, units: {} };
  }

  /**
   * Accepts a unit as its code is now, reading the unit from the skill again so an edit made in
   * this review counts. Returns the error when it cannot: no such unit, or a `Source` with no
   * fingerprint.
   */
  accept(id: string): string | null {
    const unit = parseSkill(this.skill).units.find((u) => u.id === id);
    if (!unit) return `there is no unit \`${id}\` in the skill`;
    if (!unit.source.length) return `\`${id}\` has no \`Source\`, so there is nothing to accept`;
    const result = entryFor(unit.source, this.sourceRoot);
    if ('error' in result) return `cannot accept \`${id}\`: ${result.error}`;
    this.lock.units[id] = result.entry;
    if (!this.accepted.includes(id)) this.accepted.push(id);
    return null;
  }

  /** Drops the entries sync found with nothing left to describe. */
  prune(orphans: SyncOrphan[]) {
    for (const orphan of orphans) {
      const entry = this.lock.units[orphan.unit];
      if (!entry) continue;
      if (orphan.source) delete entry[orphan.source];
      if (!orphan.source || Object.keys(entry).length === 0) delete this.lock.units[orphan.unit];
      this.pruned.push(orphan);
    }
  }

  get changed(): boolean {
    return this.accepted.length > 0 || this.pruned.length > 0;
  }

  /** Writes the lock when something changed, and says what. */
  write(): string {
    const name = basename(this.path);
    if (!this.changed) return `${name} is unchanged.`;
    writeFileSync(this.path, formatLock(this.lock));
    const parts = [
      this.accepted.length
        ? `accepted ${this.accepted.length === 1 ? '1 unit' : `${this.accepted.length} units`}${this.accepted.length <= 10 ? ` (${this.accepted.join(', ')})` : ''}`
        : '',
      this.pruned.length ? `dropped ${this.pruned.length === 1 ? '1 orphan entry' : `${this.pruned.length} orphan entries`}` : '',
    ].filter(Boolean);
    const first = this.existed ? '' : ` This is the first ${name}: it records these units as reviewed, so read them first if you have not.`;
    return `${this.existed ? 'Updated' : 'Wrote'} ${name}: ${parts.join('; ')}. Commit it with the change.${first}`;
  }
}

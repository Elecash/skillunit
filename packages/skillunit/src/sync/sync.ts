/**
 * `skillunit sync`: compares the fingerprint of each unit's `Source` with the one in
 * `skillunit.lock`, taken when the unit was last reviewed. No git is needed.
 *
 * | State   | Meaning                                                   | Severity |
 * |---------|-----------------------------------------------------------|----------|
 * | in sync | every `Source` fingerprint equals the lock                | none     |
 * | stale   | a fingerprint differs: the code changed since the review  | error    |
 * | new     | the unit, or one of its `Source` values, is not in the lock | error  |
 * | orphan  | the lock names a unit or a `Source` that no longer exists | warning  |
 *
 * Editing a unit does not clear it: a stale unit is accepted in `skillunit review`.
 */
import { readFileSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import type { Problem } from '../lint/types.js';
import { parseSkill } from '../units/index.js';
import { fingerprint } from './fingerprint.js';
import { LOCK_FILE, lockLine, readLock, sourceKey } from './lock.js';

export interface SyncOptions {
  /** Folder of the skill. */
  skill: string;
  /** Folder `Source:` paths start from. */
  sourceRoot: string;
  /** Path of `skillunit.lock`. */
  lock: string;
}

export type UnitState = 'in-sync' | 'stale' | 'new';

export interface SyncSource {
  /** The `Source` as the unit writes it, and as the lock keys it. */
  source: string;
  state: UnitState;
  /** The fingerprint in the lock, when there is one. */
  locked?: string;
  /** The fingerprint of the code now; absent when it has none, with `error` saying why. */
  current?: string;
  error?: string;
}

export interface SyncUnit {
  id: string;
  /** Skill file of the unit, from the skill folder. */
  file: string;
  line: number;
  /** Stale when a source is stale, else new when one is new, else in sync. */
  state: UnitState;
  sources: SyncSource[];
}

/** A lock entry with nothing left to describe: a unit, or one `Source` of a unit. */
export interface SyncOrphan {
  unit: string;
  /** Absent when the whole unit is gone, or has no `Source` any more. */
  source?: string;
}

export interface SyncResult {
  /** No errors; orphans are warnings. */
  ok: boolean;
  /** Absolute path of the skill folder. */
  skill: string;
  /** Absolute path of the lock, and whether it exists. */
  lock: { path: string; found: boolean };
  /** Every unit with a `Source`, in skill order. */
  units: SyncUnit[];
  orphans: SyncOrphan[];
  problems: Problem[];
  summary: {
    /** Units in the skill. */
    units: number;
    /** Of those, units with a `Source`: the ones sync compares. */
    withSource: number;
    inSync: number;
    stale: number;
    new: number;
    orphans: number;
  };
}

export function sync(options: SyncOptions): SyncResult {
  const skillDir = resolve(options.skill);
  const skill = parseSkill(skillDir);
  const lock = readLock(options.lock);
  const lockText = lock ? readFileSync(options.lock, 'utf8') : '';
  // Problems point at a skill file; one about the lock points at it from the skill folder.
  const lockFile = relative(skillDir, resolve(options.lock)).split('\\').join('/');
  const name = basename(options.lock) || LOCK_FILE;

  const problems: Problem[] = [];
  const units: SyncUnit[] = [];
  const seen = new Set<string>();
  for (const unit of skill.units) {
    if (!unit.source.length || seen.has(unit.id)) continue; // a repeated id is a lint error
    seen.add(unit.id);
    const locked = lock?.units[unit.id];
    const sources = unit.source.map((ref): SyncSource => {
      const source = sourceKey(ref);
      const before = locked?.[source];
      const now = fingerprint(ref, options.sourceRoot);
      const state: UnitState = before === undefined ? 'new' : now.ok && now.fingerprint === before ? 'in-sync' : 'stale';
      return { source, state, ...(before ? { locked: before } : {}), ...(now.ok ? { current: now.fingerprint } : { error: now.message }) };
    });
    const state: UnitState = sources.some((s) => s.state === 'stale') ? 'stale' : sources.some((s) => s.state === 'new') ? 'new' : 'in-sync';
    units.push({ id: unit.id, file: unit.file, line: unit.line, state, sources });
    if (lock && state !== 'in-sync') {
      problems.push({ file: unit.file, line: unit.line, unit: unit.id, severity: 'error', rule: 'sync', message: unitMessage(sources, locked !== undefined, name) });
    }
  }

  const orphans: SyncOrphan[] = [];
  if (lock) {
    const byId = new Map(units.map((u) => [u.id, u]));
    for (const [id, entry] of Object.entries(lock.units)) {
      const unit = byId.get(id);
      const at = { file: lockFile, line: lockLine(lockText, id), unit: id, severity: 'warning' as const, rule: 'sync' as const };
      if (!unit) {
        orphans.push({ unit: id });
        problems.push({ ...at, message: `${name} has an entry for \`${id}\`, and no unit with a \`Source\` has that id; \`skillunit review --prune\` drops it` });
        continue;
      }
      for (const source of Object.keys(entry)) {
        if (unit.sources.some((s) => s.source === source)) continue;
        orphans.push({ unit: id, source });
        problems.push({ ...at, message: `${name} has \`${source}\` for \`${id}\`, and the unit no longer lists it; \`skillunit review --prune\` drops it` });
      }
    }
  } else if (units.length) {
    problems.push({
      file: lockFile,
      line: 1,
      severity: 'error',
      rule: 'sync',
      message: `there is no ${name} yet, and ${units.length === 1 ? '1 unit has' : `${units.length} units have`} a \`Source\`. Read each unit against its code, then run \`skillunit review --accept-all\` to write it`,
    });
  }

  const count = (state: UnitState) => units.filter((u) => u.state === state).length;
  return {
    ok: !problems.some((p) => p.severity === 'error'),
    skill: skillDir,
    lock: { path: options.lock, found: lock !== null },
    units,
    orphans,
    problems,
    summary: { units: skill.units.length, withSource: units.length, inSync: count('in-sync'), stale: count('stale'), new: count('new'), orphans: orphans.length },
  };
}

/** What is wrong with a unit that is not in sync, and what to do. */
function unitMessage(sources: SyncSource[], inLock: boolean, lock: string): string {
  const todo = 'read the code against the unit, edit the unit if it is wrong, then accept it with `skillunit review`';
  if (!inLock) return `this unit is not in ${lock}; ${todo}`;
  const list = (items: SyncSource[]) => items.map((s) => `\`${s.source}\``).join(', ');
  const changed = sources.filter((s) => s.state === 'stale' && !s.error);
  const unreadable = sources.filter((s) => s.error);
  const added = sources.filter((s) => s.state === 'new' && !s.error);
  const parts = [
    changed.length ? `${list(changed)} changed since the unit was last reviewed` : '',
    ...unreadable.map((s) => `\`${s.source}\` has no fingerprint: ${s.error}`),
    added.length ? `${list(added)} ${added.length === 1 ? 'is a new `Source`' : 'are new `Source` values'}, not in ${lock}` : '',
  ].filter(Boolean);
  return `${parts.join('; ')}; ${todo}`;
}

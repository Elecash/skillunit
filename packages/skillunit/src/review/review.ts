/**
 * `skillunit review`: the units sync reports as stale or new, grouped by source file because one
 * change often touches several units. Each group has what changed in its code, then its units.
 * Accepting a unit writes its fingerprints to `skillunit.lock`; review never commits.
 */
import { realpathSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { parseFile, parseSkill, type Unit } from '../units/index.js';
import { sync, type SyncOrphan, type SyncSource } from '../sync/sync.js';
import { changeFor, findBase, type Change, type GitBase } from './changes.js';

export interface ReviewOptions {
  skill: string;
  sourceRoot: string;
  lock: string;
}

export interface ReviewUnit {
  id: string;
  /** Skill file of the unit, from the skill folder. */
  file: string;
  line: number;
  state: 'stale' | 'new';
  /** The unit as written, heading to its last line. */
  text: string;
  /**
   * Against the git base: `edited` when its text differs, `added` when the base does not have
   * it. A hint for the reader; it does not clear the unit.
   */
  change?: 'edited' | 'added';
  sources: SyncSource[];
}

export interface ReviewGroup {
  /** The source file (or folder) the group is about: the first `Source` of its units that needs review, as written. */
  path: string;
  /** The same path, absolute. */
  absolute: string;
  /** What changed, once per `Source` of the group's units that is not in sync. */
  changes: Change[];
  units: ReviewUnit[];
}

export interface Review {
  /** Absolute path of the skill folder. */
  skill: string;
  sourceRoot: string;
  lock: { path: string; found: boolean };
  /** The git base the diffs start from; null outside git or with no default branch. */
  base: { ref: string; commit: string } | null;
  groups: ReviewGroup[];
  orphans: SyncOrphan[];
  summary: { toReview: number; inSync: number; orphans: number };
}

export function buildReview(options: ReviewOptions): Review {
  const result = sync({ skill: options.skill, sourceRoot: options.sourceRoot, lock: options.lock });
  const units = new Map(parseSkill(result.skill).units.map((u) => [u.id, u]));
  const base = findBase(result.skill);
  const before = base ? unitsAtBase(base, result.skill) : null;

  const groups = new Map<string, ReviewGroup>();
  for (const s of result.units) {
    if (s.state === 'in-sync') continue;
    const unit = units.get(s.id)!;
    const ref = unit.source[s.sources.findIndex((x) => x.state !== 'in-sync')]!;
    let group = groups.get(ref.path);
    if (!group) groups.set(ref.path, (group = { path: ref.path, absolute: resolve(options.sourceRoot, ref.path), changes: [], units: [] }));
    const old = before?.(unit.file, unit.id);
    const change = before === null ? undefined : old === undefined ? 'added' : normalize(old) !== normalize(unit.text) ? 'edited' : undefined;
    group.units.push({ id: s.id, file: s.file, line: s.line, state: s.state, text: unit.text, ...(change ? { change } : {}), sources: s.sources });
    s.sources.forEach((source, i) => {
      if (source.state === 'in-sync' || group!.changes.some((c) => c.source === source.source)) return;
      group!.changes.push(changeFor(unit.source[i]!, source.source, source.state, options.sourceRoot, base));
    });
  }

  const list = [...groups.values()];
  return {
    skill: result.skill,
    sourceRoot: options.sourceRoot,
    lock: result.lock,
    base: base ? { ref: base.ref, commit: base.commit } : null,
    groups: list,
    orphans: result.orphans,
    summary: { toReview: list.reduce((n, g) => n + g.units.length, 0), inSync: result.summary.inSync, orphans: result.orphans.length },
  };
}

/** The text of a unit at the git base, by skill file and id; undefined when the base does not have it. */
function unitsAtBase(base: GitBase, skill: string): (file: string, id: string) => string | undefined {
  const prefix = relative(base.top, realpathSync(skill)).split(sep).join('/');
  const cache = new Map<string, Map<string, Unit>>();
  return (file, id) => {
    if (!cache.has(file)) {
      const text = base.git.show(base.commit, prefix ? `${prefix}/${file}` : file);
      cache.set(file, new Map(text === null ? [] : parseFile(text, file).units.map((u) => [u.id, u])));
    }
    return cache.get(file)!.get(id)?.text;
  };
}

/** The unit text with every run of whitespace made one space: a reformat is not an edit. */
const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

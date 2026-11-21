/**
 * `skillunit.lock`: per unit, the fingerprint of each of its `Source` values when the unit was
 * last reviewed. It sits next to skillunit.yaml, or in the skill folder when there is no config
 * file. Only `skillunit review` writes it; sync reads it and needs no git.
 *
 * ```json
 * {
 *   "version": 1,
 *   "units": {
 *     "check-with-is-http-error": { "src/errors.ts#isHttpError": "9f2c1a7b04d1e6aa" },
 *     "retry-idempotent-only": { "src/retry.ts": "41d0c3e2b7a955c0" }
 *   }
 * }
 * ```
 *
 * Units are sorted by id, one per line, with a trailing newline, so two branches conflict only
 * when both reviewed the same unit. No commit, date or author is stored.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError } from '../lint/types.js';
import type { SourceRef } from '../units/types.js';
import { fingerprint } from './fingerprint.js';

export const LOCK_FILE = 'skillunit.lock';

/**
 * The way fingerprints are computed. A lock with a higher version comes from a newer SkillUnit;
 * raising it makes every unit stale at once.
 */
export const LOCK_VERSION = 1;

export interface Lock {
  version: number;
  /** Unit id, then `Source` as the unit writes it, then fingerprint. */
  units: Record<string, Record<string, string>>;
}

/** The lock's path: next to the config file, or in the skill folder without one. */
export function lockPath(options: { configDir?: string; skill: string }): string {
  return join(options.configDir ?? options.skill, LOCK_FILE);
}

/** A `Source` as the unit writes it, and as the lock keys it: `path` or `path#name`. */
export function sourceKey(source: SourceRef): string {
  return source.symbol ? `${source.path}#${source.symbol}` : source.path;
}

/**
 * The lock at `path`, or null when there is none. Throws a ConfigError for a lock this build
 * cannot read: not JSON (a merge conflict, say), a version it does not know, or a wrong shape.
 */
export function readLock(path: string): Lock | null {
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf8');
  const fail = (what: string) => new ConfigError(`${path}: ${what}`);
  if (/^(<<<<<<<|=======|>>>>>>>)/m.test(text)) {
    throw fail('has merge conflict markers; take either side, then run `skillunit review` to bring it up to date');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw fail(`is not valid JSON (${(e as Error).message}); only \`skillunit review\` writes it`);
  }
  if (!isObject(raw)) throw fail('expected an object with `version` and `units`');
  const { version, units } = raw;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) throw fail('`version` must be a whole number from 1');
  if (version > LOCK_VERSION) {
    throw fail(`has version ${version}, and this SkillUnit reads version ${LOCK_VERSION}; upgrade skillunit to read it`);
  }
  if (!isObject(units)) throw fail('`units` must be an object, unit id to its sources');
  for (const [id, sources] of Object.entries(units)) {
    if (!isObject(sources)) throw fail(`\`units.${id}\` must be an object, Source to fingerprint`);
    for (const [source, print] of Object.entries(sources)) {
      if (typeof print !== 'string' || !/^[0-9a-f]{16}$/.test(print)) throw fail(`\`units.${id}\` has a fingerprint for ${source} that is not 16 hex characters`);
    }
  }
  return { version, units: units as Lock['units'] };
}

/** The lock as `skillunit review` writes it: units by id, one per line, sources sorted. */
export function formatLock(lock: Lock): string {
  const ids = Object.keys(lock.units).sort(compare);
  const line = (id: string) => {
    const sources = Object.entries(lock.units[id]!).sort((a, b) => compare(a[0], b[0]));
    return `    ${JSON.stringify(id)}: { ${sources.map(([s, p]) => `${JSON.stringify(s)}: ${JSON.stringify(p)}`).join(', ')} }`;
  };
  const body = ids.length ? `{\n${ids.map(line).join(',\n')}\n  }` : '{}';
  return `{\n  "version": ${lock.version},\n  "units": ${body}\n}\n`;
}

/**
 * The lock entry for a unit as its code is now: each `Source` and its fingerprint, or the error
 * of the first `Source` that has none (a missing file or symbol).
 */
export function entryFor(sources: SourceRef[], sourceRoot: string): { entry: Record<string, string> } | { error: string } {
  const entry: Record<string, string> = {};
  for (const source of sources) {
    const result = fingerprint(source, sourceRoot);
    if (!result.ok) return { error: result.message };
    entry[sourceKey(source)] = result.fingerprint;
  }
  return { entry };
}

/** The line of a unit's entry in a lock written by `formatLock`; 1 when it is not found. */
export function lockLine(text: string, id: string): number {
  const at = text.split('\n').findIndex((l) => l.startsWith(`    ${JSON.stringify(id)}:`));
  return at < 0 ? 1 : at + 1;
}

/** Code unit order, the same on every machine (no locale). */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `skillunit.lock`: the ids of the units the project's tests prove. It sits next to
 * `skillunit.yaml`. `skillunit proof --write` adds the units a test proves and drops the ids no
 * unit has any more; it never drops a unit that is still in the skill, so a proof that is lost
 * shows up as a line someone removed, in the diff of the change that lost it.
 *
 * ```json
 * {
 *   "version": 2,
 *   "proved": [
 *     "check-with-is-http-error",
 *     "retry-defaults"
 *   ]
 * }
 * ```
 *
 * The ids are sorted, one to a line, so a merge conflict is resolved by keeping both sides.
 */

export const LOCK_FILE = 'skillunit.lock';
export const LOCK_VERSION = 2;

export interface LockId {
  id: string;
  /** Line of the id in the file. */
  line: number;
}

export type Lock =
  /** No file. */
  | { kind: 'missing' }
  /** A lock this version reads. The ids in file order, an id listed twice kept twice. */
  | { kind: 'ok'; ids: LockId[] }
  /**
   * Merge conflict markers, or both sides kept by hand with a comma missing between them. `ids`
   * holds the ids of both sides, so `--write` can resolve it; without `--write` the lock is not
   * read. `problem` says what is wrong, for the check.
   */
  | { kind: 'conflict'; ids: LockId[]; line: number; problem: string }
  /** A lock this version cannot read. */
  | { kind: 'broken'; message: string; line: number };

const MARKER = /^(<<<<<<<|\|\|\|\|\|\|\||=======|>>>>>>>)/;

/** Reads the text of a lock, or `null` for no file. Never throws. */
export function parseLock(text: string | null): Lock {
  if (text === null) return { kind: 'missing' };
  const lines = text.split(/\r?\n/);
  const marker = lines.findIndex((l) => MARKER.test(l));
  if (marker >= 0) return conflict(lines, marker + 1, 'it has merge conflict markers');

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    const problem = `it is not valid JSON (${(e as Error).message})`;
    // Both sides of a conflict kept by hand: the ids are all there, a comma is not.
    if (/"version"\s*:\s*\d+/.test(text) && text.includes('"proved"')) return conflict(lines, 1, problem);
    return { kind: 'broken', message: problem, line: 1 };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { kind: 'broken', message: 'it must be an object with `version` and `proved`', line: 1 };
  const { version, proved, ...rest } = raw as Record<string, unknown>;
  const lineOf = (key: string) => lines.findIndex((l) => l.includes(`"${key}"`)) + 1 || 1;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { kind: 'broken', message: '`version` must be a whole number', line: lineOf('version') };
  if (version !== LOCK_VERSION) {
    const upgrade = version > LOCK_VERSION ? '; upgrade skillunit to read it' : '';
    return { kind: 'broken', message: `it has version ${version}, and this SkillUnit reads version ${LOCK_VERSION}${upgrade}`, line: lineOf('version') };
  }
  const extra = Object.keys(rest)[0];
  if (extra !== undefined) return { kind: 'broken', message: `unknown key \`${extra}\` (allowed: version, proved)`, line: lineOf(extra) };
  if (!Array.isArray(proved)) return { kind: 'broken', message: '`proved` must be a list of unit ids', line: lineOf('proved') };
  const bad = proved.findIndex((id) => typeof id !== 'string' || !id.trim());
  if (bad >= 0) return { kind: 'broken', message: `\`proved\` holds ${JSON.stringify(proved[bad])}, which is not a unit id`, line: lineOf('proved') };
  return { kind: 'ok', ids: locate(lines, proved as string[]) };
}

/** The lock with these ids: sorted, each once, one to a line, with a newline at the end. */
export function formatLock(ids: Iterable<string>): string {
  const sorted = [...new Set(ids)].sort();
  const list = sorted.length ? `[\n${sorted.map((id) => `    ${JSON.stringify(id)}`).join(',\n')}\n  ]` : '[]';
  return `{\n  "version": ${LOCK_VERSION},\n  "proved": ${list}\n}\n`;
}

/** The line of each id, searched in order from the line of `"proved"`. */
function locate(lines: string[], ids: string[]): LockId[] {
  let at = Math.max(0, lines.findIndex((l) => l.includes('"proved"')));
  return ids.map((id) => {
    const quoted = JSON.stringify(id);
    const found = lines.findIndex((l, i) => i >= at && l.includes(quoted));
    if (found < 0) return { id, line: at + 1 };
    at = found + 1;
    return { id, line: found + 1 };
  });
}

/**
 * A lock with merge conflict markers. Both sides list ids one to a line, so every quoted string
 * after `"proved"`, on a line that is not a marker, is an id of one side or the other.
 */
function conflict(lines: string[], line: number, problem: string): Lock {
  const versions = lines.join('\n').match(/"version"\s*:\s*(\d+)/g) ?? [];
  if (versions.some((v) => !v.endsWith(String(LOCK_VERSION)))) {
    return { kind: 'broken', message: `${problem}, and a side that is not a version ${LOCK_VERSION} lock; keep the version ${LOCK_VERSION} side, then run \`skillunit proof --write\``, line };
  }
  const start = lines.findIndex((l) => l.includes('"proved"'));
  const ids: LockId[] = [];
  for (let i = Math.max(0, start + 1); i < lines.length; i++) {
    if (MARKER.test(lines[i]!)) continue;
    for (const m of lines[i]!.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const id = JSON.parse(`"${m[1]}"`) as string;
      if (id.trim()) ids.push({ id, line: i + 1 });
    }
  }
  return { kind: 'conflict', ids, line, problem };
}

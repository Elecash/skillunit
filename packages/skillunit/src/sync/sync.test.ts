import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ConfigError } from '../lint/types.js';
import { buildReport, render } from '../report/index.js';
import { parseSkill } from '../units/index.js';
import { entryFor, formatLock, LOCK_VERSION, lockLine, lockPath, readLock, type Lock } from './lock.js';
import { sync } from './sync.js';

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

const unit = (id: string, source: string, does = 'do the thing.') => `### rule: ${id}

When: x.

Do: ${does}

Applies: a

Source: ${source}
`;

const SKILL = `# tinyfetch

## Rules

${unit('retry-idempotent-only', 'src/retry.ts')}
${unit('pick-a-client', 'src/create.ts#create')}
${unit('helpers', 'src/lib')}
### fact: no-source

When: x.

Value: y.

Applies: a
`;

/**
 * A project with no git: `app/` has the code, `app/skill/` the skill and `app/skillunit.lock` the
 * lock, written as `skillunit review --accept-all` would write it for the code as it is.
 */
function project(options: { lock?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'skillunit-sync-'));
  roots.push(root);
  const app = join(root, 'app');
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const edit = (path: string, change: (text: string) => string) => write(path, change(readFileSync(join(root, path), 'utf8')));
  write('app/src/retry.ts', 'export const retry = 1;\n');
  write('app/src/create.ts', '/** Makes a client. */\nexport function create() {\n  return {};\n}\n\nexport const other = 1;\n');
  write('app/src/lib/a.ts', 'export const a = 1;\n');
  write('app/skill/SKILL.md', SKILL);
  const lock = lockPath({ configDir: app, skill: join(app, 'skill') });

  /** Accept every unit as its code is now, like `review --accept-all`. */
  const acceptAll = () => {
    const units: Lock['units'] = {};
    for (const u of parseSkill(join(app, 'skill')).units) {
      if (!u.source.length) continue;
      const result = entryFor(u.source, app);
      if ('error' in result) throw new Error(result.error);
      units[u.id] = result.entry;
    }
    writeFileSync(lock, formatLock({ version: LOCK_VERSION, units }));
  };
  if (options.lock !== false) acceptAll();
  const run = () => sync({ skill: join(app, 'skill'), sourceRoot: app, lock });
  return { root, app, lock, write, edit, acceptAll, run };
}

/** `file:line unit severity` of each finding. */
const found = (r: ReturnType<typeof sync>) => r.problems.map((p) => `${p.file}:${p.line} ${p.unit ?? '-'} ${p.severity}`);
const states = (r: ReturnType<typeof sync>) => Object.fromEntries(r.units.map((u) => [u.id, u.state]));

describe('sync', () => {
  it('passes when every fingerprint equals the lock', () => {
    const p = project();
    const result = p.run();
    expect(result).toMatchObject({
      ok: true,
      problems: [],
      orphans: [],
      lock: { path: p.lock, found: true },
      summary: { units: 4, withSource: 3, inSync: 3, stale: 0, new: 0, orphans: 0 },
    });
    expect(states(result)).toEqual({ 'retry-idempotent-only': 'in-sync', 'pick-a-client': 'in-sync', helpers: 'in-sync' });
    const text = render(buildReport('sync', { sync: result }), 'table', { cwd: p.app, color: false });
    expect(text).toContain('Sync  skillunit.lock\n');
    expect(text).toContain('  3 units with a Source: 3 in sync, 0 stale, 0 new\n\nOK  sync ok\n');
  });

  it('reports a stale unit when its code changed since the review', () => {
    const p = project();
    p.edit('app/src/retry.ts', (t) => `${t}export const more = 2;\n`);
    const result = p.run();
    expect(found(result)).toEqual(['SKILL.md:5 retry-idempotent-only error']);
    expect(result.problems[0]!.message).toBe(
      '`src/retry.ts` changed since the unit was last reviewed; read the code against the unit, edit the unit if it is wrong, then accept it with `skillunit review`',
    );
    expect(result.units[0]!.sources[0]).toMatchObject({ source: 'src/retry.ts', state: 'stale', locked: expect.any(String), current: expect.any(String) });
    expect(result).toMatchObject({ ok: false, summary: { inSync: 2, stale: 1, new: 0 } });
  });

  it('leaves a unit in sync after a comment-only change or a reformat', () => {
    const p = project();
    p.edit('app/src/retry.ts', (t) => `// Retries.\n${t.replace('= 1', '=\n  1')}`);
    p.edit('app/src/create.ts', (t) => t.replace('/** Makes a client. */', '/** Makes a client, with defaults. */'));
    expect(p.run()).toMatchObject({ ok: true, summary: { inSync: 3 } });
  });

  it('compares a #symbol by its declaration, and a folder by every file under it', () => {
    const p = project();
    p.edit('app/src/create.ts', (t) => t.replace('export const other = 1;', 'export const other = 2;'));
    expect(p.run()).toMatchObject({ ok: true });
    p.edit('app/src/create.ts', (t) => t.replace('return {};', 'return { retry: 0 };'));
    p.write('app/src/lib/b.ts', 'export const b = 1;\n');
    expect(found(p.run())).toEqual(['SKILL.md:15 pick-a-client error', 'SKILL.md:25 helpers error']);
  });

  it('does not clear a stale unit when the unit is edited: review accepts it', () => {
    const p = project();
    p.edit('app/src/retry.ts', (t) => `${t}export const more = 2;\n`);
    p.edit('app/skill/SKILL.md', (t) => t.replace('Do: do the thing.\n\nApplies: a\n\nSource: src/retry.ts', 'Do: do the new thing.\n\nApplies: a\n\nSource: src/retry.ts'));
    expect(found(p.run())).toEqual(['SKILL.md:5 retry-idempotent-only error']);
    p.acceptAll();
    expect(p.run()).toMatchObject({ ok: true });
  });

  it('reports a new unit, and a new Source of a unit in the lock', () => {
    const p = project();
    p.write('app/src/other.ts', 'export const other = 1;\n');
    p.edit('app/skill/SKILL.md', (t) => `${t}\n${unit('other-thing', 'src/other.ts')}`.replace('Source: src/retry.ts', 'Source: src/retry.ts, src/other.ts'));
    const result = p.run();
    expect(states(result)).toMatchObject({ 'retry-idempotent-only': 'new', 'other-thing': 'new' });
    expect(result.problems.map((x) => `${x.unit}: ${x.message}`)).toEqual([
      'retry-idempotent-only: `src/other.ts` is a new `Source`, not in skillunit.lock; read the code against the unit, edit the unit if it is wrong, then accept it with `skillunit review`',
      'other-thing: this unit is not in skillunit.lock; read the code against the unit, edit the unit if it is wrong, then accept it with `skillunit review`',
    ]);
    expect(result.summary).toMatchObject({ withSource: 4, inSync: 2, stale: 0, new: 2 });
  });

  it('counts a unit stale when it has a changed Source and a new one', () => {
    const p = project();
    p.write('app/src/other.ts', 'export const other = 1;\n');
    p.edit('app/src/retry.ts', (t) => `${t}export const more = 2;\n`);
    p.edit('app/skill/SKILL.md', (t) => t.replace('Source: src/retry.ts', 'Source: src/retry.ts, src/other.ts'));
    const result = p.run();
    expect(states(result)['retry-idempotent-only']).toBe('stale');
    expect(result.problems[0]!.message).toMatch(/^`src\/retry\.ts` changed since the unit was last reviewed; `src\/other\.ts` is a new `Source`, not in skillunit\.lock; /);
  });

  it('reports a unit stale when its Source has no fingerprint any more', () => {
    const p = project();
    p.edit('app/src/create.ts', (t) => t.replace('export function create()', 'export function make()'));
    const result = p.run();
    expect(found(result)).toEqual(['SKILL.md:15 pick-a-client error']);
    expect(result.problems[0]!.message).toMatch(/^`src\/create\.ts#create` has no fingerprint: src\/create\.ts has no top-level declaration `create`; /);
  });

  it('warns about orphan entries: a unit that is gone, and a Source a unit no longer lists', () => {
    const p = project();
    p.edit('app/skill/SKILL.md', (t) => t.replace(unit('helpers', 'src/lib'), '').replace('Source: src/create.ts#create', 'Source: src/lib'));
    const result = p.run();
    expect(result.orphans).toEqual([{ unit: 'helpers' }, { unit: 'pick-a-client', source: 'src/create.ts#create' }]);
    const lockText = readFileSync(p.lock, 'utf8');
    expect(found(result)).toEqual([
      'SKILL.md:15 pick-a-client error',
      `../skillunit.lock:${lockLine(lockText, 'helpers')} helpers warning`,
      `../skillunit.lock:${lockLine(lockText, 'pick-a-client')} pick-a-client warning`,
    ]);
    expect(result.problems.slice(1).map((x) => x.message)).toEqual([
      'skillunit.lock has an entry for `helpers`, and no unit with a `Source` has that id; `skillunit review --prune` drops it',
      'skillunit.lock has `src/create.ts#create` for `pick-a-client`, and the unit no longer lists it; `skillunit review --prune` drops it',
    ]);
    expect(result.summary.orphans).toBe(2);
  });

  it('passes with only orphan warnings', () => {
    const p = project();
    p.edit('app/skill/SKILL.md', (t) => t.replace(unit('helpers', 'src/lib'), ''));
    const result = p.run();
    expect(result).toMatchObject({ ok: true, summary: { orphans: 1 } });
    const text = render(buildReport('sync', { sync: result }), 'table', { cwd: p.app, color: false });
    expect(text).toMatch(/\nWarnings\n {2}skillunit\.lock:\d+ {2}helpers {2}skillunit\.lock has an entry for `helpers`/);
    expect(text).toMatch(/OK {2}sync ok, 1 orphan entry\n$/);
  });

  it('reports one error, saying how to create it, when there is no lock', () => {
    const p = project({ lock: false });
    const result = p.run();
    expect(result.problems).toEqual([
      {
        file: '../skillunit.lock',
        line: 1,
        severity: 'error',
        rule: 'sync',
        message: 'there is no skillunit.lock yet, and 3 units have a `Source`. Read each unit against its code, then run `skillunit review --accept-all` to write it',
      },
    ]);
    expect(result).toMatchObject({ ok: false, lock: { found: false }, summary: { withSource: 3, new: 3 } });
    expect(render(buildReport('sync', { sync: result }), 'table', { cwd: p.app, color: false })).toMatch(/Sync {2}no skillunit\.lock\n[\s\S]*FAILED {2}sync no skillunit\.lock\n$/);
  });

  it('needs no lock when no unit has a Source', () => {
    const p = project({ lock: false });
    p.write('app/skill/SKILL.md', '# T\n\n### fact: a\n\nWhen: x.\n\nValue: y.\n\nApplies: a\n');
    expect(p.run()).toMatchObject({ ok: true, problems: [], summary: { units: 1, withSource: 0 } });
  });

  it('stops with a configuration error for a lock with a higher version', () => {
    const p = project();
    p.edit('app/skillunit.lock', (t) => t.replace(`"version": ${LOCK_VERSION}`, `"version": ${LOCK_VERSION + 1}`));
    expect(() => p.run()).toThrow(ConfigError);
    expect(() => p.run()).toThrow(`has version ${LOCK_VERSION + 1}, and this SkillUnit reads version ${LOCK_VERSION}; upgrade skillunit to read it`);
  });

  it('runs in a folder that is not a git repository', () => {
    const p = project();
    expect(() => execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: p.app, stdio: 'pipe' })).toThrow();
    expect(p.run()).toMatchObject({ ok: true });
  });
});

describe('the lock file', () => {
  const tmp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'skillunit-lock-'));
    roots.push(dir);
    return join(dir, 'skillunit.lock');
  };

  it('is written with units by id, one per line, sources sorted, and a trailing newline', () => {
    const text = formatLock({
      version: 1,
      units: {
        'retry-idempotent-only': { 'src/retry.ts': '41d0c3e2b7a955c0' },
        'check-with-is-http-error': { 'src/errors.ts#isHttpError': '9f2c1a7b04d1e6aa', 'src/errors.ts#HttpError': '0123456789abcdef' },
      },
    });
    expect(text).toBe(
      [
        '{',
        '  "version": 1,',
        '  "units": {',
        '    "check-with-is-http-error": { "src/errors.ts#HttpError": "0123456789abcdef", "src/errors.ts#isHttpError": "9f2c1a7b04d1e6aa" },',
        '    "retry-idempotent-only": { "src/retry.ts": "41d0c3e2b7a955c0" }',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    expect(formatLock({ version: 1, units: {} })).toBe('{\n  "version": 1,\n  "units": {}\n}\n');
    expect(lockLine(text, 'retry-idempotent-only')).toBe(5);
  });

  it('reads back what it writes, and null when there is none', () => {
    const path = tmp();
    expect(readLock(path)).toBeNull();
    const lock = { version: 1, units: { a: { 'src/a.ts': '0123456789abcdef' } } };
    writeFileSync(path, formatLock(lock));
    expect(readLock(path)).toEqual(lock);
  });

  it('refuses a lock it cannot read, with what to do', () => {
    const path = tmp();
    const bad = (text: string, message: RegExp) => {
      writeFileSync(path, text);
      expect(() => readLock(path), text).toThrow(message);
    };
    bad('{\n<<<<<<< HEAD\n  "a": 1\n=======\n  "a": 2\n>>>>>>> other\n}\n', /has merge conflict markers; take either side, then run `skillunit review`/);
    bad('{ "version": 1, ', /is not valid JSON \(.+\); only `skillunit review` writes it/);
    bad('[]', /expected an object with `version` and `units`/);
    bad('{ "version": 0, "units": {} }', /`version` must be a whole number from 1/);
    bad('{ "version": 2, "units": {} }', /has version 2, and this SkillUnit reads version 1; upgrade skillunit to read it/);
    bad('{ "version": 1 }', /`units` must be an object/);
    bad('{ "version": 1, "units": { "a": "x" } }', /`units\.a` must be an object, Source to fingerprint/);
    bad('{ "version": 1, "units": { "a": { "src/a.ts": "XYZ" } } }', /`units\.a` has a fingerprint for src\/a\.ts that is not 16 hex characters/);
  });

  it('sits next to the config file, or in the skill folder without one', () => {
    expect(lockPath({ configDir: '/repo', skill: '/repo/skills/x' })).toBe(join('/repo', 'skillunit.lock'));
    expect(lockPath({ skill: '/repo/skills/x' })).toBe(join('/repo/skills/x', 'skillunit.lock'));
  });
});

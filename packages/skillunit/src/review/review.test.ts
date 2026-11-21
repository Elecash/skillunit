import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fingerprint } from '../sync/fingerprint.js';
import { formatLock } from '../sync/lock.js';
import { sync } from '../sync/sync.js';
import { buildReview, editorArgs, runReview, type ReviewArgs } from './index.js';

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

// GitHub Actions sets this on pull requests; the default branch here is `main`.
let githubBaseRef: string | undefined;
beforeEach(() => {
  githubBaseRef = process.env.GITHUB_BASE_REF;
  delete process.env.GITHUB_BASE_REF;
});
afterEach(() => {
  if (githubBaseRef !== undefined) process.env.GITHUB_BASE_REF = githubBaseRef;
});

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
${unit('create-defaults', 'src/create.ts#defaults')}
${unit('helpers', 'src/lib')}`;

const CREATE = `export const defaults = { retry: 0 };

/** Makes a client. */
export function create() {
  return { ...defaults };
}
`;

/** A project: `app/` has the code, `app/skill/` the skill, and the lock goes in `app/`. Optionally a git repository on `main`. */
function project(setup: { git?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'skillunit-review-'));
  roots.push(root);
  const app = join(root, 'app');
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const edit = (path: string, from: string, to: string) => {
    const text = readFileSync(join(root, path), 'utf8');
    if (!text.includes(from)) throw new Error(`${path} has no ${from}`);
    write(path, text.replace(from, to));
  };
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: root, encoding: 'utf8' });
  const commit = (message: string) => {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', message);
  };
  write('app/src/retry.ts', 'export const retry = 1;\n');
  write('app/src/create.ts', CREATE);
  write('app/src/lib/a.ts', 'export const a = 1;\n');
  write('app/skill/SKILL.md', SKILL);
  const lock = join(app, 'skillunit.lock');
  const options = { skill: join(app, 'skill'), sourceRoot: app, lock };

  /** The folder the command runs in, which paths are printed from. */
  let cwd = app;
  const runIn = (dir: string) => (cwd = dir);
  const run = async (args: Partial<ReviewArgs> = {}, input = '', interactive = false, onEdit?: (file: string, line: number) => void) => {
    let out = '';
    const output = new Writable({
      write(chunk, _encoding, done) {
        out += chunk.toString();
        done();
      },
    });
    const edits: string[] = [];
    const code = await runReview(
      options,
      { list: false, json: false, accept: [], acceptAll: false, prune: false, ...args },
      { input: Readable.from(input ? [input] : []), output, interactive, edit: (file, line) => (edits.push(`${file}:${line}`), onEdit?.(file, line)) },
      { cwd, color: false },
    );
    return { code, out, edits };
  };
  const readLockText = () => readFileSync(lock, 'utf8');
  const lockUnits = () => Object.keys(JSON.parse(readLockText()).units);

  if (setup.git) {
    git('init', '-q');
    git('symbolic-ref', 'HEAD', 'refs/heads/main');
  }
  return { root, app, lock, options, write, edit, git, commit, run, runIn, readLockText, lockUnits };
}

/** A git project whose `main` has the code, the skill and a lock that accepts every unit; now on `feature`. */
async function reviewed() {
  const p = project({ git: true });
  await p.run({ acceptAll: true });
  p.commit('base');
  p.git('checkout', '-q', '-b', 'feature');
  return p;
}

const fp = (source: string, root: string) => {
  const [path, symbol] = source.split('#');
  const result = fingerprint(symbol ? { path: path!, symbol } : { path: path! }, root);
  if (!result.ok) throw new Error(result.message);
  return result.fingerprint;
};

describe('review without a lock', () => {
  it('lists every unit as new with where its code is, says how to write the lock, and exits 1', async () => {
    const p = project();
    const { code, out } = await p.run({ list: true });
    expect(code).toBe(1);
    expect(out).toContain('Review  no skillunit.lock yet · no git base: paths only\n');
    expect(out).toContain('\nsrc/retry.ts\n\n  src/retry.ts  src/retry.ts:1  new\n');
    expect(out).toContain('\nsrc/create.ts\n\n  src/create.ts#create  src/create.ts:4  new, lines 4 to 6\n');
    expect(out).toContain('  src/create.ts#defaults  src/create.ts:1  new\n');
    expect(out).toContain('\nsrc/lib\n\n  src/lib  src/lib/  new\n');
    // No code: the reader opens it there.
    expect(out).not.toContain('export function create');
    expect(out).toContain('  pick-a-client  new\n  skill/SKILL.md:15\n  │ ### rule: pick-a-client\n  │\n  │ When: x.\n');
    expect(out).toMatch(/There is no skillunit\.lock yet, so every unit is new\. Read them, then run `skillunit review --accept-all` to write it\.\n4 units to review in 3 files · 0 in sync\n$/);
    expect(existsSync(p.lock)).toBe(false);
  });

  it('prints every path from the folder the command runs in, next to the Source as written', async () => {
    const p = project();
    p.runIn(p.root);
    const { out } = await p.run({ list: true });
    expect(out).toContain('\napp/src/create.ts\n\n  src/create.ts#create  app/src/create.ts:4  new, lines 4 to 6\n');
    expect(out).toContain('  src/lib  app/src/lib/  new\n');
    expect(out).toContain('  pick-a-client  new\n  app/skill/SKILL.md:15\n');
    expect(out).toContain('Review  no app/skillunit.lock yet · ');
  });

  it('gives path, line and range in --json, and no code', async () => {
    const p = project();
    const { code, out } = await p.run({ json: true });
    expect(code).toBe(1);
    const json = JSON.parse(out);
    expect(json).toMatchObject({ schema: 1, lock: { path: p.lock, found: false }, base: null, summary: { toReview: 4, inSync: 0, orphans: 0 } });
    expect(json.groups.map((g: any) => g.changes)).toEqual([
      [{ source: 'src/retry.ts', state: 'new', at: { path: join(p.app, 'src/retry.ts'), kind: 'file', line: 1 } }],
      [
        { source: 'src/create.ts#create', state: 'new', at: { path: join(p.app, 'src/create.ts'), kind: 'file', line: 4, lastLine: 6 } },
        { source: 'src/create.ts#defaults', state: 'new', at: { path: join(p.app, 'src/create.ts'), kind: 'file', line: 1, lastLine: 1 } },
      ],
      [{ source: 'src/lib', state: 'new', at: { path: join(p.app, 'src/lib'), kind: 'folder' } }],
    ]);
  });

  it('says where a new Source is missing', async () => {
    const p = project();
    p.edit('app/skill/SKILL.md', 'Source: src/retry.ts', 'Source: src/gone.ts');
    p.edit('app/skill/SKILL.md', 'Source: src/create.ts#create', 'Source: src/create.ts#nowhere');
    const changes = buildReview(p.options).groups.flatMap((g) => g.changes);
    expect(changes.find((c) => c.source === 'src/gone.ts')).toMatchObject({ at: { kind: 'missing' }, note: 'src/gone.ts does not exist' });
    expect(changes.find((c) => c.source === 'src/create.ts#nowhere')).toMatchObject({ at: { kind: 'missing' }, note: 'no top-level declaration `nowhere` in src/create.ts' });
  });

  it('lists when there is no terminal and no flag, and changes nothing', async () => {
    const p = project();
    const list = await p.run({ list: true });
    expect(await p.run()).toEqual(list);
    expect(existsSync(p.lock)).toBe(false);
  });

  it('writes the first lock with --accept-all, byte for byte as the lock is described', async () => {
    const p = project();
    const { code, out } = await p.run({ acceptAll: true });
    expect(code).toBe(0);
    expect(out).toBe(
      'Wrote skillunit.lock: accepted 4 units (retry-idempotent-only, pick-a-client, create-defaults, helpers). Commit it with the change. This is the first skillunit.lock: it records these units as reviewed, so read them first if you have not.\n',
    );
    expect(p.readLockText()).toBe(
      [
        '{',
        '  "version": 1,',
        '  "units": {',
        `    "create-defaults": { "src/create.ts#defaults": "${fp('src/create.ts#defaults', p.app)}" },`,
        `    "helpers": { "src/lib": "${fp('src/lib', p.app)}" },`,
        `    "pick-a-client": { "src/create.ts#create": "${fp('src/create.ts#create', p.app)}" },`,
        `    "retry-idempotent-only": { "src/retry.ts": "${fp('src/retry.ts', p.app)}" }`,
        '  }',
        '}',
        '',
      ].join('\n'),
    );
    expect(sync(p.options)).toMatchObject({ ok: true, summary: { inSync: 4 } });
    expect(await p.run({ list: true })).toMatchObject({ code: 0, out: expect.stringMatching(/Nothing to review: 4 units in sync\.\n$/) });
  });
});

describe('review --accept and --prune', () => {
  it('accepts only the units named, and leaves the rest to review', async () => {
    const p = await reviewed();
    p.edit('app/src/retry.ts', '= 1', '= 2');
    p.edit('app/src/create.ts', '{ ...defaults }', '{ ...defaults, extra: 1 }');
    const { code, out } = await p.run({ accept: ['retry-idempotent-only'] });
    expect(code).toBe(0);
    expect(out).toBe('Updated skillunit.lock: accepted 1 unit (retry-idempotent-only). Commit it with the change.\n');
    expect(sync(p.options).units.filter((u) => u.state !== 'in-sync').map((u) => u.id)).toEqual(['pick-a-client']);
  });

  it('accepts a unit after it was edited, with its new Source', async () => {
    const p = await reviewed();
    p.write('app/src/other.ts', 'export const other = 1;\n');
    p.edit('app/skill/SKILL.md', 'Source: src/retry.ts', 'Source: src/retry.ts, src/other.ts');
    expect(sync(p.options).units[0]!.state).toBe('new');
    await p.run({ accept: ['retry-idempotent-only'] });
    expect(JSON.parse(p.readLockText()).units['retry-idempotent-only']).toEqual({ 'src/other.ts': fp('src/other.ts', p.app), 'src/retry.ts': fp('src/retry.ts', p.app) });
    expect(sync(p.options).ok).toBe(true);
  });

  it('exits 2 for an id that is not a unit, and 1 for a unit whose Source has no fingerprint', async () => {
    const p = await reviewed();
    const before = p.readLockText();
    expect(await p.run({ accept: ['no-such-unit'] })).toMatchObject({ code: 2, out: 'skillunit: there is no unit `no-such-unit` in the skill\nskillunit.lock is unchanged.\n' });
    p.edit('app/src/create.ts', 'export function create()', 'export function make()');
    expect(await p.run({ accept: ['pick-a-client'] })).toMatchObject({
      code: 1,
      out: 'skillunit: cannot accept `pick-a-client`: src/create.ts has no top-level declaration `create`\nskillunit.lock is unchanged.\n',
    });
    expect(p.readLockText()).toBe(before);
  });

  it('drops orphan entries with --prune: a unit that is gone and a Source a unit no longer lists', async () => {
    const p = await reviewed();
    p.edit('app/skill/SKILL.md', unit('helpers', 'src/lib'), '');
    p.edit('app/skill/SKILL.md', 'Source: src/create.ts#create', 'Source: src/retry.ts');
    expect(sync(p.options).orphans).toEqual([{ unit: 'helpers' }, { unit: 'pick-a-client', source: 'src/create.ts#create' }]);
    const listed = await p.run({ list: true });
    expect(listed.out).toContain('skillunit.lock has 2 entries with nothing left to describe (helpers, pick-a-client src/create.ts#create); `skillunit review --prune` drops them.');
    const { code, out } = await p.run({ prune: true, accept: ['pick-a-client'] });
    expect(code).toBe(0);
    expect(out).toBe('Updated skillunit.lock: accepted 1 unit (pick-a-client); dropped 2 orphan entries. Commit it with the change.\n');
    expect(p.lockUnits()).toEqual(['create-defaults', 'pick-a-client', 'retry-idempotent-only']);
    expect(sync(p.options)).toMatchObject({ ok: true, orphans: [] });
  });

  it('prints what it did as JSON', async () => {
    const p = await reviewed();
    p.edit('app/src/retry.ts', '= 1', '= 2');
    const { out } = await p.run({ accept: ['retry-idempotent-only'], json: true });
    expect(JSON.parse(out)).toEqual({ schema: 1, lock: p.lock, written: true, accepted: ['retry-idempotent-only'], pruned: [], errors: [] });
  });
});

describe('what changed', () => {
  it('shows the diff of a file from the merge base to the working tree, with a link to its first change', async () => {
    const p = await reviewed();
    p.edit('app/src/retry.ts', '= 1;\n', '= 1;\nexport const more = 2;\n');
    const { code, out } = await p.run({ list: true });
    expect(code).toBe(1);
    expect(out).toMatch(/^\nReview {2}skillunit\.lock · changes since main \([0-9a-f]{7}\)\n/);
    expect(out).toContain('  src/retry.ts  src/retry.ts:2  changed since the last review\n    diff --git a/app/src/retry.ts b/app/src/retry.ts\n');
    expect(out).toContain('     export const retry = 1;\n    +export const more = 2;\n');
    expect(out).toContain('  retry-idempotent-only  stale\n  skill/SKILL.md:5\n');
    expect(out).toMatch(/1 unit to review in 1 file · 3 in sync\n$/);
  });

  it('cuts the diff down to the declaration a #symbol names, with line numbers of the file', async () => {
    const p = await reviewed();
    p.edit('app/src/create.ts', '/** Makes a client. */\n', '// One more line.\n/** Makes a client. */\n');
    p.edit('app/src/create.ts', '{ ...defaults }', '{ ...defaults, extra: 1 }');
    const review = buildReview(p.options);
    expect(review.groups.map((g) => g.units.map((u) => u.id))).toEqual([['pick-a-client']]);
    expect(review.groups[0]!.changes).toEqual([
      {
        source: 'src/create.ts#create',
        state: 'stale',
        at: { path: join(p.app, 'src/create.ts'), kind: 'file', line: 5, lastLine: 7 },
        diff: [
          '--- main:app/src/create.ts#create',
          '+++ app/src/create.ts#create',
          '@@ -4,3 +5,3 @@',
          ' export function create() {',
          '-  return { ...defaults };',
          '+  return { ...defaults, extra: 1 };',
          ' }',
          '',
        ].join('\n'),
      },
    ]);
  });

  it('groups units by source file and shows each changed Source once', async () => {
    const p = await reviewed();
    p.edit('app/src/create.ts', 'retry: 0', 'retry: 1');
    p.edit('app/src/create.ts', '{ ...defaults }', '{ ...defaults, extra: 1 }');
    const review = buildReview(p.options);
    expect(review.groups.map((g) => [g.path, g.units.map((u) => u.id), g.changes.map((c) => c.source)])).toEqual([
      ['src/create.ts', ['pick-a-client', 'create-defaults'], ['src/create.ts#create', 'src/create.ts#defaults']],
    ]);
  });

  it('marks a unit edited or added in this change, against the merge base', async () => {
    const p = await reviewed();
    p.edit('app/src/retry.ts', '= 1', '= 2');
    p.edit('app/skill/SKILL.md', 'Do: do the thing.\n\nApplies: a\n\nSource: src/retry.ts', 'Do: do the other thing.\n\nApplies: a\n\nSource: src/retry.ts');
    p.write('app/src/other.ts', 'export const other = 1;\n');
    p.edit('app/skill/SKILL.md', '# tinyfetch\n', `# tinyfetch\n\n${unit('other-thing', 'src/other.ts')}`);
    const review = buildReview(p.options);
    expect(review.groups.flatMap((g) => g.units.map((u) => [u.id, u.state, u.change]))).toEqual([
      ['other-thing', 'new', 'added'],
      ['retry-idempotent-only', 'stale', 'edited'],
    ]);
    const { out } = await p.run({ list: true });
    expect(out).toContain('  retry-idempotent-only  stale, edited in this change\n');
    expect(out).toContain('  other-thing  new, added in this change\n');
    // A reformat of the unit is not an edit.
    p.edit('app/skill/SKILL.md', 'Do: do the other thing.', 'Do: do the thing.');
    p.edit('app/skill/SKILL.md', 'When: x.\n\nDo: do the thing.\n\nApplies: a\n\nSource: src/retry.ts', 'When:   x.\n\n\nDo: do the thing.\n\nApplies: a\n\nSource: src/retry.ts');
    expect(buildReview(p.options).groups.flatMap((g) => g.units.filter((u) => u.id === 'retry-idempotent-only').map((u) => u.change))).toEqual([undefined]);
  });

  it('notes a file in a folder that git does not track, and a change older than the base', async () => {
    const p = await reviewed();
    p.write('app/src/lib/b.ts', 'export const b = 1;\n');
    p.edit('app/src/retry.ts', '= 1', '= 2');
    p.commit('Change retry on feature');
    p.git('checkout', '-q', 'main');
    p.git('merge', '-q', 'feature');
    const review = buildReview(p.options);
    const changes = Object.fromEntries(review.groups.flatMap((g) => g.changes.map((c) => [c.source, c])));
    // Both changes are in main now, so the merge base has them.
    expect(changes['src/lib']!.note).toMatch(/^the same as at main /);
    expect(changes['src/retry.ts']!.note).toMatch(/^the same as at main \([0-9a-f]{7}\): it changed before that commit, so this review has no diff to show$/);
    p.write('app/src/lib/c.ts', 'export const c = 1;\n');
    expect(buildReview(p.options).groups.find((g) => g.path === 'src/lib')!.changes[0]!.note).toBe('not tracked by git, so not in the diff: app/src/lib/c.ts');
  });

  it('shows only the path outside git', async () => {
    const p = project();
    await p.run({ acceptAll: true });
    p.edit('app/src/retry.ts', '= 1', '= 2');
    const { out } = await p.run({ list: true });
    expect(out).toContain(
      '  src/retry.ts  src/retry.ts:1  changed since the last review\n  changed since the unit was last reviewed; outside a git repository, or with no default branch to compare with, there is no diff to show\n',
    );
  });
});

describe('review at a terminal', () => {
  async function changed() {
    const p = await reviewed();
    p.edit('app/src/retry.ts', '= 1', '= 2');
    p.edit('app/src/create.ts', 'retry: 0', 'retry: 1');
    p.edit('app/src/create.ts', '{ ...defaults }', '{ ...defaults, extra: 1 }');
    p.write('app/src/lib/b.ts', 'export const b = 1;\n');
    return p;
  }
  const stale = (p: Awaited<ReturnType<typeof changed>>) => sync(p.options).units.filter((u) => u.state !== 'in-sync').map((u) => u.id);

  it('asks per unit: accept, skip, and accept the rest of the file', async () => {
    const p = await changed();
    // Groups: src/retry.ts (1 unit), src/create.ts (2 units), src/lib (1 unit).
    const { code, out } = await p.run({}, 'a\nA\ns\n', true);
    expect(stale(p)).toEqual(['helpers']);
    expect(code).toBe(1);
    expect(out).toContain('  a accept · e edit · s skip · A accept the rest of this file · q quit > ');
    expect(out).toContain('  create-defaults: accepted');
    expect(out).toMatch(/Updated skillunit\.lock: accepted 3 units \(retry-idempotent-only, pick-a-client, create-defaults\)\. Commit it with the change\.\n$/);
  });

  it('counts the accepted units as in sync when it ends', async () => {
    const p = await changed();
    const { code, out } = await p.run({}, 'a\nA\na\n', true);
    expect(code).toBe(0);
    expect(out).toContain('\nNothing to review: 4 units in sync.\n');
    const p2 = await changed();
    expect((await p2.run({}, 'a\nA\ns\n', true)).out).toContain('\n1 unit to review in 1 file · 3 in sync\n');
  });

  it('keeps what was accepted when it quits, or when the input ends', async () => {
    const p = await changed();
    await p.run({}, 'a\nq\n', true);
    expect(stale(p)).toEqual(['pick-a-client', 'create-defaults', 'helpers']);
    const again = await p.run({}, 's\n', true);
    expect(again.code).toBe(1);
    expect(stale(p)).toEqual(['pick-a-client', 'create-defaults', 'helpers']);
    expect(again.out).toMatch(/skillunit\.lock is unchanged\.\n$/);
  });

  it('asks again after an answer it does not know, and after a unit it cannot accept', async () => {
    const p = await changed();
    p.edit('app/src/create.ts', 'export function create()', 'export function make()');
    const { out } = await p.run({}, 'x\na\na\ns\nq\n', true);
    expect(out).toContain('  type a, e, s, A or q, then Enter');
    expect(out).toContain('  cannot accept `pick-a-client`: src/create.ts has no top-level declaration `create`. Edit the unit or its code, or skip it.');
    expect(stale(p)).toEqual(['pick-a-client', 'create-defaults', 'helpers']);
  });

  it('opens the unit in the editor at its line, shows it again, and accepts the edited unit', async () => {
    const p = await changed();
    const skillFile = join(p.app, 'skill', 'SKILL.md');
    const onEdit = () => writeFileSync(skillFile, readFileSync(skillFile, 'utf8').replace('Do: do the thing.\n\nApplies: a\n\nSource: src/retry.ts', 'Do: do the new thing.\n\nApplies: a\n\nSource: src/retry.ts'));
    const { out, edits } = await p.run({}, 'e\na\nq\n', true, onEdit);
    expect(edits).toEqual([`${skillFile}:5`]);
    expect(out).toContain('  │ Do: do the new thing.');
    expect(stale(p)).not.toContain('retry-idempotent-only');
  });

  it('says there is nothing to review and asks nothing', async () => {
    const p = await reviewed();
    expect(await p.run({}, '', true)).toMatchObject({ code: 0, out: expect.stringMatching(/Nothing to review: 4 units in sync\.\n$/) });
  });
});

describe('opening an editor at a line', () => {
  it('passes the line the way each editor takes it', () => {
    expect(editorArgs('code', 'a.md', 5)).toEqual(['--goto', 'a.md:5']);
    expect(editorArgs('/usr/local/bin/cursor', 'a.md', 5)).toEqual(['--goto', 'a.md:5']);
    expect(editorArgs('subl', 'a.md', 5)).toEqual(['a.md:5']);
    expect(editorArgs('zed', 'a.md', 5)).toEqual(['a.md:5']);
    expect(editorArgs('zeditor', 'a.md', 5)).toEqual(['a.md:5']);
    for (const ide of ['idea', 'webstorm', 'webstorm.sh', 'pycharm64.exe', 'C:\\JetBrains\\bin\\idea64.exe', 'idea.bat', 'intellij-idea', 'rustrover.exe', 'goland', 'rider', 'clion', 'rubymine', 'phpstorm', 'datagrip']) {
      expect(editorArgs(ide, 'a.md', 5), ide).toEqual(['--line', '5', 'a.md']);
    }
    expect(editorArgs('vim', 'a.md', 5)).toEqual(['+5', 'a.md']);
    expect(editorArgs('nano', 'a.md', 5)).toEqual(['+5', 'a.md']);
  });
});

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError } from '../lint/types.js';
import { formatSync } from './format.js';
import { normalize, sync } from './sync.js';

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

// GitHub Actions sets this on pull requests; the default-base test must not see it.
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
${unit('helpers', 'src/lib')}`;

/** A repository on `main` with an app folder (code and skill), then a `feature` branch. */
function repository() {
  const root = mkdtempSync(join(tmpdir(), 'skillunit-sync-'));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  const edit = (path: string, change: (text: string) => string) => write(path, change(readFileSync(join(root, path), 'utf8')));
  const commit = (message: string) => {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', message);
  };

  // `git init -b` needs git 2.28; this works on older ones too.
  git('init', '-q');
  git('symbolic-ref', 'HEAD', 'refs/heads/main');
  write('app/src/retry.ts', 'export const retry = 1;\n');
  write('app/src/create.ts', 'export const create = 1;\n');
  write('app/src/lib/a.ts', 'export const a = 1;\n');
  write('app/src/other.ts', 'export const other = 1;\n');
  write('app/skill/SKILL.md', SKILL);
  commit('first');
  git('checkout', '-q', '-b', 'feature');

  const run = (base: string | undefined = 'main') =>
    sync({ skill: join(root, 'app', 'skill'), sourceRoot: join(root, 'app'), ...(base ? { base } : {}) });
  return { root, git, write, edit, commit, run };
}

/** `file:line unit` of each finding. */
const found = (r: ReturnType<typeof sync>) => r.problems.map((p) => `${p.file}:${p.line} ${p.unit}`);

describe('sync', () => {
  it('reports a unit whose Source changed while the unit did not', () => {
    const repo = repository();
    repo.edit('app/src/retry.ts', (t) => `${t}export const more = 2;\n`);
    repo.commit('Retry more');
    const result = repo.run();
    expect(found(result)).toEqual(['SKILL.md:5 retry-idempotent-only']);
    expect(result.problems[0]!.message).toMatch(
      /^`src\/retry\.ts` changed since [0-9a-f]{7} and this unit did not; review it, then edit it or add `Skill-reviewed: retry-idempotent-only` to a commit message$/,
    );
    expect(result).toMatchObject({ ok: false, changed: ['app/src/retry.ts'], summary: { units: 3, pointing: 1, edited: 0, marked: 0, toReview: 1 } });
  });

  it('does not report a unit edited in the same range', () => {
    const repo = repository();
    repo.edit('app/src/retry.ts', (t) => `${t}export const more = 2;\n`);
    repo.edit('app/skill/SKILL.md', (t) => t.replace('### rule: retry-idempotent-only\n\nWhen: x.\n\nDo: do the thing.', '### rule: retry-idempotent-only\n\nWhen: x.\n\nDo: do the new thing.'));
    repo.commit('Retry more, and say so');
    expect(repo.run()).toMatchObject({ ok: true, problems: [], summary: { pointing: 1, edited: 1, toReview: 0 } });
  });

  it('does not report a unit named in a Skill-reviewed trailer, one or several per line', () => {
    const repo = repository();
    repo.edit('app/src/retry.ts', (t) => `${t}// tidy\n`);
    repo.edit('app/src/create.ts', (t) => `${t}// tidy\n`);
    repo.commit('Tidy\n\nNo behaviour change.\n\nSkill-reviewed: retry-idempotent-only, pick-a-client');
    expect(repo.run()).toMatchObject({ ok: true, summary: { pointing: 2, marked: 2, toReview: 0 } });
  });

  it('counts a trailer from any commit in the range, and only for the units it names', () => {
    const repo = repository();
    repo.commit('Prepare\n\nSkill-reviewed: helpers');
    repo.edit('app/src/retry.ts', (t) => `${t}// tidy\n`);
    repo.edit('app/src/lib/a.ts', (t) => `${t}// tidy\n`);
    repo.commit('Tidy');
    const result = repo.run();
    expect(found(result)).toEqual(['SKILL.md:5 retry-idempotent-only']);
    expect(result.summary).toMatchObject({ pointing: 2, marked: 1, toReview: 1 });
  });

  it('does not count a whitespace-only change to the unit as an edit', () => {
    const repo = repository();
    repo.edit('app/src/retry.ts', (t) => `${t}// change\n`);
    repo.edit('app/skill/SKILL.md', (t) => t.replace('When: x.', 'When:   x.   ').replace('Do: do the thing.\n', 'Do: do the thing.\n\n\n'));
    repo.commit('Format');
    expect(found(repo.run())).toEqual(['SKILL.md:5 retry-idempotent-only']);
  });

  it('compares a Source with a #symbol at file level, and a folder by what is under it', () => {
    const repo = repository();
    repo.edit('app/src/create.ts', (t) => `${t}export const unrelated = 2;\n`);
    repo.write('app/src/lib/b.ts', 'export const b = 1;\n');
    repo.commit('Add things');
    expect(found(repo.run())).toEqual(['SKILL.md:15 pick-a-client', 'SKILL.md:25 helpers']);
  });

  it('counts a unit added in the range as reviewed', () => {
    const repo = repository();
    repo.edit('app/src/other.ts', (t) => `${t}export const more = 2;\n`);
    repo.edit('app/skill/SKILL.md', (t) => `${t}\n${unit('other-thing', 'src/other.ts')}`);
    repo.commit('Other, with its unit');
    expect(repo.run()).toMatchObject({ ok: true, summary: { units: 4, pointing: 1, edited: 1 } });
  });

  it('passes when no Source changed', () => {
    const repo = repository();
    repo.write('app/README.md', '# App\n');
    repo.commit('Docs');
    const result = repo.run();
    expect(result).toMatchObject({ ok: true, summary: { pointing: 0 } });
    expect(formatSync(result)).toMatch(/^1 file changed since main \([0-9a-f]{7}\) · 3 units\nsync ok: no unit points at changed code\n$/);
  });

  it('compares with the merge base, so commits on main after the branch point do not count', () => {
    const repo = repository();
    repo.git('checkout', '-q', 'main');
    repo.edit('app/src/retry.ts', (t) => `${t}// on main\n`);
    repo.commit('Main moves on');
    repo.git('checkout', '-q', 'feature');
    repo.write('app/README.md', '# App\n');
    repo.commit('Docs');
    expect(repo.run()).toMatchObject({ ok: true, changed: ['app/README.md'] });
  });

  it('finds the default branch when no base is given', () => {
    const repo = repository();
    repo.edit('app/src/retry.ts', (t) => `${t}// change\n`);
    repo.commit('Change');
    const result = repo.run(undefined);
    expect(result.base.ref).toBe('main');
    expect(found(result)).toEqual(['SKILL.md:5 retry-idempotent-only']);
  });

  it('reports a Source outside the repository', () => {
    const repo = repository();
    repo.edit('app/skill/SKILL.md', (t) => t.replace('Source: src/retry.ts', 'Source: ../../../elsewhere.ts'));
    repo.commit('Point outside');
    const result = repo.run();
    expect(result.problems.map((p) => `${p.line} ${p.unit} ${p.message}`)).toEqual([
      '13 retry-idempotent-only `Source` ../../../elsewhere.ts is outside the git repository, so sync cannot tell when it changes',
    ]);
  });

  it('reports a configuration error outside a repository or for an unknown base', () => {
    const plain = mkdtempSync(join(tmpdir(), 'skillunit-nogit-'));
    roots.push(plain);
    expect(() => sync({ skill: plain, sourceRoot: plain })).toThrow(ConfigError);
    const repo = repository();
    expect(() => repo.run('no-such-branch')).toThrow(/--base no-such-branch is not a commit in this repository/);
  });
});

describe('normalize', () => {
  it('ignores trailing spaces, blank lines and runs of spaces, but not other changes', () => {
    expect(normalize('### rule: a\n\nWhen:  x  \n\n\nDo: y\r\n')).toBe(normalize('### rule: a\nWhen: x\nDo: y'));
    expect(normalize("Right: `tf.get('/a')`")).not.toBe(normalize('Right: `tf.get("/a")`'));
  });
});

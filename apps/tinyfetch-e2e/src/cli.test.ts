/** The built command, called the way a script calls it. */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { App, CLI } from './app.js';

afterAll(() => App.removeAll());

const run = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

describe('exit 2 with a JSON reporter', () => {
  it('prints the error as JSON on stdout as well as on stderr', () => {
    for (const args of [['lint', '--reporter', 'json', '--bogus'], ['check', '--json', '--config', 'missing.yaml']]) {
      const result = run(...args);
      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/^skillunit: /);
      const out = JSON.parse(result.stdout);
      expect(out).toMatchObject({ schema: 5, command: args[0], ok: false, error: { exit: 2 } });
      expect(result.stderr).toContain(out.error.message);
    }
  });

  it('prints nothing on stdout with the table reporter', () => {
    const result = run('lint', '--bogus');
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
  });
});

describe('a report through a pipe', () => {
  // A skill whose report is far above the 64 KB a pipe holds: 3,000 links that do not resolve.
  const skill = mkdtempSync(join(tmpdir(), 'skillunit-pipe-'));
  const links = Array.from({ length: 3000 }, (_, i) => `- [file ${i}](references/missing-file-number-${i}.md)`);
  writeFileSync(join(skill, 'SKILL.md'), `---\nname: big\ndescription: A skill with a long report.\n---\n\n# Big\n\n${links.join('\n')}\n`);
  afterAll(() => rmSync(skill, { recursive: true, force: true }));

  // spawnSync reads stdout through a pipe, as `| jq` and a CI log do.
  const lint = (...args: string[]) =>
    spawnSync(process.execPath, [CLI, 'lint', skill, ...args], { cwd: skill, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } });

  it('arrives whole with the JSON reporter', () => {
    const result = lint('--reporter', 'json');
    expect(result.status).toBe(1);
    expect(result.stdout.length).toBeGreaterThan(256 * 1024);
    const report = JSON.parse(result.stdout);
    expect(report.lint.problems.filter((p: { message: string }) => p.message.includes('does not resolve'))).toHaveLength(3000);
  });

  it.each(['table', 'github'])('ends with the status line with the %s reporter', (reporter) => {
    const result = lint('--reporter', reporter);
    expect(result.status).toBe(1);
    expect(result.stdout.length).toBeGreaterThan(64 * 1024);
    // Nx sets FORCE_COLOR, which wins over NO_COLOR.
    const last = result.stdout.replace(/\x1b\[[0-9;]*m/g, '').trimEnd().split('\n').at(-1);
    expect(last).toMatch(/^FAILED {2}lint 3,?000 errors/);
  });
});

describe('the decision model provider', () => {
  // Outside any git repository, so no .env above it supplies a key.
  const project = mkdtempSync(join(tmpdir(), 'skillunit-provider-'));
  writeFileSync(join(project, 'SKILL.md'), '---\nname: tiny\ndescription: A tiny skill.\n---\n\n# Tiny\n\nRetry only GET requests.\n');
  mkdirSync(join(project, 'specs'));
  writeFileSync(join(project, 'specs', 'a.yaml'), 'tests:\n  - id: get\n    scenario: A GET times out.\n    question: May the agent retry it?\n    expect: yes\n');
  writeFileSync(join(project, 'mine.mjs'), "export default { id: 'mine', limits: { perQuestionTokens: 1000, perRequestTokens: 2000 }, decide: async () => { throw new Error('not sent'); } };\n");
  writeFileSync(join(project, 'module.yaml'), 'model: ./mine.mjs\n');
  afterAll(() => rmSync(project, { recursive: true, force: true }));

  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.endsWith('_API_KEY')));
  const inProject = (...args: string[]) => spawnSync(process.execPath, [CLI, ...args], { cwd: project, encoding: 'utf8', env: { ...env, NO_COLOR: '1' } });

  it('names the key of the provider in use when it is missing, and needs none on a dry run', () => {
    const missing = inProject('test');
    expect(missing.status).toBe(2);
    expect(missing.stderr).toBe(
      'skillunit: TYPESAFE_API_KEY is not set. Add it to the environment, or to a .env file next to skillunit.yaml or at the root of the repository, or use --dry-run.\n',
    );
    expect(inProject('test', '--dry-run').status).toBe(0);
    const openai = inProject('test', '--provider', 'openai');
    expect(openai.status).toBe(2);
    expect(openai.stderr).toMatch(/^skillunit: OPENAI_API_KEY is not set\./);
    expect(inProject('test', '--provider', 'openai', '--dry-run').status).toBe(0);
  });

  it('takes --provider on test and check only, and only a provider that ships', () => {
    const unknown = inProject('test', '--provider', 'mistral');
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toBe('skillunit: --provider takes typesafe, openai; any other provider goes in a model module\n');
    expect(inProject('lint', '--provider', 'typesafe').stderr).toContain('lint does not take --provider');
  });

  it('--provider replaces a model module of the settings, and --model alone does not', () => {
    const model = inProject('test', '--config', 'module.yaml', '--model', 'jev-latest', '--dry-run');
    expect(model.status).toBe(2);
    expect(model.stderr).toContain('--model sets the model of a provider that ships with SkillUnit; the settings use a model module. Add --provider to use one');
    const provider = inProject('test', '--config', 'module.yaml', '--provider', 'typesafe', '--model', 'jev-latest');
    expect(provider.stderr).toContain('TYPESAFE_API_KEY is not set');
    expect(inProject('test', '--config', 'module.yaml', '--provider', 'typesafe', '--dry-run').status).toBe(0);
  });
});

describe('the table reporter by unit', () => {
  let app: App;
  let ids: string[];
  beforeAll(() => {
    app = App.copy('table');
    app.test();
    ids = (app.run('check', '--dry-run').report.units as { id: string }[]).map((u) => u.id);
  }, 120_000);
  const table = (...args: string[]) => {
    const result = spawnSync(process.execPath, [CLI, 'check', '--dry-run', ...args], { cwd: app.root, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  };

  it('names every unit of tinyfetch once, in the order of its files', () => {
    expect(ids).toHaveLength(12);
    const heads = [...table().matchAll(/^ {4}(\S+) {2}(?:rule|decision|fact)$/gm)].map((m) => m[1]);
    expect(heads).toEqual(ids);
  });

  it('--compact: one row per unit', () => {
    const rows = [...table('--compact').matchAll(/^ {4}[✓✗~] (\S+) +(?:rule|decision|fact) /gm)].map((m) => m[1]);
    expect(rows).toEqual(ids);
  });
});

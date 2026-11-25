/**
 * `skillunit proof`: builds the skill from `source` and the units the tests declare, and compares
 * the build with the `skill` folder, or with `write` writes it there.
 *
 * 1. empty the `proof.units` folder of its records, when `proof.run` is set and `noRun` is not;
 * 2. run `proof.run` through the shell, from the folder of `skillunit.yaml`, whatever it exits with:
 *    a failing test is what the proof is there to report;
 * 3. read the units, fill the source, run `proof.format` on each built Markdown file;
 * 4. compare with the `skill` folder, the first line of each block that differs, or write it.
 *
 * Every finding about a line of the skill says where that line comes from: the test that declares
 * its unit, or the file of the source.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, globSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { alignLines, differences } from '../build/align.js';
import { buildSkill, listFiles, type Build, type BuiltFile, type LineOrigin } from '../build/build.js';
import { readRecords } from '../build/records.js';
import type { ProofConfig } from '../config.js';
import { output, quote } from '../lint/commands.js';
import type { Origin, Problem } from '../lint/types.js';
import type { UnitKind } from '../unit/contract.js';
import { collectRegions } from './regions.js';

export interface ProofOptions {
  /** Folder of the built skill. */
  skill: string;
  /** Folder the skill is built from. */
  source: string;
  config: ProofConfig;
  /** The settings file, for findings about the settings. */
  configFile?: string;
  /** Write the build to the skill folder instead of comparing. */
  write?: boolean;
  /** Do not run `proof.run`: use the units already in `proof.units`. */
  noRun?: boolean;
}

/** What ran the tests: the command, with how long it took and what it exited with, or why nothing did. */
export type RunReport = { command: string; status: number | null; ms: number } | { skipped: 'no-run' | 'not-set' };

export type UnitProofState = 'passed' | 'failed' | 'missing';

export interface UnitProof {
  id: string;
  /** Null for a slot whose test left no unit. */
  kind: UnitKind | null;
  /** `test`: a test proves it; `declared`: it was declared with no body, so no test does. */
  from: 'test' | 'declared';
  /** `passed`: built from its declaration; `failed`: its test failed; `missing`: nothing left it. */
  state: UnitProofState;
  /** The file of the skill the unit is built into, from the skill folder, and the line of its heading there (1 when it is not there). */
  file: string;
  line: number;
  /** The slot, from the skill folder. */
  source: { file: string; line: number };
  /** Where its test declares it, from the skill folder. */
  test?: { file: string; line: number };
  /** The message of its failed test. */
  error?: string;
}

export interface FileProof {
  /** From the skill folder. */
  file: string;
  /** `same`; `differs` or `missing` in the skill folder; `written` by `write`; `extra`: no file of the source builds it; `broken`: the build of it failed. */
  state: 'same' | 'differs' | 'missing' | 'written' | 'extra' | 'broken';
}

export interface ProofResult {
  configured: true;
  /** No errors; warnings allowed. */
  ok: boolean;
  /** Absolute path of the skill folder. */
  skill: string;
  /** Absolute path of the source. */
  source: string;
  write: boolean;
  run: RunReport;
  units: UnitProof[];
  files: FileProof[];
  problems: Problem[];
  summary: {
    units: number;
    /** Units built from a test that passed: proved. */
    proved: number;
    /** Units built from a declaration with no body: no test proves them. */
    declared: number;
    /** Slots whose test failed. */
    failed: number;
    /** Slots no test left a unit for. */
    missing: number;
    /** `{{value:…}}` in the source. */
    values: number;
    files: number;
    /** Files of the skill folder that differ from the build, or that it lacks. */
    differ: number;
    written: number;
    /** Files of the skill folder no file of the source builds. */
    extra: number;
  };
}

/** What `check` reports when the settings have no `source`. */
export interface ProofSkipped {
  configured: false;
  ok: true;
}

/** Where a line of the skill folder comes from: `file` from the skill folder. */
export type OriginLookup = (file: string, line: number) => Origin | undefined;

/**
 * How many lines of the output of `proof.run` a finding shows: enough for a runner's list of the
 * tests that failed, which comes before the details of each failure.
 */
const TAIL = 30;

/** What running `proof.run` gave. */
export interface TestRun {
  run: RunReport;
  /** How the run ended when it did not exit with 0: `exited with 1`, `did not run: …`, `did not finish (SIGTERM)`. */
  ended: string | null;
  /** The end of its output. */
  tail: string;
}

/**
 * Runs `proof.run` through the shell, from the folder of `skillunit.yaml`, after emptying the
 * `proof.units` folder of its records. Nothing runs with `noRun` or when `proof.run` is not set.
 */
export function runTests(cfg: ProofConfig, noRun: boolean): TestRun {
  if (!cfg.run) return { run: { skipped: 'not-set' }, ended: null, tail: '' };
  if (noRun) return { run: { skipped: 'no-run' }, ended: null, tail: '' };
  emptyRecords(cfg.units);
  const started = Date.now();
  const done = spawnSync(cfg.run, { shell: true, cwd: cfg.cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const run = { command: cfg.run, status: done.status, ms: Date.now() - started };
  let ended: string | null = null;
  if (done.error) ended = `did not run: ${done.error.message}`;
  else if (done.status === null) ended = `did not finish (${done.signal ?? 'stopped'})`;
  else if (done.status !== 0) ended = `exited with ${done.status}`;
  const tail = lastLines(`${done.stdout ?? ''}${done.stderr ?? ''}${done.error ? `\n${done.error.message}` : ''}`, TAIL);
  return { run, ended, tail };
}

/** The error for a run that did not exit with 0, with the end of its output; null for one that did. */
export function runFailure(cfg: ProofConfig, { ended, tail }: TestRun, leftRecords: boolean): string | null {
  if (ended === null) return null;
  const units = relative(cfg.cwd, cfg.units).split('\\').join('/') || '.';
  const what = leftRecords ? `\`proof.run\` (\`${cfg.run}\`) ${ended}: a test failed, or the run did` : `\`proof.run\` (\`${cfg.run}\`) ${ended} and left no unit in \`${units}\``;
  return `${what}${tail ? `. The end of its output:\n${tail}` : ''}`;
}

export function proof(options: ProofOptions): ProofResult {
  return runProof(options).result;
}

/** The proof, and where each line of the skill folder comes from, for lint and the model tests. */
export function runProof(options: ProofOptions): { result: ProofResult; origin: OriginLookup } {
  const skillDir = resolve(options.skill);
  const sourceDir = resolve(options.source);
  const cfg = options.config;
  const fromSkill = (abs: string) => relative(skillDir, abs).split('\\').join('/') || '.';
  const fromProject = (abs: string) => relative(cfg.cwd, abs).split('\\').join('/') || '.';
  const problems: Problem[] = [];
  const add = (file: string, line: number, message: string, more: Partial<Problem> = {}) => problems.push({ file, line, severity: 'error', rule: 'proof', message, ...more });
  const settings = settingsPlace(options.configFile, skillDir);
  const units = fromProject(cfg.units);

  // ---------------------------------------------------------------- 1, 2: the tests
  const { run, ended, tail } = runTests(cfg, options.noRun === true);

  // ---------------------------------------------------------------- 3: the build
  const records = readRecords(cfg.units, cfg.cwd);
  for (const p of records.problems) add(fromSkill(p.path), 1, p.message);
  // A run that did not exit with 0 fails the proof, whatever units it left: a failing test is a
  // failure, whether or not it declares a unit. A unit whose test failed is reported on its slot too.
  const ranAndFailed = ended !== null;
  const failure = runFailure(cfg, { run, ended, tail }, records.units.length + records.questions.length > 0);
  if (failure) add(settings.file, settings.line('run'), failure);
  const missingReason =
    'skipped' in run
      ? run.skipped === 'no-run'
        ? `\`--no-run\` used the units already in \`${units}\`, and none is this one: run the tests first, or leave out \`--no-run\``
        : `\`proof.run\` is not set, so the units are those already in \`${units}\`: run the tests first, or set \`proof.run\``
      : ranAndFailed && !records.units.length
        ? 'the tests did not run; see `proof.run`'
        : 'its test was skipped or deleted, or did not run';

  const sourceFiles = expand(cfg.sources, cfg.cwd).map((abs) => ({ file: abs, text: readFileSync(abs, 'utf8') }));
  const regions = collectRegions(sourceFiles, fromProject);
  for (const p of regions.problems) add(fromSkill(p.file), p.line, p.message);

  const build = buildSkill({ source: sourceDir, records: records.units, regions: regions.regions, missingReason, shown: fromProject });
  for (const p of build.problems) add(fromSkill(p.file), p.line, p.message, p.unit ? { unit: p.unit } : {});


  // ---------------------------------------------------------------- 3: format
  const formatted = new Map<string, string>();
  for (const f of build.files) {
    if (f.text === undefined || f.broken) continue;
    let text = f.text;
    if (cfg.format) {
      const result = formatCopy(text, join(skillDir, f.file), cfg);
      if (typeof result === 'string') text = result;
      else add(settings.file, settings.line('format'), `\`proof.format\` failed on the build of ${f.file}${result.output ? `:\n${result.output}` : ''}`);
    }
    formatted.set(f.file, text);
  }

  const origin = lookup(build, skillDir, fromSkill);

  // ---------------------------------------------------------------- 4: compare, or write
  const files: FileProof[] = [];
  const builtNames = new Set(build.files.map((f) => f.file));
  for (const f of build.files) {
    if (f.broken) {
      files.push({ file: f.file, state: 'broken' });
      continue;
    }
    const abs = join(skillDir, f.file);
    const want = f.bytes ?? Buffer.from(formatted.get(f.file)!, 'utf8');
    const have = existsSync(abs) ? readFileSync(abs) : null;
    if (have && have.equals(want)) {
      files.push({ file: f.file, state: 'same' });
      continue;
    }
    if (options.write) {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, want);
      files.push({ file: f.file, state: 'written' });
      continue;
    }
    if (!have) {
      files.push({ file: f.file, state: 'missing' });
      const first = f.origins[0];
      add(f.file, 1, `the skill folder has no \`${f.file}\`, which \`source\` builds. Run \`skillunit proof --write\``, first ? { origin: toOrigin(first, fromSkill) } : {});
      continue;
    }
    files.push({ file: f.file, state: 'differs' });
    if (f.bytes) {
      add(f.file, 1, `this file is not the one in \`source\`, which it is copied from: edit ${fromProject(join(sourceDir, f.file))}, then run \`skillunit proof --write\``, { origin: { kind: 'source', file: fromSkill(join(sourceDir, f.file)), line: 1 } });
      continue;
    }
    // One finding per block that differs, so a value in a table and the unit that states it are
    // both named. Where each line comes from is in `origin`, which every reporter shows.
    const found = differences(formatted.get(f.file)!.split(/\r?\n/), have.toString('utf8').split(/\r?\n/));
    if (!found.length) found.push({ line: 1, expected: 'other line ends', actual: 'these' });
    for (const d of found.slice(0, MAX_DIFFERENCES)) {
      const from = origin(f.file, d.line);
      const unit = from?.kind === 'test' ? from.unit : undefined;
      // Whether the code moved or someone edited the skill folder, `--write` comes first: it is
      // all a change to the code needs, and the second sentence covers an edit by hand.
      add(f.file, d.line, `this line is not what the build gives: the build has ${shownLine(d.expected, 'nothing here')}, the skill has ${shownLine(d.actual, 'nothing here')}. ${WRITE_ADVICE}`, { ...(from ? { origin: from } : {}), ...(unit ? { unit } : {}) });
    }
    if (found.length > MAX_DIFFERENCES) add(f.file, found[MAX_DIFFERENCES]!.line, `and ${found.length - MAX_DIFFERENCES} more blocks that differ from the build. Run \`skillunit proof --write\``);
  }
  for (const name of existsSync(skillDir) ? listFiles(skillDir) : []) {
    if (builtNames.has(name)) continue;
    files.push({ file: name, state: 'extra' });
    add(name, 1, `no file of \`source\` builds \`${name}\`: move it to ${fromProject(join(sourceDir, name))}, or remove it from the skill folder${options.write ? '. `--write` leaves it there' : ''}`);
  }
  files.sort((a, b) => a.file.localeCompare(b.file));

  // ---------------------------------------------------------------- the units
  const finalText = (file: string) => {
    const abs = join(skillDir, file);
    return formatted.get(file) ?? (existsSync(abs) ? readFileSync(abs, 'utf8') : '');
  };
  const unitResults: UnitProof[] = build.units.map((u) => {
    const heading = new RegExp(`^###\\s+(?:rule|decision|fact):\\s*${u.id}\\s*$`);
    const line = finalText(u.file).split(/\r?\n/).findIndex((l) => heading.test(l)) + 1 || 1;
    return {
      id: u.id,
      kind: u.kind,
      from: u.from,
      state: u.state,
      file: u.file,
      line,
      source: { file: fromSkill(u.source.file), line: u.source.line },
      ...(u.test ? { test: { file: fromSkill(u.test.file), line: u.test.line } } : {}),
      ...(u.error !== undefined ? { error: u.error } : {}),
    };
  });

  problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const count = (s: UnitProofState) => unitResults.filter((u) => u.state === s).length;
  const result: ProofResult = {
    configured: true,
    ok: !problems.some((p) => p.severity === 'error'),
    skill: skillDir,
    source: sourceDir,
    write: options.write === true,
    run,
    units: unitResults,
    files,
    problems,
    summary: {
      units: unitResults.length,
      proved: unitResults.filter((u) => u.state === 'passed' && u.from === 'test').length,
      declared: unitResults.filter((u) => u.state === 'passed' && u.from === 'declared').length,
      failed: count('failed'),
      missing: count('missing'),
      values: build.values,
      files: build.files.length,
      differ: files.filter((f) => f.state === 'differs' || f.state === 'missing').length,
      written: files.filter((f) => f.state === 'written').length,
      extra: files.filter((f) => f.state === 'extra').length,
    },
  };
  return { result, origin };
}

/**
 * Where each line of the skill folder comes from, without running the tests or the formatter:
 * the source filled with the units already in `proof.units`. For `skillunit lint` and
 * `skillunit test`, which read the skill folder as it is.
 */
export function traceSkill(options: Pick<ProofOptions, 'skill' | 'source' | 'config'>): OriginLookup {
  const skillDir = resolve(options.skill);
  const cfg = options.config;
  const records = readRecords(cfg.units, cfg.cwd);
  const sourceFiles = expand(cfg.sources, cfg.cwd).map((abs) => ({ file: abs, text: readFileSync(abs, 'utf8') }));
  const build = buildSkill({ source: resolve(options.source), records: records.units, regions: collectRegions(sourceFiles).regions, missingReason: '' });
  return lookup(build, skillDir, (abs) => relative(skillDir, abs).split('\\').join('/'));
}

/** The origin of a line of the skill folder: the line of the build it stands for, through the formatter and edits by hand. */
function lookup(build: Build, skillDir: string, fromSkill: (abs: string) => string): OriginLookup {
  const files = new Map<string, BuiltFile>(build.files.map((f) => [f.file, f]));
  const maps = new Map<string, number[] | null>();
  return (file, line) => {
    const f = files.get(file);
    if (!f || f.text === undefined || !f.origins.length) return undefined;
    let map = maps.get(file);
    if (map === undefined) {
      const abs = join(skillDir, file);
      map = existsSync(abs) ? alignLines(f.text.split(/\r?\n/), readFileSync(abs, 'utf8').split(/\r?\n/)) : null;
      maps.set(file, map);
    }
    const at = map ? map[line - 1] : line - 1;
    const o = at === undefined ? undefined : f.origins[Math.min(at, f.origins.length - 1)];
    return o ? toOrigin(o, fromSkill) : undefined;
  };
}

function toOrigin(o: LineOrigin, fromSkill: (abs: string) => string): Origin {
  return o.kind === 'test' ? { kind: 'test', file: fromSkill(o.file), line: o.line, unit: o.unit } : { kind: 'source', file: fromSkill(o.file), line: o.line };
}

/** Takes out the records of an earlier run: only `.json` files, so a wrong `proof.units` costs no other file. */
function emptyRecords(dir: string) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name.endsWith('.json')) rmSync(join(dir, e.name), { force: true });
  }
}

function lastLines(text: string, n: number): string {
  return text
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(-n)
    .join('\n');
}

/** What to do about a line of the skill folder that is not what the build gives. */
const WRITE_ADVICE = 'Run `skillunit proof --write` to update the skill. To change this text, change where it comes from: the skill folder is built.';

/** Blocks that differ reported per file; the rest are counted. */
const MAX_DIFFERENCES = 10;

function shownLine(line: string | undefined, none = 'nothing more'): string {
  if (line === undefined) return none;
  if (!line.trim()) return 'an empty line';
  const cut = line.length > 100 ? `${line.slice(0, 99)}…` : line;
  return `\`${cut.replace(/`/g, "'")}\``;
}

/** Formats `text` as the file at `abs` would be: on a hidden copy in the nearest folder that exists. */
function formatCopy(text: string, abs: string, cfg: ProofConfig): string | { output: string } {
  let dir = dirname(abs);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  const copy = join(dir, `.${basename(abs, '.md')}.skillunit-build-${process.pid}.md`);
  try {
    writeFileSync(copy, text);
    const run = spawnSync(cfg.format!.replaceAll('{file}', quote(copy)), { shell: true, cwd: cfg.cwd, encoding: 'utf8' });
    if (run.status === 0) return readFileSync(copy, 'utf8');
    return { output: output(`${run.stderr ?? ''}${run.stdout ?? ''}`, [copy], abs) || (run.error?.message ?? `exit ${run.status}`) };
  } finally {
    rmSync(copy, { force: true });
  }
}

/** Files that match any of `globs` from `cwd`, absolute and sorted, `node_modules` left out. */
export function expand(globs: string[], cwd: string): string[] {
  if (!globs.length) return [];
  const found: string[] = globSync(globs, { cwd, exclude: (name: string) => name === 'node_modules' || name.endsWith('/node_modules') });
  return [...new Set(found.map((f) => resolve(cwd, f)))].filter((f) => statSync(f, { throwIfNoEntry: false })?.isFile()).sort();
}

interface SettingsPlace {
  file: string;
  /** The line of `proof.<key>` in the settings, or of `proof:`, or of `source:`, or 1. */
  line: (key?: string) => number;
}

function settingsPlace(configFile: string | undefined, skillDir: string): SettingsPlace {
  if (!configFile) return { file: 'skillunit.yaml', line: () => 1 };
  const lines = (() => {
    try {
      return readFileSync(configFile, 'utf8').split(/\r?\n/);
    } catch {
      return [];
    }
  })();
  const find = (re: RegExp) => lines.findIndex((l) => re.test(l)) + 1;
  return {
    file: relative(skillDir, configFile).split('\\').join('/'),
    line: (key) => (key ? find(new RegExp(`^\\s+${key}\\s*:`)) : 0) || find(/^proof\s*:/) || find(/^source\s*:/) || 1,
  };
}

/**
 * `skillunit proof`: builds the skill from `source` and the units the tests declare, and compares
 * the build with the `skill` folder, or with `write` writes it there.
 *
 * 1. empty the `proof.units` folder of its records, when `proof.run` is set and `noRun` is not;
 * 2. run `proof.run` through the shell, from the folder of `skillunit.yaml`, whatever it exits with:
 *    a failing test is what the proof is there to report;
 * 3. read the units, fill the source, run `proof.format` on the built Markdown files, all in one run;
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
import { buildFromRecords } from '../build/from-records.js';
import { readRecords, type Records } from '../build/records.js';
import type { ProofConfig } from '../config.js';
import type { Origin, Problem } from '../problems.js';
import type { UnitKind } from '../unit/contract.js';
import { collectRegions, type Regions } from './regions.js';
import { output, quote } from './shell.js';

export interface ProofOptions {
  /** Folder of the built skill. */
  skill: string;
  /** Folder the skill is built from. Without it, the skill is built from the records alone: each `setup()` is a file. */
  source?: string;
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
  /** Absolute path of the source, or null for a skill built from the records alone. */
  source: string | null;
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

/** The proof, and where each line of the skill folder comes from. */
export function runProof(options: ProofOptions): { result: ProofResult; origin: OriginLookup } {
  const skillDir = resolve(options.skill);
  const sourceDir = options.source === undefined ? null : resolve(options.source);
  const cfg = options.config;
  const fromSkill = (abs: string) => relative(skillDir, abs).split('\\').join('/') || '.';
  const fromProject = (abs: string) => relative(cfg.cwd, abs).split('\\').join('/') || '.';
  const problems: Problem[] = [];
  const add = (file: string, line: number, message: string, more: Partial<Problem> = {}) => problems.push({ file, line, severity: 'error', message, ...more });
  const settings = settingsPlace(options.configFile, skillDir);
  const units = fromProject(cfg.units);

  // ---------------------------------------------------------------- 1, 2: the tests
  const { run, ended, tail } = runTests(cfg, options.noRun === true);

  // ---------------------------------------------------------------- 3: the build
  const records = readRecords(cfg.units, cfg.cwd);
  for (const p of records.problems) {
    add(fromSkill(p.path), 1, p.message, p.test ? { origin: { kind: 'test', file: fromSkill(p.test.file), line: p.test.line, ...(p.test.unit ? { unit: p.test.unit } : {}) }, ...(p.test.unit ? { unit: p.test.unit } : {}) } : {});
  }
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

  const regions = readRegions(cfg, records, fromProject);
  for (const p of regions.problems) add(fromSkill(p.file), p.line, p.message);

  const build = sourceDir
    ? buildSkill({ source: sourceDir, records: records.units, regions: regions.regions, missingReason, shown: fromProject })
    : buildFromRecords({ units: records.units, files: records.files, regions: regions.regions, shown: fromProject });
  for (const p of build.problems) add(fromSkill(p.file), p.line, p.message, p.unit ? { unit: p.unit } : {});


  // ---------------------------------------------------------------- 3: format
  const formatted = new Map<string, string>();
  const markdown = build.files.filter((f) => f.text !== undefined && !f.broken);
  const results = cfg.format ? formatCopies(markdown.map((f) => ({ text: f.text!, abs: join(skillDir, f.file) })), cfg) : [];
  markdown.forEach((f, i) => {
    const result = results[i];
    if (result !== undefined && typeof result !== 'string') add(settings.file, settings.line('format'), `\`proof.format\` failed on the build of ${f.file}${result.output ? `:\n${result.output}` : ''}`);
    formatted.set(f.file, typeof result === 'string' ? result : f.text!);
  });

  const origin = lookup(build, skillDir, fromSkill);

  // ---------------------------------------------------------------- 4: compare, or write
  const files: FileProof[] = [];
  const builtNames = new Set(build.files.map((f) => f.file));
  const builtIds = new Set(build.units.map((u) => u.id));
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
      add(f.file, 1, `the skill folder has no \`${f.file}\`, which ${sourceDir ? '`source` builds' : 'a `setup()` declares'}. Run \`skillunit proof --write\``, first ? { origin: toOrigin(first, fromSkill) } : {});
      continue;
    }
    files.push({ file: f.file, state: 'differs' });
    if (f.bytes) {
      add(f.file, 1, `this file is not the one in \`source\`, which it is copied from: edit ${fromProject(join(sourceDir!, f.file))}, then run \`skillunit proof --write\``, { origin: { kind: 'source', file: fromSkill(join(sourceDir!, f.file)), line: 1 } });
      continue;
    }
    // One finding per block that differs, so a value in a table and the unit that states it are
    // both named. Where each line comes from is in `origin`, which every reporter shows.
    const builtLines = formatted.get(f.file)!.split(/\r?\n/);
    const haveText = have.toString('utf8');
    const found = differences(builtLines, haveText.split(/\r?\n/));
    if (!found.length) found.push({ line: 1, expected: 'other line ends', actual: 'these' });
    // The origins index the build before the formatter.
    let unformatted: number[] | undefined;
    const builtOrigin = (index: number) => {
      unformatted ??= alignLines(f.text!.split(/\r?\n/), builtLines);
      const o = f.origins[Math.min(unformatted[index] ?? index, f.origins.length - 1)];
      return o ? toOrigin(o, fromSkill) : undefined;
    };
    const haveLines = haveText.split(/\r?\n/);
    for (const d of found.slice(0, MAX_DIFFERENCES)) {
      const line = Math.min(d.line, lineCount(haveText));
      // Lines only the skill has that hold a unit the build has nowhere: its test is gone. They
      // belong to no unit of the build, so they are named by their own heading.
      const stale = d.expected === undefined ? staleUnit(haveLines, d.line, d.actualEnd ?? d.line, builtIds) : undefined;
      if (stale) {
        add(f.file, stale.line, `the skill has the unit \`${stale.id}\`, and no test declares it: its test was skipped or deleted, or did not run. Run \`skillunit proof --write\` to take it out of the skill`, {
          unit: stale.id,
          lines: { build: null, skill: haveLines[stale.line - 1] ?? null },
        });
        continue;
      }
      // A line the build has belongs to the unit the build puts it in; a line only the skill has,
      // to the line of the build it stands for.
      const from = d.expectedLine !== undefined ? builtOrigin(d.expectedLine - 1) : origin(f.file, line);
      const unit = from?.kind === 'test' ? from.unit : undefined;
      const [build, skill] = shownPair(d.expected, d.actual);
      // Whether the code moved or someone edited the skill folder, `--write` comes first: it is
      // all a change to the code needs, and the second sentence covers an edit by hand.
      add(f.file, line, `this line is not what the build gives: the build has ${build}, the skill has ${skill}. ${WRITE_ADVICE}`, {
        ...(from ? { origin: from } : {}),
        ...(unit ? { unit } : {}),
        lines: { build: d.expected ?? null, skill: d.actual ?? null },
      });
    }
    if (found.length > MAX_DIFFERENCES) add(f.file, found[MAX_DIFFERENCES]!.line, `and ${found.length - MAX_DIFFERENCES} more blocks that differ from the build. Run \`skillunit proof --write\``);
  }
  for (const name of existsSync(skillDir) ? listFiles(skillDir, { dotMarkdown: true }) : []) {
    if (builtNames.has(name)) continue;
    files.push({ file: name, state: 'extra' });
    const left = options.write ? '. `--write` leaves it there' : '';
    if (!sourceDir) add(name, 1, `no \`setup()\` declares \`${name}\`: declare it in a test, or remove it from the skill folder${left}`);
    else if (basename(name).startsWith('.')) add(name, 1, `no file of \`source\` builds \`${name}\`, and none can: the build leaves out a name that starts with a dot. Remove it from the skill folder${left}`);
    else add(name, 1, `no file of \`source\` builds \`${name}\`: move it to ${fromProject(join(sourceDir, name))}, or remove it from the skill folder${left}`);
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
 * The regions of the test files the records name, and of the files of `proof.sources`: those
 * hold regions and declare no unit.
 */
function readRegions(cfg: ProofConfig, records: Records, shown?: (abs: string) => string): Regions {
  const named = [...records.units, ...records.questions].map((r) => r.abs).filter((abs) => statSync(abs, { throwIfNoEntry: false })?.isFile());
  const files = [...new Set([...named, ...expand(cfg.sources, cfg.cwd)])].sort();
  return collectRegions(files.map((abs) => ({ file: abs, text: readFileSync(abs, 'utf8') })), shown);
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

/** The characters of a line a message shows. */
const SHOWN = 100;
/** How many characters before the first difference a cut line keeps. */
const BEFORE = 30;

function shownLine(line: string | undefined, none = 'nothing more', start = 0): string {
  if (line === undefined) return none;
  if (!line.trim()) return 'an empty line';
  const end = start + SHOWN;
  const cut = line.length <= SHOWN ? line : `${start > 0 ? '…' : ''}${line.slice(start, end)}${line.length > end ? '…' : ''}`;
  return `\`${cut.replace(/`/g, "'")}\``;
}

/**
 * The two sides of a difference as a message shows them. When one is longer than a message
 * shows, both are cut around the first character where they differ, so the difference is in
 * the message; `…` marks the side that was cut.
 */
function shownPair(build: string | undefined, skill: string | undefined): [string, string] {
  if (build === undefined || skill === undefined || (build.length <= SHOWN && skill.length <= SHOWN)) return [shownLine(build, 'nothing here'), shownLine(skill, 'nothing here')];
  let at = 0;
  while (at < build.length && at < skill.length && build[at] === skill[at]) at++;
  const start = Math.max(0, at - BEFORE);
  return [shownLine(build, 'nothing here', start), shownLine(skill, 'nothing here', start)];
}

const UNIT_HEADING = /^#{1,6}\s+(?:rule|decision|fact):\s*(\S+?)\s*#*\s*$/;

/** The first unit heading in lines `from` up to `to` (from 1) whose id the build has nowhere. */
function staleUnit(lines: string[], from: number, to: number, built: Set<string>): { line: number; id: string } | undefined {
  for (let i = from - 1; i < Math.min(to - 1, lines.length); i++) {
    const id = UNIT_HEADING.exec(lines[i]!)?.[1];
    if (id !== undefined && !built.has(id)) return { line: i + 1, id };
  }
  return undefined;
}

/** The lines of a file: a line end at the end starts no line. */
function lineCount(text: string): number {
  return Math.max(1, text.split(/\r?\n/).length - (/\r?\n$/.test(text) ? 1 : 0));
}

/**
 * Formats each `text` as the file at its `abs` would be, on a hidden copy in the nearest folder
 * that exists. `proof.format` runs once, with every copy in place of `{file}`; when that run
 * fails, once per copy, so the error names the file it failed on and the others are formatted.
 */
function formatCopies(items: { text: string; abs: string }[], cfg: ProofConfig): (string | { output: string })[] {
  const copies = items.map(({ abs }) => {
    let dir = dirname(abs);
    while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
    return join(dir, `.${basename(abs, '.md')}.skillunit-build-${process.pid}.md`);
  });
  const format = (paths: string[]) => spawnSync(cfg.format!.replaceAll('{file}', paths.map(quote).join(' ')), { shell: true, cwd: cfg.cwd, encoding: 'utf8' });
  try {
    items.forEach((item, i) => writeFileSync(copies[i]!, item.text));
    if (items.length > 1 && format(copies).status === 0) return copies.map((copy) => readFileSync(copy, 'utf8'));
    return items.map((item, i) => {
      const copy = copies[i]!;
      // The run of every copy may have formatted this one, or left it half done.
      writeFileSync(copy, item.text);
      const run = format([copy]);
      if (run.status === 0) return readFileSync(copy, 'utf8');
      return { output: output(`${run.stderr ?? ''}${run.stdout ?? ''}`, [copy], item.abs) || (run.error?.message ?? `exit ${run.status}`) };
    });
  } finally {
    for (const copy of copies) rmSync(copy, { force: true });
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

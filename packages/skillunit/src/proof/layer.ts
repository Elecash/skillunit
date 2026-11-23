/**
 * `skillunit proof`: which units the project's tests prove, and whether each block flagged
 * `proof=<id>` holds what its test produced. It reads the JUnit XML report of a test run, the
 * folder where tests wrote examples, and the regions of test files. It never runs the tests.
 *
 * A unit is proved when a test whose title carries `[skill:<id>]` passed and none failed; it says
 * `Proof: none` when no test can prove it; any other unit is pending. With `write`, every flagged
 * block is rewritten from its file or region first; without it, the comparison is made in
 * memory, so the check needs no git and works before a commit.
 */
import { spawnSync } from 'node:child_process';
import { globSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type { ProofConfig } from '../config.js';
import { output, quote } from '../lint/commands.js';
import { namesUnit, proofMarks } from '../lint/proof.js';
import type { Problem } from '../lint/types.js';
import { parseFile, parseSkill, type Fence, type ParsedFile, type Unit } from '../units/index.js';
import { readExamples, type ExampleFile } from './examples.js';
import { readJUnit, ReportError, type TestCase, type TestStatus } from './junit.js';
import { collectRegions, type Region } from './regions.js';

export interface ProofOptions {
  /** Folder of the skill. */
  skill: string;
  config: ProofConfig;
  /** The settings file, for findings about the settings. */
  configFile?: string;
  /** Rewrite every flagged block from what its test produced. */
  write?: boolean;
  /**
   * Also report what lint reports about `proof=` and `Proof:`. `check` turns it off, since lint
   * ran before; `skillunit proof` alone keeps it on.
   */
  marks?: boolean;
}

export type UnitProofState = 'proved' | 'none' | 'failed' | 'pending';

export interface ProofTest {
  /** The report, from the skill folder. */
  report: string;
  line: number;
  title: string;
  status: TestStatus;
}

export interface ProofFence {
  /** The `proof=` id. */
  id: string;
  line: number;
  /** Where its text comes from: an example file, a region, or nothing found. */
  from: 'file' | 'region' | null;
  /** The text differs from what its file or region gives (before `write` rewrote it). */
  differs: boolean;
  /** `write` rewrote it. */
  written: boolean;
}

export interface UnitProof {
  id: string;
  /** Skill file of the unit, from the skill folder. */
  file: string;
  line: number;
  state: UnitProofState;
  tests: ProofTest[];
  fences: ProofFence[];
}

export interface ProofResult {
  configured: true;
  /** No errors; warnings allowed. */
  ok: boolean;
  /** Absolute path of the skill folder. */
  skill: string;
  /** The reports read, from the skill folder. */
  reports: string[];
  require: boolean;
  write: boolean;
  units: UnitProof[];
  problems: Problem[];
  summary: {
    units: number;
    proved: number;
    /** Units with `Proof: none`. */
    none: number;
    pending: number;
    /** Units with a tagged test that failed. */
    failed: number;
    /** Tests in the reports that carry a `[skill:<id>]` tag. */
    tagged: number;
    /** Flagged blocks whose text comes from a test: an example file or a region. */
    fences: number;
    /** Of those, blocks whose text differs from what the test gives. */
    differ: number;
    /** Blocks `--write` rewrote. */
    written: number;
  };
}

/** What `check` reports when the settings have no `proof` key. */
export interface ProofSkipped {
  configured: false;
  ok: true;
}

/** Slack on the start of a run read from a timestamp with no zone, which may be local time. */
const UNZONED_SLACK_MS = 14 * 60 * 60 * 1000;

export function proof(options: ProofOptions): ProofResult {
  const skillDir = resolve(options.skill);
  const cfg = options.config;
  const skill = parseSkill(skillDir);
  const fromSkill = (abs: string) => relative(skillDir, abs).split('\\').join('/');
  /** Paths inside messages start from the project, the folder of the settings. */
  const fromProject = (abs: string) => relative(cfg.cwd, abs).split('\\').join('/') || '.';
  const regionPlace = (r: Region) => `${fromProject(resolve(skillDir, r.file))}:${r.line}`;
  const problems: Problem[] = [];
  const add = (file: string, line: number, message: string, severity: Problem['severity'] = 'error', unit?: string) =>
    problems.push({ file, line, severity, rule: 'proof', message, ...(unit ? { unit } : {}) });
  const settings = settingsPlace(options.configFile, skillDir);

  if (options.marks) problems.push(...proofMarks(skill));

  // ---------------------------------------------------------------- what the tests left
  const reportPaths = expand(cfg.reports, cfg.cwd);
  if (!reportPaths.length) {
    add(settings.file, settings.line('reports'), `no report matches \`proof.reports\` (${cfg.reports.map((g) => `\`${g}\``).join(', ')}); run the tests with a JUnit reporter first, such as \`vitest run --reporter=junit --outputFile=reports/junit.xml\``);
  }
  const cases: TestCase[] = [];
  let started: number | undefined;
  /** At least one report was read. Without one, what the tests proved is unknown, not failed. */
  let read = false;
  for (const path of reportPaths) {
    try {
      const report = readJUnit(readFileSync(path, 'utf8'), fromSkill(path));
      read = true;
      cases.push(...report.cases);
      if (report.started) {
        const at = report.started.ms - (report.started.zoned ? 2000 : UNZONED_SLACK_MS);
        started = started === undefined ? at : Math.min(started, at);
      }
    } catch (e) {
      if (!(e instanceof ReportError)) throw e;
      add(e.file, e.line, `this report cannot be read: ${e.message.slice(e.message.indexOf(': ') + 2)}`);
    }
  }

  const folder = readExamples(cfg.examples);
  for (const p of folder.problems) add(fromSkill(join(cfg.examples, p.name)), 1, p.message, /no extension/.test(p.message) ? 'warning' : 'error');

  const sourceFiles = expand(cfg.sources, cfg.cwd).map((abs) => ({ file: fromSkill(abs), text: readFileSync(abs, 'utf8') }));
  const found = collectRegions(sourceFiles);
  for (const p of found.problems) add(p.file, p.line, p.message);

  // ---------------------------------------------------------------- tags
  const units = new Map<string, Unit>();
  for (const unit of skill.units) if (!units.has(unit.id)) units.set(unit.id, unit);
  const tagged = new Map<string, TestCase[]>();
  for (const c of cases) {
    for (const tag of c.tags) {
      if (!units.has(tag)) {
        const what = tag ? `\`[skill:${tag}]\` names no unit of the skill` : '`[skill:]` has no unit id';
        add(c.report, c.line, `${what}, in the test ${quoteTitle(c)}`);
        continue;
      }
      tagged.set(tag, [...(tagged.get(tag) ?? []), c]);
    }
  }

  // ---------------------------------------------------------------- units
  const results: UnitProof[] = [];
  const usedFiles = new Set<string>();
  const usedRegions = new Set<string>();
  const edits = new Map<string, Edit[]>();
  for (const unit of units.values()) {
    const tests = tagged.get(unit.id) ?? [];
    const failed = tests.filter((t) => t.status === 'failed');
    const passed = tests.filter((t) => t.status === 'passed');
    const none = unit.proof?.none === true;
    const state: UnitProofState = none ? 'none' : failed.length ? 'failed' : passed.length ? 'proved' : 'pending';
    const fences = unit.proofs.filter((f) => f.proof && namesUnit(f.proof, unit.id));
    const at = (message: string, line = unit.line) => add(unit.file, line, message, 'error', unit.id);

    // With no report read, only the report is reported: every unit would look unproved.
    if (!read) {
      results.push({ id: unit.id, file: unit.file, line: unit.line, state: none ? 'none' : 'pending', tests: [], fences: [] });
      continue;
    }
    if (none && tests.length) {
      at(`this unit says \`Proof: none\`, and ${tests.length === 1 ? 'a test is' : `${tests.length} tests are`} tagged \`[skill:${unit.id}]\` (${tests.map(quoteTitle).join(', ')}); keep one: the test, or \`Proof: none\``);
    }
    for (const t of failed) at(`the test ${quoteTitle(t)} (${fromProject(resolve(skillDir, t.report))}:${t.line}) failed${t.message ? `: ${t.message}` : ''}. It proves this unit, so the unit may no longer say what the code does`);
    if (!none && !failed.length && !passed.length) {
      if (tests.length) {
        if (fences.length || cfg.require) at(`every test tagged \`[skill:${unit.id}]\` was skipped (${tests.map(quoteTitle).join(', ')}), so nothing proves this unit`);
      } else if (fences.length) {
        at(`no test is tagged \`[skill:${unit.id}]\`, but the block at line ${fences.map((f) => f.line).join(', ')} says a test produced it; tag the test that proves this unit`, fences[0]!.line);
      } else if (cfg.require) {
        at(`no test proves this unit: tag a test that asserts what it says with \`[skill:${unit.id}]\`, or write \`Proof: none, <why>\` when no test can`);
      }
    }

    const proofFences: ProofFence[] = [];
    for (const fence of fences) {
      const id = fence.proof!;
      const file = folder.examples.get(id);
      const region = found.regions.get(id);
      const pf: ProofFence = { id, line: fence.line, from: null, differs: false, written: false };
      proofFences.push(pf);
      if (file) usedFiles.add(id);
      if (region) usedRegions.add(id);
      if (file && region) {
        at(`both \`${fromProject(file.path)}\` and the region at ${regionPlace(region)} give \`proof=${id}\`; a block comes from one of them`, fence.line);
        continue;
      }
      if (!file && !region) {
        at(`nothing gives \`proof=${id}\`: no test wrote \`${fromProject(cfg.examples)}/${id}.<extension>\`${cfg.sources.length ? ', and no file of `proof.sources` has the region `skill:' + id + '`' : ', and `proof.sources` is not set'}`, fence.line);
        continue;
      }
      pf.from = file ? 'file' : 'region';
      const text = file ? normalize(file.text) : region!.code;
      if (file && started !== undefined && file.mtimeMs < started) {
        add(unit.file, fence.line, `\`${fromProject(file.path)}\` is older than the test run in the reports: a test did not write it this time. Empty \`proof.examples\` before the tests run`, 'warning', unit.id);
      }
      const list = edits.get(unit.file) ?? [];
      list.push({ fence, unit: unit.id, text, origin: file ? fromProject(file.path) : regionPlace(region!), result: pf });
      edits.set(unit.file, list);
    }
    results.push({ id: unit.id, file: unit.file, line: unit.line, state, tests: tests.map((t) => ({ report: t.report, line: t.line, title: title(t), status: t.status })), fences: proofFences });
  }

  for (const [id, file] of read ? folder.examples : []) {
    if (!usedFiles.has(id)) add(fromSkill(file.path), 1, `no block has \`proof=${id}\`, so nothing uses \`${file.name}\``, 'warning');
  }
  for (const [id, region] of read ? found.regions : []) {
    if (!usedRegions.has(id)) add(region.file, region.line, `no block has \`proof=${id}\`, so nothing uses this region`, 'warning');
  }

  // ---------------------------------------------------------------- the blocks
  let written = 0;
  for (const [name, list] of edits) {
    const file = skill.files.find((f) => f.file === name)!;
    written += applyFile(file, list, { skillDir, cfg, write: options.write === true, add, settings });
  }

  const count = (s: UnitProofState) => results.filter((u) => u.state === s).length;
  const all = results.flatMap((u) => u.fences);
  problems.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return {
    configured: true,
    ok: !problems.some((p) => p.severity === 'error'),
    skill: skillDir,
    reports: reportPaths.map(fromSkill),
    require: cfg.require,
    write: options.write === true,
    units: results,
    problems,
    summary: {
      units: results.length,
      proved: count('proved'),
      none: count('none'),
      pending: count('pending'),
      failed: count('failed'),
      tagged: cases.filter((c) => c.tags.length).length,
      fences: all.filter((f) => f.from).length,
      differ: all.filter((f) => f.differs).length,
      written,
    },
  };
}

interface Edit {
  fence: Fence;
  unit: string;
  /** What the block should hold. */
  text: string;
  /** Where that comes from, for messages. */
  origin: string;
  result: ProofFence;
}

type Add = (file: string, line: number, message: string, severity?: Problem['severity'], unit?: string) => void;

/**
 * Compares, and with `write` rewrites, the flagged blocks of one skill file. With `format`, the
 * rewritten file is formatted first, on a copy next to the file so the formatter finds the
 * project's settings, and the blocks are compared as the formatter leaves them. Returns how many
 * blocks it wrote.
 */
function applyFile(file: ParsedFile, edits: Edit[], ctx: { skillDir: string; cfg: ProofConfig; write: boolean; add: Add; settings: SettingsPlace }): number {
  const abs = join(ctx.skillDir, file.file);
  const ready = edits.filter((e) => {
    const problem = fenceProblem(file.text, e.fence, e.text);
    if (problem) ctx.add(file.file, e.fence.line, problem, 'error', e.unit);
    return !problem;
  });
  const next = rewrite(file.text, ready);
  if (next === file.text) return 0;

  let target = next;
  if (ctx.cfg.format) {
    const formatted = formatCopy(next, abs, ctx.cfg);
    if (typeof formatted === 'string') target = formatted;
    else ctx.add(ctx.settings.file, ctx.settings.line('format'), `\`proof.format\` failed on a copy of ${file.file}${formatted.output ? `:\n${formatted.output}` : ''}`);
  }
  const after = new Map(parseFile(target, file.file).fences.filter((f) => f.proof).map((f) => [f.proof!, f]));
  let differ = 0;
  for (const e of ready) {
    const now = after.get(e.fence.proof!);
    if (!now || now.code === e.fence.code) continue;
    e.result.differs = true;
    differ++;
    if (ctx.write) {
      e.result.written = true;
      continue;
    }
    const { line, expected, actual } = firstDifference(now.code, e.fence.code);
    ctx.add(
      file.file,
      e.fence.line + 1 + line,
      `this block is not what \`${e.origin}\` gives, from line ${line + 1} of the block: the test gives ${shownLine(expected)}, the skill has ${shownLine(actual)}. Run \`skillunit proof --write\``,
      'error',
      e.unit,
    );
  }
  if (ctx.write && differ) {
    writeFileSync(abs, next);
    if (ctx.cfg.format) {
      const run = runFormat(ctx.cfg, abs);
      if (run !== true) ctx.add(ctx.settings.file, ctx.settings.line('format'), `\`proof.format\` failed on ${file.file}${run ? `:\n${run}` : ''}`);
    }
  }
  return ctx.write ? differ : 0;
}

const CLOSING = /^\s*(`{3,}|~{3,})\s*$/;

/** Why a block cannot be rewritten, if it cannot. */
function fenceProblem(text: string, fence: Fence, body: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const close = lines[fence.endLine - 1];
  if (fence.endLine <= fence.line || close === undefined || !CLOSING.test(close)) return 'this block is never closed, so it cannot be compared or written';
  const marker = /^\s*(`{3,}|~{3,})/.exec(lines[fence.line - 1]!)![1]!;
  for (const line of body.split('\n')) {
    const m = CLOSING.exec(line);
    if (m && m[1]![0] === marker[0] && m[1]!.length >= marker.length) {
      return `the example has a line \`${line.trim()}\` that would close this block; open the block with a longer fence, such as \`${marker[0]!.repeat(m[1]!.length + 1)}\``;
    }
  }
  return undefined;
}

/** The file with the body of each block replaced, at the block's own indentation. Line ends are kept. */
function rewrite(text: string, edits: Edit[]): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  for (const e of [...edits].sort((a, b) => b.fence.line - a.fence.line)) {
    const indent = /^\s*/.exec(lines[e.fence.line - 1]!)![0];
    const body = e.text === '' ? [] : e.text.split('\n').map((l) => (l ? indent + l : l));
    lines.splice(e.fence.line, e.fence.endLine - 1 - e.fence.line, ...body);
  }
  return lines.join(eol);
}

/** An example file's text, as a block holds it: `\n` line ends, no newline at the end. */
function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
}

function firstDifference(expected: string, actual: string): { line: number; expected: string | undefined; actual: string | undefined } {
  const a = expected.split('\n');
  const b = actual.split('\n');
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return { line: i, expected: a[i], actual: b[i] };
}

function shownLine(line: string | undefined): string {
  if (line === undefined) return 'nothing more';
  if (!line.trim()) return 'an empty line';
  const cut = line.length > 100 ? `${line.slice(0, 99)}…` : line;
  return `\`${cut.replace(/`/g, "'")}\``;
}

/** Formats `text` as the file at `abs` would be: on a hidden copy in the same folder. */
function formatCopy(text: string, abs: string, cfg: ProofConfig): string | { output: string } {
  const copy = join(dirname(abs), `.${basename(abs, '.md')}.skillunit-proof-${process.pid}.md`);
  try {
    writeFileSync(copy, text);
    const run = runFormat(cfg, copy, abs);
    return run === true ? readFileSync(copy, 'utf8') : { output: run };
  } finally {
    rmSync(copy, { force: true });
  }
}

/** Runs `proof.format` on `path`: true, or what it printed when it failed. */
function runFormat(cfg: ProofConfig, path: string, shownAs = path): true | string {
  const run = spawnSync(cfg.format!.replaceAll('{file}', quote(path)), { shell: true, cwd: cfg.cwd, encoding: 'utf8' });
  if (run.status === 0) return true;
  return output(`${run.stderr ?? ''}${run.stdout ?? ''}`, [path], shownAs) || (run.error?.message ?? `exit ${run.status}`);
}

/** Files that match any of `globs` from `cwd`, absolute and sorted, `node_modules` left out. */
export function expand(globs: string[], cwd: string): string[] {
  if (!globs.length) return [];
  const found = globSync(globs, { cwd, exclude: (name: string) => name === 'node_modules' || name.endsWith('/node_modules') });
  return [...new Set(found.map((f) => resolve(cwd, f)))].filter((f) => statSync(f, { throwIfNoEntry: false })?.isFile()).sort();
}

interface SettingsPlace {
  file: string;
  /** The line of `proof.<key>` in the settings, or of `proof:`, or 1. */
  line: (key: string) => number;
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
    line: (key) => find(new RegExp(`^\\s+${key}\\s*:`)) || find(/^proof\s*:/) || 1,
  };
}

/** The test's title as the runner shows it: the class or file, then the name, unless one holds the other. */
function title(c: TestCase): string {
  if (!c.classname || c.name.includes(c.classname)) return c.name;
  if (c.classname.includes(c.name)) return c.classname;
  return `${c.classname} › ${c.name}`;
}

const quoteTitle = (c: TestCase | ProofTest) => `"${'title' in c ? c.title : title(c)}"`;

export type { ExampleFile, Region };

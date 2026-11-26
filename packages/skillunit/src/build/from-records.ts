/**
 * Builds a skill from the records the tests left. Each `setup()` is a file of the skill; the units
 * and questions after it in its test file belong to it.
 *
 * ```md
 * ---                                  (SKILL.md: the frontmatter)
 * name: tinyfetch
 * description: …
 * ---
 *
 * # <title>
 *
 * <description>
 *
 * ```ts                                (the region `skill:<id>` of its test file, when it has one)
 * import { tf } from "tinyfetch";
 * ```
 *
 * ## Where to look                     (SKILL.md: one row per other file, by path)
 *
 * | Task | File |
 * | --- | --- |
 * | <when> | [<file>](<file>) |
 *
 * ## Rules                             (its units, in the order they are declared)
 *
 * ### fact: …
 * ```
 *
 * Every line comes from a test: the `setup()` of the file, or a unit.
 */
import type { Region } from '../proof/regions.js';
import { SKILL_INDEX, type FailedUnit, type PassedFile, type PassedUnit } from '../unit/contract.js';
import type { Build, BuildProblem, BuiltFile, BuiltUnit, LineOrigin } from './build.js';
import type { ReadFile, ReadUnit } from './records.js';
import { fenceLang, renderUnit } from './render.js';

export interface RecordsInput {
  units: ReadUnit[];
  files: ReadFile[];
  /** The `skill:` regions of the test files, by id; `file` is absolute. */
  regions: Map<string, Region>;
  /** A path as messages show it: from the project. */
  shown?: (abs: string) => string;
}

export function buildFromRecords(input: RecordsInput): Build {
  const problems: BuildProblem[] = [];
  const add = (file: string, line: number, message: string, unit?: string) => problems.push({ file, line, message, ...(unit ? { unit } : {}) });
  const shown = input.shown ?? ((abs: string) => abs);
  const place = (r: { abs: string; line: number }) => `${shown(r.abs)}:${r.line}`;

  // ---------------------------------------------------------------- the files, once per id and path
  const byId = new Map<string, ReadFile>();
  const byPath = new Map<string, ReadFile>();
  for (const f of input.files) {
    const first = byId.get(f.id);
    if (first) {
      add(f.abs, f.line, `the file \`${f.id}\` is also declared at ${place(first)}; two \`setup()\` cannot have the same id`);
      continue;
    }
    if (f.status === 'passed') {
      const path = (f as PassedFile).skillFile;
      const other = byPath.get(path);
      if (other) {
        add(f.abs, f.line, `\`${path}\` is also declared by \`setup('${other.id}')\` at ${place(other)}; a file of the skill has one \`setup()\``);
        continue;
      }
      byPath.set(path, f);
    } else {
      add(f.abs, f.line, `the \`setup()\` of \`${f.id}\` failed, so its file is not built: ${(f as FailedUnit).error}`);
    }
    byId.set(f.id, f);
  }

  // ---------------------------------------------------------------- the units, once per id, each in its file
  const unitIds = new Map<string, ReadUnit>();
  const ofFile = new Map<string, ReadUnit[]>();
  for (const u of input.units) {
    const first = unitIds.get(u.id);
    if (first) {
      add(u.abs, u.line, `the unit \`${u.id}\` is also declared at ${place(first)}; two tests cannot declare the same id`, u.id);
      continue;
    }
    unitIds.set(u.id, u);
    if (byId.has(u.id)) {
      add(u.abs, u.line, `the unit \`${u.id}\` has the id of the file declared at ${place(byId.get(u.id)!)}; files and units share one space of ids`, u.id);
      continue;
    }
    if (u.setup === undefined) {
      add(u.abs, u.line, `the unit \`${u.id}\` belongs to no file of the skill: declare its file with \`setup()\` before it in this test file`, u.id);
      continue;
    }
    if (!byId.has(u.setup)) {
      add(u.abs, u.line, `the unit \`${u.id}\` belongs to \`setup('${u.setup}')\`, which left no record: its test was skipped or deleted, or did not run`, u.id);
      continue;
    }
    ofFile.set(u.setup, [...(ofFile.get(u.setup) ?? []), u]);
  }

  // ---------------------------------------------------------------- each file
  const built: BuiltFile[] = [];
  const units: BuiltUnit[] = [];
  const passed = [...byId.values()].filter((f): f is PassedFile & ReadFile => f.status === 'passed');
  const others = passed.filter((f) => f.skillFile !== SKILL_INDEX).sort((a, b) => a.skillFile.localeCompare(b.skillFile));
  for (const f of passed) {
    const out: string[] = [];
    const origins: LineOrigin[] = [];
    const at = (text: string, from: { abs: string; line: number } = f, unit?: string) => {
      out.push(text);
      origins.push({ kind: 'test', file: from.abs, line: from.line, ...(unit ? { unit } : {}) });
    };
    let broken = false;
    if (f.frontmatter) {
      at('---');
      at(`name: ${f.frontmatter.name}`);
      at(`description: ${yamlText(f.frontmatter.description)}`);
      at('---');
      at('');
    }
    at(`# ${f.title}`);
    at('');
    at(f.description);
    const region = input.regions.get(f.id);
    if (region) {
      const marker = '`'.repeat(Math.max(3, ...[...region.code.matchAll(/^\s*(`{3,})/gm)].map((m) => m[1]!.length + 1)));
      at('');
      const from = { abs: region.file, line: region.line };
      at(`${marker}${fenceLang(region.file)}`, from);
      for (const l of region.code.split('\n')) at(l, from);
      at(marker, from);
    }
    if (f.skillFile === SKILL_INDEX && others.length) {
      at('');
      at('## Where to look');
      at('');
      at('| Task | File |');
      at('| --- | --- |');
      for (const o of others) at(`| ${o.when!.replace(/\|/g, '\\|')} | [${o.skillFile}](${o.skillFile}) |`, o);
    }
    const mine = (ofFile.get(f.id) ?? []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.abs.localeCompare(b.abs) || a.line - b.line);
    if (mine.length) {
      at('');
      at('## Rules');
    }
    for (const u of mine) {
      const base = { id: u.id, file: f.skillFile, setup: { file: f.abs, line: f.line }, test: { file: u.abs, line: u.line } };
      if (u.status === 'failed') {
        units.push({ ...base, kind: null, from: 'test', state: 'failed', error: (u as FailedUnit).error });
        add(u.abs, u.line, `the test of \`${u.id}\` (${place(u)}) failed, so it left no unit: ${(u as FailedUnit).error}`, u.id);
        broken = true;
        continue;
      }
      const record = u as PassedUnit & ReadUnit;
      units.push({ ...base, kind: record.kind, from: record.body === false ? 'declared' : 'test', state: 'passed' });
      const rendered = renderUnit(record, ownRegions(input.regions, u.id), (r) => r.file);
      for (const p of rendered.problems) add(p.file, p.line, p.message, u.id);
      if (rendered.problems.length) broken = true;
      at('');
      for (const l of rendered.lines) {
        out.push(l.text);
        origins.push({ kind: 'test', file: l.file, line: l.line, unit: u.id });
      }
    }
    // A Markdown file ends with a line end.
    at('');
    built.push({ file: f.skillFile, text: out.join('\n'), origins, broken });
  }
  if (passed.length && !byPath.has(SKILL_INDEX)) {
    const first = passed[0]!;
    add(first.abs, first.line, `no \`setup()\` declares \`${SKILL_INDEX}\`, the file an agent reads first: declare it, with \`frontmatter\``);
  }

  // ---------------------------------------------------------------- regions with no owner
  for (const [id, region] of input.regions) {
    const owner = id.split('.')[0]!;
    if (!unitIds.has(owner) && !byId.has(owner)) add(region.file, region.line, `the region \`skill:${id}\` belongs to no unit and no file a test declares; an example comes from the body of the test of its unit`);
    else if (byId.has(owner) && id !== owner) add(region.file, region.line, `the region \`skill:${id}\` names a file, \`${owner}\`, whose code is the region \`skill:${owner}\` alone`);
  }

  units.sort((a, b) => a.file.localeCompare(b.file));
  return { files: built, units, problems };
}

function ownRegions(regions: Map<string, Region>, id: string): Region[] {
  return [...regions.values()].filter((r) => r.id === id || r.id.startsWith(`${id}.`)).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** A line of text as a YAML value: as it is, or quoted when YAML would read it as something else. */
function yamlText(text: string): string {
  return /^[\s'"&*!|>%@`#,[\]{}?:-]|: |\s#|\s$/.test(text) ? JSON.stringify(text) : text;
}

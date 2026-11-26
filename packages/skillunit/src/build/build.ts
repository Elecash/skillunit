/**
 * Builds a skill from its source and the units the tests left. In a Markdown file of the source,
 * `{{unit:<id>}}` alone on a line is where the unit of a test goes, and `{{value:<id>.<name>}}`,
 * anywhere, a fenced block included, is a value of a unit. A unit heading in the source is an
 * error: every unit is declared in code, with `unit()`. Every other file is copied as it is. Braces around something that cannot be an id, such as
 * `{{unit:<id>}}` in a sentence about slots, are text.
 *
 * The build is in memory: the proof layer formats it, compares it with the skill folder or
 * writes it there.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Region } from '../proof/regions.js';
import type { FailedUnit, PassedUnit, UnitKind } from '../unit/contract.js';
import { unitHeadings } from '../units/index.js';
import type { ReadUnit } from './records.js';
import { renderUnit } from './render.js';

/** Where a built line comes from. Paths are absolute. */
export type LineOrigin = { kind: 'test'; file: string; line: number; unit?: string } | { kind: 'source'; file: string; line: number };

export interface BuiltFile {
  /** Path in the skill folder, with `/`. */
  file: string;
  /** The text of a Markdown file; other files are `bytes`. */
  text?: string;
  bytes?: Buffer;
  /** Where each line of `text` comes from. */
  origins: LineOrigin[];
  /** The build found a problem in this file, so it is not compared or written. */
  broken: boolean;
}

export interface BuildProblem {
  /** Absolute path of the file the problem is in: a file of the source, a test file, a record. */
  file: string;
  line: number;
  message: string;
  unit?: string;
}

/** A unit of the built skill, through its slot. */
export interface BuiltUnit {
  id: string;
  kind: UnitKind | null;
  /** `test`: a test proves it; `declared`: it was declared with no body, so no test does. */
  from: 'test' | 'declared';
  /** The slot: absolute source file and line. Built from records: the `setup()` of its file. */
  source: { file: string; line: number };
  /** What its declaration left. `missing` when nothing left the unit. */
  state: 'passed' | 'failed' | 'missing';
  /** From a test: where it is declared, when a record says. */
  test?: { file: string; line: number };
  /** From a failed test: the message of what failed. */
  error?: string;
  /** Path in the skill folder of the file the unit is built into, with `/`. */
  file: string;
}

export interface Build {
  files: BuiltFile[];
  units: BuiltUnit[];
  problems: BuildProblem[];
  /** How many `{{value:…}}` the source holds, and filled. */
  values: number;
}

export interface BuildInput {
  /** Absolute folder of the source. */
  source: string;
  /** The records the tests left, in the order of their test files. */
  records: ReadUnit[];
  /** The `skill:` regions of `proof.sources`, by id; `file` is absolute. */
  regions: Map<string, Region>;
  /** Why a slot may have no unit, said after "no test left the unit": who ran the tests. */
  missingReason: string;
  /** A path as messages show it: from the project. */
  shown?: (abs: string) => string;
}

const UNIT_SLOT = /\{\{\s*unit:([^}]*)\}\}/;
const VALUE_SLOT = /\{\{\s*value:([^}]*)\}\}/g;
const SLOT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VALUE_ID = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
/** What follows `unit:` or `value:` when it cannot be an id at all, such as `<id>`: the text is left as it is. */
const PLACEHOLDER = /[^A-Za-z0-9_.-]/;

export function buildSkill(input: BuildInput): Build {
  const problems: BuildProblem[] = [];
  const add = (file: string, line: number, message: string, unit?: string) => problems.push({ file, line, message, ...(unit ? { unit } : {}) });
  const shown = input.shown ?? ((abs: string) => abs);
  const place = (r: { abs: string; line: number }) => `${shown(r.abs)}:${r.line}`;

  // ---------------------------------------------------------------- the records, once per id
  const byId = new Map<string, ReadUnit>();
  for (const r of input.records) {
    const first = byId.get(r.id);
    if (first) {
      add(r.abs, r.line, `the unit \`${r.id}\` is also declared at ${place(first)}; two tests cannot declare the same id`, r.id);
      continue;
    }
    byId.set(r.id, r);
  }

  const files = listFiles(input.source);
  const built: BuiltFile[] = [];
  const units: BuiltUnit[] = [];
  const slots = new Map<string, { file: string; line: number }>();
  let values = 0;
  /** Files with the first of two slots for one id. */
  const twice = new Set<string>();

  for (const rel of files) {
    const abs = join(input.source, rel);
    if (!rel.toLowerCase().endsWith('.md')) {
      built.push({ file: rel, bytes: readFileSync(abs), origins: [], broken: false });
      continue;
    }
    const text = readFileSync(abs, 'utf8');
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    // A line end at the end of the file starts no line: the empty text after it is the last line.
    const last = Math.max(1, lines.length - (/\r?\n$/.test(text) ? 1 : 0));
    const out: string[] = [];
    const origins: LineOrigin[] = [];
    let broken = false;
    const fail = (line: number, message: string, unit?: string) => {
      broken = true;
      add(abs, line, message, unit);
    };
    let fence: string | null = null;
    /** The source with the slots blanked, for the parser to find unit headings written in it. */
    const prose: string[] = [];

    lines.forEach((raw, i) => {
      const line = i + 1;
      // A unit goes only outside fenced blocks; a value goes anywhere.
      const inFence = fence !== null;
      const opens = FENCE.exec(raw);
      if (fence === null && opens) fence = opens[1]!;
      else if (fence !== null && opens && opens[1]![0] === fence[0] && opens[1]!.length >= fence.length && !raw.trim().slice(opens[1]!.length).trim()) fence = null;

      const found = inFence ? null : UNIT_SLOT.exec(raw);
      // A placeholder such as `{{unit:<id>}}` in a sentence that explains slots is prose.
      const unit = found && PLACEHOLDER.test(found[1]!.trim()) ? null : found;
      if (unit) {
        prose.push('');
        const id = unit[1]!.trim();
        if (raw.trim() !== unit[0]) return fail(line, `\`${unit[0]}\` goes alone on its line, where the unit goes`);
        if (!SLOT_ID.test(id)) return fail(line, `\`${unit[0]}\` needs the id of a unit, in kebab-case: \`{{unit:default-timeout}}\``);
        const first = slots.get(id);
        if (first) {
          // Neither file is built: which of the two slots is the right one is not known.
          twice.add(first.file);
          return fail(line, `the slot of \`${id}\` is also at ${place({ abs: first.file, line: first.line })}; a unit goes in one place`, id);
        }
        slots.set(id, { file: abs, line });
        const record = byId.get(id);
        const base = { id, from: record?.status === 'passed' && record.body === false ? ('declared' as const) : ('test' as const), source: { file: abs, line }, file: rel };
        if (!record) {
          units.push({ ...base, kind: null, state: 'missing' });
          return fail(line, `no test left the unit \`${id}\`: ${input.missingReason}`, id);
        }
        const test = { file: record.abs, line: record.line };
        if (record.status === 'failed') {
          units.push({ ...base, kind: null, state: 'failed', test, error: (record as FailedUnit).error });
          return fail(line, `the test of \`${id}\` (${place(record)}) failed, so it left no unit: ${(record as FailedUnit).error}`, id);
        }
        const passed = record as PassedUnit & ReadUnit;
        units.push({ ...base, kind: passed.kind, state: 'passed', test });
        const rendered = renderUnit(passed, ownRegions(input.regions, id), (r) => r.file);
        // A problem of the rendering is in a test file; the slot's file is left unbuilt.
        for (const p of rendered.problems) add(p.file, p.line, p.message, id);
        if (rendered.problems.length) broken = true;
        for (const l of rendered.lines) {
          out.push(l.text);
          origins.push({ kind: 'test', file: l.file, line: l.line, unit: id });
        }
        return;
      }

      prose.push(raw);
      const filled = raw.replace(VALUE_SLOT, (whole, ref: string) => {
        if (PLACEHOLDER.test(ref.trim())) return whole;
        values++;
        const m = VALUE_ID.exec(ref.trim());
        if (!m) {
          fail(line, `\`${whole}\` needs a unit id, a dot and the name of a value: \`{{value:default-timeout.seconds}}\``);
          return whole;
        }
        const [, id, name] = m as unknown as [string, string, string];
        const record = byId.get(id);
        if (!record) {
          fail(line, `\`${whole}\` has no value: no test left the unit \`${id}\`; ${input.missingReason}`, id);
          return whole;
        }
        if (record.status === 'failed') {
          fail(line, `\`${whole}\` has no value: the test of \`${id}\` (${place(record)}) failed: ${(record as FailedUnit).error}`, id);
          return whole;
        }
        const own = (record as PassedUnit).values ?? {};
        if (!(name in own)) {
          const names = Object.keys(own);
          fail(line, `\`${whole}\` has no value: the unit \`${id}\` (${place(record)}) has no value \`${name}\`${names.length ? ` (its values: ${names.join(', ')})` : ', and no `values` at all'}`, id);
          return whole;
        }
        return String(own[name]);
      });
      out.push(filled);
      origins.push({ kind: 'source', file: abs, line: Math.min(line, last) });
    });

    for (const u of unitHeadings(prose.join('\n'), rel)) fail(u.line, `units are declared with \`unit()\`; put \`{{unit:${u.id}}}\` here`, u.id);
    built.push({ file: rel, text: out.join(eol), origins, broken });
  }

  for (const f of built) if (twice.has(join(input.source, f.file))) f.broken = true;

  // ---------------------------------------------------------------- what has no place
  for (const [id, record] of byId) {
    if (!slots.has(id)) add(record.abs, record.line, `this test declares the unit \`${id}\`, and no file of \`source\` has \`{{unit:${id}}}\` where it goes`, id);
  }
  for (const [id, region] of input.regions) {
    const unit = id.split('.')[0]!;
    if (!byId.has(unit)) add(region.file, region.line, `the region \`skill:${id}\` belongs to no unit a test declares; an example comes from the body of the test of its unit`);
  }

  units.sort((a, b) => a.file.localeCompare(b.file) || a.source.line - b.source.line);
  return { files: built, units, problems, values };
}

function ownRegions(regions: Map<string, Region>, id: string): Region[] {
  return [...regions.values()].filter((r) => r.id === id || r.id.startsWith(`${id}.`)).sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/**
 * Every file under `dir`, from `dir`, with `/`, sorted; dot files, dot folders and node_modules
 * left out. With `dotMarkdown`, a Markdown file whose name starts with a dot is listed: the
 * skill folder may not hold one the build does not make.
 */
export function listFiles(dir: string, { dotMarkdown = false } = {}): string[] {
  const out: string[] = [];
  const walk = (at: string) => {
    let entries;
    try {
      entries = readdirSync(at, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const listed = dotMarkdown && e.isFile() && e.name.toLowerCase().endsWith('.md');
      if ((e.name.startsWith('.') && !listed) || e.name === 'node_modules') continue;
      const abs = join(at, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile()) out.push(relative(dir, abs).split('\\').join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

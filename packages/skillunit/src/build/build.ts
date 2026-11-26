/**
 * What a build of the skill is: the files it gives, the units in them, and what was wrong. The
 * build is in memory: the proof layer formats it, compares it with the skill folder or writes it
 * there. `buildFromRecords` makes it.
 */
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { UnitKind } from '../unit/contract.js';

/** Where a built line comes from: a line of a test file, and the unit it belongs to. Paths are absolute. */
export type LineOrigin = { kind: 'test'; file: string; line: number; unit?: string };

export interface BuiltFile {
  /** Path in the skill folder, with `/`. */
  file: string;
  text: string;
  /** Where each line of `text` comes from. */
  origins: LineOrigin[];
  /** The build found a problem in this file, so it is not compared or written. */
  broken: boolean;
}

export interface BuildProblem {
  /** Absolute path of the file the problem is in: a test file or a record. */
  file: string;
  line: number;
  message: string;
  unit?: string;
}

/** A unit of the built skill. */
export interface BuiltUnit {
  id: string;
  kind: UnitKind | null;
  /** `test`: a test proves it; `declared`: it was declared with no body, so no test does. */
  from: 'test' | 'declared';
  /** The `setup()` of its file: absolute test file and line. */
  setup: { file: string; line: number };
  /** What its declaration left. */
  state: 'passed' | 'failed';
  /** Where it is declared. */
  test: { file: string; line: number };
  /** From a failed test: the message of what failed. */
  error?: string;
  /** Path in the skill folder of the file the unit is built into, with `/`. */
  file: string;
}

export interface Build {
  files: BuiltFile[];
  units: BuiltUnit[];
  problems: BuildProblem[];
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

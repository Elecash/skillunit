/**
 * The units a built skill holds, found by their headings: `### rule: <id>`, `### decision: <id>`
 * or `### fact: <id>`, outside fenced blocks and the frontmatter. The test layer needs no more of
 * a file: the file a unit is in, for its questions, and the list of units, for the report.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listMarkdown } from '../files.js';
import type { UnitKind } from '../unit/contract.js';

/** A unit of a file of the skill, where its heading is. */
export interface UnitHeading {
  id: string;
  kind: UnitKind;
  /** From the skill folder, with `/`. */
  file: string;
  /** Line of the heading, from 1. */
  line: number;
}

const HEADING = /^#{1,6}\s+(rule|decision|fact):\s*(\S+?)\s*#*\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;

/** The unit headings of one Markdown file, in order. `file` is its path in the skill folder. */
export function unitHeadings(text: string, file: string): UnitHeading[] {
  const lines = text.split(/\r?\n/);
  const out: UnitHeading[] = [];
  let i = 0;
  // A leading YAML frontmatter block, `---` to `---` or `...`, is not Markdown.
  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((l, n) => n > 0 && (l.trim() === '---' || l.trim() === '...'));
    if (end > 0) i = end + 1;
  }
  let fence: string | null = null;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    const opens = FENCE.exec(line);
    if (opens) {
      const marker = opens[1]!;
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length).trim()) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const head = HEADING.exec(line);
    if (head) out.push({ kind: head[1] as UnitKind, id: head[2]!, file, line: i + 1 });
  }
  return out;
}

/** The units of every `.md` file under `dir`, in the order of the files. */
export function listUnits(dir: string): UnitHeading[] {
  const root = resolve(dir);
  return listMarkdown(root).flatMap((rel) => unitHeadings(readFileSync(join(root, rel), 'utf8'), rel));
}

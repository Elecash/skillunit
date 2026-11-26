/**
 * A unit declared in a test, as the skill holds it: the labelled format the decision model
 * tests read.
 *
 * ```md
 * ### fact: default-timeout
 *
 * When: the user asks how long a request waits by default.
 *
 * Value: 10 seconds (`timeout: 10000`), for every method.
 *
 * Unknown: tinyfetch has no separate connect timeout; say so instead of inventing one.
 * ```
 *
 * Labels go in the order of the code below. The blocks of a rule go under `Right`, those of a fact under
 * its `Value`, those of a decision under the path their region names: the regions first, in the
 * order of the test files, then the blocks of `u.example`.
 */
import { extname } from 'node:path';
import type { Region } from '../proof/regions.js';
import type { PassedUnit } from '../unit/contract.js';

/** A line of the rendered unit, and where it comes from: the declaration, or a region. */
export interface RenderedLine {
  text: string;
  /** Absolute path of the test file, and the line, the text comes from. */
  file: string;
  line: number;
}

export interface RenderProblem {
  /** Absolute path. */
  file: string;
  line: number;
  message: string;
}

/** Fence languages by the extension of a test file, where the two differ. */
const LANG_OF: Record<string, string> = { mjs: 'js', cjs: 'js', mts: 'ts', cts: 'ts', py: 'python', rb: 'ruby', rs: 'rust', kt: 'kotlin', sh: 'sh' };

export function fenceLang(file: string): string {
  const ext = extname(file).slice(1).toLowerCase();
  return LANG_OF[ext] ?? (ext || 'text');
}

/** One label paragraph: wrapped lines and runs of spaces read as one space, as the parser reads them. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

interface Block {
  lang: string;
  code: string;
  file: string;
  line: number;
}

/**
 * Renders a unit. `regions` are those whose id is the unit's own or starts with it and a dot, in
 * the order to show them. `file` of the record is absolute.
 */
export function renderUnit(record: PassedUnit & { abs: string }, regions: Region[], regionFile: (r: Region) => string): { lines: RenderedLine[]; problems: RenderProblem[] } {
  const lines: RenderedLine[] = [];
  const problems: RenderProblem[] = [];
  const at = (text: string, file = record.abs, line = record.line) => lines.push({ text, file, line });
  const blank = () => at('');
  const label = (name: string, text: string | undefined) => {
    if (text === undefined) return;
    blank();
    at(`${name}: ${flat(text)}`);
  };
  const fromRegion = (r: Region): Block => ({ lang: fenceLang(r.file), code: r.code, file: regionFile(r), line: r.line });
  const fence = (b: Block, indent = '') => {
    blank();
    const marker = fenceMarker(b.code);
    at(`${indent}${marker}${b.lang}`, b.file, b.line);
    for (const l of b.code.split('\n')) at(l ? indent + l : '', b.file, b.line);
    at(`${indent}${marker}`, b.file, b.line);
  };

  const own = regions.filter((r) => r.id === record.id || r.id.startsWith(`${record.id}.`));
  const examples: Block[] = record.examples.map((x) => ({ lang: x.lang, code: x.text.replace(/\r\n/g, '\n').replace(/\n+$/, ''), file: record.abs, line: record.line }));

  at(`### ${record.kind}: ${record.id}`);
  label('When', record.when);
  if (record.kind === 'rule') {
    label('Do', record.do);
    label('Even when', record.evenWhen);
    const blocks = [...own.map(fromRegion), ...examples];
    if (blocks.length) {
      blank();
      at('Right:');
      for (const b of blocks) fence(b);
    }
  } else if (record.kind === 'fact') {
    label('Value', record.value);
    for (const b of [...own.map(fromRegion), ...examples]) fence(b);
    label('Unknown', record.unknown);
  } else {
    blank();
    at(record.decide === undefined ? 'Decide:' : `Decide: ${flat(record.decide)}`);
    const paths = record.paths ?? [];
    for (const r of own) {
      const path = r.id.slice(record.id.length + 1);
      if (!paths.some((p) => p.path === path)) {
        const names = paths.map((p) => `\`skill:${record.id}.${p.path}\``).join(', ');
        problems.push({ file: regionFile(r), line: r.line, message: `the region \`skill:${r.id}\` names no path of the decision \`${record.id}\`; the example of a path is in the region \`skill:<id>.<path>\` (${names})` });
      }
    }
    paths.forEach((p) => {
      blank();
      at(`- **${p.path}** — ${flat(p.when)}`);
      for (const r of own.filter((r) => r.id === `${record.id}.${p.path}`)) fence(fromRegion(r), '  ');
    });
    label('Even when', record.evenWhen);
  }
  return { lines, problems };
}

/** A run of backticks longer than any the code starts a line with, and at least three. */
function fenceMarker(code: string): string {
  let n = 3;
  for (const m of code.matchAll(/^\s*(`{3,})/gm)) n = Math.max(n, m[1]!.length + 1);
  return '`'.repeat(n);
}

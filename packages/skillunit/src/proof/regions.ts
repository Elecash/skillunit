/**
 * Reads the regions of test files: the lines between a line containing `#region skill:<id>` and
 * the next line containing `#endregion` are the example of the fence flagged `proof=<id>`. The
 * markers are comments in the file's language (`// #region skill:x`, `# #region skill:x`,
 * `<!-- #region skill:x -->`); only the text on their lines matters.
 */

export interface Region {
  id: string;
  /** The test file, as given. */
  file: string;
  /** Line of the `#region` marker. */
  line: number;
  /** Line of the `#endregion` marker. */
  endLine: number;
  /**
   * The lines between the markers, blank lines at the start and the end left out, the
   * indentation they all share removed, and lines of only spaces made empty. Nothing else
   * changes: trailing spaces on a line of code stay.
   */
  code: string;
}

export interface RegionProblem {
  file: string;
  line: number;
  message: string;
}

export interface Regions {
  regions: Map<string, Region>;
  problems: RegionProblem[];
}

const REGION = /#region\b/;
const SKILL_REGION = /#region\s+skill:([A-Za-z0-9_.-]*)/;
const END = /#endregion\b/;

/** The regions of several files. An id found twice is reported at its second place. */
export function collectRegions(files: { file: string; text: string }[]): Regions {
  const regions = new Map<string, Region>();
  const problems: RegionProblem[] = [];
  for (const { file, text } of files) {
    const found = findRegions(text, file);
    problems.push(...found.problems);
    for (const region of found.regions) {
      const first = regions.get(region.id);
      if (first) {
        problems.push({ file, line: region.line, message: `the region \`skill:${region.id}\` is also at ${first.file}:${first.line}; each example comes from one region` });
      } else {
        regions.set(region.id, region);
      }
    }
  }
  return { regions, problems };
}

/** The `skill:` regions of one file, in order. Other `#region` blocks are left alone. */
export function findRegions(text: string, file: string): { regions: Region[]; problems: RegionProblem[] } {
  const lines = text.split(/\r?\n/);
  const regions: Region[] = [];
  const problems: RegionProblem[] = [];
  let open: { id: string; line: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (open) {
      if (REGION.test(line)) {
        problems.push({ file, line: i + 1, message: `a \`#region\` inside the region \`skill:${open.id}\` opened at line ${open.line}; regions do not nest, so close it with \`#endregion\` first` });
        open = null;
        continue;
      }
      if (!END.test(line)) continue;
      const code = dedent(lines.slice(open.line, i));
      if (!code) problems.push({ file, line: open.line, message: `the region \`skill:${open.id}\` is empty` });
      else regions.push({ id: open.id, file, line: open.line, endLine: i + 1, code });
      open = null;
      continue;
    }
    const start = SKILL_REGION.exec(line);
    if (!start) continue;
    if (!start[1]) {
      problems.push({ file, line: i + 1, message: '`#region skill:` needs the id of the example: `#region skill:<unit id>`' });
      continue;
    }
    open = { id: start[1], line: i + 1 };
  }
  if (open) problems.push({ file, line: open.line, message: `the region \`skill:${open.id}\` is never closed; end it with a line containing \`#endregion\`` });

  // An id twice in one file: the first is the region; the second is reported.
  const seen = new Map<string, Region>();
  const unique: Region[] = [];
  for (const region of regions) {
    const first = seen.get(region.id);
    if (first) {
      problems.push({ file, line: region.line, message: `the region \`skill:${region.id}\` is also at line ${first.line}; each example comes from one region` });
      continue;
    }
    seen.set(region.id, region);
    unique.push(region);
  }
  problems.sort((a, b) => a.line - b.line);
  return { regions: unique, problems };
}

/**
 * Leaves out blank lines at the start and the end, makes lines of only spaces or tabs empty,
 * and removes the leading whitespace every other line starts with. The shared part is compared
 * character by character, so a tab and spaces never stand for each other.
 */
export function dedent(lines: string[]): string {
  const out = lines.map((l) => (l.trim() ? l : ''));
  while (out.length && !out[0]) out.shift();
  while (out.length && !out.at(-1)) out.pop();
  let prefix: string | null = null;
  for (const line of out) {
    if (!line) continue;
    const lead = /^[ \t]*/.exec(line)![0];
    if (prefix === null) prefix = lead;
    else {
      let k = 0;
      while (k < prefix.length && k < lead.length && prefix[k] === lead[k]) k++;
      prefix = prefix.slice(0, k);
    }
    if (!prefix) break;
  }
  const n = prefix?.length ?? 0;
  return out.map((l) => l.slice(n)).join('\n');
}

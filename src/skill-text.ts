/**
 * Reads the text an agent would read: one file of the skill, optionally cut down to some of
 * its headings. The text is sent as written, with no reflowing or cleanup, so the tests see the
 * same markdown the agent sees, confusing parts included.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';

export function readSkillText(skillDir: string, file: string, sections: string[]): string {
  const source = readFileSync(join(skillDir, file), 'utf8');
  if (sections.length === 0) return source.trim();
  return sections.map((s) => sliceSection(source, s, file)).join('\n\n');
}

/**
 * Reads the other files the agent reads next to the one under test, whole, keyed by their path
 * in the skill folder. `all` means every `.md` file in the folder except `file`.
 */
export function readWithFiles(skillDir: string, file: string, withFiles: string[] | 'all'): Record<string, string> {
  const under = toPosix(normalize(file));
  const paths = withFiles === 'all' ? listMarkdown(skillDir).filter((p) => p !== under) : withFiles;
  const out: Record<string, string> = {};
  for (const p of paths) {
    const full = join(skillDir, p);
    if (!existsSync(full) || !statSync(full).isFile()) throw new Error(`\`with\` lists ${p}, which is not a file in the skill folder`);
    out[p] = readFileSync(full, 'utf8').trim();
  }
  return out;
}

/** Every `.md` file under `dir`, as sorted paths with `/`, skipping dot folders and node_modules. */
function listMarkdown(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, prefix)).sort()) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(join(dir, rel)).isDirectory()) out.push(...listMarkdown(dir, rel));
    else if (name.endsWith('.md')) out.push(rel);
  }
  return out;
}

const toPosix = (p: string) => p.split(sep).join('/');

/**
 * Returns the heading whose text equals `title` (any level, ignoring case) and everything
 * under it, up to the next heading of the same or a higher level.
 */
export function sliceSection(source: string, title: string, file: string): string {
  const lines = source.split('\n');
  const headings = findHeadings(lines);
  const wanted = title.trim().toLowerCase();

  const index = headings.findIndex((h) => h.text.toLowerCase() === wanted);
  if (index < 0) {
    const list = headings.map((h) => `  ${'#'.repeat(h.level)} ${h.text}`).join('\n');
    throw new Error(`no heading "${title}" in ${file}. Headings in that file:\n${list}`);
  }

  const start = headings[index]!;
  const next = headings.slice(index + 1).find((h) => h.level <= start.level);
  return lines.slice(start.line, next ? next.line : lines.length).join('\n').trim();
}

interface Heading {
  line: number;
  level: number;
  text: string;
}

/** Markdown headings, skipping lines inside fenced code blocks (a `# comment` in a shell block). */
function findHeadings(lines: string[]): Heading[] {
  const out: Heading[] = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    const f = /^\s*(```+|~~~+)/.exec(line);
    if (f) {
      const marker = f[1]!;
      if (fence === null) fence = marker;
      else if (marker.startsWith(fence[0]!) && marker.length >= fence.length) fence = null;
      return;
    }
    if (fence !== null) return;
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (m) out.push({ line: i, level: m[1]!.length, text: m[2]! });
  });
  return out;
}

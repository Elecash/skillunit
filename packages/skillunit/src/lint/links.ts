/**
 * Lint item 7, the index: links to files resolve, every Markdown file is reachable from
 * `SKILL.md`, and a long file gets a warning. `#anchors` are not checked in v1.
 *
 * A reader also follows a path written as text, so a relative path to a Markdown file of the
 * skill, in a code span or in plain text, makes it reachable too (it is not checked as a link).
 * A folder below the skill folder with a `SKILL.md` of its own is a skill of its own: its files
 * are reached from that `SKILL.md`. A URL to a published page does not count.
 */
import { existsSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { codeSpans, type ParsedFile, type ParsedSkill } from '../units/index.js';
import type { Problem } from './types.js';

export const MAX_LINES = 300;

const INLINE_LINK = /!?\[(?:[^\]\\]|\\.)*\]\(\s*<?([^)\s>]+)>?(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
const REFERENCE_LINK = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$/;

interface Link {
  line: number;
  target: string;
}

export function index(skill: ParsedSkill): Problem[] {
  const out: Problem[] = [];
  const at = (file: string, line: number, message: string, severity: Problem['severity'] = 'error', rule: Problem['rule'] = 'index'): Problem => ({
    file,
    line,
    severity,
    rule,
    message,
  });
  const markdown = new Set(skill.files.map((f) => f.file));
  const edges = new Map<string, string[]>();

  for (const file of skill.files) {
    const targets: string[] = mentions(file, markdown);
    for (const link of links(file)) {
      const path = target(file.file, link.target);
      if (path === null) continue;
      if (!existsSync(join(skill.root, path))) {
        out.push(at(file.file, link.line, `the link to \`${link.target}\` does not resolve`));
      } else if (markdown.has(path)) {
        targets.push(path);
      }
    }
    edges.set(file.file, targets);
    const lines = file.text.split(/\r?\n/).length - (file.text.endsWith('\n') ? 1 : 0);
    if (lines > MAX_LINES) {
      out.push(at(file.file, 1, `${lines} lines; above about ${MAX_LINES}, look for a split into files of one task each`, 'warning', 'length'));
    }
  }

  if (!markdown.has('SKILL.md')) {
    out.push(at('SKILL.md', 1, 'the skill has no `SKILL.md`, so no file is reachable from an index'));
    return out;
  }
  const roots = skill.files.map((f) => f.file).filter(isIndex);
  const reached = new Set(roots);
  const queue = [...roots];
  while (queue.length) {
    for (const next of edges.get(queue.shift()!) ?? []) {
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  for (const file of skill.files) {
    if (reached.has(file.file)) continue;
    const from = nearestIndex(file.file, markdown);
    out.push(at(file.file, 1, `no link or path leads here from \`${from}\`; add this file to its index`));
  }
  return out;
}

const isIndex = (path: string) => path === 'SKILL.md' || path.endsWith('/SKILL.md');

/** The `SKILL.md` nearest above `path`, which is the index that should reach it. */
function nearestIndex(path: string, markdown: Set<string>): string {
  const parts = path.split('/');
  for (let n = parts.length - 1; n > 0; n--) {
    const index = [...parts.slice(0, n), 'SKILL.md'].join('/');
    if (markdown.has(index)) return index;
  }
  return 'SKILL.md';
}

/** A relative path to a Markdown file, as text: `rules/animations.md`, `./setup.md`, `../SKILL.md`. */
const MENTION = /(?<![\w/.:-])((?:\.{1,2}\/)*(?:[\w@-][\w@.-]*\/)*[\w@-][\w@.-]*\.md)(?![\w/-])/g;

/**
 * Markdown files of the skill that `file` names by a relative path in its text, code spans
 * included and fences left out. A path counts from the file's folder, from the folder of its
 * `SKILL.md`, or from the skill folder, whichever names a file of the skill.
 */
function mentions(file: ParsedFile, markdown: Set<string>): string[] {
  const lines = file.text.split(/\r?\n/);
  const hidden = new Set<number>();
  for (let i = 0; i < file.frontmatter; i++) hidden.add(i + 1);
  for (const f of file.fences) for (let l = f.line; l <= f.endLine; l++) hidden.add(l);
  const index = nearestIndex(file.file, markdown);
  const bases = [dirname(file.file), dirname(index), '.'];
  const out = new Set<string>();
  lines.forEach((line, i) => {
    if (hidden.has(i + 1)) return;
    for (const m of line.matchAll(MENTION)) {
      for (const base of bases) {
        const path = normalize(join(base, m[1]!)).split(sep).join('/');
        if (markdown.has(path) && path !== file.file) {
          out.add(path);
          break;
        }
      }
    }
  });
  return [...out];
}

/** Links in the file's Markdown text: not in frontmatter, fences or code spans. */
function links(file: ParsedFile): Link[] {
  const lines = file.text.split(/\r?\n/);
  const hidden = new Set<number>();
  for (let i = 0; i < file.frontmatter; i++) hidden.add(i + 1);
  for (const f of file.fences) for (let l = f.line; l <= f.endLine; l++) hidden.add(l);

  const out: Link[] = [];
  lines.forEach((raw, i) => {
    if (hidden.has(i + 1)) return;
    let line = raw;
    for (const span of codeSpans(raw)) line = line.replace(span.raw, ' '.repeat(span.raw.length));
    for (const m of line.matchAll(INLINE_LINK)) out.push({ line: i + 1, target: m[1]! });
    const ref = REFERENCE_LINK.exec(line);
    if (ref) out.push({ line: i + 1, target: ref[1]! });
  });
  return out;
}

/**
 * Path of a link target in the skill folder, with `/`, or null for links this check skips: URLs,
 * `mailto:`, anchors in the same file and absolute paths.
 */
function target(from: string, link: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('#') || link.startsWith('/')) return null;
  let path = link.replace(/[#?].*$/, '');
  try {
    path = decodeURI(path);
  } catch {
    // keep it as written
  }
  if (!path) return null;
  return normalize(join(dirname(from), path)).split(sep).join('/');
}

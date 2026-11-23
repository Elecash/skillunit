/**
 * Parses the units of a skill. A unit is a `### rule|decision|fact: <id>` heading followed by
 * labels, up to the next heading. Each label is a paragraph: `Label:` and its text, which may
 * wrap onto the following lines. Blank lines carry no meaning, so a unit reads the same before
 * and after a formatter such as Prettier.
 *
 * The parser only reads: it reports what it cannot make sense of (`errors`) and leaves the rules
 * of the format (required labels, order, placement) to lint, which reads `labels`, `headings`
 * and the fence owners.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listMarkdown } from '../files.js';
import {
  FOOTER_LABELS,
  LABELS,
  type Check,
  type Fence,
  type FenceOwner,
  type InlineCode,
  type InlineOwner,
  type LabelLine,
  type LabelName,
  type ParsedFile,
  type ParsedSkill,
  type ParseError,
  type ProofLabel,
  type SourceRef,
  type Unit,
  type UnitKind,
} from './types.js';

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const UNIT_HEAD = /^(rule|decision|fact):\s*(.*)$/;
const ID = /^[A-Za-z0-9_-]+$/;
const LABEL = new RegExp(`^(${LABELS.join('|')}):(?:\\s+(.*)|\\s*)$`);
/** A list item at the top level: up to one space of indentation, then `-`, `*` or `+`. */
const LIST_ITEM = /^ ?[-*+]\s+(.*)$/;
const NESTED_ITEM = /^\s{2,}[-*+]\s/;
const DOING = /^Doing:\s*(.*)$/;
const BECAUSE = /^Because:\s*(.*)$/;
const DECIDE_PATH = /^\*\*([^*]+)\*\*\s+[—–-]\s+(.*)$/;
const SETUP = /^Setup:\s*(.*)$/;
/** Long language names, read as the short ones so the type-check and `Check … in ts` see them. */
const LANG_ALIASES: Record<string, string> = { typescript: 'ts', javascript: 'js' };

/** Parses every `.md` file under `dir`, skipping dot folders and node_modules. */
export function parseSkill(dir: string): ParsedSkill {
  const root = resolve(dir);
  const files = listMarkdown(root).map((rel) => parseFile(readFileSync(join(root, rel), 'utf8'), rel));
  return {
    root,
    files,
    units: files.flatMap((f) => f.units),
    errors: files.flatMap((f) => f.errors),
  };
}

/** Parses one Markdown file. `file` is its path in the skill folder, used in every result. */
export function parseFile(text: string, file: string): ParsedFile {
  return new FileParser(text, file).parse();
}

/**
 * Lines of a leading YAML frontmatter block (`---` to `---` or `...`), or 0 when there is none.
 * Its text is not Markdown: no headings, labels or examples in it.
 */
export function frontmatterLength(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t === '---' || t === '...') return i + 1;
  }
  return 0;
}

// ---------------------------------------------------------------- fences

interface RawFence {
  start: number;
  end: number;
  indent: number;
  info: string;
  code: string;
  closed: boolean;
}

/**
 * Finds every fenced block first, so headings and labels inside code are never read as
 * structure. A fence opens with three or more backticks or tildes, at any indentation (fences
 * inside list items are indented), and closes with a run of the same character at least as
 * long, with nothing after it.
 */
function findFences(lines: string[]): RawFence[] {
  const out: RawFence[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[i]!);
    if (!open) continue;
    const [, indent, marker, info] = open as unknown as [string, string, string, string];
    if (marker[0] === '`' && info.includes('`')) continue; // inline code, not a fence
    let end = i + 1;
    let closed = false;
    for (; end < lines.length; end++) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(lines[end]!);
      if (close && close[1]![0] === marker[0] && close[1]!.length >= marker.length) {
        closed = true;
        break;
      }
    }
    const body = lines.slice(i + 1, closed ? end : lines.length);
    const code = body.map((l) => stripIndent(l, indent.length)).join('\n');
    out.push({ start: i, end: closed ? end : lines.length - 1, indent: indent.length, info: info.trim(), code, closed });
    i = end;
  }
  return out;
}

function stripIndent(line: string, n: number): string {
  let k = 0;
  while (k < n && line[k] === ' ') k++;
  return line.slice(k);
}

// ---------------------------------------------------------------- inline code

/** Inline code spans of one line, CommonMark style: a backtick run closed by a run of the same length. */
export function codeSpans(line: string): { column: number; code: string; raw: string }[] {
  const out: { column: number; code: string; raw: string }[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] !== '`') {
      i++;
      continue;
    }
    let n = 0;
    while (line[i + n] === '`') n++;
    const run = '`'.repeat(n);
    let j = i + n;
    let close = -1;
    while (j < line.length) {
      const k = line.indexOf(run, j);
      if (k < 0) break;
      if (line[k + n] !== '`' && line[k - 1] !== '`') {
        close = k;
        break;
      }
      j = k + 1;
      while (line[j] === '`') j++;
    }
    if (close < 0) {
      i += n;
      continue;
    }
    let code = line.slice(i + n, close);
    if (code.length >= 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
    out.push({ column: i + 1, code, raw: line.slice(i, close + n) });
    i = close + n;
  }
  return out;
}

// ---------------------------------------------------------------- the parser

/** The list item the parser is in, if any. `ignore` swallows the lines of a malformed item. */
type Item = { kind: 'wrong'; index: number } | { kind: 'decide'; index: number } | { kind: 'right' } | { kind: 'ignore' };

/** What the current paragraph belongs to: wrapped lines are joined to it. */
type Para =
  | { kind: 'label'; label: LabelLine }
  | { kind: 'doing' | 'because' | 'decide'; index: number }
  | { kind: 'right' }
  | { kind: 'ignore' };

const isFooter = (name: LabelName) => (FOOTER_LABELS as readonly string[]).includes(name);

class FileParser {
  private readonly lines: string[];
  private readonly result: ParsedFile;
  private readonly fenceAt = new Map<number, RawFence>();

  private section: string | null = null;
  private unit: Unit | null = null;
  private label: LabelName | null = null;
  private item: Item | null = null;
  private para: Para | null = null;
  /** The previous line inside the unit was blank. */
  private blank = false;
  /** The current label was indented into a list item; the next indented label is too. */
  private indentedLabel = false;
  /** Line index of a `Setup:` label still waiting for its fence. */
  private pendingSetup: number | null = null;

  constructor(
    text: string,
    private readonly file: string,
  ) {
    this.lines = text.split(/\r?\n/);
    // Frontmatter is blanked, not removed, so line numbers stay those of the file.
    const front = frontmatterLength(this.lines);
    for (let i = 0; i < front; i++) this.lines[i] = '';
    this.result = { file, text, frontmatter: front, units: [], fences: [], inlineCode: [], setup: {}, wrongCode: [], headings: [], errors: [] };
  }

  parse(): ParsedFile {
    for (const f of findFences(this.lines)) this.fenceAt.set(f.start, f);

    for (let i = 0; i < this.lines.length; i++) {
      const raw = this.fenceAt.get(i);
      if (raw) {
        this.onFence(raw);
        i = raw.end;
        continue;
      }
      const line = this.lines[i]!;
      const heading = HEADING.exec(line);
      if (heading) this.onHeading(i, heading[1]!.length, heading[2]!);
      else if (this.unit) this.onUnitLine(i, line);
      else this.onProseLine(i, line);
    }
    this.closeUnit();
    this.closeSetup();
    return this.result;
  }

  private error(index: number, message: string) {
    const e: ParseError = { file: this.file, line: index + 1, message };
    if (this.unit) e.unit = this.unit.id;
    this.result.errors.push(e);
  }

  // ---------------------------------------------------------------- headings and units

  private onHeading(i: number, level: number, text: string) {
    this.closeUnit();
    this.closeSetup();
    this.result.headings.push({ line: i + 1, level, text });
    if (level === 2) this.section = text;

    const head = UNIT_HEAD.exec(text);
    if (!head) return;
    const kind = head[1] as UnitKind;
    const id = head[2]!.trim();
    if (level !== 3) {
      this.error(i, `a unit heading must be level 3 (\`### ${kind}: ${id}\`), not level ${level}`);
      return;
    }
    if (!ID.test(id)) {
      this.error(i, `"${id}" is not a valid unit id: use letters, digits and hyphens, with no spaces`);
      return;
    }
    this.unit = {
      id,
      kind,
      file: this.file,
      line: i + 1,
      endLine: i + 1,
      section: this.section,
      labels: [],
      decide: [],
      right: [],
      wrong: [],
      skipped: 0,
      applies: [],
      check: [],
      source: [],
      proofs: [],
      text: '',
    };
    this.label = null;
    this.item = null;
    this.para = null;
    this.blank = false;
  }

  private closeUnit() {
    const u = this.unit;
    if (!u) return;
    // Walk to the next heading, skipping fences, and keep the last non-blank line before it.
    let end = u.line - 1;
    for (let k = u.line; k < this.lines.length && !HEADING.test(this.lines[k]!); k++) {
      const f = this.fenceAt.get(k);
      if (f) {
        end = f.end;
        k = f.end;
        continue;
      }
      if (this.lines[k]!.trim()) end = k;
    }
    u.endLine = end + 1;
    u.text = this.lines.slice(u.line - 1, u.endLine).join('\n');

    for (const l of u.labels) this.applyLabel(u, l);

    u.wrong.forEach((w, index) => {
      const spans = codeSpans(w.doing);
      const only = spans.length === 1 && spans[0]!.raw === w.doing ? spans[0]! : null;
      if (!only) return;
      w.code = {
        type: 'inline',
        file: this.file,
        line: w.line,
        column: Math.max(0, this.lines[w.line - 1]!.indexOf(only.raw)) + 1,
        code: only.code,
        owner: { kind: 'unit', unit: u.id, label: 'Wrong', item: index },
      };
      this.result.wrongCode.push({ unit: u.id, item: index, code: w.code });
    });
    this.result.units.push(u);
    this.unit = null;
  }

  /** Copies a label's text, complete once its paragraph has ended, to the unit's fields. */
  private applyLabel(u: Unit, l: LabelLine) {
    switch (l.name) {
      case 'When':
        u.when = l.value;
        break;
      case 'Do':
        u.do = l.value;
        break;
      case 'Value':
        u.value = l.value;
        break;
      case 'Unknown':
        u.unknown = l.value;
        break;
      case 'Even when':
        u.evenWhen = l.value;
        break;
      case 'Decide':
        if (l.value) u.decideText = l.value;
        break;
      case 'Applies':
        u.applies = splitList(l.value);
        break;
      case 'Source':
        u.source = splitList(l.value).map(parseSource);
        break;
      case 'Proof':
        u.proof = parseProof(l.value, l.line);
        break;
      case 'Check': {
        const check = parseCheck(l.value, l.line);
        if (typeof check === 'string') {
          this.error(l.line - 1, check);
        } else {
          // The regex is the first code span of the label's text; usually on the label's own line.
          check.column = codeSpans(this.lines[l.line - 1]!)[0]?.column ?? 1;
          u.check.push(check);
        }
        break;
      }
      case 'Right':
      case 'Wrong':
        break;
    }
  }

  // ---------------------------------------------------------------- prose

  private onProseLine(i: number, line: string) {
    const setup = SETUP.exec(line);
    if (setup) {
      this.closeSetup();
      if (setup[1]) this.error(i, '`Setup:` stands alone on its line, with the fenced block on the next lines');
      this.pendingSetup = i;
      return;
    }
    if (line.trim() && this.pendingSetup !== null) this.closeSetup();
    this.collectInline(i, line, { kind: 'reference' });
  }

  /** Reports a `Setup:` label that is not followed by a fence. */
  private closeSetup() {
    if (this.pendingSetup === null) return;
    const at = this.pendingSetup;
    this.pendingSetup = null;
    this.error(at, '`Setup:` must be followed by a fenced block');
  }

  // ---------------------------------------------------------------- fences

  private onFence(raw: RawFence) {
    if (!raw.closed) this.error(raw.start, 'this fenced block is never closed');
    const [lang = '', ...flags] = raw.info.split(/\s+/).filter(Boolean);
    const fence: Fence = {
      type: 'fence',
      file: this.file,
      line: raw.start + 1,
      endLine: raw.end + 1,
      lang: LANG_ALIASES[lang.toLowerCase()] ?? lang.toLowerCase(),
      flags,
      code: raw.code,
      owner: { kind: 'reference' },
    };
    const proof = proofFlag(flags);
    if (proof !== undefined) fence.proof = proof;

    if (this.pendingSetup !== null) {
      this.pendingSetup = null;
      fence.owner = { kind: 'setup' };
      if (!fence.lang) this.error(raw.start, 'a `Setup` block needs a language after the opening fence');
      else this.result.setup[fence.lang] ??= fence;
    } else if (this.unit) {
      fence.owner = this.unitFenceOwner(raw, fence);
      if (fence.proof !== undefined) this.unit.proofs.push(fence);
      // A fence ends the paragraph before it; a line after it starts a new one.
      this.para = null;
      this.blank = true;
    }
    this.result.fences.push(fence);
  }

  private unitFenceOwner(raw: RawFence, fence: Fence): FenceOwner {
    const u = this.unit!;
    // The item was reported once already; its code is not an example of anything.
    if (this.item?.kind === 'ignore' && raw.indent >= 2) return { kind: 'skipped', unit: u.id };
    const misplaced = (message: string): FenceOwner => {
      this.error(raw.start, message);
      return { kind: 'misplaced', unit: u.id, label: this.label };
    };
    if (this.label === 'Right') {
      u.right.push(fence);
      return { kind: 'right', unit: u.id };
    }
    if (this.label === 'Wrong') {
      if (this.item?.kind !== 'wrong' || raw.indent < 2) {
        return misplaced('a fenced block under `Wrong` goes inside a `- Doing:` item, indented');
      }
      u.wrong[this.item.index]!.fences.push(fence);
      return { kind: 'wrong', unit: u.id, item: this.item.index };
    }
    if (this.label === 'Decide') {
      if (this.item?.kind !== 'decide' || raw.indent < 2) {
        return misplaced('a fenced block under `Decide` goes inside a `- **path** — condition` item, indented');
      }
      const path = u.decide[this.item.index]!;
      path.fences.push(fence);
      return { kind: 'decide', unit: u.id, path: path.id };
    }
    const where = this.label ? `\`${this.label}\`` : 'the unit heading';
    return misplaced(`fenced blocks go under \`Right\`, \`Wrong\` or \`Decide\`, not under ${where}`);
  }

  // ---------------------------------------------------------------- lines inside a unit

  private onUnitLine(i: number, line: string) {
    if (!line.trim()) {
      this.blank = true;
      this.para = null;
      return;
    }
    const afterBlank = this.blank;
    this.blank = false;
    const indent = line.length - line.trimStart().length;
    const text = line.trim();
    const indentedLabel = this.indentedLabel && !afterBlank;
    this.indentedLabel = false;

    if (NESTED_ITEM.test(line)) {
      this.error(i, 'lists go one level deep');
      this.para = { kind: 'ignore' };
      return;
    }

    if (indent < 2) {
      const label = LABEL.exec(text);
      if (label) {
        const name = label[1] as LabelName;
        if (this.item && !afterBlank) {
          this.error(i, `leave a blank line between the list and \`${name}:\`; without it, Markdown reads the label as part of the last list item`);
        }
        this.startLabel(i, name, label[2] ?? '', line, !afterBlank && this.para?.kind === 'label');
        return;
      }
      const item = LIST_ITEM.exec(line);
      if (item) {
        this.onListItem(i, item[1]!, line);
        return;
      }
      if (SETUP.test(text)) {
        this.error(i, '`Setup` goes in the prose part of the file, before the first example, not inside a unit');
        this.para = { kind: 'ignore' };
        return;
      }
      // An unindented `Because:` right after `Doing:` still belongs to the item (a lazy line).
      if (!afterBlank && this.para?.kind === 'doing' && BECAUSE.test(text)) {
        this.startBecause(i, text, line, true);
        return;
      }
      if (!afterBlank && this.para) {
        this.continuePara(i, line);
        return;
      }
      this.error(i, `this paragraph is not a label; a unit holds only labels (${LABELS.join(', ')})`);
      this.para = { kind: 'ignore' };
      return;
    }

    // Indented: inside a list item, or the wrapped text of a label.
    if (this.item?.kind === 'wrong' && BECAUSE.test(text)) {
      this.startBecause(i, text, line, !afterBlank);
      return;
    }
    const label = (this.item && this.item.kind !== 'ignore') || indentedLabel ? LABEL.exec(text) : null;
    if (label) {
      const name = label[1] as LabelName;
      this.error(i, `\`${name}:\` is indented into the list item above it; start it at the beginning of the line, after a blank line`);
      this.startLabel(i, name, label[2] ?? '', line, false);
      this.indentedLabel = true;
      return;
    }
    if (!afterBlank && this.para) {
      this.continuePara(i, line);
      return;
    }
    if (this.item?.kind === 'ignore') return;
    if (this.item?.kind === 'right') {
      this.para = { kind: 'right' };
      this.unit!.right.push(...this.collectInline(i, line, { kind: 'unit', unit: this.unit!.id, label: 'Right' }));
      return;
    }
    this.error(
      i,
      this.item?.kind === 'wrong'
        ? 'a `Wrong` item holds a `Doing:` paragraph, a `Because:` paragraph and fenced blocks, nothing else'
        : this.item?.kind === 'decide'
          ? 'a `Decide` path holds its condition and fenced blocks, nothing else'
          : 'indented text outside a list item',
    );
    this.para = { kind: 'ignore' };
  }

  private startLabel(i: number, name: LabelName, value: string, line: string, joined: boolean) {
    const u = this.unit!;
    if (name !== 'Check' && u.labels.some((l) => l.name === name)) {
      this.error(i, `\`${name}\` appears twice in this unit`);
    }
    const label: LabelLine = { name, line: i + 1, value: value.trim(), part: isFooter(name) ? 'footer' : 'body', joined };
    u.labels.push(label);
    this.label = name;
    this.item = null;
    this.para = { kind: 'label', label };

    if (name === 'Wrong' && label.value) {
      this.error(i, '`Wrong:` takes a list of `- Doing:` items on the next lines, not text on the same line');
    }
    if (name === 'Check') return; // the regex span is not an example
    const found = this.collectInline(i, line, { kind: 'unit', unit: u.id, label: name });
    if (name === 'Right') u.right.push(...found);
  }

  private startBecause(i: number, text: string, line: string, joined: boolean) {
    const item = this.item as { kind: 'wrong'; index: number };
    const w = this.unit!.wrong[item.index]!;
    if (w.becauseLine !== undefined) this.error(i, 'this `Wrong` item already has a `Because:` line');
    w.because = BECAUSE.exec(text)![1]!.trim();
    w.becauseLine = i + 1;
    w.becauseJoined = joined;
    this.para = { kind: 'because', index: item.index };
    this.collectInline(i, line, { kind: 'unit', unit: this.unit!.id, label: 'Wrong', item: item.index });
  }

  private onListItem(i: number, content: string, line: string) {
    const u = this.unit!;
    if (this.label === 'Wrong') {
      const doing = DOING.exec(content);
      if (!doing) {
        this.error(i, 'an item under `Wrong` starts with `Doing:`');
        u.skipped++;
        this.item = { kind: 'ignore' };
        this.para = { kind: 'ignore' };
        return;
      }
      u.wrong.push({ line: i + 1, doing: doing[1]!.trim(), because: '', becauseJoined: false, code: null, fences: [] });
      const index = u.wrong.length - 1;
      this.item = { kind: 'wrong', index };
      this.para = { kind: 'doing', index };
      this.collectInline(i, line, { kind: 'unit', unit: u.id, label: 'Wrong', item: index });
      return;
    }
    if (this.label === 'Decide') {
      const path = DECIDE_PATH.exec(content);
      if (!path) {
        this.error(i, 'a path under `Decide` reads `- **path** — condition`');
        u.skipped++;
        this.item = { kind: 'ignore' };
        this.para = { kind: 'ignore' };
        return;
      }
      u.decide.push({ id: path[1]!.trim(), condition: path[2]!.trim(), line: i + 1, fences: [] });
      const index = u.decide.length - 1;
      this.item = { kind: 'decide', index };
      this.para = { kind: 'decide', index };
      this.collectInline(i, line, { kind: 'unit', unit: u.id, label: 'Decide' });
      return;
    }
    if (this.label === 'Right') {
      this.item = { kind: 'right' };
      this.para = { kind: 'right' };
      u.right.push(...this.collectInline(i, line, { kind: 'unit', unit: u.id, label: 'Right' }));
      return;
    }
    const where = this.label ? `\`${this.label}\`` : 'the unit heading';
    this.error(i, `only \`Right\`, \`Wrong\` and \`Decide\` take a list, not ${where}`);
    this.item = { kind: 'ignore' };
    this.para = { kind: 'ignore' };
  }

  /** A wrapped line of the current paragraph: joined to its text with a space. */
  private continuePara(i: number, line: string) {
    const u = this.unit!;
    const para = this.para!;
    const text = line.trim();
    const join = (a: string) => (a ? `${a} ${text}` : text);
    switch (para.kind) {
      case 'label': {
        para.label.value = join(para.label.value);
        if (para.label.name === 'Check') return;
        const found = this.collectInline(i, line, { kind: 'unit', unit: u.id, label: para.label.name });
        if (para.label.name === 'Right') u.right.push(...found);
        return;
      }
      case 'doing':
      case 'because': {
        const w = u.wrong[para.index]!;
        if (para.kind === 'doing') w.doing = join(w.doing);
        else w.because = join(w.because);
        this.collectInline(i, line, { kind: 'unit', unit: u.id, label: 'Wrong', item: para.index });
        return;
      }
      case 'decide':
        u.decide[para.index]!.condition = join(u.decide[para.index]!.condition);
        this.collectInline(i, line, { kind: 'unit', unit: u.id, label: 'Decide' });
        return;
      case 'right':
        u.right.push(...this.collectInline(i, line, { kind: 'unit', unit: u.id, label: 'Right' }));
        return;
      case 'ignore':
        return;
    }
  }

  // ---------------------------------------------------------------- helpers

  private collectInline(i: number, line: string, owner: InlineOwner): InlineCode[] {
    const found = codeSpans(line).map(
      (s): InlineCode => ({ type: 'inline', file: this.file, line: i + 1, column: s.column, code: s.code, owner }),
    );
    this.result.inlineCode.push(...found);
    return found;
  }
}

/** `a, b, c`, with backticks around a name allowed. */
function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim().replace(/^`(.*)`$/, '$1').trim())
    .filter(Boolean);
}

function parseSource(value: string): SourceRef {
  const hash = value.indexOf('#');
  if (hash < 0) return { path: value };
  const symbol = value.slice(hash + 1).trim();
  return symbol ? { path: value.slice(0, hash).trim(), symbol } : { path: value.slice(0, hash).trim() };
}

/** The value of the first `proof=` flag of a fence, with quotes around it taken off. */
export function proofFlag(flags: string[]): string | undefined {
  const flag = flags.find((f) => f.startsWith('proof='));
  if (flag === undefined) return undefined;
  const value = flag.slice('proof='.length);
  return /^(["'])(.*)\1$/.exec(value)?.[2] ?? value;
}

/** `none`, then an optional reason after a comma, a dash or a space: `none, a recommendation`. */
const PROOF_NONE = /^none(?![\w-])[\s,;:.—–-]*(.*)$/s;

export function parseProof(value: string, line: number): ProofLabel {
  const raw = value.trim();
  const none = PROOF_NONE.exec(raw);
  return { line, raw, none: !!none, reason: none?.[1]!.trim() ?? '' };
}

const CHECK_FORMAT = '`Check` reads ``forbid `/regex/` in <languages>``';

/**
 * Parses the text after `Check:`: ``forbid `/regex/flags` in ts, tsx``. Returns the error
 * message when it does not parse. `column` is left at 1; the caller knows the line.
 */
export function parseCheck(value: string, line: number): Check | string {
  const text = value.trim();
  const head = /^(\S+)\s+(.*)$/.exec(text);
  if (!head) return CHECK_FORMAT;
  const [, mode, rest] = head as unknown as [string, string, string];
  if (mode === 'require') return '`require` is not supported; v1 of `Check` has only `forbid`';
  if (mode !== 'forbid') return CHECK_FORMAT;

  const span = codeSpans(rest)[0];
  if (!span || span.column !== 1) {
    return rest.startsWith('/')
      ? 'put the regex of a `Check` in backticks, as in ``forbid `/regex/` in ts``: outside a code span, Markdown reads `*` and `_` as emphasis and a formatter rewrites them'
      : CHECK_FORMAT;
  }
  const re = /^\/(.*)\/([a-z]*)$/s.exec(span.code);
  const langs = /^\s+in\s+(.+)$/.exec(rest.slice(span.raw.length));
  if (!re || !langs) return CHECK_FORMAT;
  const [, source, flags] = re as unknown as [string, string, string];
  if (/[gy]/.test(flags)) return 'a `Check` regex cannot use the flags `g` or `y`: they keep state between matches, so the same text can match once and fail the next time';

  let regex: RegExp;
  try {
    regex = new RegExp(source, flags);
  } catch (e) {
    return `\`Check\` has an invalid regex: ${(e as Error).message}`;
  }
  const list = langs[1]!
    .split(',')
    .map((l) => l.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return '`Check` needs at least one language after `in`';
  return { mode: 'forbid', regex, langs: list, line, raw: text, column: 1 };
}

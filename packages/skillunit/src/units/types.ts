/**
 * What the parser returns for a skill written in units. See docs/style-guide.md (today
 * lab/runes/STYLE.md) for the format. Every line number is 1-based and every path is relative to
 * the skill folder, with `/`.
 */

export type UnitKind = 'rule' | 'decision' | 'fact';

/** The labels, in the one order every kind follows. `Check` is for lint, not for the agent, and goes last. */
export const LABELS = ['When', 'Do', 'Decide', 'Value', 'Unknown', 'Even when', 'Right', 'Check'] as const;

export type LabelName = (typeof LABELS)[number];

/** A label as it appears in the unit, in order, so lint can check order and placement. */
export interface LabelLine {
  name: LabelName;
  line: number;
  /** The label's text: its paragraph after `Label:`, wrapped lines joined with a space. */
  value: string;
  /** The label sits in the same paragraph as the label before it, with no blank line between. */
  joined: boolean;
}

/** Who a fenced block belongs to. Lint decides from this what must compile and what must not. */
export type FenceOwner =
  /** The fence after a `Setup:` label. It is not an example. */
  | { kind: 'setup' }
  /** A fence outside any unit. */
  | { kind: 'reference' }
  | { kind: 'right'; unit: string }
  /** A block under the `Value` of a fact: what the fact's test produced, or an example of the value. */
  | { kind: 'value'; unit: string }
  /** `path` is the id of the `Decide` path the fence sits in. */
  | { kind: 'decide'; unit: string; path: string }
  /** A fence under a label that takes no code. The parser also reports it as an error. */
  | { kind: 'misplaced'; unit: string; label: LabelName | null }
  /** A fence inside a list item the parser reported as malformed and skipped. Nothing checks it. */
  | { kind: 'skipped'; unit: string };

export interface Fence {
  type: 'fence';
  file: string;
  /** Line of the opening fence. */
  line: number;
  /** Line of the closing fence, or the last line of the file when it is never closed. */
  endLine: number;
  /**
   * First word of the info string, lowercased (`ts`, `tsx`, `sh`), or '' when there is none.
   * `typescript` and `javascript` read as `ts` and `js`.
   */
  lang: string;
  /** The other words of the info string, such as `no-check`. */
  flags: string[];
  /** The code between the fences, with the fence's own indentation removed. */
  code: string;
  owner: FenceOwner;
}

/** Who an inline code span belongs to. */
export type InlineOwner = { kind: 'reference' } | { kind: 'unit'; unit: string; label: LabelName | null };

export interface InlineCode {
  type: 'inline';
  file: string;
  line: number;
  /** 1-based column of the opening backtick. */
  column: number;
  code: string;
  owner: InlineOwner;
}

export interface DecidePath {
  /** The bold label of the path: `- **cache** — …` gives `cache`. */
  id: string;
  condition: string;
  line: number;
  fences: Fence[];
}

export interface Check {
  /** v1 has only `forbid`. */
  mode: 'forbid';
  regex: RegExp;
  /** Fence languages the check runs on, lowercased. */
  langs: string[];
  line: number;
  /** The text after `Check:`, as written. */
  raw: string;
  /** 1-based column of the regex's code span on `line`. */
  column: number;
}

export interface Unit {
  id: string;
  kind: UnitKind;
  file: string;
  /** Line of the `### kind: id` heading. */
  line: number;
  /** Last non-blank line of the unit. */
  endLine: number;
  /** Text of the `##` heading the unit sits under, or null before any. */
  section: string | null;
  labels: LabelLine[];

  when?: string;
  do?: string;
  /** Text after `Decide:` on its own line, if any. The paths are in `decide`. */
  decideText?: string;
  decide: DecidePath[];
  value?: string;
  unknown?: string;
  evenWhen?: string;
  /** Fences and inline code spans under `Right`. */
  right: (Fence | InlineCode)[];
  /** `Decide` or `Right` items the parser reported as malformed and skipped. */
  skipped: number;

  check: Check[];
  /** Fences under the `Value` of a fact. */
  valueFences: Fence[];

  /** The unit as written, heading to `endLine`. */
  text: string;
}

export interface Heading {
  line: number;
  level: number;
  text: string;
}

export interface ParseError {
  file: string;
  line: number;
  /** The unit the line belongs to, if any. */
  unit?: string;
  message: string;
}

export interface ParsedFile {
  file: string;
  /** The file as read. Lint reads links and line counts from it. */
  text: string;
  /** Lines of the leading frontmatter block, 0 when there is none. */
  frontmatter: number;
  units: Unit[];
  /** Every fenced block of the file, in order, `Setup` blocks included. */
  fences: Fence[];
  /** Every inline code span outside fences, frontmatter and `Check` lines, in order. */
  inlineCode: InlineCode[];
  /** The first `Setup` block of each language. Lint reports any further ones. */
  setup: Record<string, Fence>;
  headings: Heading[];
  errors: ParseError[];
}

export interface ParsedSkill {
  /** Absolute path of the skill folder. */
  root: string;
  files: ParsedFile[];
  units: Unit[];
  errors: ParseError[];
}

/**
 * What the parser returns for a skill written in units. See docs/style-guide.md (today
 * lab/runes/STYLE.md) for the format. Every line number is 1-based and every path is relative to
 * the skill folder, with `/`.
 */

export type UnitKind = 'rule' | 'decision' | 'fact';

/** Body labels in the one order every kind follows. */
export const BODY_LABELS = ['When', 'Do', 'Decide', 'Value', 'Unknown', 'Even when', 'Right', 'Wrong'] as const;
export const FOOTER_LABELS = ['Applies', 'Check', 'Source', 'Proof'] as const;
export const LABELS = [...BODY_LABELS, ...FOOTER_LABELS] as const;

export type LabelName = (typeof LABELS)[number];

/** A label as it appears in the unit, in order, so lint can check order and placement. */
export interface LabelLine {
  name: LabelName;
  line: number;
  /** The label's text: its paragraph after `Label:`, wrapped lines joined with a space. */
  value: string;
  /** Set by the name: `Applies`, `Check`, `Source` and `Proof` are footer, the rest body. */
  part: 'body' | 'footer';
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
  /** `item` is the index in `Unit.wrong`. */
  | { kind: 'wrong'; unit: string; item: number }
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
  /**
   * The value of the first `proof=<id>` flag, quotes taken off: a test produced this block. ''
   * for a bare `proof=`. Lint checks that it names the fence's own unit.
   */
  proof?: string;
  /** The code between the fences, with the fence's own indentation removed. */
  code: string;
  owner: FenceOwner;
}

/** Who an inline code span belongs to. `Check` regexes skip spans in `Wrong` items. */
export type InlineOwner =
  | { kind: 'reference' }
  | { kind: 'unit'; unit: string; label: LabelName | null; item?: number };

export interface InlineCode {
  type: 'inline';
  file: string;
  line: number;
  /** 1-based column of the opening backtick. */
  column: number;
  code: string;
  owner: InlineOwner;
}

export interface WrongItem {
  line: number;
  doing: string;
  /** '' when the item has no `Because:` line. Lint reports that. */
  because: string;
  becauseLine?: number;
  /** `Because:` sits in the same paragraph as `Doing:`, with no blank line between. */
  becauseJoined: boolean;
  /** Set when `Doing` is one code span and nothing else. */
  code: InlineCode | null;
  /** Fences inside the item. */
  fences: Fence[];
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

/** The `Proof:` label of a unit. v1 takes only `none`, with an optional reason after it. */
export interface ProofLabel {
  line: number;
  /** The label's text, as written. */
  raw: string;
  /** The text is `none`, or `none` and a reason. Lint reports any other text. */
  none: boolean;
  /** What follows `none`, punctuation before it taken off; '' when there is none. */
  reason: string;
}

export interface SourceRef {
  path: string;
  /** The part after `#`. v1 of sync ignores it. */
  symbol?: string;
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
  wrong: WrongItem[];
  /** `Wrong`, `Decide` or `Right` items the parser reported as malformed and skipped. */
  skipped: number;

  applies: string[];
  check: Check[];
  source: SourceRef[];
  /** The `Proof:` label, if any. */
  proof?: ProofLabel;
  /** Fences of the unit with a `proof=` flag, in order, whatever label or list item they are in. */
  proofs: Fence[];

  /** The unit as written, heading to `endLine`. Sync compares it across commits. */
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
  /** Every `Wrong` item whose `Doing` is one code span and nothing else. */
  wrongCode: { unit: string; item: number; code: InlineCode }[];
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

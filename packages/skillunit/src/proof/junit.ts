/**
 * Reads a JUnit XML report: every `testcase`, its title and whether it passed, failed or was
 * skipped, and the units it proves, from the `[skill:<id>]` tags in its title. Vitest, Jest (with
 * jest-junit), pytest and most other runners write this format. A small reader of our own: the
 * format needs elements, attributes, text, CDATA and the XML entities, and nothing else.
 */

export type TestStatus = 'passed' | 'failed' | 'skipped';

export interface TestCase {
  /** The report the test was read from, as given. */
  report: string;
  /** Line of the `<testcase>` in the report. */
  line: number;
  name: string;
  /** The test's file, class or suite, as the runner writes it. Kept for messages. */
  classname: string;
  /** `failure` or `error` makes it failed, `skipped` skipped; anything else passed. */
  status: TestStatus;
  /** The first line of the failure, error or skip message, when there is one. */
  message?: string;
  /** Unit ids from the `[skill:<id>]` tags in `classname` and `name`, in order, each once. */
  tags: string[];
}

/** The report is not well-formed XML. */
export class ReportError extends Error {
  constructor(
    readonly file: string,
    readonly line: number,
    message: string,
  ) {
    super(`${file}:${line}: ${message}`);
  }
}

const TAG = /\[skill:([^\]\s]*)\]/g;

/**
 * The unit ids a test title names, in order, each once. A tag with nothing after `skill:` gives
 * '', so the caller can report it.
 */
export function skillTags(title: string): string[] {
  return [...new Set([...title.matchAll(TAG)].map((m) => m[1]!))];
}

/** Every `testcase` of a JUnit XML report, nested suites included, in document order. */
export function parseJUnit(xml: string, file: string): TestCase[] {
  return readJUnit(xml, file).cases;
}

export interface JUnitReport {
  cases: TestCase[];
  /**
   * The earliest `timestamp` of a `testsuite`: when the run started. `zoned` is false when the
   * runner wrote no time zone; the time is then read as UTC, which may be off by hours.
   */
  started?: { ms: number; zoned: boolean };
}

/** The cases of a report, and when its run started. */
export function readJUnit(xml: string, file: string): JUnitReport {
  const cases: TestCase[] = [];
  let started: JUnitReport['started'];
  const stack: string[] = [];
  let current: TestCase | null = null;
  /** The `failure`, `error` or `skipped` element being read, for its text. */
  let result: { status: TestStatus; text: string; message?: string } | null = null;

  const lines = lineStarts(xml);
  const lineAt = (pos: number) => lineOf(lines, pos);
  const fail = (pos: number, message: string): never => {
    throw new ReportError(file, lineAt(pos), message);
  };

  const finishResult = () => {
    if (!current || !result) return;
    // A failure or an error wins over a skip; the first message of the winning kind is kept.
    const wins = result.status === 'failed' ? current.status !== 'failed' : current.status === 'passed';
    if (wins) {
      current.status = result.status;
      const message = firstLine(result.message ?? '') || firstLine(result.text);
      if (message) current.message = message;
      else delete current.message;
    }
    result = null;
  };

  let pos = 0;
  while (pos < xml.length) {
    const lt = xml.indexOf('<', pos);
    const text = xml.slice(pos, lt < 0 ? xml.length : lt);
    if (result && text) result.text += decode(text);
    if (lt < 0) break;

    if (xml.startsWith('<!--', lt)) {
      pos = skipTo(xml, lt, '-->', () => fail(lt, 'a comment is never closed'));
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt);
      if (end < 0) fail(lt, 'a CDATA section is never closed');
      if (result) result.text += xml.slice(lt + 9, end);
      pos = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      pos = skipTo(xml, lt, '?>', () => fail(lt, 'a processing instruction is never closed'));
      continue;
    }
    if (xml.startsWith('<!', lt)) {
      // A DOCTYPE, with an internal subset in brackets or without.
      const bracket = xml.indexOf('[', lt);
      const close = xml.indexOf('>', lt);
      pos = bracket >= 0 && bracket < close ? skipTo(xml, bracket, ']>', () => fail(lt, 'a DOCTYPE is never closed')) : skipTo(xml, lt, '>', () => fail(lt, 'a DOCTYPE is never closed'));
      continue;
    }

    const tag = readTag(xml, lt, fail);
    pos = tag.end;
    if (tag.closing) {
      const open = stack.pop();
      if (open !== tag.name) fail(lt, open ? `\`</${tag.name}>\` closes \`<${open}>\`` : `\`</${tag.name}>\` closes nothing`);
      if (isResult(tag.name)) finishResult();
      if (tag.name === 'testcase' && current) {
        cases.push(current);
        current = null;
      }
      continue;
    }

    if (tag.name === 'testsuite' && tag.attrs.timestamp) {
      const time = readTimestamp(tag.attrs.timestamp);
      if (time && (!started || time.ms < started.ms)) started = time;
    }
    if (tag.name === 'testcase') {
      if (current) fail(lt, 'a `testcase` inside another `testcase`');
      const name = tag.attrs.name ?? '';
      const classname = tag.attrs.classname ?? '';
      current = { report: file, line: lineAt(lt), name, classname, status: 'passed', tags: skillTags(`${classname} ${name}`) };
    } else if (current && isResult(tag.name) && stack.at(-1) === 'testcase') {
      result = { status: tag.name === 'skipped' ? 'skipped' : 'failed', text: '' };
      if (tag.attrs.message !== undefined) result.message = tag.attrs.message;
    }

    if (tag.selfClosing) {
      if (isResult(tag.name) && result) finishResult();
      if (tag.name === 'testcase' && current) {
        cases.push(current);
        current = null;
      }
    } else {
      stack.push(tag.name);
    }
  }
  if (stack.length) fail(xml.length, `the report ends inside \`<${stack.at(-1)}>\`; was it cut short?`);
  return started ? { cases, started } : { cases };
}

/** An ISO 8601 time, with or without a zone. A time with no zone is read as UTC. */
function readTimestamp(value: string): { ms: number; zoned: boolean } | undefined {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?)(Z|[+-]\d\d:?\d\d)?$/.exec(value.trim());
  if (!m) return undefined;
  const ms = Date.parse(m[2] ? value.trim() : `${m[1]}Z`);
  return Number.isNaN(ms) ? undefined : { ms, zoned: Boolean(m[2]) };
}

const isResult = (name: string) => name === 'failure' || name === 'error' || name === 'skipped';

function skipTo(xml: string, from: number, end: string, onMissing: () => never): number {
  const at = xml.indexOf(end, from);
  if (at < 0) onMissing();
  return at + end.length;
}

interface Tag {
  name: string;
  attrs: Record<string, string>;
  closing: boolean;
  selfClosing: boolean;
  /** Position after the `>`. */
  end: number;
}

/** Reads `<name a="1" b='2'>`, `<name/>` or `</name>` at `lt`. A `>` inside a quoted value is text. */
function readTag(xml: string, lt: number, fail: (pos: number, message: string) => never): Tag {
  let i = lt + 1;
  const closing = xml[i] === '/';
  if (closing) i++;
  const nameMatch = /^[A-Za-z_][\w.:-]*/.exec(xml.slice(i, i + 200));
  if (!nameMatch) fail(lt, 'a `<` that starts no tag; write it as `&lt;`');
  const name = nameMatch![0];
  i += name.length;
  const attrs: Record<string, string> = {};
  for (;;) {
    while (/\s/.test(xml[i] ?? '')) i++;
    if (i >= xml.length) fail(lt, `\`<${name}\` is never closed`);
    if (xml[i] === '>') return { name, attrs, closing, selfClosing: false, end: i + 1 };
    if (xml.startsWith('/>', i) && !closing) return { name, attrs, closing, selfClosing: true, end: i + 2 };
    const attr = /^([A-Za-z_][\w.:-]*)\s*=\s*(["'])/.exec(xml.slice(i, i + 200));
    if (!attr || closing) fail(i, `cannot read the attributes of \`<${name}>\``);
    const quote = attr![2]!;
    const start = i + attr![0].length;
    const end = xml.indexOf(quote, start);
    if (end < 0) fail(i, `the value of \`${attr![1]}\` is never closed`);
    attrs[attr![1]!] = decode(xml.slice(start, end));
    i = end + 1;
  }
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** Decodes the five XML entities and character references. Any other `&name;` stays as it is. */
export function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, ref: string) => {
    if (ref[0] !== '#') return NAMED[ref] ?? whole;
    const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

function firstLine(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean) ?? '';
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], pos: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

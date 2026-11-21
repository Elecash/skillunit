/**
 * An example's own declaration wins over the `Setup`. A skill in prose mixes fragments, which
 * need the `Setup`, with complete examples that import and create the same names themselves;
 * with the whole `Setup` in front, those fail with "Duplicate identifier" and "Cannot redeclare".
 *
 * So the `Setup` put in front of one example leaves out what declares a name the example
 * declares at its top level: one specifier of an import (the whole import when none is left),
 * one declarator of a `const`, or a whole function, class, enum, type, interface or namespace.
 * By name only, whatever the kind. What is left out is blanked, every line break kept, so a
 * diagnostic stays on its line. An example or a `Setup` that does not parse gets the whole
 * `Setup`, as before.
 */
import { parse, type ParserOptions, type ParserPlugin } from '@babel/parser';
import type { TsBlock } from './tsc.js';

type Lang = TsBlock['lang'];

/** The few fields of a Babel node read here. */
interface Node {
  type: string;
  start?: number | null;
  end?: number | null;
  [key: string]: unknown;
}

/** The `Setup` to put in front of `code`: as written, less the declarations `code` makes itself. */
export function setupFor(setup: string, code: string, lang: Lang): string {
  const example = statements(code, lang);
  if (!example) return setup;
  const names = new Set(example.flatMap(bound));
  if (names.size === 0) return setup;
  const own = statements(setup, lang);
  if (!own) return setup;
  const cuts = own.flatMap((s) => cutsOf(s, names, setup));
  return cuts.length ? blank(setup, cuts) : setup;
}

const parsed = new Map<string, Node[] | null>();

/** The top-level statements of `code`, or null when it does not parse. */
function statements(code: string, lang: Lang): Node[] | null {
  const key = `${lang}\0${code}`;
  if (!parsed.has(key)) {
    let body: Node[] | null;
    try {
      body = parse(code, options(lang)).program.body as unknown as Node[];
    } catch {
      body = null;
    }
    if (parsed.size > 500) parsed.clear();
    parsed.set(key, body);
  }
  return parsed.get(key)!;
}

/**
 * As `tsc` reads an example: a module, with a top-level `return` or `await` allowed. `errorRecovery`
 * lets through what `tsc` reports itself, such as a name declared twice.
 */
function options(lang: Lang): ParserOptions {
  const plugins: ParserPlugin[] = [];
  if (lang === 'ts' || lang === 'tsx') plugins.push('typescript');
  if (lang !== 'ts') plugins.push('jsx');
  plugins.push('decorators', 'decoratorAutoAccessors');
  return {
    sourceType: 'module',
    plugins,
    errorRecovery: true,
    attachComment: false,
    allowReturnOutsideFunction: true,
    allowAwaitOutsideFunction: true,
    allowNewTargetOutsideFunction: true,
    allowUndeclaredExports: true,
  };
}

/** A statement's declaration, through `export`. */
function declarationOf(statement: Node): Node {
  const inner = statement.declaration as Node | null | undefined;
  return (statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration') && inner ? inner : statement;
}

/** The names a top-level statement declares. */
function bound(statement: Node): string[] {
  const node = declarationOf(statement);
  switch (node.type) {
    case 'ImportDeclaration':
      return (node.specifiers as Node[]).map((s) => name(s.local));
    case 'VariableDeclaration':
      return (node.declarations as Node[]).flatMap((d) => patternNames(d.id as Node));
    case 'TSModuleDeclaration':
      return node.kind === 'global' || (node.id as Node).type === 'StringLiteral' ? [] : [leftmost(node.id as Node)];
    case 'TSImportEqualsDeclaration':
    case 'FunctionDeclaration':
    case 'TSDeclareFunction':
    case 'ClassDeclaration':
    case 'TSEnumDeclaration':
    case 'TSTypeAliasDeclaration':
    case 'TSInterfaceDeclaration':
      return node.id ? [name(node.id)] : [];
    default:
      return [];
  }
}

const name = (node: unknown) => ((node as Node | null)?.name as string | undefined) ?? '';

/** `a` of `namespace a.b.c`. */
function leftmost(node: Node): string {
  return node.type === 'TSQualifiedName' ? leftmost(node.left as Node) : name(node);
}

/** The names a binding pattern declares: `a`, `{ a, b: c, ...d }`, `[e, f = 1]`. */
function patternNames(node: Node | null): string[] {
  if (!node) return [];
  switch (node.type) {
    case 'Identifier':
      return [name(node)];
    case 'ObjectPattern':
      return (node.properties as Node[]).flatMap((p) => patternNames(p.type === 'RestElement' ? (p.argument as Node) : (p.value as Node)));
    case 'ArrayPattern':
      return (node.elements as (Node | null)[]).flatMap(patternNames);
    case 'AssignmentPattern':
      return patternNames(node.left as Node);
    case 'RestElement':
      return patternNames(node.argument as Node);
    default:
      return [];
  }
}

type Range = [number, number];
const range = (node: Node): Range => [node.start ?? 0, node.end ?? 0];

/** What to blank in one statement of the `Setup`. */
function cutsOf(statement: Node, names: Set<string>, text: string): Range[] {
  const node = declarationOf(statement);
  const whole = [range(statement)];
  if (node.type === 'ImportDeclaration') {
    // A side-effect import declares nothing, and stays.
    return items(node.specifiers as Node[], (s) => names.has(name(s.local)), whole, text);
  }
  if (node.type === 'VariableDeclaration') {
    return items(node.declarations as Node[], (d) => patternNames(d.id as Node).some((n) => names.has(n)), whole, text);
  }
  return bound(statement).some((n) => names.has(n)) ? whole : [];
}

/**
 * The items of a list to leave out (`a` of `import { a, b }`, of `declare const a: A, b: B`),
 * each with one comma next to it so what is left still parses; the whole statement when none is
 * left.
 */
function items(list: Node[], out: (item: Node) => boolean, whole: Range[], text: string): Range[] {
  const gone = list.filter(out);
  if (gone.length === 0) return [];
  if (gone.length === list.length) return whole;
  return gone.map((item) => {
    const [start, to] = range(item);
    let from = start;
    let after = to;
    while (/\s/.test(text[after] ?? '')) after++;
    if (text[after] === ',') return [from, after + 1] as Range;
    let before = from - 1;
    while (before >= 0 && /\s/.test(text[before]!)) before--;
    if (text[before] === ',') from = before;
    return [from, to] as Range;
  });
}

/** `text` with every character of the ranges but line breaks turned into a space. */
function blank(text: string, ranges: Range[]): string {
  // Babel's offsets count UTF-16 code units, as `split('')` does.
  const chars = text.split('');
  for (const [from, to] of ranges) for (let i = from; i < to; i++) if (chars[i] !== '\n' && chars[i] !== '\r') chars[i] = ' ';
  return chars.join('');
}

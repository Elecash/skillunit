/**
 * The fingerprint of a unit's `Source`: the first 16 hex characters of a SHA-256 of the code it
 * points to, with comments and layout left out. A Source is a file, a folder, or `path#name`, one
 * top-level declaration of a file. No git and no lock file are involved.
 *
 * - A JavaScript or TypeScript file is read through @babel/parser: its tokens without the
 *   comments, joined by one space. A comment-only edit or a reformat that keeps the tokens keeps
 *   the fingerprint; a formatter that changes tokens (quotes, trailing commas, semicolons) changes
 *   it. `//` inside a string, a template literal or a regular expression is part of a token.
 * - Any other file, or a code file the parser cannot read, has only its whitespace normalised:
 *   every run of whitespace becomes one space. The result lists the code files that fell back,
 *   so lint can say their comments count.
 * - Line endings are made `\n` first, so a CRLF checkout agrees with an LF one, even inside a
 *   template literal that spans lines.
 * - `path#name` takes every top-level declaration called `name` (a function with its overloads, a
 *   class, a `const`, `let` or `var`, an interface, a type, an enum, a namespace; exported or
 *   not), so a change elsewhere in the file leaves it as it was. It does not follow the helpers
 *   it calls.
 * - A folder is the fingerprint of the sorted list of its files' paths and fingerprints,
 *   skipping dot folders and `node_modules`.
 *
 * Changing any of this changes every fingerprint, so it is frozen by the lock file's `version`.
 */
import { parse, type ParseResult, type ParserOptions, type ParserPlugin } from '@babel/parser';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import type { SourceRef } from '../units/types.js';

export type FingerprintResult =
  | { ok: true; fingerprint: string; unparsed: Unparsed[] }
  | { ok: false; reason: FingerprintError; message: string };

/** A code file the parser could not read, so only its whitespace was normalised. */
export interface Unparsed {
  /** The `Source` path, or a file under it for a folder, with `/` between folders. */
  file: string;
  error: string;
}

/**
 * - `missing`: the path is neither a file nor a folder.
 * - `missing-symbol`: the file has no top-level declaration with that name.
 * - `re-exported`: the file only re-exports the name, or exports another declaration under it.
 * - `symbol-in-folder`: `#name` after a folder.
 * - `unparsable`: `#name` after a file that is not code, or that the parser cannot read.
 */
export type FingerprintError = 'missing' | 'missing-symbol' | 're-exported' | 'symbol-in-folder' | 'unparsable';

/** Extensions whose comments are left out. */
export const CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

/** The fingerprint of `source`, whose path is relative to `root`. */
export function fingerprint(source: SourceRef, root: string): FingerprintResult {
  const path = resolve(root, source.path);
  const stat = statSync(path, { throwIfNoEntry: false });
  const fail = (reason: FingerprintError, message: string): FingerprintResult => ({ ok: false, reason, message });
  if (!stat || (!stat.isFile() && !stat.isDirectory())) return fail('missing', `${source.path} does not exist`);
  if (stat.isDirectory()) {
    if (source.symbol) return fail('symbol-in-folder', `${source.path} is a folder, so \`#${source.symbol}\` names nothing`);
    const unparsed: Unparsed[] = [];
    const prefix = source.path.replace(/[\\/]+$/, '');
    const entries = folderEntries(path, (file, error) => unparsed.push({ file: `${prefix}/${file}`, error }));
    return { ok: true, fingerprint: hash(JSON.stringify(entries)), unparsed };
  }
  if (!source.symbol) {
    const unparsed: Unparsed[] = [];
    const print = fileFingerprint(path, (error) => unparsed.push({ file: source.path, error }));
    return { ok: true, fingerprint: print, unparsed };
  }

  const text = decode(readFileSync(path));
  if (text === null || !isCode(path)) {
    return fail('unparsable', `${source.path} is not a JavaScript or TypeScript file, so \`#${source.symbol}\` cannot be found in it`);
  }
  const parsed = parseCode(text, path);
  if ('error' in parsed) return fail('unparsable', `${source.path} could not be parsed, so \`#${source.symbol}\` cannot be found: ${parsed.error}`);
  const parts = declarations(parsed.ast, source.symbol);
  if (!parts.length) {
    const reexport = reexported(parsed.ast, source.symbol);
    if (reexport) return fail('re-exported', reexportMessage(source.path, source.symbol, reexport, parsed.ast));
    return fail('missing-symbol', `${source.path} has no top-level declaration \`${source.symbol}\``);
  }
  return { ok: true, fingerprint: hash(parts.map((ranges) => words(text, parsed.ast.tokens ?? [], ranges)).join(' ')), unparsed: [] };
}

/**
 * The fingerprint of one file, at an absolute or working-directory path. `onUnparsed` hears about
 * a code file the parser could not read.
 */
export function fileFingerprint(path: string, onUnparsed?: (error: string) => void): string {
  const bytes = readFileSync(path);
  const text = decode(bytes);
  return text === null ? hash(bytes) : hash(normalizeText(text, path, onUnparsed));
}

/**
 * The text a file's fingerprint is taken from: the tokens without comments for a code file that
 * parses, every run of whitespace made one space otherwise. `file` only decides by its extension.
 */
export function normalizeText(text: string, file: string, onUnparsed?: (error: string) => void): string {
  const lf = toLf(text);
  if (isCode(file)) {
    const parsed = parseCode(lf, file);
    if (!('error' in parsed)) return words(lf, parsed.ast.tokens ?? [], [[0, lf.length]]);
    onUnparsed?.(parsed.error);
  }
  return lf.replace(/\s+/g, ' ').trim();
}

/** `\r\n` and a lone `\r` made `\n`. */
const toLf = (text: string) => text.replace(/\r\n?/g, '\n');

const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex').slice(0, 16);

const isCode = (file: string) => CODE_EXTENSIONS.includes(extname(file).toLowerCase());

/**
 * The text of a UTF-8 file with `\n` line endings, or null for bytes that are not UTF-8, whose
 * fingerprint is of the raw bytes.
 */
function decode(bytes: Buffer): string | null {
  try {
    return toLf(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}

/** `[path, fingerprint]` of every file under `dir`, sorted by path, with `/` between folders. */
function folderEntries(dir: string, onUnparsed: (file: string, error: string) => void): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (abs: string, rel: string) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const absPath = join(abs, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      // A link counts as what it points to, except a linked folder, which is skipped so a cycle cannot loop.
      const isFile = entry.isFile() || (entry.isSymbolicLink() && statSync(absPath, { throwIfNoEntry: false })?.isFile());
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') walk(absPath, relPath);
      } else if (isFile) {
        out.push([relPath, fileFingerprint(absPath, (error) => onUnparsed(relPath, error))]);
      }
    }
  };
  walk(dir, '');
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

// ---- Parsing ----

type Ast = ParseResult;
type Statement = Ast['program']['body'][number];
type Token = { type: string | { label: string }; start: number; end: number };
type Range = [number, number];

function parseCode(text: string, file: string): { ast: Ast } | { error: string } {
  try {
    return { ast: parse(text, parserOptions(file)) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * TypeScript files get the `typescript` plugin; `.tsx` and the JavaScript ones get `jsx` too. A
 * `.ts` file cannot have it: `<T>x` is a type assertion there, and JSX would fail on it. Every
 * code file gets `decorators` and `decoratorAutoAccessors`, without which Babel 8 reads no
 * decorator at all. `errorRecovery` keeps going past the errors it can, such as strict-mode ones
 * in a script or a TypeScript parameter decorator.
 */
function parserOptions(file: string): ParserOptions {
  const ext = extname(file).toLowerCase();
  const ts = ['.ts', '.tsx', '.mts', '.cts'].includes(ext);
  const plugins: ParserPlugin[] = [];
  if (ts) plugins.push(['typescript', { dts: /\.d\.[mc]?ts$/i.test(file) }]);
  if (!['.ts', '.mts', '.cts'].includes(ext)) plugins.push('jsx');
  plugins.push('decorators', 'decoratorAutoAccessors');
  const sourceType = ext === '.cjs' || ext === '.cts' ? 'commonjs' : ext === '.js' || ext === '.jsx' ? 'unambiguous' : 'module';
  return { sourceType, plugins, tokens: true, errorRecovery: true, attachComment: false };
}

/**
 * The tokens inside `ranges`, without comments, joined by one space. JSX text has its whitespace
 * normalised, since a reformat rewraps it.
 */
function words(text: string, tokens: Token[], ranges: Range[]): string {
  const out: string[] = [];
  for (const token of tokens) {
    if (!ranges.some(([from, to]) => token.start >= from && token.end <= to)) continue;
    const kind = typeof token.type === 'string' ? token.type : token.type.label;
    if (kind === 'CommentLine' || kind === 'CommentBlock' || kind === 'eof') continue;
    const word = kind === 'jsxText' ? text.slice(token.start, token.end).replace(/\s+/g, ' ').trim() : text.slice(token.start, token.end);
    if (word) out.push(word);
  }
  return out.join(' ');
}

/**
 * The ranges of every top-level declaration called `name`, in file order; one entry per
 * declaration. A `const`, `let` or `var` with several declarators keeps only the keyword, its own
 * declarator and what follows the last one, so a change to a sibling leaves it as it was.
 */
function declarations(ast: Ast, name: string): Range[][] {
  const out: Range[][] = [];
  for (const statement of ast.program.body) {
    const inner = declarationOf(statement);
    if (!inner) continue;
    const start = Math.min(statement.start ?? 0, ...decoratorStarts(inner));
    const end = statement.end ?? 0;
    if (inner.type === 'VariableDeclaration') {
      const first = inner.declarations[0];
      const last = inner.declarations[inner.declarations.length - 1];
      for (const d of inner.declarations) {
        if (!boundNames(d.id).includes(name)) continue;
        out.push([
          [start, first?.start ?? start],
          [d.start ?? 0, d.end ?? 0],
          [last?.end ?? end, end],
        ]);
      }
    } else if (declaredName(inner) === name) {
      out.push([[start, end]]);
    }
  }
  return out;
}

type Declaration = Extract<
  Statement,
  {
    type:
      | 'FunctionDeclaration'
      | 'TSDeclareFunction'
      | 'ClassDeclaration'
      | 'VariableDeclaration'
      | 'TSInterfaceDeclaration'
      | 'TSTypeAliasDeclaration'
      | 'TSEnumDeclaration'
      | 'TSModuleDeclaration';
  }
>;

const DECLARATION_TYPES = new Set([
  'FunctionDeclaration',
  'TSDeclareFunction',
  'ClassDeclaration',
  'VariableDeclaration',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'TSEnumDeclaration',
  'TSModuleDeclaration',
]);

/** The declaration a top-level statement makes, looking inside `export` and `export default`. */
function declarationOf(statement: Statement): Declaration | null {
  const inner: { type: string } | null | undefined =
    statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration' ? statement.declaration : statement;
  return inner && DECLARATION_TYPES.has(inner.type) ? (inner as Declaration) : null;
}

/**
 * The name a declaration other than a variable makes. `namespace A.B {}` declares `A`;
 * `declare module 'x'` and `declare global` declare no name.
 */
function declaredName(node: Exclude<Declaration, { type: 'VariableDeclaration' }>): string | undefined {
  if (node.type !== 'TSModuleDeclaration') return node.id?.type === 'Identifier' ? node.id.name : undefined;
  if (node.kind === 'global') return undefined;
  let id: { type: string; name?: string; left?: unknown } = node.id;
  while (id.type === 'TSQualifiedName') id = id.left as typeof id;
  return id.type === 'Identifier' ? id.name : undefined;
}

/** How a file exports `name` without declaring it: `export { a as name }`, `… from`, `* as name from`. */
interface Reexport {
  /** The name it exports, which is not declared here. Absent for `export * as name`. */
  local?: string;
  /** The module after `from`, if any. */
  from?: string;
}

function reexported(ast: Ast, name: string): Reexport | null {
  for (const statement of ast.program.body) {
    if (statement.type !== 'ExportNamedDeclaration' || statement.declaration) continue;
    for (const specifier of statement.specifiers) {
      const exported = specifier.exported.type === 'Identifier' ? specifier.exported.name : specifier.exported.value;
      if (exported !== name) continue;
      const local = specifier.type === 'ExportSpecifier' ? (specifier.local.type === 'Identifier' ? specifier.local.name : specifier.local.value) : undefined;
      return { ...(local !== undefined ? { local } : {}), ...(statement.source ? { from: statement.source.value } : {}) };
    }
  }
  return null;
}

function reexportMessage(path: string, name: string, how: Reexport, ast: Ast): string {
  const point = 'point `Source` at the file that declares it';
  if (how.from) return `${path} re-exports \`${name}\` from ${how.from} and does not declare it; ${point}`;
  if (how.local && how.local !== name && declarations(ast, how.local).length) {
    return `${path} exports its declaration \`${how.local}\` under the name \`${name}\`; point \`Source\` at ${path}#${how.local}`;
  }
  return `${path} re-exports \`${name}\` and does not declare it; ${point}`;
}

function decoratorStarts(node: Declaration): number[] {
  const decorators = 'decorators' in node ? (node.decorators ?? []) : [];
  return decorators.map((d) => d.start ?? Infinity);
}

type Pattern = { type: string; [key: string]: unknown };

/** The names a declarator binds: `a`, or every name in a destructuring pattern. */
function boundNames(node: unknown): string[] {
  if (!node || typeof node !== 'object') return [];
  const p = node as Pattern;
  switch (p.type) {
    case 'Identifier':
      return [p.name as string];
    case 'ObjectPattern':
      return (p.properties as Pattern[]).flatMap((prop) => boundNames(prop.type === 'RestElement' ? prop.argument : prop.value));
    case 'ArrayPattern':
      return (p.elements as Pattern[]).flatMap(boundNames);
    case 'RestElement':
      return boundNames(p.argument);
    case 'AssignmentPattern':
      return boundNames(p.left);
    default:
      return [];
  }
}

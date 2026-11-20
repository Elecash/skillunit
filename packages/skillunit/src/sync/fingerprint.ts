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
 *   every run of whitespace becomes one space.
 * - `path#name` takes every top-level declaration called `name` (a function with its overloads, a
 *   class, a `const`, `let` or `var`, an interface, a type, an enum; exported or not), so a
 *   change elsewhere in the file leaves it as it was. It does not follow the helpers it calls.
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
  | { ok: true; fingerprint: string }
  | { ok: false; reason: FingerprintError; message: string };

/**
 * - `missing`: the path is neither a file nor a folder.
 * - `missing-symbol`: the file has no top-level declaration with that name.
 * - `symbol-in-folder`: `#name` after a folder.
 * - `unparsable`: `#name` after a code file the parser cannot read.
 */
export type FingerprintError = 'missing' | 'missing-symbol' | 'symbol-in-folder' | 'unparsable';

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
    return { ok: true, fingerprint: hash(JSON.stringify(folderEntries(path))) };
  }
  if (!source.symbol) return { ok: true, fingerprint: fileFingerprint(path) };

  const text = decode(readFileSync(path));
  if (text === null || !isCode(path)) {
    return fail('unparsable', `${source.path} is not a JavaScript or TypeScript file, so \`#${source.symbol}\` cannot be found in it`);
  }
  const parsed = parseCode(text, path);
  if ('error' in parsed) return fail('unparsable', `${source.path} could not be parsed, so \`#${source.symbol}\` cannot be found: ${parsed.error}`);
  const parts = declarations(parsed.ast, source.symbol);
  if (!parts.length) return fail('missing-symbol', `${source.path} has no top-level declaration \`${source.symbol}\``);
  return { ok: true, fingerprint: hash(parts.map((ranges) => words(text, parsed.ast.tokens ?? [], ranges)).join(' ')) };
}

/** The fingerprint of one file, at an absolute or working-directory path. */
export function fileFingerprint(path: string): string {
  const bytes = readFileSync(path);
  const text = decode(bytes);
  return text === null ? hash(bytes) : hash(normalizeText(text, path));
}

/**
 * The text a file's fingerprint is taken from: the tokens without comments for a code file that
 * parses, every run of whitespace made one space otherwise. `file` only decides by its extension.
 */
export function normalizeText(text: string, file: string): string {
  if (isCode(file)) {
    const parsed = parseCode(text, file);
    if (!('error' in parsed)) return words(text, parsed.ast.tokens ?? [], [[0, text.length]]);
  }
  return text.replace(/\s+/g, ' ').trim();
}

const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex').slice(0, 16);

const isCode = (file: string) => CODE_EXTENSIONS.includes(extname(file).toLowerCase());

/** The text of a UTF-8 file, or null for bytes that are not UTF-8, whose fingerprint is of the raw bytes. */
function decode(bytes: Buffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** `[path, fingerprint]` of every file under `dir`, sorted by path, with `/` between folders. */
function folderEntries(dir: string): Array<[string, string]> {
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
        out.push([relPath, fileFingerprint(absPath)]);
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
 * `.ts` file cannot have it: `<T>x` is a type assertion there, and JSX would fail on it.
 * `errorRecovery` keeps going past the errors it can, such as strict-mode ones in a script.
 */
function parserOptions(file: string): ParserOptions {
  const ext = extname(file).toLowerCase();
  const ts = ['.ts', '.tsx', '.mts', '.cts'].includes(ext);
  const plugins: ParserPlugin[] = [];
  if (ts) plugins.push(['typescript', { dts: /\.d\.[mc]?ts$/i.test(file) }]);
  if (!['.ts', '.mts', '.cts'].includes(ext)) plugins.push('jsx');
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
    } else if (inner.id?.type === 'Identifier' && inner.id.name === name) {
      out.push([[start, end]]);
    }
  }
  return out;
}

type Declaration = Extract<
  Statement,
  { type: 'FunctionDeclaration' | 'TSDeclareFunction' | 'ClassDeclaration' | 'VariableDeclaration' | 'TSInterfaceDeclaration' | 'TSTypeAliasDeclaration' | 'TSEnumDeclaration' }
>;

const DECLARATION_TYPES = new Set([
  'FunctionDeclaration',
  'TSDeclareFunction',
  'ClassDeclaration',
  'VariableDeclaration',
  'TSInterfaceDeclaration',
  'TSTypeAliasDeclaration',
  'TSEnumDeclaration',
]);

/** The declaration a top-level statement makes, looking inside `export` and `export default`. */
function declarationOf(statement: Statement): Declaration | null {
  const inner: { type: string } | null | undefined =
    statement.type === 'ExportNamedDeclaration' || statement.type === 'ExportDefaultDeclaration' ? statement.declaration : statement;
  return inner && DECLARATION_TYPES.has(inner.type) ? (inner as Declaration) : null;
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

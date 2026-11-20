import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { SourceRef } from '../units/types.js';
import { fingerprint, normalizeText, type FingerprintResult } from './fingerprint.js';

const roots: string[] = [];
afterAll(() => roots.forEach((r) => rmSync(r, { recursive: true, force: true })));

/** A new folder with `files` in it. */
function tree(files: Record<string, string | Buffer>): string {
  const root = mkdtempSync(join(tmpdir(), 'skillunit-fingerprint-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const ref = (source: string): SourceRef => {
  const [path, symbol] = source.split('#');
  return symbol ? { path: path!, symbol } : { path: path! };
};

/** The fingerprint of `source` in a folder holding only `file` with `text`. */
function of(text: string, source = 'src/a.ts'): string {
  const file = source.split('#')[0]!;
  return ok(fingerprint(ref(source), tree({ [file]: text })));
}

function ok(result: FingerprintResult): string {
  if (!result.ok) throw new Error(`expected a fingerprint, got ${result.reason}: ${result.message}`);
  expect(result.fingerprint).toMatch(/^[0-9a-f]{16}$/);
  return result.fingerprint;
}

const RETRY = `import { sleep } from './sleep.js';

/** Retries idempotent requests only. */
export function shouldRetry(method: string, attempt: number): boolean {
  // POST is not idempotent.
  if (method === 'POST') return false;
  return attempt < 3;
}

export function backoff(attempt: number): number {
  return 100 * 2 ** attempt;
}
`;

describe('file fingerprints', () => {
  it('is the same after a comment-only edit, a reformat and a reorder of blank lines', () => {
    const base = of(RETRY);
    const comments = RETRY.replace('/** Retries idempotent requests only. */', '/**\n * Retries only idempotent requests.\n * See RFC 9110.\n */')
      .replace('// POST is not idempotent.', '/* never POST */')
      .replace('attempt < 3;', 'attempt < 3; // three tries')
      .replace('(method: string,', '(/* the verb */ method: string,');
    const reformat = RETRY.replace(
      'export function shouldRetry(method: string, attempt: number): boolean {',
      'export function shouldRetry(\n    method: string,\n    attempt: number\n): boolean\n{',
    )
      .replace(/\n {2}/g, '\n\t')
      .replace('100 * 2 ** attempt', '100*2**attempt');
    const blankLines = RETRY.replace("from './sleep.js';\n\n", "from './sleep.js';\n").replace('}\n\nexport', '}\n\n\n\nexport') + '\n\n';
    expect(of(comments)).toBe(base);
    expect(of(reformat)).toBe(base);
    expect(of(blankLines)).toBe(base);
  });

  it('changes with a renamed variable', () => {
    expect(of(RETRY.replaceAll('attempt', 'tries'))).not.toBe(of(RETRY));
  });

  it('changes with any other token, quotes and trailing commas included', () => {
    expect(of(RETRY.replace("'POST'", '"POST"'))).not.toBe(of(RETRY));
    expect(of(RETRY.replace('attempt: number)', 'attempt: number,)'))).not.toBe(of(RETRY));
    expect(of(RETRY.replace('attempt < 3', 'attempt <= 3'))).not.toBe(of(RETRY));
  });

  it('does not read `//` or `/*` inside a string, a template literal or a regular expression as a comment', () => {
    const pairs = [
      ['const a = "// x";', 'const a = "// y";'],
      ["const a = '/* x */ b';", "const a = '/* y */ b';"],
      ['const a = `// x ${b} /* y */`;', 'const a = `// x ${b} /* z */`;'],
      ['const a = /\\/\\/ x/g;', 'const a = /\\/\\/ y/g;'],
      ['const a = b / 2; // c\nconst d = /x/;', 'const a = b / 2; // c\nconst d = /y/;'],
    ];
    for (const [one, two] of pairs) expect(of(one!), `${one} and ${two}`).not.toBe(of(two!));
    expect(normalizeText('const a = `// x ${b} y`; // gone', 'a.ts')).toBe('const a = `// x ${ b } y` ;');
  });

  it('keeps whitespace inside strings and template literals', () => {
    expect(of("const a = 'x  y';")).not.toBe(of("const a = 'x y';"));
    expect(of('const a = `x\n  y`;')).not.toBe(of('const a = `x y`;'));
  });

  it('reads every code extension, with JSX in .tsx and the JavaScript ones', () => {
    const jsx = 'export const A = () => <div className="a">{/* note */}hi</div>;';
    for (const ext of ['tsx', 'jsx', 'js', 'mjs', 'cjs']) {
      expect(normalizeText(jsx, `a.${ext}`), ext).toBe('export const A = ( ) => < div className = "a" > { } hi < / div > ;');
    }
    for (const ext of ['ts', 'mts', 'cts']) {
      expect(normalizeText('const a = <T>b; // c', `a.${ext}`), ext).toBe('const a = < T > b ;');
    }
    expect(normalizeText('module.exports = 1; return; // c', 'a.cjs')).toBe('module . exports = 1 ; return ;');
    expect(normalizeText('declare const a: number; // c', 'a.d.ts')).toBe('declare const a : number ;');
  });

  it('normalises only the whitespace of a file that is not JavaScript or TypeScript', () => {
    const md = '# Retries\n\nRetry  idempotent\nrequests. // not a comment here\n';
    expect(normalizeText(md, 'a.md')).toBe('# Retries Retry idempotent requests. // not a comment here');
    expect(of(md, 'docs/a.md')).toBe(of('# Retries Retry idempotent requests. // not a comment here', 'docs/a.md'));
    expect(of(md, 'docs/a.md')).not.toBe(of(md.replace('// not a comment here', '// changed'), 'docs/a.md'));
    expect(of('a: 1 # x\n', 'a.yaml')).not.toBe(of('a: 1 # y\n', 'a.yaml'));
  });

  it('falls back to whitespace only for a code file the parser cannot read', () => {
    const broken = 'export function f( {\n  return 1; // c\n';
    expect(normalizeText(broken, 'a.ts')).toBe('export function f( { return 1; // c');
    expect(of(broken)).toBe(of('export function f( { return 1; // c'));
  });

  it('lists a code file it could not parse, and nothing for one it could', () => {
    expect(fingerprint(ref('src/a.ts'), tree({ 'src/a.ts': 'export function f( {' }))).toMatchObject({
      ok: true,
      unparsed: [{ file: 'src/a.ts', error: expect.stringMatching(/\(1:\d+\)$/) }],
    });
    expect(fingerprint(ref('src/a.ts'), tree({ 'src/a.ts': RETRY }))).toMatchObject({ ok: true, unparsed: [] });
    expect(fingerprint(ref('docs/a.md'), tree({ 'docs/a.md': 'not ( code' }))).toMatchObject({ ok: true, unparsed: [] });
  });

  it('hashes the bytes of a file that is not UTF-8', () => {
    const root = tree({ 'a.bin': Buffer.from([0xff, 0xfe, 0x00, 0x20, 0x20]), 'b.bin': Buffer.from([0xff, 0xfe, 0x00, 0x20]) });
    expect(ok(fingerprint(ref('a.bin'), root))).not.toBe(ok(fingerprint(ref('b.bin'), root)));
  });

  it('reports a path that does not exist', () => {
    expect(fingerprint(ref('src/none.ts'), tree({}))).toEqual({ ok: false, reason: 'missing', message: 'src/none.ts does not exist' });
  });
});

describe('line endings', () => {
  const crlf = (text: string) => text.replace(/\n/g, '\r\n');
  const TEMPLATE = 'export const usage = `skillunit check\n  --dry-run`;\n\nexport function other() {\n  return 1;\n}\n';

  it('gives the same fingerprint with LF, CRLF and a lone CR, as a file and as a symbol', () => {
    for (const text of [RETRY, TEMPLATE]) {
      for (const source of ['src/a.ts', 'src/a.ts#other', 'src/a.ts#shouldRetry'].filter((s) => !s.includes('#') || text.includes(s.split('#')[1]!))) {
        expect(of(crlf(text), source), source).toBe(of(text, source));
        expect(of(text.replace(/\n/g, '\r'), source), source).toBe(of(text, source));
      }
    }
    expect(of(crlf(TEMPLATE), 'src/a.ts#usage')).toBe(of(TEMPLATE, 'src/a.ts#usage'));
  });

  it('keeps the line break inside a template literal as one `\\n`', () => {
    expect(normalizeText(crlf(TEMPLATE), 'a.ts')).toBe('export const usage = `skillunit check\n  --dry-run` ; export function other ( ) { return 1 ; }');
    expect(of(TEMPLATE.replace('check\n  --dry-run', 'check --dry-run'))).not.toBe(of(TEMPLATE));
  });

  it('gives the same fingerprint for CRLF in a file that is not code, a file that does not parse, and a folder', () => {
    const md = '# Retries\n\nRetry idempotent\nrequests.\n';
    expect(of(crlf(md), 'docs/a.md')).toBe(of(md, 'docs/a.md'));
    const broken = 'export function f( {\n  return `a\nb`;\n';
    expect(of(crlf(broken))).toBe(of(broken));
    const files = { 'lib/a.ts': TEMPLATE, 'lib/b.md': md };
    const crlfFiles = { 'lib/a.ts': crlf(TEMPLATE), 'lib/b.md': crlf(md) };
    expect(ok(fingerprint(ref('lib'), tree(crlfFiles)))).toBe(ok(fingerprint(ref('lib'), tree(files))));
  });
});

describe('symbol fingerprints', () => {
  it('leaves a symbol as it was after a change to another function, and changes the file', () => {
    const other = RETRY.replace('100 * 2 ** attempt', '200 * 2 ** attempt');
    expect(of(other, 'src/a.ts#shouldRetry')).toBe(of(RETRY, 'src/a.ts#shouldRetry'));
    expect(of(other)).not.toBe(of(RETRY));
    expect(of(other, 'src/a.ts#backoff')).not.toBe(of(RETRY, 'src/a.ts#backoff'));
  });

  it('changes with the symbol, and not with its comments or layout', () => {
    const base = of(RETRY, 'src/a.ts#shouldRetry');
    expect(of(RETRY.replace('attempt < 3', 'attempt < 5'), 'src/a.ts#shouldRetry')).not.toBe(base);
    expect(of(RETRY.replace('// POST is not idempotent.', '// POST and PATCH.'), 'src/a.ts#shouldRetry')).toBe(base);
    expect(of(RETRY.replace('/** Retries idempotent requests only. */', ''), 'src/a.ts#shouldRetry')).toBe(base);
  });

  it('is the declaration alone: moving it in the file leaves it as it was', () => {
    const moved = RETRY.replace(/\/\*\* Retries[\s\S]*?\n}\n\n/, '') + '\nexport function shouldRetry(method: string, attempt: number): boolean {\n  if (method === \'POST\') return false;\n  return attempt < 3;\n}\n';
    expect(of(moved, 'src/a.ts#shouldRetry')).toBe(of(RETRY, 'src/a.ts#shouldRetry'));
  });

  const KINDS = `export function load(url: string): Promise<string>;
export function load(url: URL): Promise<string>;
export function load(url: string | URL): Promise<string> {
  return fetch(url).then((r) => r.text());
}

export class Client {
  get(path: string) {
    return path;
  }
}

export const retry = async (times: number) => times > 0;

interface Options {
  timeout: number;
}

export type Method = 'GET' | 'POST';

enum Level {
  Low,
  High,
}

export default class Fallback {}

declare function ambient(): void;

let first = 1,
  second = 2;

const { deep: [inner] } = { deep: [1] };
`;

  it('finds overloads, a class, a const arrow function, an interface, a type and an enum by name', () => {
    const cases: Array<[string, string, string]> = [
      ['load', 'url: URL)', 'url: Request)'],
      ['load', 'r.text()', 'r.json()'],
      ['Client', 'return path;', 'return path + "/";'],
      ['retry', 'times > 0', 'times >= 0'],
      ['Options', 'timeout: number', 'timeout?: number'],
      ['Method', "'GET' | 'POST'", "'GET' | 'PUT'"],
      ['Level', 'High,', 'Higher,'],
      ['Fallback', 'class Fallback {}', 'class Fallback { x = 1 }'],
      ['ambient', 'ambient(): void', 'ambient(): number'],
      ['first', 'first = 1', 'first = 3'],
      ['inner', 'deep: [1]', 'deep: [2]'],
    ];
    for (const [name, from, to] of cases) {
      const before = of(KINDS, `src/a.ts#${name}`);
      expect(KINDS.includes(from), from).toBe(true);
      expect(of(KINDS.replace(from, to), `src/a.ts#${name}`), `${name}: ${from} -> ${to}`).not.toBe(before);
    }
  });

  it('keeps each declaration to itself', () => {
    const changed = KINDS.replace('r.text()', 'r.json()');
    for (const name of ['Client', 'retry', 'Options', 'Method', 'Level', 'Fallback', 'ambient', 'first']) {
      expect(of(changed, `src/a.ts#${name}`), name).toBe(of(KINDS, `src/a.ts#${name}`));
    }
    // A sibling declarator in the same `let` is not part of the symbol.
    expect(of(KINDS.replace('second = 2', 'second = 4'), 'src/a.ts#first')).toBe(of(KINDS, 'src/a.ts#first'));
    expect(of(KINDS.replace('let first', 'const first'), 'src/a.ts#first')).not.toBe(of(KINDS, 'src/a.ts#first'));
  });

  it('counts `export` as part of the declaration', () => {
    expect(of(KINDS.replace('export type Method', 'type Method'), 'src/a.ts#Method')).not.toBe(of(KINDS, 'src/a.ts#Method'));
  });

  it('takes only top-level declarations', () => {
    const nested = 'export function outer() {\n  function inner() {}\n  return inner;\n}\n';
    expect(fingerprint(ref('src/a.ts#inner'), tree({ 'src/a.ts': nested }))).toMatchObject({ ok: false, reason: 'missing-symbol' });
  });

  it('finds a symbol in a JavaScript file with JSX', () => {
    const view = 'export function View() {\n  return <p>hi</p>; // c\n}\nexport const other = 1;\n';
    expect(of(view.replace('// c', ''), 'src/view.jsx#View')).toBe(of(view, 'src/view.jsx#View'));
    expect(of(view.replace('<p>hi</p>', '<p>bye</p>'), 'src/view.jsx#View')).not.toBe(of(view, 'src/view.jsx#View'));
  });

  it('finds a namespace by name, with every block of it', () => {
    const NS = 'export namespace Api {\n  export const a = 1;\n}\nnamespace Outer.Inner {\n  export const b = 2;\n}\nnamespace Api {\n  export const c = 3;\n}\ndeclare module \'virtual\' {}\ndeclare global {\n  interface Window {}\n}\nexport const after = 1;\n';
    const api = of(NS, 'src/a.ts#Api');
    expect(of(NS.replace('a = 1', 'a = 2'), 'src/a.ts#Api')).not.toBe(api);
    expect(of(NS.replace('c = 3', 'c = 4'), 'src/a.ts#Api')).not.toBe(api);
    expect(of(NS.replace('b = 2', 'b = 5'), 'src/a.ts#Api')).toBe(api);
    expect(of(NS.replace('b = 2', 'b = 5'), 'src/a.ts#Outer')).not.toBe(of(NS, 'src/a.ts#Outer'));
    for (const name of ['Inner', 'virtual', 'global']) {
      expect(fingerprint(ref(`src/a.ts#${name}`), tree({ 'src/a.ts': NS })), name).toMatchObject({ ok: false, reason: 'missing-symbol' });
    }
  });

  it('says when a name is only re-exported, and where to point instead', () => {
    const REEXPORTS = "import { imported } from './i';\nconst local = 1;\nexport { helper } from './h';\nexport * as all from './x';\nexport { local as renamed, imported as again, imported };\n";
    const message = (name: string) => {
      const result = fingerprint(ref(`src/a.ts#${name}`), tree({ 'src/a.ts': REEXPORTS }));
      expect(result, name).toMatchObject({ ok: false, reason: 're-exported' });
      return result.ok ? '' : result.message;
    };
    const point = 'point `Source` at the file that declares it';
    expect(message('helper')).toBe(`src/a.ts re-exports \`helper\` from ./h and does not declare it; ${point}`);
    expect(message('all')).toBe(`src/a.ts re-exports \`all\` from ./x and does not declare it; ${point}`);
    expect(message('renamed')).toBe('src/a.ts exports its declaration `local` under the name `renamed`; point `Source` at src/a.ts#local');
    expect(message('again')).toBe(`src/a.ts re-exports \`again\` and does not declare it; ${point}`);
    expect(message('imported')).toBe(`src/a.ts re-exports \`imported\` and does not declare it; ${point}`);
    expect(of(REEXPORTS, 'src/a.ts#local')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('reports a missing symbol', () => {
    expect(fingerprint(ref('src/a.ts#nowhere'), tree({ 'src/a.ts': RETRY }))).toEqual({
      ok: false,
      reason: 'missing-symbol',
      message: 'src/a.ts has no top-level declaration `nowhere`',
    });
    // A name that is only exported, imported or used is not a declaration.
    for (const name of ['sleep', 'method']) {
      expect(fingerprint(ref(`src/a.ts#${name}`), tree({ 'src/a.ts': RETRY })), name).toMatchObject({ ok: false, reason: 'missing-symbol' });
    }
  });

  it('reports a symbol in a file it cannot read, or after a folder', () => {
    expect(fingerprint(ref('src/a.ts#f'), tree({ 'src/a.ts': 'export function f( {' }))).toMatchObject({ ok: false, reason: 'unparsable' });
    expect(fingerprint(ref('docs/a.md#f'), tree({ 'docs/a.md': '# f' }))).toMatchObject({ ok: false, reason: 'unparsable' });
    expect(fingerprint(ref('src#f'), tree({ 'src/a.ts': RETRY }))).toEqual({
      ok: false,
      reason: 'symbol-in-folder',
      message: 'src is a folder, so `#f` names nothing',
    });
  });
});

describe('folder fingerprints', () => {
  const FILES = { 'lib/a.ts': RETRY, 'lib/b.md': '# B\n', 'lib/sub/c.ts': 'export const c = 1;\n' };
  const folder = (files: Record<string, string>) => ok(fingerprint(ref('lib'), tree(files)));

  it('changes when a file in it, or in a subfolder, changes, is added or is removed', () => {
    const base = folder(FILES);
    expect(folder({ ...FILES, 'lib/sub/c.ts': 'export const c = 2;\n' })).not.toBe(base);
    expect(folder({ ...FILES, 'lib/d.ts': '' })).not.toBe(base);
    const { 'lib/b.md': _, ...fewer } = FILES;
    expect(folder(fewer)).not.toBe(base);
  });

  it('changes when a file is renamed or moved', () => {
    const { 'lib/sub/c.ts': c, ...rest } = FILES;
    expect(folder({ ...rest, 'lib/c.ts': c })).not.toBe(folder(FILES));
  });

  it('is the same after comment-only edits and reformats of its files', () => {
    expect(folder({ ...FILES, 'lib/sub/c.ts': '// c\nexport const c =\n  1;\n', 'lib/b.md': '#   B' })).toBe(folder(FILES));
  });

  it('skips dot folders and node_modules, and files outside the folder', () => {
    const base = folder(FILES);
    expect(folder({ ...FILES, 'lib/.cache/x.ts': 'x', 'lib/node_modules/m/index.js': 'x', 'lib/sub/node_modules/y.js': 'y', 'other.ts': 'z' })).toBe(base);
    expect(folder({ ...FILES, 'lib/.env.example': 'A=1' })).not.toBe(base);
  });

  it('does not depend on the order files were written in', () => {
    const reversed = Object.fromEntries(Object.entries(FILES).reverse());
    expect(folder(reversed)).toBe(folder(FILES));
  });

  it('counts a linked file and skips a linked folder', () => {
    const root = tree(FILES);
    const base = ok(fingerprint(ref('lib'), root));
    symlinkSync(join(root, 'lib'), join(root, 'lib', 'loop'));
    expect(ok(fingerprint(ref('lib'), root))).toBe(base);
    symlinkSync(join(root, 'lib', 'b.md'), join(root, 'lib', 'b-link.md'));
    expect(ok(fingerprint(ref('lib'), root))).not.toBe(base);
  });

  it('has a fingerprint when empty', () => {
    const root = tree({});
    mkdirSync(join(root, 'lib'));
    ok(fingerprint(ref('lib'), root));
  });
});

describe('pinned fingerprints', () => {
  // fixtures/fingerprint/pinned.tsx has generics, overloads, a regular expression, a template
  // literal over two lines, JSX, decorators and a namespace. Its normalised text and fingerprints
  // are written here, so a parser upgrade that cuts tokens differently fails this test instead of
  // making every lock stale with no word why. If the tokens change on purpose, the lock's
  // `version` goes up and these values are written again.
  const dir = fileURLToPath(new URL('../../fixtures/fingerprint/', import.meta.url));
  const text = readFileSync(join(dir, 'pinned.tsx'), 'utf8');

  const TEXT = [
    "import type { ReactNode } from 'react' ;",
    'export function pick < T > ( items : T [ ] ) : T ;',
    'export function pick < T > ( items : T [ ] , count : number ) : T [ ] ;',
    'export function pick < T > ( items : T [ ] , count ? : number ) : T | T [ ] { return count === undefined ? items [ 0 ] ! : items . slice ( 0 , count ) ; }',
    'export const pair = < A , B extends object = { } > ( a : A , b : B ) : [ A , B ] => [ a , b ] ;',
    'type Partial2 < T > = { [ K in keyof T ] ? : T [ K ] } ;',
    'const SLASHES = /\\/\\/[^\\n]*|\\/\\*.*?\\*\\//g ;',
    "const greeting = `hello ${ 'world' } // still the template\nsecond   line` ;",
    'function sealed ( target : unknown ) { }',
    'function log ( _ : unknown , context : ClassMemberDecoratorContext ) { }',
    '@ sealed export class Panel < Props extends { title : string } > { @ log accessor open = false ;',
    '@ log render ( props : Props ) : ReactNode { return ( < section className = "panel" data-title = { `a ${ props . title }` } >',
    '{ } < h1 > { props . title } < / h1 > text that wraps < / section > ) ; } }',
    'export namespace Api { export const version = 1 satisfies number ; }',
  ].join(' ');

  const PINNED: Record<string, string> = {
    '': 'ed2048444b1379df',
    pick: '10c780a9949e4a10',
    pair: '7690efd3c94f28b6',
    Partial2: 'f641f0eece0bc359',
    greeting: '9ec40302b1ade068',
    Panel: 'ad71f0e5460adc4c',
    Api: 'e02e4767a2c765c8',
  };
  const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

  it('reads the fixture into the same tokens', () => {
    expect(normalizeText(text, 'pinned.tsx')).toBe(TEXT);
  });

  it('gives the same fingerprints for the file and its symbols', () => {
    for (const [symbol, print] of Object.entries(PINNED)) {
      expect(ok(fingerprint(ref(symbol ? `pinned.tsx#${symbol}` : 'pinned.tsx'), dir)), symbol || 'the file').toBe(print);
    }
  });

  it('takes a symbol from the same tokens as the file, decorators included', () => {
    expect(PINNED['']).toBe(sha(TEXT));
    const panel = TEXT.slice(TEXT.indexOf('@ sealed'), TEXT.indexOf(' export namespace'));
    expect(PINNED.Panel).toBe(sha(panel));
    expect(PINNED.Api).toBe(sha(TEXT.slice(TEXT.indexOf('export namespace'))));
  });

  it('gives the same fingerprints with CRLF line endings', () => {
    const root = tree({ 'pinned.tsx': text.replace(/\r?\n/g, '\r\n') });
    for (const [symbol, print] of Object.entries(PINNED)) {
      expect(ok(fingerprint(ref(symbol ? `pinned.tsx#${symbol}` : 'pinned.tsx'), root)), symbol || 'the file').toBe(print);
    }
  });
});

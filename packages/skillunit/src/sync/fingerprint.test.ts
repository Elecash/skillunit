import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

  it('hashes the bytes of a file that is not UTF-8', () => {
    const root = tree({ 'a.bin': Buffer.from([0xff, 0xfe, 0x00, 0x20, 0x20]), 'b.bin': Buffer.from([0xff, 0xfe, 0x00, 0x20]) });
    expect(ok(fingerprint(ref('a.bin'), root))).not.toBe(ok(fingerprint(ref('b.bin'), root)));
  });

  it('reports a path that does not exist', () => {
    expect(fingerprint(ref('src/none.ts'), tree({}))).toEqual({ ok: false, reason: 'missing', message: 'src/none.ts does not exist' });
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

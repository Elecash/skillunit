import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { exportNames, loadTypeScript } from './typescript.js';

const folders: string[] = [];
afterEach(() => folders.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A folder with these files; returns its path. */
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'skillunit-exports-'));
  folders.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe('exportNames', () => {
  it('gives the values and the types apart, sorted', () => {
    const dir = project({
      'index.ts': [
        'export function get() {}',
        'export const VERSION = 1;',
        'export class HttpError extends Error {}',
        'export interface Options { retry?: number }',
        'export type Method = "GET" | "POST";',
        'export enum Mode { A }',
      ].join('\n'),
    });
    expect(exportNames(join(dir, 'index.ts'))).toEqual({ values: ['HttpError', 'Mode', 'VERSION', 'get'], types: ['Method', 'Options'] });
  });

  it('takes a file: URL', () => {
    const dir = project({ 'index.ts': 'export const a = 1;\nexport type B = string;\n' });
    expect(exportNames(pathToFileURL(join(dir, 'index.ts')))).toEqual({ values: ['a'], types: ['B'] });
    expect(exportNames(pathToFileURL(join(dir, 'index.ts')).href)).toEqual({ values: ['a'], types: ['B'] });
  });

  it('counts a class exported with `export type` as a type, through a re-export too', () => {
    const dir = project({
      'errors.ts': 'export class TimeoutError extends Error {}\nexport class HttpError extends Error {}\n',
      'types.ts': "export type { TimeoutError } from './errors.js';\n",
      'index.ts': "export { HttpError } from './errors.js';\nexport * from './types.js';\n",
    });
    expect(exportNames(join(dir, 'index.ts'))).toEqual({ values: ['HttpError'], types: ['TimeoutError'] });
  });

  it('gives the names `export *` brings', () => {
    const dir = project({
      'client.ts': 'export function create() {}\nexport interface Client { get(): void }\n',
      'index.ts': "export * from './client.js';\nexport const tf = 1;\n",
    });
    expect(exportNames(join(dir, 'index.ts'))).toEqual({ values: ['create', 'tf'], types: ['Client'] });
  });

  it("reads the project's tsconfig.json, its `paths` included", () => {
    const dir = project({
      'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', paths: { lib: ['./src/lib.ts'] } } }),
      'src/lib.ts': 'export const fromLib = 1;\n',
      'src/index.ts': "export * from 'lib';\n",
    });
    expect(exportNames(join(dir, 'src', 'index.ts'))).toEqual({ values: ['fromLib'], types: [] });
  });

  it('fails on a file the compiler does not find', () => {
    const dir = project({});
    expect(() => exportNames(join(dir, 'missing.ts'))).toThrow(`exportNames: the compiler did not find ${join(dir, 'missing.ts')}`);
  });

  it("passes over a `typescript` with no compiler API, as TypeScript 7's package is, for SkillUnit's own", () => {
    const require = createRequire(import.meta.url);
    const seven = require('typescript-7') as { version: string };
    expect(seven).not.toHaveProperty('createProgram');
    const load = (place: string) => (place.startsWith('/project/') ? seven : require('typescript')) as never;
    const ts = loadTypeScript(['/project/src/index.ts', '/skillunit/dist/typescript.js'], load);
    expect(typeof ts.createProgram).toBe('function');
    expect(ts.version).toBe((require('typescript') as { version: string }).version);
  });

  it('names the version it found when no `typescript` has the compiler API', () => {
    const load = () => ({ version: '7.0.2' }) as never;
    expect(() => loadTypeScript(['/project/src/index.ts', '/skillunit/dist/typescript.js'], load)).toThrow(
      'exportNames needs the compiler API of `typescript`, and the one found, 7.0.2, does not export it from its main entry, as TypeScript 7 does not: install SkillUnit again so that it has its own `typescript`, or add `typescript@6` to the project',
    );
  });

  it('says to install typescript when it is not there', () => {
    const missing = () => {
      throw Object.assign(new Error("Cannot find module 'typescript'"), { code: 'MODULE_NOT_FOUND' });
    };
    expect(() => loadTypeScript(['/project/src/index.ts', '/skillunit/dist/typescript.js'], missing)).toThrow('exportNames needs the package `typescript`, which is not installed: install it in the project, with `npm install --save-dev typescript`');
  });
});

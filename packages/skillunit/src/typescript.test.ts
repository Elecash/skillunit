import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('says to install typescript when it is not there', () => {
    const missing = () => {
      throw Object.assign(new Error("Cannot find module 'typescript'"), { code: 'MODULE_NOT_FOUND' });
    };
    expect(() => loadTypeScript(['/project/src/index.ts', '/skillunit/dist/typescript.js'], missing)).toThrow('exportNames needs the package `typescript`, which is not installed: install it in the project, with `npm install --save-dev typescript`');
  });
});

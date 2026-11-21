/** What of a `Setup` an example's own declarations leave out, and that what is left still parses. */
import { parse } from '@babel/parser';
import { describe, expect, it } from 'vitest';
import { trimSetup } from './shadow.js';

const parses = (code: string) => parse(code, { sourceType: 'module', plugins: ['typescript'] }).program.body.length >= 0;
const trimmed = (setup: string, example: string) => {
  const out = trimSetup(setup, example, 'ts');
  expect(out.split('\n')).toHaveLength(setup.split('\n').length);
  expect(out).toHaveLength(setup.length);
  expect(parses(out)).toBe(true);
  return out.replace(/ +/g, ' ').trim();
};

describe('the Setup an example gets', () => {
  it('leaves out one specifier of an import, with a comma, wherever it is', () => {
    const setup = 'import React, { useState, useEffect } from "react";';
    expect(trimmed(setup, 'import React from "react";')).toBe('import { useState, useEffect } from "react";');
    expect(trimmed(setup, 'const useState = 1;')).toBe('import React, { useEffect } from "react";');
    expect(trimmed(setup, 'function useEffect() {}')).toBe('import React, { useState } from "react";');
    expect(trimmed(setup, 'let useState, useEffect;')).toBe('import React, { } from "react";');
    expect(trimmed('import Def, * as NS from "x";', 'class NS {}')).toBe('import Def from "x";');
    expect(trimmed('import Def, * as NS from "x";', 'type Def = 1;')).toBe('import * as NS from "x";');
  });

  it('leaves out a whole import when none of it is left, and keeps a side-effect import', () => {
    expect(trimmed('import { a } from "x";\nimport "polyfill";', 'const a = 1;')).toBe('import "polyfill";');
  });

  it('leaves out one declarator, or the whole declaration', () => {
    const setup = 'declare const a: Map<string, number>, b: B;';
    expect(trimmed(setup, 'const a = 1;')).toBe('declare const b: B;');
    expect(trimmed(setup, 'const { b } = x;')).toBe('declare const a: Map<string, number> ;');
    expect(trimmed(setup, 'const [a, ...b] = x;')).toBe('');
  });

  it('decides by name, whatever the kind of either declaration', () => {
    const setup = 'interface Client { id: number }\ndeclare function send(): void;\nnamespace api.v1 { export const x = 1; }\nenum Color { Red }';
    expect(trimmed(setup, 'class Client {}\nexport const send = 1;\nimport api from "api";\ntype Color = string;')).toBe('');
  });

  it('counts only top-level names, and names a block imports with `import x =`', () => {
    const setup = 'declare const a: A;\ndeclare const b: B;';
    expect(trimmed(setup, 'function f() { const a = 1; }\n{ let b = 2; }')).toBe('declare const a: A;\ndeclare const b: B;');
    expect(trimmed(setup, 'import a = require("a");')).toBe('declare const b: B;');
  });

  it('gives the whole Setup to an example that does not parse, and with a Setup that does not parse', () => {
    expect(trimSetup('declare const a: A;', 'const a = ;', 'ts')).toBe('declare const a: A;');
    expect(trimSetup('declare const a: A =;', 'const a = 1;', 'ts')).toBe('declare const a: A =;');
  });

  it('reads a top-level return or await in an example', () => {
    expect(trimmed('declare const a: A;', 'const a = await load();\nif (!a) return;')).toBe('');
  });
});

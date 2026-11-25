/** Test helpers: a skill parsed from strings, and a line finder. Not part of the package API. */
import { parseFile, type ParsedSkill } from '../units/index.js';
import { structure } from './structure.js';
import type { Problem } from './types.js';

export const F = '```';

export function skillOf(files: Record<string, string>, root = '/skill'): ParsedSkill {
  const parsed = Object.entries(files).map(([path, text]) => parseFile(text, path));
  return { root, files: parsed, units: parsed.flatMap((f) => f.units), errors: parsed.flatMap((f) => f.errors) };
}

/** 1-based line of the first line of `text` that contains `needle`. */
export function lineOf(text: string, needle: string, from = 0): number {
  const i = text.split('\n').findIndex((l, n) => n >= from && l.includes(needle));
  if (i < 0) throw new Error(`"${needle}" not found`);
  return i + 1;
}

/** `line unit severity: message`, the parts a test asserts on. */
export const show = (p: Problem) => `${p.line} ${p.unit ?? '-'} ${p.severity}: ${p.message}`;

/** What the structure rules report on one file, as `show` gives it. */
export const structureOf = (text: string) => structure(skillOf({ 'a.md': text })).map(show);

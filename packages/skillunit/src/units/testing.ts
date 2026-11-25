/** Test helpers: a file parsed from a string, and its errors. Not part of the package API. */
import { parseFile } from './parse.js';

export const parse = (text: string, file = 'features/retries.md') => parseFile(text, file);

/** The errors of a file, as `line: message`. */
export const messages = (text: string) => parse(text).errors.map((e) => `${e.line}: ${e.message}`);

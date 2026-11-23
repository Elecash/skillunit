/**
 * `import { skillExample } from 'skillunit/proof'`: for tests in JavaScript and TypeScript that
 * produce the example of a unit as a value. The test calls `skillExample(id, value)` and
 * `skillunit proof --write` copies what it wrote into the block flagged `proof=<id>`.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CONFIG_FILE, DEFAULT_PROOF_EXAMPLES, loadConfig } from '../config.js';

/** A unit id, or a unit id, a dot and a name. */
const ID = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?$/;

const folders = new Map<string, string>();

/**
 * Writes the example of `proof=<id>` to the `proof.examples` folder of the nearest
 * `skillunit.yaml` above the working directory: a string as it is, to `<id>.txt`; any other value
 * as JSON with two-space indentation, to `<id>.json`. Returns the path it wrote.
 */
export function skillExample(id: string, value: unknown): string {
  if (!ID.test(id)) throw new Error(`skillExample: \`${id}\` is not a unit id, nor a unit id, a dot and a name`);
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (text === undefined) throw new Error(`skillExample: the example of \`${id}\` cannot be written as JSON`);
  const dir = examplesFolder(process.cwd());
  mkdirSync(dir, { recursive: true });
  const [ext, other] = typeof value === 'string' ? ['txt', 'json'] : ['json', 'txt'];
  // A file of the other kind from an earlier run would give the block two sources.
  rmSync(join(dir, `${id}.${other}`), { force: true });
  const path = join(dir, `${id}.${ext}`);
  writeFileSync(path, typeof value === 'string' ? text : `${text}\n`);
  return path;
}

/** The `proof.examples` folder of the nearest `skillunit.yaml` at or above `from`. */
export function examplesFolder(from: string): string {
  const start = resolve(from);
  const cached = folders.get(start);
  if (cached) return cached;
  for (let dir = start; ; dir = dirname(dir)) {
    const file = join(dir, CONFIG_FILE);
    if (existsSync(file)) {
      const folder = loadConfig(file).proof?.examples ?? resolve(dir, DEFAULT_PROOF_EXAMPLES);
      folders.set(start, folder);
      return folder;
    }
    if (dirname(dir) === dir) break;
  }
  throw new Error(`skillExample: no ${CONFIG_FILE} in ${start} or a folder above it; run the tests from the project that has one`);
}

/**
 * Reads the folder where tests write examples: `<id>.<extension>` holds the text of the fence
 * flagged `proof=<id>`. The id may itself hold a dot (`retry-defaults.custom-delay.json`), so it
 * is the file name without its last extension.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface ExampleFile {
  id: string;
  /** The file name in the folder. */
  name: string;
  /** Absolute path. */
  path: string;
  /** The file's text, as it is. */
  text: string;
  /** When the test wrote it, to tell a file left from an earlier run. */
  mtimeMs: number;
}

export interface ExampleProblem {
  /** The file name in the folder. */
  name: string;
  message: string;
}

export interface ExamplesFolder {
  /** The folder does not exist: the tests wrote nothing, or wrote it elsewhere. */
  missing: boolean;
  examples: Map<string, ExampleFile>;
  problems: ExampleProblem[];
}

/** The examples of `dir`, by id. Dot files and sub-folders are left out. */
export function readExamples(dir: string): ExamplesFolder {
  const examples = new Map<string, ExampleFile>();
  const problems: ExampleProblem[] = [];
  if (!existsSync(dir)) return { missing: true, examples, problems };

  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
  for (const name of names) {
    const dot = name.lastIndexOf('.');
    if (dot <= 0) {
      problems.push({ name, message: `\`${name}\` has no extension; an example file is \`<id>.<extension>\`, such as \`${name}.json\`` });
      continue;
    }
    const id = name.slice(0, dot);
    const first = examples.get(id);
    if (first) {
      problems.push({ name, message: `\`${name}\` and \`${first.name}\` are both examples of \`${id}\`; keep one` });
      continue;
    }
    const path = join(dir, name);
    examples.set(id, { id, name, path, text: readFileSync(path, 'utf8'), mtimeMs: statSync(path).mtimeMs });
  }
  return { missing: false, examples, problems };
}

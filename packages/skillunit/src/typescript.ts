/**
 * `import { exportNames } from 'skillunit/typescript'`: the names a TypeScript file exports, as
 * the compiler sees them, values and types apart. A unit builds its sentence from them, so an
 * export added or renamed changes the skill. It loads the project's own `typescript` when that
 * package has the compiler API, and SkillUnit's own otherwise: TypeScript 7 exports only its
 * version from its main entry. `skillunit/vitest` and `skillunit/unit` never load it.
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as TS from 'typescript';

export interface ExportNames {
  /** What the module holds at run time: functions, classes, constants. Sorted. */
  values: string[];
  /** What only the types have: interfaces, type aliases, and a class exported with `export type`. Sorted. */
  types: string[];
}

/**
 * The names `entry` exports, a path or a `file:` URL. The compiler reads the `tsconfig.json`
 * nearest above it, when there is one, so `paths` and the module settings are the project's;
 * otherwise it resolves modules as Node does. `export *` gives the names it brings.
 */
export function exportNames(entry: string | URL): ExportNames {
  const file = resolve(typeof entry === 'string' && !entry.startsWith('file:') ? entry : fileURLToPath(entry));
  const ts = loadTypeScript([file, fileURLToPath(import.meta.url)]);
  const program = ts.createProgram([file], compilerOptions(ts, file));
  const source = program.getSourceFile(file);
  if (!source) throw new Error(`exportNames: the compiler did not find ${file}`);
  const checker = program.getTypeChecker();
  const module = checker.getSymbolAtLocation(source);
  if (!module) return { values: [], types: [] };
  // The type of the module object has a property for each value it exports, and none for a type,
  // whatever chain of `export type`, `export *` and re-exports brought it.
  const values = checker
    .getTypeOfSymbolAtLocation(module, source)
    .getProperties()
    .map((p) => p.name);
  const all = checker.getExportsOfModule(module).map((e) => e.name);
  return { values: [...values].sort(), types: all.filter((n) => !values.includes(n)).sort() };
}

/** The project's settings from the `tsconfig.json` nearest above `file`, or Node's resolution. */
function compilerOptions(ts: typeof TS, file: string): TS.CompilerOptions {
  const fallback: TS.CompilerOptions = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  const config = ts.findConfigFile(dirname(file), ts.sys.fileExists);
  const parsed = config ? ts.getParsedCommandLineOfConfigFile(config, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} }) : undefined;
  return { ...(parsed?.options ?? fallback), noEmit: true, skipLibCheck: true };
}

/** Loads `typescript` as a file at `place` would import it. */
const requireFrom = (place: string) => createRequire(join(dirname(place), 'noop.js'))('typescript') as typeof TS;

/**
 * `typescript`, resolved from the first of `from` that has it with its compiler API: the
 * project's, then SkillUnit's. A `typescript` with no `createProgram`, such as TypeScript 7's,
 * is passed over.
 */
export function loadTypeScript(from: string[], load: (place: string) => typeof TS = requireFrom): typeof TS {
  let found: string | undefined;
  for (const place of from) {
    let ts: typeof TS;
    try {
      ts = load(place);
    } catch (e) {
      if ((e as { code?: string }).code !== 'MODULE_NOT_FOUND') throw e;
      continue;
    }
    if (typeof ts?.createProgram === 'function') return ts;
    found ??= String((ts as { version?: unknown } | undefined)?.version ?? 'of no known version');
  }
  if (found !== undefined) {
    throw new Error(`exportNames needs the compiler API of \`typescript\`, and the one found, ${found}, does not export it from its main entry, as TypeScript 7 does not: install SkillUnit again so that it has its own \`typescript\`, or add \`typescript@6\` to the project`);
  }
  throw new Error('exportNames needs the package `typescript`, which is not installed: install it in the project, with `npm install --save-dev typescript`');
}

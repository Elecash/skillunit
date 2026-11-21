/**
 * Runs the project's own `tsc` over code blocks of a skill, once for the whole skill. The
 * compiler API is not used: `typescript@7` (the native port) no longer has it. Each block becomes
 * one file: its `Setup`, then its code. The files and a tsconfig that `extends` the configured
 * one go in a fresh folder under the nearest `node_modules/.cache/skillunit/`, so imports of
 * installed packages resolve as they do for the project. The folder is removed afterwards; when
 * it cannot be, the run warns and keeps its result.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { removeTemp } from '../temp.js';
import { ConfigError } from './types.js';

export interface TsBlock {
  lang: 'ts' | 'tsx' | 'js' | 'jsx';
  code: string;
  /** Prepended to `code`; diagnostics in it are reported against `setupLine`. */
  setup?: { code: string; line: number };
  /** Markdown line of the first line of `code`. */
  line: number;
}

export interface TsDiagnostic {
  /** Markdown line. */
  line: number;
  /** `TS2304` and so on. */
  code: string;
  message: string;
  /** The diagnostic is in the `Setup` lines, not in the block's own code. */
  inSetup: boolean;
  /**
   * The code does not parse: the diagnostic came from a pass where `tsc` stopped before
   * checking types. Decided by what `tsc` did, not by the code: TS2657 is a parse error, and
   * TS1108 is reported while checking types.
   */
  syntax: boolean;
}

export interface TscRun {
  version: string;
  /** Diagnostics of each block, in the order of the blocks given. */
  diagnostics: TsDiagnostic[][];
}

const DIAGNOSTIC = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/;
const GLOBAL_DIAGNOSTIC = /^error (TS\d+): (.*)$/;

export function runTsc(tsconfig: string, blocks: TsBlock[]): TscRun {
  if (!existsSync(tsconfig)) throw new ConfigError(`\`examples.ts.tsconfig\` points to ${tsconfig}, which does not exist`);
  const { tsc, version } = findTsc(tsconfig);
  const dir = cacheFolder(tsconfig);
  try {
    const names = blocks.map((b, i) => `block${i}.${b.lang}`);
    blocks.forEach((b, i) => {
      const text = b.setup ? `${b.setup.code}\n${b.code}\n` : `${b.code}\n`;
      writeFileSync(join(dir, names[i]!), text);
    });
    const diagnostics: TsDiagnostic[][] = blocks.map(() => []);

    // `tsc` checks no types at all when any file does not parse, and then reports only the parse
    // errors. A pass that stopped there drops the blocks it reported, which keep those errors,
    // and the rest run again. A pass that reached the type-check is final. A syntax-only pass
    // with no error in a block is a settings problem (see `runPass`), so each pass that does
    // not end the loop drops at least one block.
    let active = blocks.map((_, i) => i);
    while (active.length > 0) {
      const pass = runPass(tsc, tsconfig, dir, blocks, names, active);
      if (pass.typeChecked) {
        for (const i of active) diagnostics[i] = pass.diagnostics.get(i) ?? [];
        break;
      }
      const broken = active.filter((i) => pass.diagnostics.has(i));
      for (const i of broken) diagnostics[i] = pass.diagnostics.get(i)!;
      active = active.filter((i) => !broken.includes(i));
    }
    return { version, diagnostics };
  } finally {
    removeTemp(dir);
  }
}

/**
 * A file with a type error that every pass compiles. `tsc` reports type errors only when every
 * file parsed, so its error coming back is how a pass is known to have reached the type-check.
 * Its diagnostic is never reported.
 */
const SENTINEL = 'skillunit-sentinel.ts';
const SENTINEL_CODE = 'const __skillunit_sentinel__: number = "";\n';

interface Pass {
  /** `tsc` reached the type-check: every diagnostic is final. Otherwise each one is a parse error. */
  typeChecked: boolean;
  /** Diagnostics of each block that has some. */
  diagnostics: Map<number, TsDiagnostic[]>;
}

/** One `tsc` run over the blocks in `active`. */
function runPass(
  tsc: string,
  tsconfig: string,
  dir: string,
  blocks: TsBlock[],
  names: string[],
  active: number[],
): Pass {
  const hasJs = active.some((i) => blocks[i]!.lang === 'js' || blocks[i]!.lang === 'jsx');
  let base = relative(dir, tsconfig).split(sep).join('/');
  if (!base.startsWith('.')) base = `./${base}`;
  const config = {
    extends: base,
    compilerOptions: {
      noEmit: true,
      composite: false,
      incremental: false,
      declaration: false,
      emitDeclarationOnly: false,
      moduleDetection: 'force',
      noUnusedLocals: false,
      noUnusedParameters: false,
      // The generated files sit outside any `rootDir` the project sets.
      rootDir: parse(dir).root,
      ...(hasJs ? { allowJs: true, checkJs: true } : {}),
    },
    files: [SENTINEL, ...active.map((i) => names[i]!)],
    include: [],
  };
  writeFileSync(join(dir, SENTINEL), SENTINEL_CODE);
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(config, null, 2));

  const run = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json', '--pretty', 'false'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error) throw new ConfigError(`could not run ${tsc}: ${run.error.message}`);
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

  // Each diagnostic is a line, followed by its continuation lines, indented: "No overload
  // matches this call." is followed by the line that names the property.
  const sentinel = resolve(dir, SENTINEL);
  const index = new Map(active.map((i) => [resolve(dir, names[i]!), i]));
  type Found = { block: number; line: number; code: string; message: string[] };
  const found: Found[] = [];
  let last: Found | null = null;
  let typeChecked = false;
  // Errors with no file, or in a tsconfig, are about the settings. Errors in the project's own
  // source files are not the skill's to report, and are left out.
  const settings: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (last && /^\s+\S/.test(line)) {
      last.message.push(line.trim());
      continue;
    }
    last = null;
    if (GLOBAL_DIAGNOSTIC.test(line)) {
      settings.push(line);
      continue;
    }
    const m = DIAGNOSTIC.exec(line);
    if (!m) continue;
    const file = resolve(dir, m[1]!);
    if (file === sentinel) {
      typeChecked = true;
      continue;
    }
    const i = index.get(file);
    if (i === undefined) {
      if (m[1]!.endsWith('.json')) settings.push(line);
      continue;
    }
    last = { block: i, line: Number(m[2]), code: m[4]!, message: [m[5]!] };
    found.push(last);
  }
  if (settings.length) throw new ConfigError(`tsc rejected the settings from ${tsconfig}:\n${settings.join('\n')}`);
  if (!typeChecked && found.length === 0) {
    throw new ConfigError(
      `tsc did not check types, and reported no error in an example: a file of the project may not parse, or ${tsconfig} may set \`noCheck\`. What it said:\n${output.trim().slice(0, 4000) || '(nothing)'}`,
    );
  }

  const diagnostics = new Map<number, TsDiagnostic[]>();
  for (const d of found) {
    if (!diagnostics.has(d.block)) diagnostics.set(d.block, []);
    diagnostics.get(d.block)!.push(mapDiagnostic(blocks[d.block]!, d.line, d.code, d.message.join(' '), !typeChecked));
  }
  return { typeChecked, diagnostics };
}

function mapDiagnostic(block: TsBlock, genLine: number, code: string, message: string, syntax: boolean): TsDiagnostic {
  const setupLines = block.setup ? block.setup.code.split('\n').length : 0;
  if (block.setup && genLine <= setupLines) {
    return { line: block.setup.line + genLine - 1, code, message, inSetup: true, syntax };
  }
  // A missing `}` is reported on the line after the code; keep it on the block's last line.
  const own = Math.min(genLine - setupLines, block.code.split('\n').length);
  return { line: block.line + own - 1, code, message, inSetup: false, syntax };
}

/**
 * `tsc` of the `typescript` package in the nearest `node_modules` at or above the tsconfig, run
 * with this Node. Only `node_modules` folders count: not `NODE_PATH`, not a global install.
 */
function findTsc(tsconfig: string): { tsc: string; version: string } {
  let pkgPath: string | undefined;
  for (let dir = dirname(tsconfig); ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', 'typescript', 'package.json');
    if (existsSync(candidate)) {
      pkgPath = candidate;
      break;
    }
    if (dirname(dir) === dir) break;
  }
  if (!pkgPath) {
    throw new ConfigError(
      `\`examples.ts\` is set, but \`typescript\` is not installed in a node_modules folder at or above ${dirname(tsconfig)}. Install it with \`npm install -D typescript\``,
    );
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string; bin?: string | Record<string, string> };
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.tsc;
  if (!bin) throw new ConfigError(`${pkgPath} has no \`tsc\` binary`);
  return { tsc: join(dirname(pkgPath), bin), version: pkg.version };
}

/** A fresh folder under the nearest `node_modules/.cache/skillunit/` at or above the tsconfig. */
function cacheFolder(tsconfig: string): string {
  let dir = dirname(tsconfig);
  for (;;) {
    const nm = join(dir, 'node_modules');
    if (existsSync(nm)) {
      const cache = join(nm, '.cache', 'skillunit');
      mkdirSync(cache, { recursive: true });
      return mkdtempSync(join(cache, 'run-'));
    }
    const up = dirname(dir);
    if (up === dir) throw new ConfigError(`no node_modules folder at or above ${dirname(tsconfig)}; install typescript there`);
    dir = up;
  }
}

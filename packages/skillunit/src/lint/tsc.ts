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
  /** A syntax error (TS1000 to TS1999): the code does not parse. */
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

    // `tsc` checks no types at all when any file has a syntax error. A block with one keeps its
    // syntax diagnostics and leaves the next pass, until a pass has no syntax error. Each pass
    // drops at least one block, so this ends.
    let active = blocks.map((_, i) => i);
    while (active.length > 0) {
      const pass = runPass(tsc, tsconfig, dir, blocks, names, active);
      const broken = active.filter((i) => pass.get(i)?.some((d) => d.syntax));
      if (broken.length === 0) {
        for (const i of active) diagnostics[i] = pass.get(i) ?? [];
        break;
      }
      for (const i of broken) diagnostics[i] = pass.get(i)!.filter((d) => d.syntax);
      active = active.filter((i) => !broken.includes(i));
    }
    return { version, diagnostics };
  } finally {
    removeTemp(dir);
  }
}

/** One `tsc` run over the blocks in `active`. Returns the diagnostics of each block that has some. */
function runPass(
  tsc: string,
  tsconfig: string,
  dir: string,
  blocks: TsBlock[],
  names: string[],
  active: number[],
): Map<number, TsDiagnostic[]> {
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
    files: active.map((i) => names[i]!),
    include: [],
  };
  writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(config, null, 2));

  const run = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json', '--pretty', 'false'], {
    cwd: dir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error) throw new ConfigError(`could not run ${tsc}: ${run.error.message}`);
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;

  const out = new Map<number, TsDiagnostic[]>();
  const index = new Map(active.map((i) => [resolve(dir, names[i]!), i]));
  let named = 0;
  // Errors with no file, or in a tsconfig, are about the settings. Errors in the project's own
  // source files are not the skill's to report, and are left out.
  const settings: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (GLOBAL_DIAGNOSTIC.test(line)) {
      settings.push(line);
      continue;
    }
    const m = DIAGNOSTIC.exec(line);
    if (!m) continue;
    const i = index.get(resolve(dir, m[1]!));
    if (i === undefined) {
      if (m[1]!.endsWith('.json')) settings.push(line);
      continue;
    }
    named++;
    if (!out.has(i)) out.set(i, []);
    out.get(i)!.push(mapDiagnostic(blocks[i]!, Number(m[2]), m[4]!, m[5]!));
  }
  if (settings.length) throw new ConfigError(`tsc rejected the settings from ${tsconfig}:\n${settings.join('\n')}`);
  if (run.status !== 0 && named === 0) {
    throw new ConfigError(`tsc failed without an error in an example. What it said:\n${output.trim().slice(0, 4000)}`);
  }
  return out;
}

/** Syntax errors are TS1000 to TS1999. */
const isSyntax = (code: string) => /^TS1\d{3}$/.test(code);

function mapDiagnostic(block: TsBlock, genLine: number, code: string, message: string): TsDiagnostic {
  const setupLines = block.setup ? block.setup.code.split('\n').length : 0;
  const syntax = isSyntax(code);
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

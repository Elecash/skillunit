/**
 * `createUnit(it, options)`: a unit of the skill declared where its test is. The `unit` it
 * returns registers a test with the runner's own `it`, so loops, `describe`, `beforeEach` and the
 * project's mocks work as in any test. When the body passes, the unit is written as a
 * `PassedUnit`; when it throws, as a `FailedUnit`, and the error is thrown again. A skipped test
 * writes nothing.
 *
 * This module imports nothing from Node at load time: a runner that cannot write files passes
 * its own `write`, and the default one is loaded only when a unit is written.
 */
import { checkSpec, UNIT_CONTRACT, UNIT_ID, type PassedUnit, type UnitExample, type UnitKind, type UnitRecord, type UnitSpec } from './contract.js';

/** What the body of a unit gets, besides the runner's own context. */
export interface UnitContext {
  /** Sets the `Value` of a fact from what the body observed. It replaces `value` of the spec. */
  value(text: string): void;
  /** Adds a block the body produced: an output, a config, a table of outcomes. */
  example(lang: string, text: string): void;
}

export type UnitBody<Ctx> = (u: UnitContext, ctx: Ctx) => unknown;

/** The part of a runner's `it` that `createUnit` uses. */
export interface RunnerIt<Ctx> {
  (name: string, fn: (ctx: Ctx) => unknown, ...rest: any[]): unknown;
  skip?: (name: string, fn: (ctx: Ctx) => unknown, ...rest: any[]) => unknown;
  only?: (name: string, fn: (ctx: Ctx) => unknown, ...rest: any[]) => unknown;
}

/** Where a unit is declared. `file` is a path or a `file:` URL. */
export interface UnitPlace {
  file: string;
  line: number;
}

export interface CreateUnitOptions<Ctx> {
  /**
   * Writes the record of a unit. `key` is the same for one declaration across runs and differs
   * between two declarations, even of the same id, so a writer can name the file after it.
   * Defaults to writing `<id>.<hash>.json` in the `proof.units` folder of the nearest
   * `skillunit.yaml` above the working directory, with Node's `fs`.
   */
  write?: (record: UnitRecord, key: string) => unknown;
  /** Where the runner says the test is, when it says. Otherwise the place comes from the stack of the call to `unit`. */
  locate?: (ctx: Ctx) => UnitPlace | undefined;
  /** The error a runner throws to skip a test from inside it: the test writes nothing. */
  isSkip?: (error: unknown) => boolean;
  /** A failure the runner recorded without throwing, such as a soft assertion, after the body returned. */
  failure?: (ctx: Ctx) => string | undefined;
}

export type UnitFn<Ctx> = (id: string, spec: UnitSpec, body: UnitBody<Ctx>, ...rest: any[]) => void;

export type Unit<Ctx> = UnitFn<Ctx> & { skip: UnitFn<Ctx>; only: UnitFn<Ctx> };

/** Files of this helper, whose frames the stack of a call to `unit` starts with. */
const OWN = new Set<string>();
export function ownFile(url: string): void {
  OWN.add(pathOf(url));
}
ownFile(import.meta.url);

export function createUnit<Ctx = unknown>(it: RunnerIt<Ctx>, options: CreateUnitOptions<Ctx> = {}): Unit<Ctx> {
  const write = options.write ?? defaultWrite;
  /** Declarations of each id at each place, so a loop that declares one id twice gets two keys. */
  const seen = new Map<string, number>();

  const declare = (register: RunnerIt<Ctx> | undefined, how: string): UnitFn<Ctx> =>
    function unit(id, spec, body, ...rest) {
      if (!register) throw new Error(`unit${how}: the runner's \`it\` has no \`${how.slice(1)}\``);
      const place = callerPlace(new Error().stack);
      let kind: UnitKind | undefined;
      let problem: unknown;
      try {
        kind = checkSpec(id, spec);
      } catch (e) {
        problem = e;
      }
      const title = kind ? `${kind} ${id}: ${sentence(kind, spec)}` : `unit ${String(id)}`;
      const base = `${String(id)}@${place?.file ?? '?'}:${place?.line ?? 0}`;
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      const key = n ? `${base}#${n}` : base;

      register(
        title,
        async (ctx: Ctx) => {
          const where = options.locate?.(ctx) ?? place ?? { file: '', line: 0 };
          const head = { skillunit: UNIT_CONTRACT, id, file: pathOf(where.file), line: where.line, test: title } as const;
          const failed = async (error: unknown) => {
            // An id that is not one cannot be named by a slot; nothing would read the record.
            if (typeof id === 'string' && UNIT_ID.test(id)) await write({ ...head, status: 'failed', error: messageOf(error) }, key);
          };
          if (problem) {
            await failed(problem);
            throw problem;
          }
          let value = spec.value;
          const examples: UnitExample[] = [];
          const u: UnitContext = {
            value(text) {
              if (kind !== 'fact') throw new Error(`unit \`${id}\`: \`u.value\` sets the Value of a fact, and this is a ${kind}`);
              if (typeof text !== 'string' || !text.trim()) throw new Error(`unit \`${id}\`: \`u.value\` takes text that is not empty`);
              value = text;
            },
            example(lang, text) {
              if (typeof lang !== 'string' || !/^[A-Za-z0-9_+.-]+$/.test(lang)) throw new Error(`unit \`${id}\`: \`u.example\` takes a fence language first, such as \`text\` or \`json\`; got ${JSON.stringify(lang)}`);
              if (typeof text !== 'string') throw new Error(`unit \`${id}\`: \`u.example\` takes the block's text as a string`);
              examples.push({ lang, text });
            },
          };
          try {
            await body(u, ctx);
            if (kind === 'fact' && value === undefined) {
              throw new Error(`unit \`${id}\`: the fact has no Value; give \`value\` in its spec or call \`u.value(text)\` in its body`);
            }
          } catch (e) {
            if (options.isSkip?.(e)) throw e;
            await failed(e);
            throw e;
          }
          const soft = options.failure?.(ctx);
          if (soft !== undefined) {
            await failed(soft);
            return;
          }
          const record: PassedUnit = { ...head, status: 'passed', kind: kind!, ...copySpec(spec), examples };
          if (value !== undefined) record.value = value;
          await write(record, key);
        },
        ...rest,
      );
    };

  return Object.assign(declare(it, ''), { skip: declare(it.skip?.bind(it), '.skip'), only: declare(it.only?.bind(it), '.only') });
}

/** The sentence a test is titled with: what the unit says. */
function sentence(kind: UnitKind, spec: UnitSpec): string {
  return (kind === 'rule' ? spec.do : kind === 'fact' ? spec.value : spec.decide) ?? spec.when;
}

/** The keys of the spec, in the contract's order, without the ones it leaves out. */
function copySpec(spec: UnitSpec): Omit<UnitSpec, 'value'> {
  const out: Omit<UnitSpec, 'value'> = { when: spec.when };
  if (spec.do !== undefined) out.do = spec.do;
  if (spec.decide !== undefined) out.decide = spec.decide;
  if (spec.paths !== undefined) out.paths = spec.paths.map((p) => ({ path: p.path, when: p.when }));
  if (spec.unknown !== undefined) out.unknown = spec.unknown;
  if (spec.evenWhen !== undefined) out.evenWhen = spec.evenWhen;
  if (spec.check !== undefined) out.check = spec.check;
  if (spec.values !== undefined) out.values = { ...spec.values };
  return out;
}

function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || error.name;
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

/** A frame of a stack: V8's `at f (file:1:2)` and `at file:1:2`, and `f@file:1:2` elsewhere. */
const FRAME = /(?:\(|@|\bat )((?:file:\/\/)?[^()\s@]+?):(\d+):(\d+)\)?\s*$/;

/** The first frame of `stack` outside this helper: the line that called `unit`. */
export function callerPlace(stack: string | undefined): UnitPlace | undefined {
  for (const line of (stack ?? '').split('\n')) {
    const m = FRAME.exec(line);
    if (!m) continue;
    const file = pathOf(m[1]!);
    if (OWN.has(file) || file.startsWith('node:') || !/[\\/]/.test(file)) continue;
    return { file, line: Number(m[2]) };
  }
  return undefined;
}

/** A path from a path or a `file:` URL. */
export function pathOf(file: string): string {
  if (!file.startsWith('file://')) return file;
  const path = decodeURIComponent(new URL(file).pathname);
  // `file:///C:/x` is `C:/x` on Windows.
  return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path;
}

let nodeWrite: ((record: UnitRecord, key: string) => void) | undefined;
async function defaultWrite(record: UnitRecord, key: string): Promise<void> {
  nodeWrite ??= (await import('./write.js')).writeUnit;
  nodeWrite(record, key);
}

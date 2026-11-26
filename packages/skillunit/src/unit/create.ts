/**
 * `createUnit(it, options)` gives `unit` and `ask`, which declare the units of the skill and the
 * questions for the decision model in the project's tests. Both register a test with the
 * runner's own `it`, so loops, `describe`, `beforeEach` and the project's mocks work as in any
 * test.
 *
 * `unit(id, spec, body)`: when the body passes, the unit is written as a `PassedUnit`; when it
 * throws, as a `FailedUnit`, and the error is thrown again. Without a body, the unit is one no
 * test proves, such as advice: its record says so. A skipped test writes nothing.
 *
 * `ask(id, spec)`: a question about the prose of a built file, which belongs to no unit.
 *
 * Questions are checked when they are declared and written in the records. The runner asks the
 * model nothing: SkillUnit asks them after the build.
 *
 * This module imports nothing from Node at load time: a runner that cannot write files passes
 * its own `write`, and the default one is loaded only when a unit is written.
 */
import { checkAsk, checkNumbers, checkQuestions, checkSpec, FENCE_LANG, QUESTION_ID, UNIT_CONTRACT, UNIT_ID, UnitSpecError, type AskedQuestion, type AskSpec, type PassedQuestion, type PassedUnit, type UnitExample, type UnitKind, type UnitRecord, type UnitSpec } from './contract.js';

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

export type UnitFn<Ctx> = (id: string, spec: UnitSpec, body?: UnitBody<Ctx>, ...rest: any[]) => void;

export type Unit<Ctx> = UnitFn<Ctx> & { skip: UnitFn<Ctx>; only: UnitFn<Ctx> };

export type AskFn = (id: string, spec: AskSpec, ...rest: any[]) => void;

export type Ask = AskFn & { skip: AskFn; only: AskFn };

/** Files of this helper, whose frames the stack of a call to `unit` starts with. */
const OWN = new Set<string>();
export function ownFile(url: string): void {
  OWN.add(pathOf(url));
}
ownFile(import.meta.url);

export function createUnit<Ctx = unknown>(it: RunnerIt<Ctx>, options: CreateUnitOptions<Ctx> = {}): { unit: Unit<Ctx>; ask: Ask } {
  const write = options.write ?? defaultWrite;
  /** Declarations of each id at each place, so a loop that declares one id twice gets two keys. */
  const seen = new Map<string, number>();
  /** The id of each question declared so far, and what declared it. */
  const asked = new Map<string, string>();

  /** A key for one declaration: the same across runs, and different for two declarations. */
  const keyOf = (prefix: string, id: unknown, place: UnitPlace | undefined) => {
    const base = `${prefix}${String(id)}@${place?.file ?? '?'}:${place?.line ?? 0}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}#${n}` : base;
  };
  /** Throws when a question has the id of one declared before; otherwise claims the ids. */
  const claim = (questions: AskedQuestion[], who: string, owner: string) => {
    for (const q of questions) {
      const other = asked.get(q.id);
      if (other) throw new UnitSpecError(`${who}: the question \`${q.id}\` has the id of a question of ${other}; give one of them another \`id\``);
    }
    for (const q of questions) asked.set(q.id, owner);
  };
  const where = (place: UnitPlace | undefined) => (place ? `${place.file}:${place.line}` : 'unknown place');

  const declareUnit = (register: RunnerIt<Ctx> | undefined, how: string): UnitFn<Ctx> =>
    function unit(id, spec, body, ...rest) {
      if (!register) throw new Error(`unit${how}: the runner's \`it\` has no \`${how.slice(1)}\``);
      const place = callerPlace(new Error().stack);
      let kind: UnitKind | undefined;
      let questions: AskedQuestion[] | undefined;
      let problem: unknown;
      try {
        kind = checkSpec(id, spec);
        if (body !== undefined && typeof body !== 'function') {
          throw new UnitSpecError(`unit \`${id}\`: the third argument is the body of the test, a function; leave it out for a unit no test proves`);
        }
        if (body === undefined && kind === 'fact' && spec.value === undefined) {
          throw new UnitSpecError(`unit \`${id}\`: the fact has no Value; a unit with no body gives \`value\` in its spec`);
        }
        if (spec.ask !== undefined) questions = checkQuestions(id, spec.ask);
        claim(questions ?? [], `unit \`${id}\``, `the unit \`${id}\` (${where(place)})`);
      } catch (e) {
        problem = e;
      }
      const title = kind ? `${kind} ${id}: ${sentence(kind, spec)}` : `unit ${String(id)}`;
      const key = keyOf('', id, place);

      register(
        title,
        async (ctx: Ctx) => {
          const at = options.locate?.(ctx) ?? place ?? { file: '', line: 0 };
          const head = { skillunit: UNIT_CONTRACT, id, file: pathOf(at.file), line: at.line, test: title } as const;
          const failed = async (error: unknown) => {
            // An id that is not one cannot be named by a slot; nothing would read the record.
            if (typeof id === 'string' && UNIT_ID.test(id)) await write({ ...head, status: 'failed', error: messageOf(error) }, key);
          };
          if (problem) {
            await failed(problem);
            throw problem;
          }
          let value = spec.value;
          const examples: UnitExample[] = (spec.examples ?? []).map((x) => ({ lang: x.lang, text: x.text }));
          if (body) {
            const u: UnitContext = {
              value(text) {
                if (kind !== 'fact') throw new Error(`unit \`${id}\`: \`u.value\` sets the Value of a fact, and this is a ${kind}`);
                if (typeof text !== 'string' || !text.trim()) throw new Error(`unit \`${id}\`: \`u.value\` takes text that is not empty`);
                value = text;
              },
              example(lang, text) {
                if (kind === 'decision') throw new Error(`unit \`${id}\`: a decision shows its examples in its paths, from the regions \`skill:${id}.<path>\`; \`u.example\` is for a rule or a fact`);
                if (typeof lang !== 'string' || !FENCE_LANG.test(lang)) throw new Error(`unit \`${id}\`: \`u.example\` takes a fence language first, such as \`text\` or \`json\`; got ${JSON.stringify(lang)}`);
                if (typeof text !== 'string') throw new Error(`unit \`${id}\`: \`u.example\` takes the block's text as a string`);
                examples.push({ lang, text });
              },
            };
            try {
              await body(u, ctx);
              if (kind === 'fact' && value === undefined) {
                throw new Error(`unit \`${id}\`: the fact has no Value; give \`value\` in its spec or call \`u.value(text)\` in its body`);
              }
              checkNumbers(id, { ...spec, value });
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
          }
          const record: PassedUnit = { ...head, status: 'passed', kind: kind!, ...(body ? {} : { body: false as const }), ...copySpec(spec, questions), examples };
          if (value !== undefined) record.value = value;
          await write(record, key);
        },
        ...rest,
      );
    };

  const declareAsk = (register: RunnerIt<Ctx> | undefined, how: string): AskFn =>
    function ask(id, spec, ...rest) {
      if (!register) throw new Error(`ask${how}: the runner's \`it\` has no \`${how.slice(1)}\``);
      const place = callerPlace(new Error().stack);
      let checked: ReturnType<typeof checkAsk> | undefined;
      let problem: unknown;
      try {
        checked = checkAsk(id, spec);
        claim([checked.question], `ask \`${id}\``, `\`ask('${id}')\` (${where(place)})`);
      } catch (e) {
        problem = e;
      }
      const title = checked ? `question ${id}: ${checked.question.question}` : `question ${String(id)}`;
      const key = keyOf('ask:', id, place);

      register(
        title,
        async (ctx: Ctx) => {
          const at = options.locate?.(ctx) ?? place ?? { file: '', line: 0 };
          const head = { skillunit: UNIT_CONTRACT, id, file: pathOf(at.file), line: at.line, test: title } as const;
          if (problem) {
            if (typeof id === 'string' && QUESTION_ID.test(id)) await write({ ...head, status: 'failed', kind: 'question', error: messageOf(problem) }, key);
            throw problem;
          }
          const record: PassedQuestion = { ...head, status: 'passed', kind: 'question', skillFile: checked!.skillFile, ask: [checked!.question] };
          await write(record, key);
        },
        ...rest,
      );
    };

  const unit = Object.assign(declareUnit(it, ''), { skip: declareUnit(it.skip?.bind(it), '.skip'), only: declareUnit(it.only?.bind(it), '.only') });
  const ask = Object.assign(declareAsk(it, ''), { skip: declareAsk(it.skip?.bind(it), '.skip'), only: declareAsk(it.only?.bind(it), '.only') });
  return { unit, ask };
}

/** The sentence a test is titled with: what the unit says. */
function sentence(kind: UnitKind, spec: UnitSpec): string {
  return (kind === 'rule' ? spec.do : kind === 'fact' ? spec.value : spec.decide) ?? spec.when;
}

/** The keys of the spec, in the contract's order, without the ones it leaves out. */
function copySpec(spec: UnitSpec, questions: AskedQuestion[] | undefined): Pick<PassedUnit, 'when' | 'do' | 'decide' | 'paths' | 'unknown' | 'evenWhen' | 'check' | 'values' | 'ask'> {
  const out: ReturnType<typeof copySpec> = { when: spec.when };
  if (spec.do !== undefined) out.do = spec.do;
  if (spec.decide !== undefined) out.decide = spec.decide;
  if (spec.paths !== undefined) out.paths = spec.paths.map((p) => ({ path: p.path, when: p.when }));
  if (spec.unknown !== undefined) out.unknown = spec.unknown;
  if (spec.evenWhen !== undefined) out.evenWhen = spec.evenWhen;
  if (spec.check !== undefined) out.check = spec.check;
  if (spec.values !== undefined) out.values = { ...spec.values };
  if (questions) out.ask = questions;
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

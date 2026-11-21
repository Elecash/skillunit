/** Helpers shared by the lint rules that look at code: whose a fence is, its `Setup`, `Wrong` code. */
import type { Fence, FenceOwner, ParsedFile, ParsedSkill, Unit } from '../units/index.js';

/** The unit a fence belongs to, if any. */
export function ownerUnit(owner: FenceOwner): string | undefined {
  return 'unit' in owner ? owner.unit : undefined;
}

/** Fences that are examples an agent may copy: they must compile and follow every `Check`. */
export function isExample(fence: Fence): boolean {
  const kind = fence.owner.kind;
  return kind === 'reference' || kind === 'right' || kind === 'decide';
}

export const isNoCheck = (fence: Fence) => fence.flags.includes('no-check');

/**
 * The file's own `Setup` for a block of `lang`: the `Setup` of that language, or for `tsx` and
 * `jsx`, the `ts` or `js` one when the file has no `tsx` or `jsx` Setup.
 */
export function ownSetup(file: ParsedFile, lang: string): Fence | undefined {
  const fallback: Record<string, string> = { tsx: 'ts', jsx: 'js' };
  return file.setup[lang] ?? (fallback[lang] ? file.setup[fallback[lang]] : undefined);
}

const indexes = new WeakMap<ParsedSkill, Map<string, ParsedFile>>();

/**
 * The `SKILL.md` files above a file, the nearest first: the one of its folder, then those of the
 * folders above, up to the skill folder. A `SKILL.md` starts from the folder above its own, so a
 * nested skill's list goes on with the skill it is nested in.
 */
export function skillIndexesOf(skill: ParsedSkill, file: ParsedFile): ParsedFile[] {
  if (!indexes.has(skill)) indexes.set(skill, new Map(skill.files.map((f) => [f.file, f])));
  const byPath = indexes.get(skill)!;
  const parts = file.file.split('/');
  const out: ParsedFile[] = [];
  for (let n = parts.length - (parts.at(-1) === 'SKILL.md' ? 2 : 1); n >= 0; n--) {
    const index = byPath.get([...parts.slice(0, n), 'SKILL.md'].join('/'));
    if (index) out.push(index);
  }
  return out;
}

/** A `Setup` and the file that declares it. */
export interface SetupSource {
  fence: Fence;
  file: ParsedFile;
}

/**
 * The `Setup` a block of `lang` in `file` uses: the file's own (see `ownSetup`), or when it has
 * none for that language, the one of the nearest `SKILL.md` above it that has one. One `Setup`,
 * never two added together.
 */
export function setupFor(skill: ParsedSkill, file: ParsedFile, lang: string): SetupSource | undefined {
  for (const source of [file, ...skillIndexesOf(skill, file)]) {
    const fence = ownSetup(source, lang);
    if (fence) return { fence, file: source };
  }
  return undefined;
}

/** The languages that have a `Setup` for `file`, its own or one of a `SKILL.md` above it. */
export function setupLanguages(skill: ParsedSkill, file: ParsedFile): string[] {
  return [...new Set([file, ...skillIndexesOf(skill, file)].flatMap((f) => Object.keys(f.setup)))];
}

/** Code of a `Wrong` item: its `Doing` when that is one code span, or a fence inside the item. */
export interface WrongCode {
  file: ParsedFile;
  unit: Unit;
  item: number;
  kind: 'inline' | 'fence';
  code: string;
  /** Markdown line of the code's first line. */
  line: number;
  /** null when the language cannot be told: a span in a unit with no `Right` fence, in a file with no single `Setup`. */
  lang: string | null;
  fence?: Fence;
}

export function collectWrongCode(skill: ParsedSkill): WrongCode[] {
  const out: WrongCode[] = [];
  for (const file of skill.files) {
    for (const unit of file.units) {
      const right = unit.right.find((r): r is Fence => r.type === 'fence');
      const setups = setupLanguages(skill, file);
      const spanLang = right?.lang || (setups.length === 1 ? setups[0]! : null);
      unit.wrong.forEach((w, item) => {
        if (w.code) out.push({ file, unit, item, kind: 'inline', code: w.code.code, line: w.code.line, lang: spanLang });
        for (const fence of w.fences) {
          out.push({ file, unit, item, kind: 'fence', code: fence.code, line: fence.line + 1, lang: fence.lang || null, fence });
        }
      });
    }
  }
  return out;
}

/** The text of a match, shortened for a message. */
export function snippet(text: string, max = 60): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

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
 * The `Setup` a block of `lang` uses: the file's `Setup` of that language, or for `tsx` and
 * `jsx`, the `ts` or `js` one when the file has no `tsx` or `jsx` Setup.
 */
export function setupFor(file: ParsedFile, lang: string): Fence | undefined {
  const fallback: Record<string, string> = { tsx: 'ts', jsx: 'js' };
  return file.setup[lang] ?? (fallback[lang] ? file.setup[fallback[lang]] : undefined);
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
      const setups = Object.keys(file.setup);
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

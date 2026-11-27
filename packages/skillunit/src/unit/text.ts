/**
 * Lists in a sentence, for the text a test builds from what its body reads: `and(code(names))` is
 * `` `a`, `b` and `c` ``. They load nothing, so a test imports them with `key`.
 */

/** `a`, `a and b`, `a, b and c`. */
export const and = (items: readonly string[]): string => list(items, 'and');
/** `a`, `a or b`, `a, b or c`. */
export const or = (items: readonly string[]): string => list(items, 'or');
/** Each item in backticks, a code span of Markdown. */
export const code = (items: readonly string[]): string[] => items.map((i) => `\`${i}\``);

const list = (items: readonly string[], word: string) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ${word} ${items.at(-1)}`);

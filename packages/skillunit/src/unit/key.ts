/**
 * A name of the code a sentence gives, from a value its types hold: `key<RequestOptions>('retry')`
 * accepts only a key of `RequestOptions`, so a key renamed or removed fails the type-check of
 * every test that still names it. It returns the name as it is, and loads nothing.
 */
export const key = <T>(name: Extract<keyof T, string>): Extract<keyof T, string> => name;

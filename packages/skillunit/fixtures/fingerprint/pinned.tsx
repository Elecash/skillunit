// The fingerprint test pins the normalised text and the fingerprint of this file and of its
// symbols. Do not edit or format it: a change here, or a parser upgrade that cuts the tokens
// differently, fails that test on purpose. If the parser's tokens change, the lock's `version`
// goes up.
import type { ReactNode } from 'react';

/** Overloads, with generics. */
export function pick<T>(items: T[]): T;
export function pick<T>(items: T[], count: number): T[];
export function pick<T>(items: T[], count?: number): T | T[] {
  return count === undefined ? items[0]! : items.slice(0, count);
}

export const pair = <A, B extends object = {}>(a: A, b: B): [A, B] => [a, b];

type Partial2<T> = { [K in keyof T]?: T[K] };

// Not comments: a regular expression, and a template literal over two lines.
const SLASHES = /\/\/[^\n]*|\/\*.*?\*\//g;
const greeting = `hello ${'world' /* inside the braces */} // still the template
second   line`;

function sealed(target: unknown) {}
function log(_: unknown, context: ClassMemberDecoratorContext) {}

@sealed
export class Panel<Props extends { title: string }> {
  @log accessor open = false;

  @log
  render(props: Props): ReactNode {
    return (
      <section className="panel" data-title={`a ${props.title}`}>
        {/* a JSX comment */}
        <h1>{props.title}</h1>
        text   that
        wraps
      </section>
    );
  }
}

export namespace Api {
  export const version = 1 satisfies number;
}

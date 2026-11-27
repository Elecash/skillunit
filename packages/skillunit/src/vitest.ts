/**
 * `import { unit, ask, setup } from 'skillunit/vitest'`: `unit(id, spec, body)` registers a Vitest test
 * that proves a unit of the skill, and leaves the unit in the `proof.units` folder when it
 * passes; without a body, it declares a unit no test proves. `ask(id, spec)` declares a question
 * about the prose of a built file. `setup(id, spec)` declares a file of the skill, which the units
 * and questions after it in the test file belong to. `key<T>(name)` is a name the types of the
 * code hold, and `and()`, `or()` and `code()` list names in a sentence.
 */
import { it, type TestContext } from 'vitest';
import { createUnit, ownFile } from './unit/create.js';
import { vitestOptions } from './unit/vitest-options.js';
import { removeUnit, writeUnit } from './unit/write.js';

ownFile(import.meta.url);

export const { unit, ask, setup } = createUnit<TestContext>(it as never, { write: writeUnit, remove: removeUnit, ...vitestOptions });

export { key } from './unit/key.js';
export { and, code, or } from './unit/text.js';
export type { AskSpec, SetupSpec, UnitContext, UnitQuestion, UnitSpec } from './unit/index.js';

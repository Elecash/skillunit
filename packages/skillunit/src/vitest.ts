/**
 * `import { unit } from 'skillunit/vitest'`: `unit(id, spec, body)` registers a Vitest test that
 * proves a unit of the skill, and leaves the unit in the `proof.units` folder when it passes.
 */
import { it, type TestContext } from 'vitest';
import { createUnit, ownFile } from './unit/create.js';
import { writeUnit } from './unit/write.js';

ownFile(import.meta.url);

export const unit = createUnit<TestContext>(it as never, {
  write: writeUnit,
  // Vitest knows the line only with `includeTaskLocation`; otherwise the stack of the call gives it.
  locate: (ctx) => (ctx.task.location ? { file: ctx.task.file.filepath, line: ctx.task.location.line } : undefined),
  // `ctx.skip()` throws this to skip the test from inside it.
  isSkip: (e) => (e as { code?: unknown } | null)?.code === 'VITEST_PENDING',
  // `expect.soft` fails the test without throwing.
  failure: (ctx) => (ctx.task.result?.state === 'fail' ? (ctx.task.result.errors?.[0]?.message ?? 'the test failed') : undefined),
});

export type { UnitContext, UnitSpec } from './unit/index.js';

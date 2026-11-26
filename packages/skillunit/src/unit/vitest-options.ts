/**
 * How `skillunit/vitest` reads a Vitest test: where it is, how it is skipped, a failure that did
 * not throw, and how many assertions it made. `vitest.ts` passes these to `createUnit`.
 */
import { expect, type TestContext } from 'vitest';
import type { CreateUnitOptions } from './create.js';

export const vitestOptions: Omit<CreateUnitOptions<TestContext>, 'write'> = {
  // Vitest knows the line only with `includeTaskLocation`; otherwise the stack of the call gives it.
  locate: (ctx) => (ctx.task.location ? { file: ctx.task.file.filepath, line: ctx.task.location.line } : undefined),
  // `ctx.skip()` throws this to skip the test from inside it.
  isSkip: (e) => (e as { code?: unknown } | null)?.code === 'VITEST_PENDING',
  // `expect.soft` fails the test without throwing.
  failure: (ctx) => (ctx.task.result?.state === 'fail' ? (ctx.task.result.errors?.[0]?.message ?? 'the test failed') : undefined),
  // The assertions of the global `expect`, and of the test context's own when the body used it.
  assertions: (ctx) => expect.getState().assertionCalls + (ctx.expect === expect ? 0 : ctx.expect.getState().assertionCalls),
};

// The tests behind vitest.xml. To regenerate, copy this file as sample.test.ts into an empty
// folder and run there:
//   npx vitest run --root . --reporter=junit --outputFile=vitest.xml
// then set `hostname` to localhost.
import { describe, expect, it } from 'vitest';

describe('retries', () => {
  it('reads the defaults [skill:retry-defaults]', () => {
    expect(1).toBe(1);
  });
  it('covers two units [skill:retry-network] [skill:retry-5xx]', () => {
    expect(1).toBe(1);
  });
  it('fails [skill:retry-fails]', () => {
    expect(1).toBe(2);
  });
  it.skip('is skipped [skill:retry-skipped]', () => {});
  it('throws [skill:retry-throws]', () => {
    throw new Error('boom & <done>');
  });
});

describe('errors [skill:errors-in-describe]', () => {
  it('passes a title with "quotes" & <angle> brackets', () => {
    expect(true).toBe(true);
  });
});

it('has no tag', () => {
  expect(1).toBe(1);
});

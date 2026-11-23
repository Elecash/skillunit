// The tests behind jest.xml. To regenerate, copy this file as sample.test.js into an empty
// folder, install jest@29 and jest-junit@16 there, and run:
//   JEST_JUNIT_OUTPUT_NAME=jest.xml npx jest --ci --reporters=default --reporters=jest-junit
// then replace the folder's path in the stack traces with /project.
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

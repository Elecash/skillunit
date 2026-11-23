import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    // The JUnit report is what `skillunit proof` reads to see which units of the skill the tests prove.
    reporters: ['default', 'junit'],
    outputFile: { junit: './reports/junit.xml' },
  },
});

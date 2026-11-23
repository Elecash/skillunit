import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Asks the real APIs; `vitest.contract.config.ts` runs it.
    exclude: [...configDefaults.exclude, 'src/models/contract.test.ts'],
    testTimeout: 30_000,
    // The JUnit report is what `skillunit proof` reads to see which units of the skill the tests prove.
    reporters: ['default', 'junit'],
    outputFile: { junit: './reports/junit.xml' },
  },
});

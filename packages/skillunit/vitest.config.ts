import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Asks the real APIs; `vitest.contract.config.ts` runs it.
    exclude: [...configDefaults.exclude, 'src/models/contract.test.ts'],
    testTimeout: 30_000,
  },
});

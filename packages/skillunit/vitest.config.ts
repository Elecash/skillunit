import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The tests of the skill import SkillUnit by its name, as a project does; this is its source.
    alias: {
      'skillunit/vitest': fileURLToPath(new URL('./src/vitest.ts', import.meta.url)),
      'skillunit/unit': fileURLToPath(new URL('./src/unit/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Asks the real APIs; `vitest.contract.config.ts` runs it.
    exclude: [...configDefaults.exclude, 'src/models/contract.test.ts'],
    testTimeout: 30_000,
  },
});

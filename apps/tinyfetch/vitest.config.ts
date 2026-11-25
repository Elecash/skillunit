import { defineConfig } from 'vitest/config';

// `skillunit proof` runs these tests through `proof.run` and reads the units they leave in
// `tmp/skill-units`. It empties that folder before the run.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});

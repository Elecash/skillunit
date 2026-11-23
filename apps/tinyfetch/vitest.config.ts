import { rmSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// `skillunit proof` reads what the run leaves: the JUnit report, and the examples tests write
// with `skillExample`. A file left from an earlier run would pass for this one, so the folder is
// emptied before the tests start.
rmSync(new URL('./tmp/skill-proof', import.meta.url), { recursive: true, force: true });

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    reporters: ['default', 'junit'],
    outputFile: { junit: './reports/junit.xml' },
  },
});

import { defineConfig } from 'vitest/config';

// Each scenario copies the app, runs git and the built CLI, and type-checks the skill's examples.
export default defineConfig({ test: { include: ['src/**/*.test.ts'], testTimeout: 300_000 } });

import { defineConfig } from 'vitest/config';
import { loadEnv } from './src/env.js';

// The keys come from the environment, or from a .env file here or in a folder above, up to the
// git root: the same files the CLI reads.
loadEnv(process.cwd());

export default defineConfig({
  test: {
    include: ['src/models/contract.test.ts'],
    testTimeout: 90_000,
  },
});

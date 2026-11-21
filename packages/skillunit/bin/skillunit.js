#!/usr/bin/env node
// The `skillunit` command. It lives outside `dist`, so npm links it at install, before the first
// build, and a build cannot drop its execute bit.
import { existsSync } from 'node:fs';

const cli = new URL('../dist/cli.js', import.meta.url);
if (existsSync(cli)) {
  await import(cli.href);
} else {
  // No `process.exit`: it can cut what stderr has not written yet when stderr is a pipe.
  process.stderr.write('skillunit: dist/cli.js is missing; build it first with `npx nx build skillunit`\n');
  process.exitCode = 2;
}

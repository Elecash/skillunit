// Runs `tsc` from the workspace's `typescript` package (6.x). `.bin/tsc` is not reliable
// here: the tests also install TypeScript 7 under the alias `typescript-7`, and npm links
// whichever `tsc` it installs last.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const run = spawnSync(process.execPath, [tsc, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(run.status ?? 1);

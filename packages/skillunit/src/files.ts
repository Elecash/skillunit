/** Files of a skill folder. */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Every `.md` file under `dir`, as sorted paths with `/`, skipping dot folders and node_modules. */
export function listMarkdown(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(dir, prefix)).sort()) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(join(dir, rel)).isDirectory()) out.push(...listMarkdown(dir, rel));
    else if (name.endsWith('.md')) out.push(rel);
  }
  return out;
}

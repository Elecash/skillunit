/** Running a command of the settings through the shell, and showing what it printed. */

/** Quotes a path for `sh` and `cmd`. */
export function quote(path: string): string {
  return process.platform === 'win32' ? `"${path}"` : `'${path.replaceAll("'", "'\\''")}'`;
}

/** Lines of a command's output kept in a finding, and characters per line. */
const OUTPUT_LINES = 12;
const LINE_CHARS = 200;

/**
 * What a command printed, for a finding: its non-empty lines, at most `OUTPUT_LINES`, with each
 * temp file it was given named by `place`, since that file is gone.
 */
export function output(text: string, temp: string[], place: string): string {
  let out = text;
  for (const path of temp) out = out.split(path).join(place);
  const lines = out
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim());
  const kept = lines.slice(0, OUTPUT_LINES).map((l) => (l.length > LINE_CHARS ? `${l.slice(0, LINE_CHARS - 1)}…` : l));
  if (lines.length > OUTPUT_LINES) kept.push(`(${lines.length - OUTPUT_LINES} more lines)`);
  return kept.join('\n');
}

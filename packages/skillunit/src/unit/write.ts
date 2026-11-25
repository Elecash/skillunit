/**
 * The default `write` of `createUnit`, for runners in Node: the record goes to
 * `<proof.units>/<id>.<hash>.json` of the nearest `skillunit.yaml` above the working directory,
 * with `file` made relative to that file's folder.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { CONFIG_FILE, DEFAULT_PROOF_UNITS, loadConfig } from '../config.js';
import type { UnitRecord } from './contract.js';

interface Target {
  /** Folder of `skillunit.yaml`. */
  root: string;
  /** Where units go. */
  units: string;
}

const targets = new Map<string, Target>();

export function writeUnit(record: UnitRecord, key: string): string {
  const { root, units } = unitsTarget(process.cwd());
  const file = isAbsolute(record.file) ? relative(root, record.file).split('\\').join('/') : record.file;
  mkdirSync(units, { recursive: true });
  const path = join(units, `${record.id}.${hash(key)}.json`);
  writeFileSync(path, `${JSON.stringify({ ...record, file }, null, 2)}\n`);
  return path;
}

/** The folder of the nearest `skillunit.yaml` at or above `from`, and its `proof.units`. */
export function unitsTarget(from: string): Target {
  const start = resolve(from);
  const cached = targets.get(start);
  if (cached) return cached;
  for (let dir = start; ; dir = dirname(dir)) {
    const file = join(dir, CONFIG_FILE);
    if (existsSync(file)) {
      const target = { root: dir, units: loadConfig(file).proof?.units ?? resolve(dir, DEFAULT_PROOF_UNITS) };
      targets.set(start, target);
      return target;
    }
    if (dirname(dir) === dir) break;
  }
  throw new Error(`unit: no ${CONFIG_FILE} in ${start} or a folder above it; run the tests from the project that has one`);
}

/** FNV-1a, 32 bits, as 8 hex digits: short, and the same on every machine. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

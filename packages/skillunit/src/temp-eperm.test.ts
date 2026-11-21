// `EPERM`, as a sandbox that forbids deleting gives it, cannot be made with `chmod`, so `rmSync`
// is replaced here: it fails the way it does after its own retries.
import { describe, expect, it, vi } from 'vitest';

const rmSync = vi.hoisted(() =>
  vi.fn(() => {
    throw Object.assign(new Error("EPERM: operation not permitted, unlink '/x/a.ts'"), { code: 'EPERM' });
  }),
);
vi.mock('node:fs', async (original) => ({ ...(await original<typeof import('node:fs')>()), rmSync }));

const { removeTemp } = await import('./temp.js');

describe('removeTemp on EPERM', () => {
  it('asks rmSync to retry, then warns instead of throwing', () => {
    const warnings: string[] = [];
    expect(() => removeTemp('/x', (m) => warnings.push(m))).not.toThrow();
    expect(rmSync).toHaveBeenCalledWith('/x', { recursive: true, force: true, maxRetries: 3 });
    expect(warnings).toEqual(['could not remove the temporary folder /x (EPERM); delete it yourself']);
  });
});

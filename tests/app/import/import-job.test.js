/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach } from 'vitest';

const { beginImport, endImport, isCurrentImport, cancelImport } = await import(
  '@/app/import/import-job.js'
);

describe('import jobs', () => {
  beforeEach(() => {
    cancelImport();
  });

  it('cancels the previous job when a new one starts', () => {
    const first = beginImport('first');
    const second = beginImport('second');

    expect(first.signal.aborted).toBe(true);
    expect(isCurrentImport(first)).toBe(false);
    expect(isCurrentImport(second)).toBe(true);
  });

  it('does not let an old job clear the current state', () => {
    const first = beginImport('first');
    const second = beginImport('second');

    expect(endImport(first)).toBe(false);
    expect(isCurrentImport(second)).toBe(true);
    expect(endImport(second)).toBe(true);
  });
});

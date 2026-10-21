import { describe, it, expect } from 'vitest';
import { installBrowserStubs } from './helpers.js';

installBrowserStubs();

/**
 * The paste classification decides whether narration is interrupted, so it
 * is tested on its own — the DOM handler only collects the numbers.
 */
const { classifyPaste } = await import('../src/app/editor.js');

describe('classifyPaste', () => {
  it('treats a paste over the whole document as a replacement', () => {
    expect(classifyPaste(1000, 0, 1000, 50)).toBe('replaced');
  });

  it('treats a paste over most of the document as a replacement', () => {
    expect(classifyPaste(1000, 0, 900, 50)).toBe('replaced');
  });

  it('treats a paste that becomes most of the document as a replacement', () => {
    // 100 characters pasted into a nearly empty document
    expect(classifyPaste(20, 0, 0, 100)).toBe('replaced');
  });

  it('treats a small paste in the middle as an edit', () => {
    expect(classifyPaste(1000, 100, 120, 30)).toBe('edited');
  });

  it('treats a paste into an empty document as a replacement', () => {
    expect(classifyPaste(0, 0, 0, 200)).toBe('replaced');
  });

  it('treats a paste that replaces a small part of a large document as an edit', () => {
    expect(classifyPaste(5000, 2500, 2510, 120)).toBe('edited');
  });

  it('handles an inverted selection defensively', () => {
    expect(classifyPaste(100, 80, 20, 10)).toBe('edited');
  });
});

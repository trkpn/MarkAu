/**
 * An import brings in a document, so it becomes the document.
 *
 * The text of the old document must not stay in the editor, mixed into the
 * text that came in.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { installBrowserStubs } from './helpers.js';

installBrowserStubs();

/**
 * A stand-in for the editor — the same shape the paste tests use.
 */
function createFakeEditor() {
  const listeners = new Map();

  return {
    value: '',
    selectionStart: 0,
    selectionEnd: 0,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event);
      return true;
    },
    focus() {},
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    setRangeText(text, start, end) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
    }
  };
}

const fakeEditor = createFakeEditor();

globalThis.document.getElementById = (id) => (id === 'editor' ? fakeEditor : null);
globalThis.document.execCommand = () => false;

const { runImport } = await import('../src/app/url-import.js');

/**
 * Answers the call for the README of a repository.
 */
function mockFetch() {
  const readme = '# The README\n\nThe words of the readme.';

  globalThis.fetch = async (url) => {
    if (String(url).includes('api.github.com')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: Buffer.from(readme, 'utf8').toString('base64')
        })
      };
    }

    throw new Error(`unexpected request: ${url}`);
  };
}

describe('an import', () => {
  beforeEach(() => {
    fakeEditor.value = 'THE OLD CONTENT';
    mockFetch();
  });

  it('becomes the document', async () => {
    const done = await runImport('https://github.com/owner/repository');

    expect(done).toBe(true);
    expect(fakeEditor.value).toContain('The words of the readme.');
  });

  it('leaves nothing of the old document behind', async () => {
    await runImport('https://github.com/owner/repository');

    expect(fakeEditor.value).not.toContain('THE OLD CONTENT');
  });
});

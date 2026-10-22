import { describe, it, expect, beforeEach } from 'vitest';
import { installBrowserStubs } from './helpers.js';

installBrowserStubs();

/**
 * The buffer only needs a value, a selection and `setRangeText` — a small
 * stand-in keeps the tests free of a DOM implementation.
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
      (listeners.get(event.type) || []).forEach((fn) => fn(event));
      return true;
    },
    focus() {},
    setSelectionRange(start, end) {
      this.selectionStart = start;
      this.selectionEnd = end;
    },
    setRangeText(text, start, end, mode) {
      this.value = this.value.slice(0, start) + text + this.value.slice(end);
      const caret = mode === 'end' ? start + text.length : start;
      this.selectionStart = caret;
      this.selectionEnd = caret;
    }
  };
}

const fakeEditor = createFakeEditor();

const fakeElements = {
  editor: fakeEditor,
  'line-numbers': { textContent: '' },
  'doc-stats': { textContent: '' },
  'reading-time': { textContent: '' }
};

globalThis.document.getElementById = (id) => fakeElements[id] ?? null;
// The browser API that keeps the native undo history. It does not exist
// here, so the fallback path of the editor is the one under test.
globalThis.document.execCommand = () => false;

/**
 * The paste classification decides whether narration is interrupted, so it
 * is tested on its own — the DOM handler only collects the numbers.
 */
const { classifyPaste, insertText, initEditor, onContentChange } = await import(
  '../src/app/editor.js'
);
const { isEditorHidden } = await import('../src/app/paste.js');
const { saveSettings } = await import('../src/settings-manager.js');

// Registers the real mutation pipeline on the fake editor.
initEditor({});

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

describe('insertText', () => {
  beforeEach(() => {
    fakeEditor.value = '';
    fakeEditor.selectionStart = 0;
    fakeEditor.selectionEnd = 0;
  });

  it('inserts the text at the caret', () => {
    fakeEditor.value = 'Hello world';
    fakeEditor.selectionStart = 5;
    fakeEditor.selectionEnd = 5;

    insertText(' there');

    expect(fakeEditor.value).toBe('Hello there world');
  });

  it('replaces the selection, exactly like a manual paste', () => {
    fakeEditor.value = 'Hello world';
    fakeEditor.selectionStart = 0;
    fakeEditor.selectionEnd = 5;

    insertText('Goodbye');

    expect(fakeEditor.value).toBe('Goodbye world');
  });

  it('replaces the whole document when asked to', () => {
    fakeEditor.value = 'The old document';

    insertText('# The new document', { replaceDocument: true });

    expect(fakeEditor.value).toBe('# The new document');
  });

  it('announces a document replacement as a replacement', () => {
    const reasons = [];
    const stop = onContentChange(({ reason }) => reasons.push(reason));

    fakeEditor.value = 'Old content';
    insertText('A completely new document', { replaceDocument: true });
    stop();

    expect(reasons).toEqual(['replaced']);
  });

  it('announces a small insertion as an edit', () => {
    const reasons = [];
    const stop = onContentChange(({ reason }) => reasons.push(reason));

    fakeEditor.value = 'x'.repeat(1000);
    fakeEditor.selectionStart = 10;
    fakeEditor.selectionEnd = 10;

    insertText('hello');
    stop();

    expect(reasons).toEqual(['edited']);
  });
});

describe('isEditorHidden', () => {
  it('is hidden in the preview view', () => {
    saveSettings({ view: 'preview' });
    expect(isEditorHidden()).toBe(true);
  });

  it('is visible in the edit and split views', () => {
    saveSettings({ view: 'edit' });
    expect(isEditorHidden()).toBe(false);

    saveSettings({ view: 'split' });
    expect(isEditorHidden()).toBe(false);
  });
});

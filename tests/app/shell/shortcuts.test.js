/**
 * @vitest-environment jsdom
 *
 * The keyboard owns one shortcut for the tab workflow:
 * Ctrl+Alt+N / Cmd+Option+N opens the next article in a tab of its own.
 *
 * The heavy modules the shortcut file also serves (speech, translation,
 * history, …) are replaced with stand-ins; what is under test is the key
 * routing, not those features.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockTts = {
  stop: vi.fn(),
  isSpeaking: vi.fn(() => false),
  isNarrationStarting: vi.fn(() => false)
};
vi.mock('@/speech/tts.js', () => mockTts);

const mockEditor = {
  applyFormat: vi.fn(),
  flushDraft: vi.fn()
};
vi.mock('@/app/editor/editor.js', () => mockEditor);

const mockNarration = {
  toggleNarration: vi.fn(() => 'paused'),
  cancelPendingStart: vi.fn(() => false)
};
vi.mock('@/app/preview/narration.js', () => mockNarration);

const mockLayout = {
  setView: vi.fn()
};
vi.mock('@/app/shell/layout.js', () => mockLayout);

const mockPaste = {
  pasteFromClipboard: vi.fn()
};
vi.mock('@/app/editor/paste.js', () => mockPaste);

const mockUrlImport = {
  openDialog: vi.fn()
};
vi.mock('@/app/import/url-import.js', () => mockUrlImport);

const mockTranslate = {
  openDialog: vi.fn()
};
vi.mock('@/app/translate/translate.js', () => mockTranslate);

const mockHistory = {
  openDialog: vi.fn(),
  captureNow: vi.fn(() => ({ added: false }))
};
vi.mock('@/app/history/dialog.js', () => mockHistory);

document.body.innerHTML = `
  <textarea id="editor"></textarea>
  <button id="btn-new-tab"></button>
  <div id="preview"></div>
  <input type="checkbox" id="check-box" />
  <input type="text" id="text-input" />
`;

const { initShortcuts } = await import('@/app/shell/shortcuts.js');
const { el } = await import('@/app/shell/dom.js');

/** @param {KeyboardEventInit} init */
function pressOn(target, init) {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

function press(init) {
  pressOn(document.getElementById('editor'), init);
}

describe('the new tab shortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'open').mockReturnValue({
      opener: null,
      focus() {}
    });
    initShortcuts();
  });

  it('opens a new empty tab on Ctrl+Alt+N', () => {
    press({ key: 'n', ctrlKey: true, altKey: true, bubbles: true });

    const url = new URL(window.open.mock.calls[0][0]);
    expect(url.searchParams.get('new')).toBe('1');
  });

  it('opens a new empty tab on Cmd+Option+N', () => {
    press({ key: 'n', metaKey: true, altKey: true, bubbles: true });

    expect(window.open).toHaveBeenCalledTimes(1);
  });

  it('works while the focus is in the editor', () => {
    const editor = document.getElementById('editor');
    editor.focus();

    press({ key: 'n', ctrlKey: true, altKey: true, bubbles: true });

    expect(window.open).toHaveBeenCalledTimes(1);
  });

  it('is not triggered by the keys the browser keeps for itself', () => {
    press({ key: 'n', ctrlKey: true, bubbles: true }); // the browser's new window
    press({ key: 'n', ctrlKey: true, shiftKey: true, bubbles: true }); // incognito
    press({ key: 'n', altKey: true, bubbles: true });
    press({ key: 'n', ctrlKey: true, altKey: true, shiftKey: true, bubbles: true });

    expect(window.open).not.toHaveBeenCalled();
  });

  it('does nothing while a dialog is open', () => {
    el.modalSettings = document.createElement('div');

    press({ key: 'n', ctrlKey: true, altKey: true, bubbles: true });

    expect(window.open).not.toHaveBeenCalled();
    delete el.modalSettings;
  });
});

describe('formatting shortcuts in editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initShortcuts();
  });

  it('applies bold on Ctrl+B inside editor', () => {
    press({ key: 'b', ctrlKey: true, bubbles: true });
    expect(mockEditor.applyFormat).toHaveBeenCalledWith('bold');
  });

  it('applies italic on Ctrl+I inside editor', () => {
    press({ key: 'i', ctrlKey: true, bubbles: true });
    expect(mockEditor.applyFormat).toHaveBeenCalledWith('italic');
  });

  it('saves document on Ctrl+S inside editor', () => {
    press({ key: 's', ctrlKey: true, bubbles: true });
    expect(mockEditor.flushDraft).toHaveBeenCalled();
    expect(mockHistory.captureNow).toHaveBeenCalled();
  });
});

describe('space key narration toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initShortcuts();
  });

  it('toggles narration on Space outside editor', () => {
    const preview = document.getElementById('preview');
    pressOn(preview, { code: 'Space', bubbles: true });
    expect(mockNarration.toggleNarration).toHaveBeenCalledTimes(1);
  });

  it('does not toggle narration when Space is pressed in editor', () => {
    press({ code: 'Space', bubbles: true });
    expect(mockNarration.toggleNarration).not.toHaveBeenCalled();
  });

  it('does not toggle narration when Space is pressed on checkbox', () => {
    const checkbox = document.getElementById('check-box');
    pressOn(checkbox, { code: 'Space', bubbles: true });
    expect(mockNarration.toggleNarration).not.toHaveBeenCalled();
  });

  it('does not toggle narration when Space is pressed in text input', () => {
    const textInput = document.getElementById('text-input');
    pressOn(textInput, { code: 'Space', bubbles: true });
    expect(mockNarration.toggleNarration).not.toHaveBeenCalled();
  });
});

describe('escape key stop narration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initShortcuts();
  });

  it('stops reading on Escape when speech is active', () => {
    mockTts.isSpeaking.mockReturnValue(true);
    const preview = document.getElementById('preview');
    pressOn(preview, { key: 'Escape', bubbles: true });
    expect(mockTts.stop).toHaveBeenCalledWith('user');
  });
});

describe('view shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initShortcuts();
  });

  it('sets view to edit on 1', () => {
    const preview = document.getElementById('preview');
    pressOn(preview, { key: '1', bubbles: true });
    expect(mockLayout.setView).toHaveBeenCalledWith('edit');
  });

  it('sets view to split on 2', () => {
    const preview = document.getElementById('preview');
    pressOn(preview, { key: '2', bubbles: true });
    expect(mockLayout.setView).toHaveBeenCalledWith('split');
  });

  it('sets view to preview on 3', () => {
    const preview = document.getElementById('preview');
    pressOn(preview, { key: '3', bubbles: true });
    expect(mockLayout.setView).toHaveBeenCalledWith('preview');
  });
});

describe('dialog shortcuts outside editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initShortcuts();
  });

  it('opens history on Ctrl+Shift+H', () => {
    const preview = document.getElementById('preview');
    pressOn(preview, { key: 'h', ctrlKey: true, shiftKey: true, bubbles: true });
    expect(mockHistory.openDialog).toHaveBeenCalledTimes(1);
  });

  it('opens translate on Ctrl+Shift+L', () => {
    const preview = document.getElementById('preview');
    pressOn(preview, { key: 'l', ctrlKey: true, shiftKey: true, bubbles: true });
    expect(mockTranslate.openDialog).toHaveBeenCalledTimes(1);
  });

  it('opens url import on Ctrl+Shift+U', () => {
    const preview = document.getElementById('preview');
    pressOn(preview, { key: 'u', ctrlKey: true, shiftKey: true, bubbles: true });
    expect(mockUrlImport.openDialog).toHaveBeenCalledTimes(1);
  });

  it('triggers paste on Ctrl+Shift+V', () => {
    const preview = document.getElementById('preview');
    pressOn(preview, { key: 'v', ctrlKey: true, shiftKey: true, bubbles: true });
    expect(mockPaste.pasteFromClipboard).toHaveBeenCalledTimes(1);
  });
});

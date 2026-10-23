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

vi.mock('@/speech/tts.js', () => ({ stop: vi.fn(), isSpeaking: () => false }));
vi.mock('@/app/editor/editor.js', () => ({
  applyFormat: vi.fn(),
  flushDraft: vi.fn()
}));
vi.mock('@/app/preview/narration.js', () => ({ toggleNarration: () => 'paused' }));
vi.mock('@/app/shell/layout.js', () => ({ setView: vi.fn() }));
vi.mock('@/app/editor/paste.js', () => ({ pasteFromClipboard: vi.fn() }));
vi.mock('@/app/import/url-import.js', () => ({ openDialog: vi.fn() }));
vi.mock('@/app/translate/translate.js', () => ({ openDialog: vi.fn() }));
vi.mock('@/app/history/dialog.js', () => ({
  openDialog: vi.fn(),
  captureNow: () => ({ added: false })
}));

document.body.innerHTML = '<textarea id="editor"></textarea><button id="btn-new-tab"></button>';

const { initShortcuts } = await import('@/app/shell/shortcuts.js');
const { el } = await import('@/app/shell/dom.js');

/** @param {KeyboardEventInit} init */
function press(init) {
  document.getElementById('editor').dispatchEvent(new KeyboardEvent('keydown', init));
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

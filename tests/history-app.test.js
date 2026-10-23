/**
 * ============================================================================
 * VERSION HISTORY — THE DIALOG
 * ============================================================================
 * The versions of the document are kept in the browser, and the dialog is
 * where the user gets to do something with them. These tests make sure
 * that a version is taken at the right moment, that the list shows them
 * from the newest to the oldest, and that looking at one, putting one back
 * and throwing them away all do what they say.
 * ============================================================================
 */

/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The jsdom environment has no localStorage of its own — only that one
// piece is replaced, so that the rest of the environment stays real.
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => (storage.has(key) ? storage.get(key) : null),
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
  key: (index) => Array.from(storage.keys())[index] ?? null,
  get length() {
    return storage.size;
  }
};

// The confirmation is the user's answer — the tests answer it themselves.
vi.mock('../src/app/dialog.js', () => ({
  confirmDialog: vi.fn(async () => true)
}));

const MARKUP = `
  <div id="modal-history" class="modal-backdrop" hidden>
    <div class="modal-card">
      <div class="modal-header">
        <h3 id="modal-history-title">Version history</h3>
        <button type="button" id="btn-close-history"></button>
      </div>
      <div class="modal-body">
        <p id="history-stats"></p>
        <p id="history-empty" hidden></p>
        <div id="history-list"></div>
        <button type="button" id="btn-history-save">Save version now</button>
        <button type="button" id="btn-history-clear">Clear history</button>
        <button type="button" id="btn-history-close">Close</button>
      </div>
    </div>
  </div>
  <button type="button" id="btn-history"></button>
  <textarea id="editor"></textarea>
  <div id="line-numbers"></div>
  <span id="doc-stats"></span>
  <span id="reading-time"></span>
`;

// The registry of elements is read once, when the module is loaded — so
// the markup has to be in place before that happens.
document.body.innerHTML = MARKUP;

const { openDialog, closeDialog, initHistory, captureNow } = await import('../src/app/history.js');
const { el } = await import('../src/app/dom.js');
const { initEditor, setMarkdown } = await import('../src/app/editor.js');
const { loadSettings, saveSettings } = await import('../src/settings-manager.js');
const { addVersion, getVersion, listVersions } = await import('../src/version-history.js');
const { confirmDialog } = await import('../src/app/dialog.js');

// The editor owns the buffer and the events of the document; the history
// listens to them.
initEditor({ initialContent: '' });
initHistory();

/**
 * Lets the promises of the dialog settle.
 * @returns {Promise<void>}
 */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The buttons of a row of the list.
 * @param {number} [index] the row
 * @returns {HTMLButtonElement[]}
 */
function buttonsOf(index = 0) {
  const row = el.historyList.querySelectorAll('.history-entry')[index];
  return Array.from(row.querySelectorAll('button'));
}

/**
 * A button of a row of the list, found by its name.
 * @param {string} label
 * @param {number} [index] the row
 * @returns {HTMLButtonElement}
 */
function buttonNamed(label, index = 0) {
  return buttonsOf(index).find((node) => node.textContent.trim() === label);
}

describe('the dialog', () => {
  beforeEach(() => {
    // The document is emptied first — so that the history starts from
    // nothing as well.
    el.editor.value = '';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    storage.clear();
    loadSettings();
    confirmDialog.mockClear();

    el.modalHistory.setAttribute('hidden', '');
    el.historyList.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens and closes', () => {
    openDialog();
    expect(el.modalHistory.hasAttribute('hidden')).toBe(false);

    closeDialog();
    expect(el.modalHistory.hasAttribute('hidden')).toBe(true);
  });

  it('is opened by the button in the header', () => {
    el.btnHistory.click();
    expect(el.modalHistory.hasAttribute('hidden')).toBe(false);
  });

  it('stays open when Escape closes a confirmation on top of it', () => {
    addVersion('# One', { at: 1000 });
    openDialog();

    // The confirmation the restore and the clear actions open.
    const confirmation = document.createElement('dialog');
    confirmation.setAttribute('open', '');
    document.body.appendChild(confirmation);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(el.modalHistory.hasAttribute('hidden')).toBe(false);

    confirmation.remove();
  });

  it('closes with the Escape key', () => {
    openDialog();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(el.modalHistory.hasAttribute('hidden')).toBe(true);
  });

  it('lists the versions from the newest to the oldest', () => {
    addVersion('# The oldest', { at: 1000 });
    addVersion('# The middle', { at: 2000 });
    addVersion('# The newest', { at: 3000 });

    openDialog();

    const titles = Array.from(el.historyList.querySelectorAll('.history-entry-title')).map(
      (node) => node.textContent
    );

    expect(titles).toEqual(['The newest', 'The middle', 'The oldest']);
  });

  it('says how many versions there are', () => {
    addVersion('# One', { at: 1000 });

    openDialog();

    expect(el.historyStats.textContent).toContain('1 version');
  });

  it('shows the empty state when there is nothing yet', () => {
    openDialog();

    expect(el.historyEmpty.hidden).toBe(false);
    expect(el.historyList.querySelectorAll('.history-entry').length).toBe(0);
  });

  it('keeps a version when the user asks for it', () => {
    el.editor.value = '# A version of the document';

    openDialog();
    el.btnHistorySave.click();

    const versions = listVersions();
    expect(versions.length).toBe(1);
    expect(versions[0].reason).toBe('manual');
    expect(getVersion(versions[0].id).markdown).toBe('# A version of the document');
    expect(el.historyList.querySelectorAll('.history-entry').length).toBe(1);
  });

  it('shows the beginning of a version', () => {
    addVersion('# The version\n\nAnd the rest of it.', { at: 1000 });

    openDialog();
    buttonNamed('Preview').click();

    const preview = el.historyList.querySelector('.history-preview');
    expect(preview).toBeTruthy();
    expect(preview.textContent).toContain('# The version');

    // And it goes away again.
    buttonNamed('Preview').click();
    expect(el.historyList.querySelector('.history-preview')).toBeNull();
  });

  it('throws a version away when it is deleted', () => {
    addVersion('# One', { at: 1000 });
    addVersion('# Two', { at: 2000 });

    openDialog();
    buttonNamed('Delete').click();

    expect(listVersions().length).toBe(1);
    expect(el.historyList.querySelectorAll('.history-entry').length).toBe(1);
  });

  it('empties the history when it is cleared', async () => {
    addVersion('# One', { at: 1000 });

    openDialog();
    el.btnHistoryClear.click();
    await settle();

    expect(listVersions().length).toBe(0);
    expect(el.historyEmpty.hidden).toBe(false);
    expect(el.historyList.querySelectorAll('.history-entry').length).toBe(0);
  });

  it('asks before the history is cleared', async () => {
    addVersion('# One', { at: 1000 });

    openDialog();
    el.btnHistoryClear.click();
    await settle();

    expect(confirmDialog).toHaveBeenCalled();
    const options = confirmDialog.mock.calls[0][0];
    expect(options.danger).toBe(true);
  });

  it('puts an older version back into the document', async () => {
    addVersion('# The older document', { at: 1000 });

    el.editor.value = '# The document as it is now';
    openDialog();

    buttonNamed('Restore').click();
    await settle();

    expect(el.editor.value).toBe('# The older document');
    expect(el.modalHistory.hasAttribute('hidden')).toBe(true);
  });

  it('keeps the version that was on screen when one is put back', async () => {
    addVersion('# The older document', { at: 1000 });

    el.editor.value = '# The document as it is now';
    openDialog();

    buttonNamed('Restore').click();
    await settle();

    const reasons = listVersions().map((version) => version.reason);
    expect(reasons).toContain('before-restore');
  });

  it('does not keep the restored version a second time', async () => {
    vi.useFakeTimers();

    addVersion('# The older document', { at: 1000 });

    el.editor.value = '# The document as it is now';
    openDialog();

    buttonNamed('Restore').click();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(el.editor.value).toBe('# The older document');

    // Only the version that was there before the restore — the restored
    // text is not kept a second time.
    const versions = listVersions();
    expect(versions.length).toBe(2);
    expect(versions[0].reason).toBe('before-restore');
  });

  it('puts a version back without keeping anything when the history is off', async () => {
    vi.useFakeTimers();

    addVersion('# The older document', { at: 1000 });
    el.editor.value = '# The document as it is now';
    saveSettings({ historyEnabled: false });

    openDialog();
    buttonNamed('Restore').click();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(el.editor.value).toBe('# The older document');
    expect(listVersions().length).toBe(1);
  });
});

describe('when the document changes', () => {
  beforeEach(() => {
    el.editor.value = '';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    storage.clear();
    loadSettings();
    confirmDialog.mockClear();

    el.modalHistory.setAttribute('hidden', '');
    el.historyList.replaceChildren();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a version once the typing has stopped', () => {
    vi.useFakeTimers();

    el.editor.value = '# Typed by hand';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    expect(listVersions().length).toBe(0);

    vi.advanceTimersByTime(10_000);

    const versions = listVersions();
    expect(versions.length).toBe(1);
    expect(getVersion(versions[0].id).markdown).toBe('# Typed by hand');
    expect(versions[0].reason).toBe('auto');
  });

  it('keeps the text that was there when the document is replaced', () => {
    el.editor.value = '# The first document';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    setMarkdown('# Something else entirely', 'replaced');

    const versions = listVersions();
    expect(versions.length).toBe(1);
    expect(getVersion(versions[0].id).markdown).toBe('# The first document');
    expect(versions[0].reason).toBe('before-replace');
  });

  it('does not keep a version for an edit too small to matter', () => {
    vi.useFakeTimers();

    el.editor.value = '# The document';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(10_000);
    expect(listVersions().length).toBe(1);

    // A word is added, and the typing stops.
    el.editor.value = '# The document, cut short.';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(10_000);

    expect(listVersions().length).toBe(1);
  });

  it('keeps a small edit when nothing has been kept for a long while', () => {
    vi.useFakeTimers();

    el.editor.value = '# The document';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(10_000);
    expect(listVersions().length).toBe(1);

    // Nothing is kept for eleven minutes, then a word is added.
    vi.advanceTimersByTime(11 * 60 * 1000);
    el.editor.value = '# The document, again.';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(10_000);

    expect(listVersions().length).toBe(2);
  });

  it('keeps a version at once when the user asks for it', () => {
    el.editor.value = '# The document';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    const result = captureNow();

    expect(result.added).toBe(true);
    expect(listVersions().length).toBe(1);
    expect(listVersions()[0].reason).toBe('manual');
  });

  it('keeps the old text when the document is rewritten by hand', () => {
    el.editor.value = '# A document that is about to be thrown away and replaced by a short one';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    el.editor.value = 'short';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    const versions = listVersions();
    expect(versions.length).toBe(1);
    expect(versions[0].reason).toBe('before-replace');
  });

  it('does not treat a change at the very front as a replacement', () => {
    vi.useFakeTimers();

    el.editor.value = '# The document';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    el.editor.value = 'x The document';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    // Nothing is kept at once — the change is an ordinary edit.
    expect(listVersions().length).toBe(0);

    vi.advanceTimersByTime(10_000);

    const versions = listVersions();
    expect(versions.length).toBe(1);
    expect(versions[0].reason).toBe('auto');
  });

  it('keeps the new text as well when the document is replaced', () => {
    vi.useFakeTimers();

    el.editor.value = '# The first document';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    setMarkdown('# Pasted over the whole document', 'replaced');

    // The old text is kept at once.
    expect(listVersions()[0].reason).toBe('before-replace');

    // The new text is kept the same way typing is — once it settles.
    vi.advanceTimersByTime(10_000);

    const versions = listVersions();
    expect(versions.length).toBe(2);
    expect(versions[0].reason).toBe('auto');
    expect(getVersion(versions[0].id).markdown).toBe('# Pasted over the whole document');
  });

  it('keeps one version however often the same text is pasted', () => {
    vi.useFakeTimers();

    el.editor.value = '# The document';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(10_000);
    expect(listVersions().length).toBe(1);

    // Ten pastes that put exactly the same text back over itself.
    for (let index = 0; index < 10; index += 1) {
      el.editor.value = '# The document';
      el.editor.dispatchEvent(new Event('input', { bubbles: true }));
      vi.advanceTimersByTime(10_000);
    }

    expect(listVersions().length).toBe(1);
  });

  it('does not keep a document that is already in the history', () => {
    vi.useFakeTimers();

    el.editor.value = '# First document';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(10_000);

    setMarkdown('# Second document', 'replaced');
    vi.advanceTimersByTime(10_000);

    // The first document is pasted back: it is in the history already.
    setMarkdown('# First document', 'replaced');
    vi.advanceTimersByTime(10_000);

    expect(listVersions().length).toBe(2);
  });

  it('keeps nothing when the history is switched off', () => {
    saveSettings({ historyEnabled: false });

    el.editor.value = '# Typed by hand';
    el.editor.dispatchEvent(new Event('input', { bubbles: true }));

    setMarkdown('# Something else entirely', 'replaced');

    expect(listVersions().length).toBe(0);
  });
});

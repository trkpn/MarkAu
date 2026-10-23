/**
 * @vitest-environment jsdom
 *
 * Several tabs of the app can be open at once. These tests make sure the
 * tabs do not overwrite each other's document, that a preference changed in
 * one tab reaches the others, and that the history dialog stays honest when
 * another tab writes a version.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Each storage area gets its own Map, so a test can move between "tabs" by
 * swapping the session copy the way a reload of one tab would.
 * @returns {Storage}
 */
function createStorage() {
  const store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    }
  };
}

globalThis.localStorage = createStorage();
globalThis.sessionStorage = createStorage();

document.body.innerHTML =
  '<textarea id="editor"></textarea>' +
  '<div id="line-numbers"></div>' +
  '<span id="doc-stats"></span>' +
  '<span id="reading-time"></span>';

const editor = await import('@/app/editor/editor.js');
const settings = await import('@/core/settings.js');
const history = await import('@/core/history.js');
const multiTab = await import('@/core/multi-tab.js');

const SETTINGS_KEY = 'markau_settings_v1';
const HISTORY_KEY = 'markau_history_v1';
const RECOVERY_KEY = 'markdown_draft';
const TAB_DRAFT_KEY = 'markdown_draft_tab';

describe('documents in several tabs', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.getElementById('editor').value = '';
  });

  it('keeps the draft of each tab separate', () => {
    sessionStorage.setItem(TAB_DRAFT_KEY, 'The document of tab A');
    expect(editor.loadDraft()).toBe('The document of tab A');

    // Tab B autosaves its own document: tab A's copy is untouched.
    document.getElementById('editor').value = 'The document of tab B';
    editor.flushDraft();

    expect(sessionStorage.getItem(TAB_DRAFT_KEY)).toBe('The document of tab B');
    expect(localStorage.getItem(RECOVERY_KEY)).toBe('The document of tab B');

    // Tab A comes back (reload): its own copy is still there.
    sessionStorage.setItem(TAB_DRAFT_KEY, 'The document of tab A');
    expect(editor.loadDraft()).toBe('The document of tab A');
  });

  it('starts a brand-new tab from the last autosaved document', () => {
    localStorage.setItem(RECOVERY_KEY, 'Last autosaved document');
    expect(editor.loadDraft()).toBe('Last autosaved document');
  });

  it('leaves the recovery copy alone when an empty tab is closed', () => {
    sessionStorage.setItem(TAB_DRAFT_KEY, 'Something');
    localStorage.setItem(RECOVERY_KEY, 'Another article');

    document.getElementById('editor').value = '';
    editor.flushDraft();

    expect(sessionStorage.getItem(TAB_DRAFT_KEY)).toBe('');
    expect(localStorage.getItem(RECOVERY_KEY)).toBe('Another article');
  });

  it('does not bring a cleared document back from the recovery copy', () => {
    localStorage.setItem(RECOVERY_KEY, 'The article that was cleared');
    document.getElementById('editor').value = 'The article that was cleared';

    document.getElementById('editor').value = '';
    editor.flushDraft();

    expect(editor.loadDraft()).toBe('');
  });

  it('keeps a deliberately empty tab empty, even with a recovery copy around', () => {
    localStorage.setItem(RECOVERY_KEY, 'The last article');
    sessionStorage.setItem(TAB_DRAFT_KEY, 'The copied article');

    editor.startBlankTab();

    expect(editor.hasTabDraft()).toBe(false);
    expect(sessionStorage.getItem(TAB_DRAFT_KEY)).toBeNull();
    expect(editor.loadDraft()).toBe('');
    expect(localStorage.getItem(RECOVERY_KEY)).toBe('The last article');
  });

  it('shows the tab draft again once the empty tab is written in', () => {
    localStorage.setItem(RECOVERY_KEY, 'The last article');
    editor.startBlankTab();
    document.getElementById('editor').value = 'A new article';
    editor.flushDraft();

    expect(editor.loadDraft()).toBe('A new article');
  });
});

describe('settings in several tabs', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    settings.loadSettings();
  });

  it('applies a change saved by another tab', () => {
    const seen = vi.fn();
    const off = settings.onSettingsChange(seen);

    const payload = JSON.stringify({ theme: 'light', fontUi: 'Inter' });
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY, newValue: payload }));

    expect(settings.getSettings().theme).toBe('light');
    expect(settings.getSettings().fontUi).toBe('Inter');
    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it('merges its change into the settings another tab just saved', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light' }));

    settings.saveSettings({ fontUi: 'Inter' });

    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    expect(stored.theme).toBe('light');
    expect(stored.fontUi).toBe('Inter');
  });

  it('ignores a storage event about something else', () => {
    const seen = vi.fn();
    const off = settings.onSettingsChange(seen);

    window.dispatchEvent(new StorageEvent('storage', { key: 'something_else', newValue: 'x' }));

    expect(seen).not.toHaveBeenCalled();
    off();
  });
});

describe('history in several tabs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('refreshes when another tab writes a version', () => {
    const seen = vi.fn();
    const off = history.onHistoryChange(seen);

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: HISTORY_KEY,
        newValue: JSON.stringify({ version: 1, entries: [] })
      })
    );

    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });
});

describe('narration across tabs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('announces a start and hears the other tab', async () => {
    const seen = vi.fn();
    const off = multiTab.onOtherTabNarrationStart(seen);

    multiTab.announceNarrationStart();

    if (typeof BroadcastChannel === 'function') {
      const otherTab = new BroadcastChannel('markau-narration');
      otherTab.postMessage({ type: 'narration-start' });
      otherTab.close();
      await new Promise((resolve) => setTimeout(resolve, 0));
    } else {
      expect(localStorage.getItem('markau_narration_ping')).not.toBeNull();
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'markau_narration_ping',
          newValue: String(Date.now())
        })
      );
    }

    expect(seen).toHaveBeenCalledTimes(1);
    off();
  });

  it.skipIf(typeof BroadcastChannel !== 'function')(
    'hears an already open tab when a new one asks',
    async () => {
      const otherTab = new BroadcastChannel('markau-narration');
      /** @param {MessageEvent} event */
      const answer = (event) => {
        if (event.data?.type === 'probe') otherTab.postMessage({ type: 'here', to: event.data.id });
      };
      otherTab.addEventListener('message', answer);

      const open = await multiTab.isAnotherTabOpen();

      otherTab.removeEventListener('message', answer);
      otherTab.close();

      expect(open).toBe(true);
    }
  );
});

describe('the life of a tab', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.getElementById('editor').value = '';
    editor.initEditor({ initialContent: 'start' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the draft when the page goes away', () => {
    document.getElementById('editor').value = 'the words written just now';

    window.dispatchEvent(new Event('pagehide'));

    expect(sessionStorage.getItem(TAB_DRAFT_KEY)).toBe('the words written just now');
    expect(localStorage.getItem(RECOVERY_KEY)).toBe('the words written just now');
  });

  it('writes a replaced document right away', () => {
    editor.setMarkdown('# The pasted article', 'replaced');

    expect(sessionStorage.getItem(TAB_DRAFT_KEY)).toBe('# The pasted article');
    expect(localStorage.getItem(RECOVERY_KEY)).toBe('# The pasted article');
  });

  it('writes the draft when the tab is hidden', () => {
    document.getElementById('editor').value = 'the words before switching away';
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

    document.dispatchEvent(new Event('visibilitychange'));

    expect(sessionStorage.getItem(TAB_DRAFT_KEY)).toBe('the words before switching away');
  });
});

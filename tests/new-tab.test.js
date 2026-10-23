/**
 * @vitest-environment jsdom
 *
 * A second document is a second tab: the header button opens one, and the
 * tab starts empty so that the new article is not mixed with the old one.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
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

document.body.innerHTML = '<button id="btn-new-tab"></button><textarea id="editor"></textarea>';

const { openNewTab, initNewTab } = await import('../src/app/new-tab.js');

describe('opening a second tab', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('opens the app in a new tab for an empty document', () => {
    const focus = vi.fn();
    const tab = { opener: {}, focus };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab);

    openNewTab();

    const opened = open.mock.calls[0][0];
    const url = new URL(opened);
    expect(url.searchParams.get('new')).toBe('1');
    expect(url.pathname).toBe(window.location.pathname);
    expect(open.mock.calls[0][1]).toBe('_blank');
    expect(tab.opener).toBeNull();
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('survives a browser that blocks the tab', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    expect(() => openNewTab()).not.toThrow();
  });

  it('wires the header button', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue({ focus() {} });
    initNewTab();

    document.getElementById('btn-new-tab').click();

    expect(open).toHaveBeenCalledTimes(1);
  });
});

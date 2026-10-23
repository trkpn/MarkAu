/**
 * ============================================================================
 * A SECOND TAB
 * ============================================================================
 * The reader often reads several articles at once: one tab per article, and
 * the tab is closed when the article is done. Each tab of the app keeps its
 * own document (see `editor.js`), so the header has a button that opens
 * another one.
 *
 * The new tab is deliberately empty. The browser copies the session storage
 * of this tab into the new one, and without the `new` flag that copy would
 * put the current article on the screen again; the app sees the flag and
 * starts blank. The recovery copy of the last document is left untouched.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
import { flushDraft } from '@/app/editor/editor.js';
import { setMessage } from '@/app/shell/status.js';

/**
 * Opens another tab of the app, with an empty document.
 */
export function openNewTab() {
  // The draft of this tab is written before a new tab is opened: the reader
  // may leave this article for later without waiting for the autosave.
  flushDraft();

  const url = new URL(window.location.href);
  url.searchParams.set('new', '1');
  const tab = window.open(url.toString(), '_blank');

  if (!tab) {
    setMessage('The browser blocked the new tab', { tone: 'warn', ttl: 3000 });
    return;
  }

  // The new tab never needs to reach back into this one.
  try {
    tab.opener = null;
  } catch {
    /* some browsers refuse the assignment - the tab still works */
  }

  tab.focus?.();
}

/**
 * Wires the header button.
 */
export function initNewTab() {
  el.btnNewTab?.addEventListener('click', openNewTab);
}

/**
 * ============================================================================
 * VERSION HISTORY — THE DIALOG
 * ============================================================================
 * The versions of the document are kept in the browser, and this module
 * decides when a version is taken and what the user gets to do with them:
 * look at one, put one back, throw one away, throw all of them away.
 *
 * When a version is taken:
 *
 *   • a few seconds after the text stops changing — the way an editor of
 *     any kind saves quietly in the background. Typing and pasting are
 *     the same thing here: a paste is a change of the document too, and
 *     the text it brings is worth keeping
 *   • the moment the document is replaced — an import, a translation, a
 *     reset — so that the text that was there is not lost, and then the
 *     text that replaced it, like any other paste
 *   • when the user asks for it, with "Save version now"
 *
 * Everything that is shown is put into the document as text, never as
 * markup: the text of a version is the text of the user, and it is never
 * allowed to become part of the page.
 * ============================================================================
 */

import { el } from './dom.js';
import { setMarkdown, onContentChange } from './editor.js';
import { getSettings } from '../settings-manager.js';
import { setMessage } from './status.js';
import { confirmDialog } from './dialog.js';
import {
  addVersion,
  changedCharacters,
  clearHistory,
  getVersion,
  historyStats,
  listVersions,
  readHistory,
  removeVersion,
  formatBytes,
  formatRelativeTime,
  looksLikeBulkRewrite,
  onHistoryChange,
  REASON_AUTO,
  REASON_MANUAL,
  REASON_BEFORE_REPLACE,
  REASON_BEFORE_RESTORE
} from '../version-history.js';

/** How much of a version the preview shows. */
const PREVIEW_CHARS = 1500;

/** The smallest edit that is worth a version of its own, in characters. */
const MIN_CHANGE_CHARS = 40;

/** The smallest edit relative to the last version, in a document so long. */
const MIN_CHANGE_RATIO = 0.01;

/** However small the edits are, a version is taken after this long without one. */
const SILENT_WINDOW_MS = 10 * 60 * 1000;

/** How the reason of a version is told to the user. */
const REASON_LABELS = {
  [REASON_AUTO]: 'Automatic save',
  [REASON_MANUAL]: 'Saved by hand',
  [REASON_BEFORE_REPLACE]: 'Before replacement',
  [REASON_BEFORE_RESTORE]: 'Before restoring'
};

/** The text of the document as it was when it was last seen. */
let lastSeenText = '';

/** The timer of the automatic capture. */
let captureTimer = null;

/**
 * True while a version is being put back into the document. The restored
 * text is already in the history, so it is not kept a second time.
 */
let restoring = false;

/**
 * Whether the next automatic capture is taken whatever the size of the
 * change — a document that replaced another one is a new document, not an
 * edit of the old.
 */
let captureIsForced = false;

/** Where the focus was before the dialog opened. */
let lastFocused = null;

/* ==========================================================================
 * The capture
 * ========================================================================== */

/**
 * Whether the history is kept at all.
 * @returns {boolean}
 */
function historyEnabled() {
  return getSettings().historyEnabled !== false;
}

/**
 * How many versions are kept.
 * @returns {number}
 */
function historyLimit() {
  return getSettings().historyLimit;
}

/**
 * The text of the document, as it is now.
 * @returns {string}
 */
function currentText() {
  return el.editor?.value ?? '';
}

/**
 * Stops the automatic capture that is waiting.
 */
function cancelCapture() {
  if (captureTimer === null) return;
  clearTimeout(captureTimer);
  captureTimer = null;
}

/**
 * Waits for the typing to stop, and then keeps the version.
 * @param {{ force?: boolean }} [options] whether the size of the change is
 *   ignored when the version is taken
 */
function scheduleCapture({ force = false } = {}) {
  cancelCapture();

  if (force) captureIsForced = true;

  const seconds = Number(getSettings().historyDelaySeconds) || 10;

  captureTimer = setTimeout(() => {
    captureTimer = null;
    captureVersion(REASON_AUTO, { force: takeForce() });
  }, seconds * 1000);
}

/**
 * Takes the pending "keep it whatever its size" mark, and clears it.
 * @returns {boolean}
 */
function takeForce() {
  const forced = captureIsForced;
  captureIsForced = false;
  return forced;
}

/**
 * Whether the document on screen deserves a version of its own.
 *
 * Not every edit does: a version for every word would bury the one the user
 * wants. A change is worth keeping when it is big enough — or when nothing
 * has been kept for a long while, so that work that grows a word at a time
 * is not lost either.
 *
 * @param {string} text the text of the document
 * @returns {boolean}
 */
function worthKeeping(text) {
  const newest = readHistory()[0];
  if (!newest) return Boolean(text.trim());
  if (newest.markdown === text) return false;

  const changed = changedCharacters(newest.markdown, text);
  if (changed >= Math.max(MIN_CHANGE_CHARS, newest.chars * MIN_CHANGE_RATIO)) return true;

  return Date.now() - newest.at >= SILENT_WINDOW_MS;
}

/**
 * Keeps the version of the document that is on screen.
 * @param {string} reason why the version is taken
 * @param {{ force?: boolean }} [options] whether the size of the change is
 *   ignored — an explicit save keeps a version whatever the edit was
 * @returns {{ added: boolean, entry?: object, reason?: string }}
 */
function captureVersion(reason, { force = false } = {}) {
  if (!historyEnabled()) return { added: false, reason: 'disabled' };

  const text = currentText();

  if (!force && reason === REASON_AUTO && !worthKeeping(text)) {
    return { added: false, reason: 'minor' };
  }

  return addVersion(text, { reason, limit: historyLimit() });
}

/**
 * Keeps a version of the document right away, whatever the size of the
 * change — the user asked for it, or pressed Ctrl+S.
 * @returns {{ added: boolean, entry?: object, reason?: string }}
 */
export function captureNow() {
  const result = captureVersion(REASON_MANUAL, { force: true });
  captureIsForced = false;
  return result;
}

/**
 * Whether the text that was there is gone.
 *
 * A rewrite — an import, a translation, a reset — throws the old text
 * away, and that text is worth keeping. An edit that only puts something
 * in front of the old text does not: the old text is still there, and it
 * is not a version of its own.
 *
 * @param {string} before the text as it was
 * @param {string} after the text as it is
 * @returns {boolean}
 */
function textIsGone(before, after) {
  if (!before.trim()) return false;
  if (after.includes(before)) return false;

  // A rewrite takes a big bite out of the document. A change that keeps
  // the document about the same size — a character or two at the very
  // front — is an edit, even though hardly any of its beginning is shared.
  const shorter = Math.min(before.length, after.length);
  const longer = Math.max(before.length, after.length);
  if (shorter > 0 && longer / shorter < 2) return false;

  return looksLikeBulkRewrite(before, after);
}

/**
 * Looks at the document after every change.
 * @param {{ reason: 'edited'|'replaced' }} payload
 */
function handleContentChange({ reason }) {
  const current = currentText();

  // Nothing changed — a paste of the very text that is already there, for
  // instance. There is nothing to keep, and no capture to plan.
  if (current === lastSeenText) return;

  const enabled = historyEnabled();

  // The document was replaced: the text that was there is kept, so that
  // the replacement can be taken back.
  if (reason === 'replaced' || textIsGone(lastSeenText, current)) {
    cancelCapture();

    if (enabled && lastSeenText.trim()) {
      addVersion(lastSeenText, {
        reason: REASON_BEFORE_REPLACE,
        limit: historyLimit()
      });
    }

    lastSeenText = current;

    // The text that replaced the old one is a new document, not an edit —
    // a paste, an import, a translation — so it is worth a version
    // whatever its size.
    if (enabled && !restoring) scheduleCapture({ force: true });

    return;
  }

  // An ordinary edit: the version is kept once the typing stops, if the
  // edit is worth one.
  lastSeenText = current;

  if (enabled) scheduleCapture();
}

/**
 * Keeps the version that is waiting, right away.
 *
 * The last edit of a session must not be lost when the tab is closed, so
 * the waiting capture is decided before the page goes away. A small edit
 * that is not worth a version is safe in the draft either way.
 */
function flushCapture() {
  if (captureTimer === null) return;
  cancelCapture();

  captureVersion(REASON_AUTO, { force: takeForce() });
}

/* ==========================================================================
 * The dialog
 * ========================================================================== */

/**
 * The name of a version.
 * @param {string} reason
 * @returns {string}
 */
function reasonLabel(reason) {
  return REASON_LABELS[reason] ?? REASON_LABELS[REASON_AUTO];
}

/**
 * Draws one version.
 * @param {object} version
 * @returns {HTMLElement}
 */
function renderVersion(version) {
  const row = document.createElement('div');
  row.className = 'history-entry';
  row.dataset.id = version.id;

  const head = document.createElement('div');
  head.className = 'history-entry-head';

  const title = document.createElement('div');
  title.className = 'history-entry-title';
  title.textContent = version.title || 'Untitled';

  const meta = document.createElement('div');
  meta.className = 'history-entry-meta';
  meta.textContent = `${formatRelativeTime(version.at)} · ${version.chars.toLocaleString()} chars · ${reasonLabel(version.reason)}`;

  head.append(title, meta);

  const actions = document.createElement('div');
  actions.className = 'history-entry-actions';

  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'btn btn-sm';
  preview.textContent = 'Preview';
  preview.addEventListener('click', () => togglePreview(row, version.id));

  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = 'btn btn-sm';
  restore.textContent = 'Restore';
  restore.addEventListener('click', () => restoreVersion(version.id));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-sm btn-danger';
  remove.textContent = 'Delete';
  remove.addEventListener('click', () => deleteVersion(version.id));

  actions.append(preview, restore, remove);

  row.append(head, actions);
  return row;
}

/**
 * Shows the beginning of a version — or hides it again.
 * @param {HTMLElement} row
 * @param {string} id
 */
function togglePreview(row, id) {
  const shown = row.querySelector('.history-preview');
  if (shown) {
    shown.remove();
    return;
  }

  const entry = getVersion(id);
  if (!entry) return;

  // The text of a version is the text of the user: it is put into the
  // page as text, never as markup.
  const preview = document.createElement('pre');
  preview.className = 'history-preview';
  preview.textContent = entry.markdown.slice(0, PREVIEW_CHARS);

  row.appendChild(preview);
}

/**
 * Draws the whole list again.
 */
function renderHistory() {
  const versions = listVersions();
  const stats = historyStats();

  if (el.historyStats) {
    const noun = stats.count === 1 ? 'version' : 'versions';
    el.historyStats.textContent = `${stats.count} ${noun} · ${formatBytes(stats.bytes)}`;
  }

  if (el.historyEmpty) {
    el.historyEmpty.hidden = versions.length > 0;
  }

  if (!el.historyList) return;
  el.historyList.replaceChildren();

  versions.forEach((version) => {
    el.historyList.appendChild(renderVersion(version));
  });
}

/**
 * Puts an older version back into the document.
 * @param {string} id
 */
async function restoreVersion(id) {
  const entry = getVersion(id);
  if (!entry) return;

  const confirmed = await confirmDialog({
    title: 'Restore this version?',
    message: `The document goes back to "${entry.title || 'Untitled'}" (${formatRelativeTime(
      entry.at
    )}). The version on screen is kept in the history.`,
    confirmLabel: 'Restore',
    danger: true
  });
  if (!confirmed) return;

  // The version that is on screen is kept, so that the restore can be
  // taken back as well — unless the history is switched off.
  if (historyEnabled()) {
    addVersion(currentText(), { reason: REASON_BEFORE_RESTORE, limit: historyLimit() });
  }

  restoring = true;
  try {
    setMarkdown(entry.markdown, 'replaced');
  } finally {
    restoring = false;
  }
  closeDialog();
  setMessage('Version restored', { tone: 'accent', ttl: 2500 });
}

/**
 * Throws one version away.
 * @param {string} id
 */
function deleteVersion(id) {
  removeVersion(id);
  renderHistory();
  setMessage('Version deleted', { tone: 'muted', ttl: 2000 });
}

/**
 * Throws the whole history away.
 */
async function clearAll() {
  const confirmed = await confirmDialog({
    title: 'Clear the version history?',
    message: 'Every stored version is removed. The document itself is not touched.',
    confirmLabel: 'Clear history',
    danger: true
  });
  if (!confirmed) return;

  clearHistory();
  renderHistory();
  setMessage('The version history is empty', { tone: 'muted', ttl: 2500 });
}

/**
 * Keeps the version of the document that is on screen, right now.
 */
function saveNow() {
  const result = captureVersion(REASON_MANUAL, { force: true });

  if (!result.added) {
    const message =
      result.reason === 'duplicate'
        ? 'This version is already in the history'
        : result.reason === 'disabled'
          ? 'The version history is switched off'
          : 'The version could not be saved';
    setMessage(message, { tone: 'muted', ttl: 2500 });
    return;
  }

  renderHistory();
  setMessage('Version saved', { tone: 'accent', ttl: 2000 });
}

/**
 * Opens the version history.
 */
export function openDialog() {
  if (!el.modalHistory) return;

  lastFocused = document.activeElement;
  renderHistory();

  el.modalHistory.removeAttribute('hidden');
  el.btnHistoryClose?.focus();
}

/**
 * Closes the version history and gives the focus back.
 */
export function closeDialog() {
  el.modalHistory?.setAttribute('hidden', '');

  // The focus goes back where it was — unless that place is inside a
  // dialog that has been closed since (the history opened from the
  // preferences, for instance).
  const target =
    lastFocused && document.contains(lastFocused) && !lastFocused.closest('[hidden]')
      ? lastFocused
      : el.btnHistory;
  lastFocused = null;

  if (target && typeof target.focus === 'function') {
    try {
      target.focus();
    } catch {
      /* the element may be gone already */
    }
  }
}

/* ==========================================================================
 * Bootstrap
 * ========================================================================== */

/**
 * Initializes the version history.
 */
export function initHistory() {
  // The text the app starts with is the baseline: it is the text that is
  // there before the first change — and it is not a version yet.
  lastSeenText = currentText();

  el.btnHistory?.addEventListener('click', openDialog);
  el.btnCloseHistory?.addEventListener('click', closeDialog);
  el.btnHistoryClose?.addEventListener('click', closeDialog);
  el.btnHistorySave?.addEventListener('click', saveNow);
  el.btnHistoryClear?.addEventListener('click', clearAll);

  el.modalHistory?.addEventListener('click', (event) => {
    if (event.target === el.modalHistory) closeDialog();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (!el.modalHistory || el.modalHistory.hasAttribute('hidden')) return;

    // A confirmation the history itself opened is on top: the Escape key
    // answers that dialog, and the history stays where it is.
    if (document.querySelector('dialog[open]')) return;

    closeDialog();
  });

  // The document changes
  onContentChange(handleContentChange);

  // The list stays honest while the dialog is open — a version that is
  // taken in the background belongs in it.
  onHistoryChange(() => {
    if (el.modalHistory && !el.modalHistory.hasAttribute('hidden')) renderHistory();
  });

  // The last edit of the session is kept before the page goes away.
  window.addEventListener('pagehide', flushCapture);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushCapture();
  });
}

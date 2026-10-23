/**
 * ============================================================================
 * KEYBOARD SHORTCUTS
 * ============================================================================
 * One place for every keyboard interaction, so the behaviour is consistent
 * and easy to extend.
 *
 * Rules:
 *   • Shortcuts never fire while the user is typing in a text field, unless
 *     the shortcut is explicitly a formatting command.
 *   • The Space key belongs to the app: it plays and pauses the narration
 *     everywhere — also when a button or a slider has the focus. Only a
 *     check box keeps it, and a dialog keeps it as well.
 *   • Escape always does the least destructive thing first: it closes the
 *     preferences dialog if that is open, and only then stops narration.
 * ============================================================================
 */

import { el } from '@/app/shell/dom.js';
import { stop, isSpeaking, isNarrationStarting } from '@/speech/tts.js';
import { applyFormat, flushDraft } from '@/app/editor/editor.js';
import { setView } from '@/app/shell/layout.js';
import { pasteFromClipboard } from '@/app/editor/paste.js';
import { openDialog as openUrlImportDialog } from '@/app/import/url-import.js';
import { openDialog as openTranslateDialog } from '@/app/translate/translate.js';
import { openDialog as openHistoryDialog, captureNow } from '@/app/history/dialog.js';
import { openNewTab } from '@/app/editor/new-tab.js';
import { toggleNarration, cancelPendingStart } from '@/app/preview/narration.js';
import { setMessage } from '@/app/shell/status.js';

/**
 * @param {EventTarget|null} target
 * @returns {boolean} whether the event target is a text entry field
 */
function isTextEntry(target) {
  if (!target || target === el.editor) return false;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || target.isContentEditable === true) return true;
  // Only the inputs that take text — a slider or a button is not one, and
  // the Space key has to keep working there.
  if (tag === 'INPUT') {
    const type = (target.getAttribute('type') || 'text').toLowerCase();
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file'].includes(
      type
    );
  }
  return false;
}

/**
 * @param {EventTarget|null} target
 * @returns {boolean} whether the target needs the Space key for itself
 *
 * Only a check box or a radio button does: for them, Space *is* the way to
 * change the setting. Everything else — buttons, links, sliders, drop-downs —
 * gives the Space key back to the app, so that the key means the same thing
 * everywhere. Buttons and links still react to Enter.
 */
function ownsSpace(target) {
  if (!target || !target.tagName) return false;
  if (target.tagName.toLowerCase() !== 'input') return false;

  const type = (target.getAttribute('type') || 'text').toLowerCase();
  return type === 'checkbox' || type === 'radio';
}

/**
 * Saves the draft and keeps a version of the document — what Ctrl+S means
 * here. A version is kept whatever the size of the change: the user asked
 * for this one.
 */
function saveDocument() {
  flushDraft();

  const kept = captureNow();
  setMessage(kept.added ? '💾 Draft saved — version kept' : '💾 Draft saved', {
    tone: 'accent',
    ttl: 1800
  });
}

/**
 * @returns {boolean} whether a modal surface is currently open
 */
function isModalOpen() {
  if (el.modalSettings && !el.modalSettings.hasAttribute('hidden')) return true;
  if (el.modalUrlImport && !el.modalUrlImport.hasAttribute('hidden')) return true;
  if (el.modalTranslate && !el.modalTranslate.hasAttribute('hidden')) return true;
  if (el.modalHistory && !el.modalHistory.hasAttribute('hidden')) return true;
  return Boolean(document.querySelector('dialog[open]'));
}

/**
 * Handles a single key press.
 * @param {KeyboardEvent} event
 */
function onKeyDown(event) {
  const mod = event.ctrlKey || event.metaKey;
  const inEditor = event.target === el.editor;
  const inField = isTextEntry(event.target);

  /* ---------------------------------------------------------------- ESC --
   * Escape closes the preferences dialog first; if no dialog is open it
   * stops the narration.
   */
  if (event.key === 'Escape') {
    if (el.modalSettings && !el.modalSettings.hasAttribute('hidden')) return; // handled by the modal
    if (el.modalUrlImport && !el.modalUrlImport.hasAttribute('hidden')) return; // handled by the modal
    if (el.modalTranslate && !el.modalTranslate.hasAttribute('hidden')) return; // handled by the modal
    if (el.modalHistory && !el.modalHistory.hasAttribute('hidden')) return; // handled by the modal
    const pending = cancelPendingStart();
    if (isSpeaking() || isNarrationStarting() || pending) {
      event.preventDefault();
      stop('user');
      setMessage('Reading stopped', { tone: 'muted', ttl: 1500 });
    }
    return;
  }

  /* ------------------------------------------------------- formatting --
   * These work inside the editor, where the browser's own bold/italic
   * shortcuts would otherwise do nothing.
   */
  if (inEditor && mod && !event.altKey) {
    const key = event.key.toLowerCase();

    if (key === 'b') {
      event.preventDefault();
      applyFormat('bold');
      return;
    }

    if (key === 'i') {
      event.preventDefault();
      applyFormat('italic');
      return;
    }

    if (key === 's') {
      event.preventDefault();
      saveDocument();
      return;
    }
  }

  /* -------------------------------------------------------------- save --
   * The browser's own Ctrl+S saves the page; here it saves the document,
   * wherever the focus is — unless a field, a dialog or a shortcut with
   * more keys owns the combination.
   */
  if (
    mod &&
    !event.shiftKey &&
    !event.altKey &&
    !inField &&
    !isModalOpen() &&
    event.key.toLowerCase() === 's'
  ) {
    event.preventDefault();
    saveDocument();
    return;
  }

  /* ------------------------------------------------------------ new tab --
   * Ctrl+Alt+N / Cmd+Option+N opens the next article in a tab of its own.
   * Ctrl+Shift+N is not used, because the browser takes it for incognito.
   */
  if (mod && event.altKey && !event.shiftKey && !isModalOpen() && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    openNewTab();
    return;
  }
  /* ------------------------------------------------------------- paste --
   * The browser's own paste only reaches a text field, so outside the editor
   * the app offers its own: it makes the clipboard the document, without a
   * trip through the view switcher.
   */
  if (
    mod &&
    event.shiftKey &&
    !event.altKey &&
    !inEditor &&
    !inField &&
    !isModalOpen() &&
    event.key.toLowerCase() === 'v'
  ) {
    event.preventDefault();
    pasteFromClipboard();
    return;
  }

  /* ------------------------------------------------------ url import --
     The same shape as the paste shortcut: a command that brings something
     in, reachable from anywhere outside the editor.
     */
  if (
    mod &&
    event.shiftKey &&
    !event.altKey &&
    !inEditor &&
    !inField &&
    !isModalOpen() &&
    event.key.toLowerCase() === 'u'
  ) {
    event.preventDefault();
    openUrlImportDialog();
    return;
  }

  /* ------------------------------------------------------- translate --
     The same shape as the import shortcut: a command that changes the
     document, reachable from anywhere outside the editor. Ctrl+Shift+T is
     not used, because the browser takes it for "reopen the last tab".
     */
  if (
    mod &&
    event.shiftKey &&
    !event.altKey &&
    !inEditor &&
    !inField &&
    !isModalOpen() &&
    event.key.toLowerCase() === 'l'
  ) {
    event.preventDefault();
    openTranslateDialog();
    return;
  }

  /* --------------------------------------------------------- history --
     The same shape again: a command that shows something, reachable from
     anywhere outside the editor.
     */
  if (
    mod &&
    event.shiftKey &&
    !event.altKey &&
    !inEditor &&
    !inField &&
    !isModalOpen() &&
    event.key.toLowerCase() === 'h'
  ) {
    event.preventDefault();
    openHistoryDialog();
    return;
  }

  /* -------------------------------------------------- playback & views --
   * These only apply outside the editor, so they never get in the way of
   * writing — and never while a dialog owns the keyboard.
   */
  if (inEditor || inField || mod || event.altKey || isModalOpen()) return;

  if (event.code === 'Space') {
    // A check box keeps the key: for it, Space is the way to change the
    // setting.
    if (ownsSpace(event.target)) return;

    event.preventDefault();
    const state = toggleNarration();
    if (state === 'paused') {
      setMessage('Paused - press Space to continue', { tone: 'accent', ttl: 2500 });
    } else if (state === 'empty') {
      setMessage('Nothing to read', { tone: 'muted', ttl: 2000 });
    } else {
      setMessage('Reading.', { tone: 'accent', ttl: 1500 });
    }
    return;
  }

  if (event.key === '1') {
    event.preventDefault();
    setView('edit');
    return;
  }

  if (event.key === '2') {
    event.preventDefault();
    setView('split');
    return;
  }

  if (event.key === '3') {
    event.preventDefault();
    setView('preview');
  }
}

/**
 * Initializes the keyboard shortcuts.
 */
export function initShortcuts() {
  window.addEventListener('keydown', onKeyDown);
}
